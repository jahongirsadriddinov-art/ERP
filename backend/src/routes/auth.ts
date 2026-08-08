import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';
import Company from '../models/Company';
import Subscription from '../models/Subscription';
import Otp from '../models/Otp';
import { bot } from '../services/bot';
import { sendOtpSms } from '../services/eskizService';
import { scoped, stamped } from '../middleware/scope';
import { normalizePhone, isValidUzPhone, hashPassword, verifyPassword } from '../utils/tokens';
import { checkRate } from '../utils/rateLimit';

const router = Router();

const clientIp = (req: any) => (req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip || '').trim();

// /login (eski, Telegram-kod) bilan /verify-otp (yangi, SMS-kod) IKKALASI ham
// muvaffaqiyatli tasdiqlangandan keyin bir xil ishni qiladi: obuna holatini
// tekshiradi, JWT beradi, user+company qaytaradi. Ikki joyda mantiqni
// nusxalab, ikkalasi asta-sekin bir-biridan farqlanib ketmasligi uchun shu
// yerga chiqarilgan.
async function issueSession(user: IUser, res: any) {
  const [company, sub] = await Promise.all([
    user.companyId ? Company.findById(user.companyId) : Promise.resolve(null),
    (user.companyId && user.role !== 'dasturchi')
      ? Subscription.findOne({ companyId: user.companyId }).sort({ createdAt: -1 })
      : Promise.resolve(null),
  ]);

  if (user.companyId && user.role !== 'dasturchi') {
    if (sub) {
      const now = new Date();
      if (sub.status === 'active' && sub.currentPeriodEnd && sub.currentPeriodEnd < now) {
        sub.status = 'expired';
        await sub.save();
      }
      if (sub.status === 'pending') {
        return res.status(403).json({
          subscriptionStatus: 'pending',
          error: 'Obunangiz hali admin tomonidan tasdiqlanmagan. Iltimos kuting yoki @Sadriddinov_Jahongir bilan bog\'laning.',
        });
      }
      if (sub.status === 'expired' || sub.status === 'rejected') {
        return res.status(403).json({
          subscriptionStatus: sub.status,
          error: 'Obunangiz muddati tugagan yoki rad etilgan. To\'lovni yangilash uchun @Sadriddinov_Jahongir bilan bog\'laning.',
        });
      }
    }
  }

  const token = jwt.sign(
    {
      userId: user._id,
      role: user.role,
      companyId: user.companyId,
      branchId: company?.branchId,
      isOwner: user.isOwner || false
    },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '7d' }
  );

  return res.json({
    success: true,
    token,
    user: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      projectIds: user.projectIds || [],
      companyId: user.companyId,
      isOwner: user.isOwner || false,
      language: user.language || 'uz'
    },
    // Firma brendi — hamma a'zo shu qiymatni ko'radi (o'zgartira olmaydi)
    company: company ? {
      id: company._id,
      branchId: company.branchId,
      name: company.name,
      logoUrl: company.logoUrl || '',
      currency: company.currency
    } : null
  });
}

// ─── SMS OTP login (Eskiz.uz) — eski Telegram-kod /send-code va /login ni ────
// almashtiradi. Faqat TIZIMDA MAVJUD userlar uchun ishlaydi (auto-create yo'q —
// bo'sh raqamga OTP kirish huquqi bermaydi, mavjud rol/firma tizimi buziladi).
const OTP_TTL_MS = 2 * 60 * 1000;       // 2 daqiqa
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 soniya

router.post('/send-otp', async (req, res) => {
  try {
    const rawPhone = req.body?.phone;
    if (!rawPhone || typeof rawPhone !== 'string' || !isValidUzPhone(rawPhone)) {
      return res.status(400).json({ success: false, error: "Telefon raqam noto'g'ri formatda. Namuna: +998901234567" });
    }
    const phone = normalizePhone(rawPhone);
    const ip = clientIp(req);

    // Rate limit: telefon bo'yicha 60s cooldown + soatiga max 5 ta, IP bo'yicha soatiga max 10 ta.
    const cooldown = checkRate(`otp:cooldown:${phone}`, 1, OTP_RESEND_COOLDOWN_MS);
    if (!cooldown.allowed) {
      return res.status(429).json({ success: false, error: `Iltimos ${cooldown.retryAfterSec} soniyadan keyin qayta urining`, retryAfterSec: cooldown.retryAfterSec });
    }
    const phoneHourly = checkRate(`otp:hourly:phone:${phone}`, 5, 60 * 60 * 1000);
    if (!phoneHourly.allowed) {
      return res.status(429).json({ success: false, error: "Juda ko'p urinish. Keyinroq qayta urining." });
    }
    const ipHourly = checkRate(`otp:hourly:ip:${ip}`, 10, 60 * 60 * 1000);
    if (!ipHourly.allowed) {
      return res.status(429).json({ success: false, error: "Juda ko'p urinish. Keyinroq qayta urining." });
    }

    // Faqat mavjud user — begona/tasodifiy raqamga OTP yubormaymiz (ular tizimda
    // yo'qligini ham oshkor qilmaymiz, shunchaki bir xil generic javob qaytadi).
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Bu raqam bilan foydalanuvchi topilmadi' });
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString(); // 1000-9999
    const otpHash = await hashPassword(code);

    // Eski OTP (agar bo'lsa) shu bilan bir yo'la bekor qilinadi — bitta
    // upsert, ikkita alohida so'rov (delete+create) o'rniga (tezroq).
    await Otp.findOneAndUpdate(
      { phone },
      { phone, otpHash, attempts: 0, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
      { upsert: true, setDefaultsOnInsert: true }
    );

    const sms = await sendOtpSms(phone, code);
    if (!sms.ok) {
      // OTP yozuvini qoldirmaymiz — yuborilmagan kodni keyin "to'g'ri" deb tekshirib bo'lmaydi.
      await Otp.deleteMany({ phone });
      return res.status(502).json({ success: false, error: 'SMS yuborishda xatolik yuz berdi. Birozdan keyin qayta urining.' });
    }

    // Eskiz TEST rejimida SMS matni doim ularning qat'iy test-matni bo'ladi
    // (yuqorida, eskizService) — ya'ni chinakam kod HECH QACHON telefonga
    // yetib bormaydi, sinash imkonsiz bo'lib qoladi. Shu sabab, FAQAT
    // ESKIZ_TEST_MODE=true bo'lganda (aniq, ataylab qo'yiladigan flag —
    // production'da hech qachon yoqilmaydi), kodni javobga ham qo'shamiz.
    // ESKIZ_TEST_MODE=false bo'lsa (haqiqiy akkount) bu qator ishlamaydi —
    // kod faqat SMS orqali yetadi, spec talabi to'liq saqlanadi.
    const isTestMode = (process.env.ESKIZ_TEST_MODE || '').toLowerCase() === 'true';
    return res.json({
      success: true,
      message: 'Tasdiqlash kodi yuborildi',
      ...(isTestMode ? { devOtp: code, devNote: 'Eskiz TEST rejimida — kod SMS orqali kelmaydi, shuning uchun shu yerda ko\'rsatilyapti.' } : {}),
    });
  } catch (err) {
    console.error('[send-otp]', err);
    return res.status(500).json({ success: false, error: 'Server xatoligi' });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const rawPhone = req.body?.phone;
    const otp = req.body?.otp ?? req.body?.code; // frontend 'code' deb yuboradi, spec 'otp' deydi — ikkalasini ham qabul qilamiz
    if (!rawPhone || !otp || typeof otp !== 'string') {
      return res.status(400).json({ success: false, error: 'Telefon va OTP kiritilishi shart' });
    }
    const phone = normalizePhone(rawPhone);
    if (!isValidUzPhone(phone)) {
      return res.status(400).json({ success: false, error: "Telefon raqam noto'g'ri formatda" });
    }

    // Bir IP'dan ko'plab TURLI raqamlarni brute-force qilishga qarshi qo'shimcha himoya
    // (asosiy himoya — pastdagi 5-urinish limiti, bu esa faqat qo'shimcha qatlam).
    const ipCheck = checkRate(`otp:verify:ip:${clientIp(req)}`, 20, 10 * 60 * 1000);
    if (!ipCheck.allowed) {
      return res.status(429).json({ success: false, error: "Juda ko'p urinish. Keyinroq qayta urining." });
    }

    const otpDoc = await Otp.findOne({ phone }).sort({ createdAt: -1 });
    if (!otpDoc || otpDoc.expiresAt < new Date()) {
      if (otpDoc) await otpDoc.deleteOne();
      return res.status(400).json({ success: false, error: "Kod topilmadi yoki muddati tugagan. Qaytadan so'rang." });
    }
    if (otpDoc.attempts >= OTP_MAX_ATTEMPTS) {
      await otpDoc.deleteOne();
      return res.status(400).json({ success: false, error: "Urinishlar soni tugadi. Qaytadan so'rang." });
    }

    const isCorrect = await verifyPassword(otp, otpDoc.otpHash);
    if (!isCorrect) {
      otpDoc.attempts += 1;
      const attemptsLeft = OTP_MAX_ATTEMPTS - otpDoc.attempts;
      if (attemptsLeft <= 0) {
        await otpDoc.deleteOne();
        return res.status(400).json({ success: false, error: "Kod noto'g'ri. Urinishlar soni tugadi, qaytadan so'rang." });
      }
      await otpDoc.save();
      return res.status(400).json({ success: false, error: `Kod noto'g'ri. ${attemptsLeft} ta urinish qoldi.` });
    }

    // To'g'ri — bir martalik, darhol o'chiriladi.
    await otpDoc.deleteOne();

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' });
    }
    user.phoneVerifiedAt = new Date();
    await user.save();

    return issueSession(user, res);
  } catch (err) {
    console.error('[verify-otp]', err);
    return res.status(500).json({ success: false, error: 'Server xatoligi' });
  }
});

// Himoyalangan test endpoint — Authorization: Bearer <token> orqali joriy userni qaytaradi.
router.get('/me', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Avtorizatsiya talab qilinadi' });
  }
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' });
    return res.json({
      success: true,
      user: {
        id: user._id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        companyId: user.companyId,
      },
    });
  } catch (err) {
    console.error('[auth/me]', err);
    return res.status(500).json({ success: false, error: 'Server xatoligi' });
  }
});

// ─── Dasturchi (super-admin) sozlamalari ─────────────────────────────────────
// Xavfsizlik uchun .env dan o'qiladi; agar berilmasa quyidagi standart ishlatiladi.
// TAVSIYA: backend/.env ga DEVELOPER_PHONE va kuchli DEVELOPER_PASSWORD qo'shing.
const DEVELOPER_PHONE = normalizePhone(process.env.DEVELOPER_PHONE || '+998900960890');
const DEVELOPER_PASSWORD = process.env.DEVELOPER_PASSWORD || 'Dasturchi_2026';

// ─── DEPRECATED — Telegram-kod orqali login (SMS OTP bilan almashtirildi) ────
// Frontend endi /send-otp va /verify-otp ni chaqiradi. Bu ikkisi ATAYLAB
// o'chirilmagan (backward-compat / qo'lda fallback uchun) — lekin hech qanday
// UI ular tomon so'rov yubormaydi.
router.post('/send-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Telefon raqam kiritilishi shart' });
  }

  let formattedPhone = phone.replace(/\s+/g, '');
  if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+' + formattedPhone;
  }

  try {
    const user = await User.findOne({ phone: formattedPhone });
    if (!user) {
      return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    }

    if (!user.telegramChatId) {
      return res.status(400).json({ error: 'Telegram botga ulanmagan. Iltimos botga kirib /start bosing va raqamingizni yuboring.' });
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    user.telegramVerificationCode = code;
    user.telegramVerificationCodeExpires = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes expiry
    await user.save();

    await bot.sendMessage(user.telegramChatId, `Sizning tizimga kirish kodingiz: <code>${code}</code>\nKod 2 daqiqa davomida amal qiladi.`, { parse_mode: 'HTML' });

    return res.json({ message: 'Kod yuborildi' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Login: verify the code
router.post('/login', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'Telefon va kod kiritilishi shart' });
  }

  let formattedPhone = phone.replace(/\s+/g, '');
  if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+' + formattedPhone;
  }

  try {
    const user = await User.findOne({ phone: formattedPhone });
    if (!user) {
      return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    }

    if (user.telegramVerificationCode !== code) {
      return res.status(400).json({ error: 'Kod noto\'g\'ri' });
    }

    if (user.telegramVerificationCodeExpires && user.telegramVerificationCodeExpires < new Date()) {
      return res.status(400).json({ error: 'Kodning muddati tugagan' });
    }

    // Clear the code so it cannot be reused
    user.telegramVerificationCode = undefined;
    user.telegramVerificationCodeExpires = undefined;
    await user.save();

    return issueSession(user, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ─── Dasturchi login: raqam + parol (Telegram kod EMAS) ──────────────────────
// Faqat dasturchi raqami tekshiriladi, parol doimiy (o'zgarmas). Muvaffaqiyatli
// bo'lsa super-admin JWT beriladi (isDeveloper=true, companyId yo'q — hamma firmani ko'radi).
router.post('/dev-login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: 'Telefon va parol kiritilishi shart' });
    }
    const normalized = normalizePhone(phone);
    if (normalized !== DEVELOPER_PHONE || password !== DEVELOPER_PASSWORD) {
      return res.status(401).json({ error: 'Telefon yoki parol noto\'g\'ri' });
    }

    // Dasturchi User yozuvini topamiz yoki yaratamiz (companyId'siz)
    let dev = await User.findOne({ phone: DEVELOPER_PHONE });
    if (!dev) {
      dev = await User.create({
        phone: DEVELOPER_PHONE,
        firstName: 'Dasturchi',
        role: 'dasturchi',
      });
    } else if (dev.role !== 'dasturchi') {
      dev.role = 'dasturchi';
      await dev.save();
    }

    const token = jwt.sign(
      { userId: dev._id, role: 'dasturchi', isDeveloper: true },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '365d' }
    );

    return res.json({
      token,
      user: {
        id: dev._id,
        firstName: dev.firstName,
        lastName: dev.lastName || '',
        phone: dev.phone,
        role: 'dasturchi',
        projectIds: [],
        isDeveloper: true,
        language: dev.language || 'uz'
      },
      company: null,
    });
  } catch (err) {
    console.error('dev-login error:', err);
    return res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Admin: Add new user
router.post('/users', async (req, res) => {
  const { firstName, lastName, phone, role, brigade, projectIds } = req.body;

  if (!firstName || !phone || !role) {
    return res.status(400).json({ error: 'firstName, phone va role kiritilishi shart' });
  }

  // Note: we'd ideally check if the caller is a director/deputy here using auth middleware
  let formattedPhone = phone.replace(/\s+/g, '');
  if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+' + formattedPhone;
  }

  try {
    const existing = await User.findOne({ phone: formattedPhone });
    if (existing) {
      return res.status(400).json({ error: 'Bu raqam band' });
    }

    const newUser = new User(stamped({
      firstName,
      lastName: lastName || '',
      phone: formattedPhone,
      role,
      ...(brigade && brigade.trim() ? { brigade } : {}),
      projectIds: Array.isArray(projectIds) ? projectIds : []
    }));

    await newUser.save();
    return res.status(201).json({
      _id: newUser._id,
      id: newUser._id,
      name: newUser.firstName + (newUser.lastName ? ' ' + newUser.lastName : ''),
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      phone: newUser.phone,
      role: newUser.role,
      projectIds: newUser.projectIds || []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Admin: Update user
router.put('/users/:id', async (req, res) => {
  const { firstName, lastName, phone, role, brigade, projectIds } = req.body;
  try {
    const user = await User.findOne(scoped({ _id: req.params.id }));
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    // "Direktor" va "dasturchi" lavozimini FAQAT dasturchi (super-admin) belgilay
    // oladi — aks holda oddiy admin (direktor/o'rinbosar) o'zini yoki boshqa
    // xodimni shu tahrirlash so'rovi orqali yuqori huquqqa ko'tarib olishi mumkin
    // edi (imtiyoz eskalatsiyasi). Frontend allaqachon bu variantlarni yashiradi —
    // bu yerdagi tekshiruv haqiqiy himoya, chunki API to'g'ridan-to'g'ri ham
    // chaqirilishi mumkin.
    const requester = req.user;
    const isDeveloperCaller = !!(requester?.isDeveloper || requester?.role === 'dasturchi');
    if (role && ['direktor', 'dasturchi'].includes(role) && role !== user.role && !isDeveloperCaller) {
      return res.status(403).json({ error: "Bu lavozimni faqat dasturchi paneli orqali o'zgartirish mumkin" });
    }

    if (firstName) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (role) user.role = role;
    if (brigade !== undefined) user.brigade = brigade;
    if (Array.isArray(projectIds)) user.projectIds = projectIds;
    if (phone) {
      let formattedPhone = phone.replace(/\s+/g, '');
      if (!formattedPhone.startsWith('+')) formattedPhone = '+' + formattedPhone;
      user.phone = formattedPhone;
    }
    await user.save();
    return res.json({
      id: user._id,
      name: user.firstName + (user.lastName ? ' ' + user.lastName : ''),
      phone: user.phone,
      role: user.role,
      brigade: user.brigade,
      projectIds: user.projectIds || []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Admin: Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findOneAndDelete(scoped({ _id: req.params.id }));
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    res.json({ message: "O'chirildi" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
