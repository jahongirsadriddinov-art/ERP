import { receiptToExpense } from '../services/botExpense';
import { todayInTashkent } from '../utils/tz';
import { checkRate } from '../utils/rateLimit';
import ObjectForHints from '../models/Object';
import { Router } from 'express';
import Transaction from '../models/Transaction';
import Material from '../models/Material';
import { bot, notifyAdmins } from '../services/bot';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { emitToUser } from '../services/socket';
import { tb, BotLang } from '../i18n/bot';
import { logAudit } from '../services/audit';
// XATO TUZATILDI: bu faylda avval FAQAT Telegram bot xabari (bot.sendMessage)
// va real-vaqt socket (emitToUser) yuborilardi — foydalanuvchi bot orqali
// EMAS, faqat sayt/APK/Windows dasturi orqali ishlasa (Telegram ochmasa) va
// ilova ochiq bo'lmasa, yangi yukxat/to'lov/tasdiqlash haqida HECH QANDAY
// xabar olmasdi (aniq foydalanuvchi shikoyati: "sayt/ilova/exe'ning o'zining
// bildirishnomasi kelmayapti"). messages.ts'da ALLAQACHON mavjud bo'lgan Web
// Push (sendPushToUser — chinakam qurilma bildirishnomasi, ilova yopiq
// bo'lsa ham keladi) endi shu faylning barcha bildirishnoma nuqtalariga ham
// qo'shildi.
import { sendPushToUser } from '../services/push';
import { approveTransactionAction, confirmTransactionAction, rejectTransactionAction } from '../services/transactionActions';

const router = Router();

// Idempotency cache: key → { id, result, expiresAt }
// Duplicate POST /:id/confirm yoki yangi expense yaratilganda ikki marta yuborilishiga qarshi
const idempotencyCache = new Map<string, { id: string; result: any; expiresAt: number }>();
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000; // 24 soat

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of idempotencyCache) { if (v.expiresAt < now) idempotencyCache.delete(k); }
}, 60 * 60 * 1000); // 1 soatda bir tozalaymiz

// Get all transactions
// Ko'rinish (visibility) qoidasi: direktor/orinbosar firmaning BARCHA
// tranzaksiyalarini ko'radi (moliyani nazorat qilish ularning vazifasi).
// Boshqa har qanday rol (ishchi, prorab, brigadir va h.k.) FAQAT o'zi
// yaratgan yoki o'ziga tegishli (yuboruvchi/qabul qiluvchi) yozuvlarni
// ko'radi — boshqa xodimlarning shaxsiy chiqim/maosh yozuvlari ko'rinmaydi.
// companyId izolyatsiyasi scoped() orqali baribir ustidan qo'llanadi.
router.get('/', async (req, res) => {
  try {
    const tenant = getTenant();
    const isFinanceAdmin = tenant?.isDeveloper || tenant?.role === 'direktor' || tenant?.role === 'orinbosar';
    // Kirim (owner 2026-10-22): direktor (va firma egasi) — hammaning kirimini; o'rinbosar — faqat o'zi kiritganini;
    // boshqa rollar kirimni ko'rmaydi
    const isDirector = !!tenant?.isDeveloper || tenant?.role === 'direktor' || !!tenant?.isOwner;
    const incomeRule: Record<string, unknown> = isDirector ? {} : tenant?.role === 'orinbosar' && tenant?.userId
      ? { $or: [{ type: { $ne: 'income' } }, { createdById: tenant.userId }] }
      : { type: { $ne: 'income' } };
    const filter = isFinanceAdmin || !tenant?.userId
      ? scoped(incomeRule)
      : scoped({ $and: [incomeRule, { $or: [{ createdById: tenant.userId }, { toUserId: tenant.userId }, { fromUserId: tenant.userId }] }] });
    const transactions = await Transaction.find(filter).sort({ createdAt: -1 });
    res.json(transactions.map(t => ({ ...t.toObject(), id: t._id })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Create transaction (expense or transfer)
router.post('/', async (req, res) => {
  try {
    const data = req.body;

    // Validate required fields
    const VALID_TYPES = ['transfer', 'expense', 'income', 'oylik', 'material', 'jihozlar', 'transport', 'boshqa'];
    // Kirimni faqat direktor va o'rinbosar kiritadi (owner 2026-10-22); tarifga bog'liq emas
    if (req.body?.type === 'income') {
      const tn = getTenant();
      const me = tn?.userId ? await User.findById(tn.userId).select('role isOwner').lean().catch(() => null) as any : null;
      const boss = !!tn?.isDeveloper || (me && (['direktor', 'orinbosar'].includes(me.role) || me.isOwner));
      if (!boss) return res.status(403).json({ error: "Kirimni faqat direktor yoki o'rinbosar kirita oladi" });
    }
    if (!data.type) {
      return res.status(400).json({ success: false, errors: [{ field: 'type', message: 'Tur kiritilishi shart' }] });
    }
    if (!VALID_TYPES.includes(data.type)) {
      return res.status(400).json({ success: false, errors: [{ field: 'type', message: `Noto'g'ri tur: ${data.type}` }] });
    }
    if (data.type === 'transfer') {
      const errs: { field: string; message: string }[] = [];
      if (!data.materialName || String(data.materialName).trim().length < 1)
        errs.push({ field: 'materialName', message: 'Material nomi kiritilishi shart' });
      if (!data.quantity || isNaN(Number(data.quantity)) || Number(data.quantity) <= 0)
        errs.push({ field: 'quantity', message: 'Miqdor musbat son bo\'lishi kerak' });
      if (!data.toUserId)
        errs.push({ field: 'toUserId', message: 'Kimga yuborilishini ko\'rsating' });
      if (errs.length) return res.status(400).json({ success: false, errors: errs });
    } else {
      const amount = Number(data.amount);
      if (!data.amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ success: false, errors: [{ field: 'amount', message: 'Summa musbat son bo\'lishi kerak' }] });
      }
      if (amount > 1e13) {
        return res.status(400).json({ success: false, errors: [{ field: 'amount', message: 'Summa juda katta' }] });
      }
    }

    // Idempotency: agar client idempotency key yuborsa — duplicate requestni qaytaramiz
    const idempKey = (req.headers['x-idempotency-key'] as string || '').trim();
    if (idempKey) {
      const cached = idempotencyCache.get(idempKey);
      if (cached) {
        return res.status(200).json(cached.result);
      }
    }

    const txData: any = {
      type: data.type,
      status: data.status || 'pending',
      date: data.date || data.sentDate || new Date().toISOString().split('T')[0],
    };

    // Transfer specific fields
    if (data.type === 'transfer') {
      // XAVFSIZLIK (audit 2026-10-19): yuboruvchi — faqat o'zi; qabul qiluvchi — shu firmadagi BOSHQA odam;
      // obyekt — shu firmaniki; holat — doim 'pending' (o'ziga yuborib tasdiqlab, tasdiqsiz chiqim yaratib bo'lmasin)
      const me = getTenant()?.userId ? String(getTenant()!.userId) : (data.fromUserId ? String(data.fromUserId) : '');
      if (getTenant()?.userId) {
        if (!data.toUserId || String(data.toUserId) === me) {
          return res.status(400).json({ success: false, errors: [{ field: 'toUserId', message: "O'zingizga yuborib bo'lmaydi" }] });
        }
        const rcpt = await User.findOne(scoped({ _id: String(data.toUserId) })).select('_id firstName lastName').lean().catch(() => null);
        if (!rcpt) return res.status(400).json({ success: false, errors: [{ field: 'toUserId', message: 'Qabul qiluvchi topilmadi' }] });
        if (data.projectId && !(await ObjectForHints.exists(scoped({ _id: String(data.projectId) })).catch(() => null))) {
          return res.status(400).json({ success: false, errors: [{ field: 'projectId', message: 'Obyekt topilmadi' }] });
        }
        data.fromUserId = me;
      }
      txData.status = 'pending';
      txData.materialName = data.materialName;
      txData.quantity = data.quantity;
      txData.unit = data.unit;
      txData.price = data.price != null ? Number(data.price) : undefined;
      txData.projectId = data.projectId ? String(data.projectId) : undefined;
      txData.fromUserId = data.fromUserId ? String(data.fromUserId) : undefined;
      txData.fromUserName = data.fromUserName;
      txData.toUserId = data.toUserId ? String(data.toUserId) : undefined;
      txData.toUserName = data.toUserName;
      txData.note = data.note;
      // Yukxatni kim qo'shgani (owner 2026-10-22: o'zi qo'shganini o'zi tahrirlaydi/o'chiradi) — faqat JWT'dan
      if (getTenant()?.userId) txData.createdById = String(getTenant()!.userId);
    } else {
      // Expense types: oylik, material, jihozlar, transport, boshqa, expense, income
      txData.amount = Number(data.amount) || 0;
      txData.description = data.description;
      txData.projectId = data.projectId ? String(data.projectId) : undefined;
      txData.toUserId = data.toUserId ? String(data.toUserId) : undefined;
      // MUHIM: createdById HECH QACHON so'rov tanasidan olinmaydi — faqat
      // tekshirilgan JWT kontekstidan (companyId/stamped() bilan bir xil
      // qoida). Aks holda har qanday xodim boshqa birovning (masalan
      // direktorning) ID'sini yuborib, quyidagi admin-tasdiqlash talabini
      // chetlab o'tishi yoki tranzaksiyani boshqa birovga yopishtirishi
      // mumkin edi. Faqat autentifikatsiyasiz (legacy) so'rovlarda body'dagi
      // qiymatga qaytiladi — eski xatti-harakat saqlanadi.
      txData.createdById = getTenant()?.userId || (data.createdById ? String(data.createdById) : undefined);
      txData.status = data.toUserId ? 'pending' : (data.status || 'confirmed');
    }

    // direktor/orinbosardan BOSHQA har qanday rol chiqim yaratsa — admin
    // tasdiqlashi shart (allow-list emas, deny-list: yangi rol qo'shilsa ham
    // ushbu qoida avtomatik ishlab turadi). Bunday holatda ANIQ kim
    // tasdiqlashini xodimning O'ZI tanlashi SHART (aniq talab) — bo'sh
    // "istalgan admin tasdiqlasin" endi qabul qilinmaydi.
    const creatorId = txData.createdById || getTenant()?.userId;
    if (txData.type !== 'transfer' && creatorId) {
      const creator = await User.findById(creatorId).catch(() => null);
      if (creator && !['direktor', 'orinbosar'].includes(creator.role)) {
        txData.requiresAdminApproval = true;
        txData.status = 'pending';

        const approverId = data.approverId ? String(data.approverId) : undefined;
        if (!approverId) {
          return res.status(400).json({ success: false, errors: [{ field: 'approverId', message: 'Kim tasdiqlashini tanlang' }] });
        }
        const approver = await User.findOne({ _id: approverId, companyId: creator.companyId }).catch(() => null);
        if (!approver || !['direktor', 'orinbosar'].includes(approver.role)) {
          return res.status(400).json({ success: false, errors: [{ field: 'approverId', message: 'Noto\'g\'ri tasdiqlovchi tanlandi' }] });
        }
        txData.approverId = approverId;
      }
    }

    const tx = new Transaction(stamped(txData));
    await tx.save();

    // Send telegram notification
    if (tx.status === 'pending') {
      try {
        if (tx.type === 'transfer' && tx.toUserId) {
          // Bitta xabarda: to'liq matn + tugmalar (avval 2 alohida xabar edi)
          const toUser = await User.findById(tx.toUserId).catch(() => null);
          if (toUser && toUser.telegramChatId) {
            const toLang = toUser.language as BotLang | undefined;
            const msg = tb(toLang, 'transferNewFull', { name: tx.materialName || '—', qty: String(tx.quantity), unit: tx.unit || '', sender: tx.fromUserName || '—', date: tx.date || '—' });
            await bot.sendMessage(toUser.telegramChatId, msg, {
              parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
                { text: tb(toLang, 'confirmBtn'), callback_data: `confirm_${tx._id}` },
                { text: tb(toLang, 'rejectBtn'), callback_data: `reject_${tx._id}` },
              ]] }
            }).catch(console.error);
          }
          if (toUser) {
            sendPushToUser(String(toUser._id), {
              title: '📦 Yangi yukxat',
              body: `${tx.materialName || '—'} — ${tx.quantity} ${tx.unit || ''}`,
              tag: 'transfer',
            }).catch(() => {});
          }
        } else if (tx.type !== 'transfer' && tx.toUserId) {
          // Payment to specific user — bitta xabarda matn + tugmalar
          const toUser = await User.findById(tx.toUserId).catch(() => null);
          if (toUser && toUser.telegramChatId) {
            const toLang = toUser.language as BotLang | undefined;
            const msg = tb(toLang, 'paymentNew', { amount: `${(tx.amount || 0).toLocaleString()} so'm`, reason: tx.description || '—', date: tx.date || '—' });
            await bot.sendMessage(toUser.telegramChatId, msg, {
              parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
                { text: tb(toLang, 'confirmBtn'), callback_data: `confirm_${tx._id}` },
                { text: tb(toLang, 'rejectBtn'), callback_data: `reject_${tx._id}` },
              ]] }
            }).catch(console.error);
          }
          if (toUser) {
            sendPushToUser(String(toUser._id), {
              title: '💰 Yangi to\'lov',
              body: `${tx.description || '—'} — ${(tx.amount || 0).toLocaleString()} so'm`,
              tag: 'payment',
            }).catch(() => {});
          }
        }

        // Chiqim uchun ANIQ tasdiqlovchi tanlangan bo'lsa — o'sha odamga
        // to'g'ridan-to'g'ri, harakat tugmalari bilan xabar (bu yuqoridagi
        // toUserId xabaridan FARQLI: u "pul oldingizmi" deb so'raydi, bu esa
        // "chiqimni tasdiqlaysizmi" deb so'raydi — ikkalasi ham kelishi mumkin).
        if (tx.requiresAdminApproval && tx.approverId) {
          const approverUser = await User.findById(tx.approverId).catch(() => null);
          if (approverUser && approverUser.telegramChatId) {
            const aLang = approverUser.language as BotLang | undefined;
            const requester = await User.findById(tx.createdById).catch(() => null);
            const requesterName = requester ? `${requester.firstName} ${requester.lastName || ''}`.trim() : '—';
            const msg = tb(aLang, 'approverPaymentNew', { amount: `${(tx.amount || 0).toLocaleString()} so'm`, reason: tx.description || '—', date: tx.date || '—', requester: requesterName });
            await bot.sendMessage(approverUser.telegramChatId, msg, {
              parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
                { text: tb(aLang, 'confirmBtn'), callback_data: `confirm_${tx._id}` },
                { text: tb(aLang, 'rejectBtn'), callback_data: `reject_${tx._id}` },
              ]] }
            }).catch(console.error);
          }
          if (approverUser) {
            sendPushToUser(String(approverUser._id), {
              title: '💰 Tasdiqlash kerak',
              body: `${tx.description || '—'} — ${(tx.amount || 0).toLocaleString()} so'm`,
              tag: 'approval',
            }).catch(() => {});
          }
        }

        // Boshqa (tanlanmagan) adminlarga — shunchaki xabardorlik uchun,
        // tugmasiz (ular baribir tasdiqlay olmaydi — yuqoridagi tekshiruvga qarang).
        const adminMsg = tx.type === 'transfer'
          ? `📦 *Yangi yukxat*\n${tx.materialName} — ${tx.quantity} ${tx.unit}\nYuboruvchi: ${tx.fromUserName || '—'}\nQabul qiluvchi: ${tx.toUserName || '—'}`
          : `💰 *Yangi to'lov so'rovi*\n${tx.description || '—'} — ${(tx.amount || 0).toLocaleString()} so'm`;
        if (tx.companyId) await notifyAdmins(adminMsg, undefined, String(tx.companyId)).catch(console.error); // faqat shu firma rahbarlari

      } catch(notifErr) {
        console.error('Telegram notification error:', notifErr);
      }
    }

    const result = tx.toObject();
    const responseBody = { ...result, id: tx._id };
    // Idempotency key bo'lsa — natijani cache'ga qo'shamiz (24 soat)
    if (idempKey) {
      idempotencyCache.set(idempKey, { id: String(tx._id), result: responseBody, expiresAt: Date.now() + IDEMPOTENCY_TTL });
    }
    res.status(201).json(responseBody);
  } catch (err) {
    console.error('Transaction POST error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Confirm transaction — FAQAT qabul qiluvchi (tx.toUserId) tasdiqlashi mumkin.
// confirmedById HECH QACHON so'rov tanasidan olinmaydi — faqat tekshirilgan
// JWT (getTenant().userId) dan, aks holda boshqa odam ("sender") ham
// o'zi yuborgan tranzaksiyani tasdiqlab qo'ya olar edi.
router.patch('/:id/confirm', async (req, res) => {
  try {
    const r = await confirmTransactionAction({ txFilter: scoped({ _id: req.params.id }), actorUserId: getTenant()?.userId, defect: req.body?.defect });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    const result = r.tx.toObject();
    res.json({ ...result, id: r.tx._id });
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Admin chiqim tasdiqlash (expense approval chain). Mantiq — services/transactionActions.ts
// (AI yordamchi ham aynan shu funksiyani chaqiradi: bir xil qoidalar, atomik holat o'tishi).
router.patch('/:id/approve', async (req, res) => {
  try {
    const r = await approveTransactionAction({ txFilter: scoped({ _id: req.params.id }), actorUserId: getTenant()?.userId, note: req.body?.note, req });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.json({ ...r.tx.toObject(), id: r.tx._id });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Reject transaction — qabul qiluvchi yoki admin (approverId tanlangan bo'lsa — faqat o'sha admin)
router.patch('/:id/reject', async (req, res) => {
  try {
    const r = await rejectTransactionAction({ txFilter: scoped({ _id: req.params.id }), actorUserId: getTenant()?.userId, note: req.body?.note });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    const result = r.tx.toObject();
    res.json({ ...result, id: r.tx._id });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Delete transaction
// XAVFSIZLIK — TOPILMA (audit): scoped() firmalararo o'chirishni to'sardi,
// lekin firma ICHIDA hech qanday rol tekshiruvi yo'q edi — /approve,
// /confirm, /reject barchasida rol/egalik tekshiruvi bor edi, faqat
// o'chirishda yo'q qolib ketgan (aniq xatolik) — istalgan oddiy ishchi
// firmaning istalgan moliyaviy yozuvini (o'zi yaratmagan bo'lsa ham)
// butunlay o'chira olardi.
// POST /api/transactions/scan-receipt — chek/nakladnoy suratidan chiqim maydonlarini o'qish (saqlamaydi —
// foydalanuvchi tekshirib, keyin oddiy chiqim sifatida yuboradi).
router.post('/scan-receipt', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    if (!checkRate(`receipt:${t.userId}`, 40, 60 * 60_000).allowed) return res.status(429).json({ error: "Juda ko'p urinish — birozdan keyin" });
    const { image, mimeType } = req.body || {};
    if (typeof image !== 'string' || image.length < 500 || image.length > 8_000_000) return res.status(400).json({ error: "Surat noto'g'ri yoki juda katta" });
    const mt = typeof mimeType === 'string' && /^image\/(jpeg|png|webp|heic)$/.test(mimeType) ? mimeType : 'image/jpeg';
    const objs: any[] = t.companyId ? await ObjectForHints.find({ companyId: t.companyId }).select('name').limit(60).lean() : [];
    const r = await receiptToExpense(Buffer.from(image, 'base64'), mt, todayInTashkent(), { objects: objs.map(o => String(o.name)) });
    if (!r) return res.status(422).json({ error: "Chekdan summani o'qib bo'lmadi — aniqroq, yorug' joyda suratga oling" });
    res.json(r);
  } catch (err: any) {
    if (err?.message === 'NO_GEMINI') return res.status(503).json({ error: 'AI xizmati sozlanmagan' });
    console.error('[scan-receipt]', err?.message);
    res.status(500).json({ error: "Chekni o'qib bo'lmadi — qayta urinib ko'ring" });
  }
});

// Tahrirlash (owner 2026-10-22: "hamma o'zi qo'shgan narsani o'zgartira olsin; direktor va o'rinbosar — barchasini").
// Tasdiqlangan yozuvni faqat direktor/o'rinbosar o'zgartiradi (o'chirish qoidasi bilan bir xil); eski qiymat auditda qoladi.
// Tur faqat chiqim turlari ichida almashadi (yukxat ↔ chiqim ↔ kirim emas).
const EXPENSE_TYPES = ['expense', 'oylik', 'material', 'jihozlar', 'transport', 'boshqa'];
// Yozuvga egalik (PATCH/DELETE uchun): rahbar (direktor/o'rinbosar/ega) — hammasi; aks holda faqat qo'shgan xodim.
// Yukxatda createdById eski yozuvlarda yo'q — yuboruvchi (fromUserId) qo'shgan hisoblanadi.
// Kirim: o'rinbosar faqat o'zi kiritganini ko'radi — demak faqat o'zinikini o'zgartiradi/o'chiradi (direktorniki ko'rinmaydi).
function txAccess(tx: any, actor: any, actingUserId: string): { isBoss: boolean; allowed: boolean } {
  const isBoss = !!actor && (['direktor', 'orinbosar'].includes(actor.role) || !!actor.isOwner);
  const me = String(actingUserId);
  const isCreator = String(tx.createdById || '') === me || (tx.type === 'transfer' && !tx.createdById && String(tx.fromUserId || '') === me);
  if (tx.type === 'income' && actor?.role === 'orinbosar' && !actor?.isOwner && !isCreator) return { isBoss, allowed: false };
  return { isBoss, allowed: isBoss || isCreator };
}
router.patch('/:id', async (req, res) => {
  try {
    const actingUserId = getTenant()?.userId;
    if (!actingUserId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const tx: any = await Transaction.findOne(scoped({ _id: req.params.id }));
    if (!tx) return res.status(404).json({ error: 'Topilmadi' });
    const actor = await User.findById(actingUserId).catch(() => null);
    const { isBoss, allowed } = txAccess(tx, actor, actingUserId);
    if (!allowed) return res.status(403).json({ error: "Faqat direktor, o'rinbosar yoki yozuvni qo'shgan xodim o'zgartira oladi" });
    if (tx.status === 'confirmed' && !isBoss) return res.status(409).json({ error: "Tasdiqlangan yozuvni faqat direktor yoki o'rinbosar o'zgartira oladi" });
    const b = req.body || {};
    const errors: { field: string; message: string }[] = [];
    const set: Record<string, unknown> = {};
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
    if (b.description !== undefined) set.description = str(b.description, 1000) ?? '';
    if (b.note !== undefined) set.note = str(b.note, 1000) ?? '';
    if (b.date !== undefined) {
      if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) errors.push({ field: 'date', message: "Sana YYYY-MM-DD ko'rinishida bo'lsin" });
      else set.date = b.date;
    }
    if (b.projectId !== undefined) {
      if (b.projectId === null || b.projectId === '') set.projectId = undefined;
      else if (!(await ObjectForHints.exists(scoped({ _id: String(b.projectId) })).catch(() => null))) errors.push({ field: 'projectId', message: 'Obyekt topilmadi' });
      else set.projectId = String(b.projectId);
    }
    if (tx.type === 'transfer') {
      if (b.materialName !== undefined) { const n = str(b.materialName, 200); if (!n) errors.push({ field: 'materialName', message: 'Material nomi kerak' }); else set.materialName = n; }
      if (b.quantity !== undefined) { const q = Number(b.quantity); if (!Number.isFinite(q) || q <= 0) errors.push({ field: 'quantity', message: "Miqdor musbat son bo'lsin" }); else set.quantity = q; }
      if (b.unit !== undefined) set.unit = str(b.unit, 20) ?? '';
      if (b.price !== undefined) { const p = Number(b.price); if (b.price !== null && (!Number.isFinite(p) || p < 0)) errors.push({ field: 'price', message: "Narx noto'g'ri" }); else set.price = b.price === null ? undefined : p; }
    } else {
      if (b.amount !== undefined) {
        const a = Number(b.amount);
        if (!Number.isFinite(a) || a <= 0 || a > 1e13) errors.push({ field: 'amount', message: "Summa musbat son bo'lsin" });
        else { set.amount = a; if (!tx.currency || tx.currency === 'UZS') { set.uzsAmount = a; set.originalAmount = a; } }
      }
      if (b.type !== undefined) {
        if (tx.type === 'income' || !EXPENSE_TYPES.includes(String(b.type))) errors.push({ field: 'type', message: "Turni o'zgartirib bo'lmaydi" });
        else set.type = String(b.type);
      }
    }
    if (errors.length) return res.status(400).json({ success: false, errors });
    if (!Object.keys(set).length) return res.status(400).json({ error: "O'zgartirish yo'q" });
    const before = tx.toObject();
    tx.set(set);
    await tx.save();
    if (actor) {
      logAudit({
        userId: actingUserId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
        action: 'update', entity: 'transaction', entityId: String(tx._id),
        description: `Tranzaksiya o'zgartirildi: ${Object.keys(set).join(', ')}`,
        oldValue: Object.fromEntries(Object.keys(set).map((k) => [k, (before as any)[k]])), newValue: set,
        companyId: actor.companyId, req,
      }).catch(() => {});
    }
    res.json({ ...tx.toObject(), id: tx._id });
  } catch (err) {
    console.error('[transactions PATCH]', (err as Error)?.message);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const actingUserId = getTenant()?.userId;
    if (!actingUserId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const tx = await Transaction.findOne(scoped({ _id: req.params.id }));
    if (!tx) return res.status(404).json({ error: 'Topilmadi' });
    const actor = await User.findById(actingUserId).catch(() => null);
    const { isBoss, allowed } = txAccess(tx, actor, actingUserId);
    if (!allowed) {
      return res.status(403).json({ error: 'Faqat direktor, orinbosar yoki yozuvni yaratgan xodim o\'chira oladi' });
    }
    // XAVFSIZLIK/MOLIYAVIY BUTUNLIK — TOPILMA (audit): tasdiqlangan
    // (confirmed) tranzaksiyani ham hech qanday izsiz o'chirib bo'lardi —
    // moliyaviy hisobotlarga ishonchni buzadi. Endi tasdiqlangan yozuvni
    // O'CHIRIB bo'lmaydi (faqat pending/rejected) — moliyaviy tuzatish
    // kerak bo'lsa, yangi (masalan manfiy) tranzaksiya yaratish orqali
    // qilinishi kerak, tarixni yo'q qilish orqali emas.
    // Tasdiqlangan yozuvni faqat direktor/o'rinbosar o'chira oladi (audit jurnalida eski qiymati qoladi)
    if (tx.status === 'confirmed' && !isBoss) {
      return res.status(409).json({ error: "Tasdiqlangan yozuvni faqat direktor yoki o'rinbosar o'chira oladi" });
    }
    const snapshot = tx.toObject();
    await tx.deleteOne();

    if (actor) {
      logAudit({
        userId: actingUserId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
        action: 'delete', entity: 'transaction', entityId: req.params.id,
        description: `Tranzaksiya o'chirildi: ${tx.type === 'transfer' ? tx.materialName : tx.description || '—'}${tx.amount ? ` — ${tx.amount.toLocaleString()} so'm` : ''}`,
        oldValue: snapshot, companyId: actor.companyId, req,
      }).catch(() => {});
    }

    res.json({ message: "O'chirildi" });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
