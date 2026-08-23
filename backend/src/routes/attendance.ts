import { Router } from 'express';
import Attendance from '../models/Attendance';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { todayInTashkent, tashkentHour } from '../utils/tz';
import { bot, keyboardForUser, fmtWorkDuration } from '../services/bot';
import { tb, BotLang } from '../i18n/bot';
import { emitToUser } from '../services/socket';

// MUHIM: xodim "Ishga keldim"/"Ishni yakunlash"ni SAYTDAN bossa, botning
// o'zi bundan XABARSIZ qolardi — Telegram'dagi klaviatura (tugmalar to'plami)
// faqat BOT bilan bevosita muloqotda (masalan /start yoki biror tugma
// bosilganda) yangilanardi. Natijada foydalanuvchi saytdan ishni tugatgan
// bo'lsa ham, botni ochsa hali ham ESKI (masalan hali "Ishga keldim"gina
// bor yoki hali "ishlayapman" holatidagi) klaviaturani ko'rardi. Endi har
// ikkala amalda ham botga TO'G'RIDAN-TO'G'RI yangilangan klaviatura bilan
// xabar yuboriladi — sayt yoki bot, qaysi biridan foydalanilishidan qat'i
// nazar ikkalasi ham DOIM sinxron.
async function pushBotKeyboardRefresh(userId: string, buildMessage: (lang?: BotLang) => string) {
  try {
    const user = await User.findById(userId).select('telegramChatId language role companyId').lean();
    if (!user?.telegramChatId) return;
    const lang = user.language as BotLang | undefined;
    const keyboard = await keyboardForUser(user, lang);
    await bot.sendMessage(user.telegramChatId, buildMessage(lang), { reply_markup: keyboard });
  } catch (err) {
    console.error('[attendance] bot klaviatura yangilash xatosi:', err);
  }
}

const router = Router();

// GET /api/attendance/list — BOSHQARUV ko'rinishi: firmadagi HAR BIR
// ishchining bugungi yo'qlama holati (kelgan/kelmagan, kelgan/ketgan vaqti,
// ishlagan davomiylik). /today'dan farqli — u faqat O'ZINI ko'rsatadi, bu esa
// direktor/orinbosar (va nazorat uchun dasturchi) uchun HAMMA xodimni birdan.
// Firma ichki HR-ma'lumoti bo'lsa ham, boshqa /api/objects, /api/transactions
// kabi yo'llardan farqli — dasturchi bu yerda ATAYLAB bloklanmagan (foydalanuvchi
// aniq talabi bilan): oldindan mavjud /api/gps yo'llari ham xuddi shunday,
// blockDeveloper qo'llanilmagan.
router.get('/list', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const allowed = tenant.role === 'direktor' || tenant.role === 'orinbosar' || tenant.role === 'dasturchi' || tenant.isDeveloper;
    if (!allowed) return res.status(403).json({ error: 'Ruxsat yo\'q' });

    const workerRoles = ['ishchi', 'prorab', 'brigadir'] as const;
    const users = await User.find({ ...scoped(), role: { $in: workerRoles } })
      .select('firstName lastName role phone').lean();

    const today = todayInTashkent();
    const userIds = users.map(u => String(u._id));
    const records = await Attendance.find({ ...scoped(), date: today, userId: { $in: userIds } }).lean();
    const byUser = new Map(records.map(r => [r.userId, r]));

    const now = Date.now();
    const list = users.map(u => {
      const uid = String(u._id);
      const rec = byUser.get(uid);
      let status: 'NOT_STARTED' | 'WORKING' | 'FINISHED' = 'NOT_STARTED';
      let minutesWorking: number | null = null;
      if (rec?.checkIn && rec?.checkOut) status = 'FINISHED';
      else if (rec?.checkIn) {
        status = 'WORKING';
        minutesWorking = Math.round((now - new Date(rec.checkIn).getTime()) / 60000);
      }
      return {
        userId: uid,
        name: u.firstName + (u.lastName ? ' ' + u.lastName : ''),
        role: u.role,
        phone: u.phone,
        status,
        checkIn: rec?.checkIn || null,
        checkOut: rec?.checkOut || null,
        workHours: rec?.workHours ?? null,
        minutesWorking,
      };
    });
    res.json(list);
  } catch (err) {
    console.error('[attendance/list]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/attendance — o'z yoki kompaniya yozuvlari
// XAVFSIZLIK — TOPILMA (audit): `userId` firmalararo sizishdan scoped()
// bilan himoyalangan edi, lekin firma ICHIDA hech qanday rol tekshiruvi
// yo'q edi — istalgan oddiy ishchi boshqa xodimning to'liq yo'qlama
// tarixini (kelish/ketish vaqtlari) ko'ra olardi. Endi /list bilan bir
// xil qoida: faqat o'zi, yoki direktor/orinbosar/dasturchi boshqasini ham.
router.get('/', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { userId, from, to, date } = req.query as Record<string, string>;
    const isBoss = tenant.role === 'direktor' || tenant.role === 'orinbosar' || tenant.role === 'dasturchi' || tenant.isDeveloper;
    if (userId && String(userId) !== String(tenant.userId) && !isBoss) {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }
    const filter: any = scoped();
    filter.userId = userId || tenant.userId;
    if (date) { filter.date = date; }
    else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    const records = await Attendance.find(filter).sort({ date: -1 });
    res.json(records.map(r => ({ ...r.toObject(), id: r._id })));
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// POST /api/attendance/checkin — kirish qayd etish
router.post('/checkin', async (req, res) => {
  try {
    const tenant = getTenant();
    const { lat, lng, note } = req.body;
    const userId = tenant?.userId;
    if (!userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const today = todayInTashkent();
    const now = new Date();
    const status = tashkentHour(now) >= 9 ? 'late' : 'present'; // 9:00 dan keyin kech keldi

    let record = await Attendance.findOne({ userId, date: today });
    if (record?.checkIn) return res.status(400).json({ error: 'Bugun allaqachon kirishni qayd etgansiz' });

    if (!record) {
      record = new Attendance(stamped({ userId, date: today }));
    }
    record.checkIn = now.toISOString();
    record.status = status;
    if (lat != null) record.lat = lat;
    if (lng != null) record.lng = lng;
    if (note) record.note = note;
    await record.save();

    const payload = { ...record.toObject(), id: record._id };
    res.json(payload);

    // Bot klaviaturasini darhol yangilaymiz (sayt orqali qilingan bo'lsa ham) —
    // aks holda foydalanuvchi botni ochsa ESKI (masalan hali "Ishga keldim"gina
    // bor) klaviaturani ko'raverardi, chunki bot bu o'zgarishdan bexabar edi.
    const checkInTime = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
    pushBotKeyboardRefresh(userId, lang => tb(lang, 'checkInConfirmed', { time: checkInTime })).catch(() => {});
    // Saytdagi/ilovadagi BOSHQA ochiq sessiyalarga (masalan ilova ochiq
    // turgan holda check-in botdan qilingan bo'lsa) DARHOL xabar beramiz —
    // aks holda "Ishga keldim" tugmasi eskirgan holatda ko'rinaverardi,
    // faqat qo'lda sahifani yangilash yordam berardi (aniq xabar qilingan
    // xato: "site ga ilovaga kirsam ham ishga keldim tugmasi turibdi").
    emitToUser(userId, 'attendance:update', payload);
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// POST /api/attendance/checkout — chiqishni qayd etish
router.post('/checkout', async (req, res) => {
  try {
    const tenant = getTenant();
    const { lat, lng, note } = req.body;
    const userId = tenant?.userId;
    if (!userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const today = todayInTashkent();
    const record = await Attendance.findOne({ userId, date: today });
    if (!record) return res.status(400).json({ error: 'Avval kirish qayd etilmagan' });
    if (record.checkOut) return res.status(400).json({ error: 'Chiqish allaqachon qayd etilgan' });

    const now = new Date();
    record.checkOut = now.toISOString();
    if (lat != null) record.checkOutLat = lat;
    if (lng != null) record.checkOutLng = lng;
    if (note) record.note = (record.note ? record.note + ' | ' : '') + note;

    // Ishlangan soatlar hisoblash
    let workedMinutes = 0;
    if (record.checkIn) {
      const ms = now.getTime() - new Date(record.checkIn).getTime();
      workedMinutes = Math.max(0, Math.round(ms / 60000));
      record.workHours = Math.round((ms / 3600000) * 10) / 10;
    }
    await record.save();
    const payload = { ...record.toObject(), id: record._id };
    res.json(payload);

    // Bot klaviaturasini darhol yangilaymiz (sayt orqali qilingan bo'lsa ham).
    const checkOutTime = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
    pushBotKeyboardRefresh(userId, lang => tb(lang, 'checkOutConfirmed', { time: checkOutTime, hours: fmtWorkDuration(workedMinutes, lang) })).catch(() => {});
    emitToUser(userId, 'attendance:update', payload);
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// GET /api/attendance/today — bugungi holat
router.get('/today', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const today = todayInTashkent();
    const record = await Attendance.findOne({ userId: tenant.userId, date: today });
    res.json(record ? { ...record.toObject(), id: record._id } : null);
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// GET /api/attendance/stats — oylik statistika
// XAVFSIZLIK — TOPILMA (audit): bu marshrutda scoped() UMUMAN yo'q edi —
// firmalararo to'liq sizish (boshqa firmaning istalgan xodimi ID'sini
// bersa, uning butun oylik yo'qlama tarixi va statistikasi ko'rinardi),
// ustiga hech qanday rol tekshiruvi ham yo'q edi (firma ichida ham
// istalgan xodim boshqasinikini ko'ra olardi). Endi /list va yuqoridagi
// GET / bilan bir xil qoida.
router.get('/stats', async (req, res) => {
  try {
    const { userId, month } = req.query as Record<string, string>;
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const isBoss = tenant.role === 'direktor' || tenant.role === 'orinbosar' || tenant.role === 'dasturchi' || tenant.isDeveloper;
    if (userId && String(userId) !== String(tenant.userId) && !isBoss) {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }
    const targetUserId = userId || tenant.userId;

    const yearMonth = month || new Date().toISOString().slice(0, 7);
    const from = `${yearMonth}-01`;
    const toDate = new Date(yearMonth + '-01');
    toDate.setMonth(toDate.getMonth() + 1);
    const to = toDate.toISOString().split('T')[0];

    const records = await Attendance.find(scoped({ userId: targetUserId, date: { $gte: from, $lt: to } })).sort({ date: 1 });
    const present = records.filter(r => r.status === 'present').length;
    const late = records.filter(r => r.status === 'late').length;
    const absent = records.filter(r => r.status === 'absent').length;
    const totalHours = records.reduce((s, r) => s + (r.workHours || 0), 0);

    res.json({ records: records.map(r => ({ ...r.toObject(), id: r._id })), stats: { present, late, absent, totalHours: Math.round(totalHours * 10) / 10, days: records.length } });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

export default router;
