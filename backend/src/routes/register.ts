import { Router } from 'express';
import jwt from 'jsonwebtoken';
import Registration from '../models/Registration';
import User from '../models/User';
import Company from '../models/Company';
import Subscription from '../models/Subscription';
import ConsentLog from '../models/ConsentLog';
import PendingRegistration from '../models/PendingRegistration';
import { generateBranchId } from '../models/Counter';
import { PLAN_CONFIG, SelectedPlan } from './subscriptions';
import { bot } from '../services/bot';
import {
  normalizePhone, isValidUzPhone, hashPassword, isStrongPassword, hashToken,
} from '../utils/tokens';
import { checkRate } from '../utils/rateLimit';
import {
  createRegistration, findActiveByRawToken,
} from '../services/registrationService';

const router = Router();

const BOT_USERNAME = process.env.BOT_USERNAME || 'qurilish_erp_bot';
const CONSENT_VERSION = { terms: 'terms_v1', privacy: 'privacy_v1' };

// XAVFSIZLIK: auth.ts'dagi bir xil tuzatish — X-Forwarded-For'ni to'g'ridan-
// to'g'ri o'qish mijoz tomonidan qalbakilashtirilishi mumkin edi (index.ts'dagi
// "trust proxy" izohiga qarang). Endi Express'ning ishonchli `req.ip`'i.
function clientIp(req: any): string {
  return (req.ip || '').trim();
}

// MUHIM: frontend'da bug bo'lib, o'zgaruvchi hali tayinlanmagan holatda so'rov
// yuborilsa, query/body'da ANIQ "undefined" SATRI keladi (JS template literal
// `${undefined}` = "undefined") — oddiy `!registrationId` tekshiruvidan
// O'TIB KETADI (bo'sh emas, chinakam satr!), keyin esa Mongoose'ning ObjectId
// cast'i chuqur, foydasiz stack trace bilan qulaydi. Shu funksiya 24-belgili
// hex ekanini ANIQ tekshiradi — frontend buggi hali ham bo'lsa ham, backend
// hech qachon qulamaydi.
function isValidObjectIdStr(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
}

// ─── 1) Telefon kiritish → ro'yxat sessiyasi + deep-link token ────────────────
router.post('/phone', async (req, res) => {
  try {
    const { phone, ownerConfirm, language } = req.body;
    if (!phone || !isValidUzPhone(phone)) {
      return res.status(400).json({ error: 'To\'g\'ri O\'zbekiston raqamini kiriting (+998 XX XXX XX XX)' });
    }
    const normalized = normalizePhone(phone);
    const ip = clientIp(req);
    const lang = ['uz', 'uz-cyrl', 'ru'].includes(language) ? language : 'uz';

    // Rate limit: IP dan 5/soat, raqamга 3/soat
    const ipLimit = checkRate(`reg:ip:${ip}`, 5, 60 * 60 * 1000);
    if (!ipLimit.allowed) {
      return res.status(429).json({ error: 'Juda ko\'p urinish. Birozdan so\'ng qayta urinib ko\'ring.', retryAfterSec: ipLimit.retryAfterSec });
    }
    const phoneLimit = checkRate(`reg:phone:${normalized}`, 3, 60 * 60 * 1000);
    if (!phoneLimit.allowed) {
      return res.status(429).json({ error: 'Bu raqamga juda ko\'p urinish bo\'ldi. Birozdan so\'ng qayta urinib ko\'ring.', retryAfterSec: phoneLimit.retryAfterSec });
    }

    // Bu raqam allaqachon firma egasimi? → login'ga yo'naltiramiz
    const existing = await User.findOne({ phone: normalized });
    if (existing) {
      return res.status(200).json({ exists: true, message: 'Bu raqam bilan firma mavjud. Iltimos tizimga kiring.' });
    }

    const { reg, rawToken } = await createRegistration({
      phone: normalized,
      ip,
      userAgent: req.headers['user-agent']?.toString(),
      consents: ownerConfirm ? { ownerConfirm: true, ownerConfirmAt: new Date().toISOString() } : {},
      language: lang,
    });

    return res.status(201).json({
      registrationId: String(reg._id),
      token: rawToken, // deep-link uchun (bir martalik, 15 daqiqa)
      botUsername: BOT_USERNAME,
      deepLink: `https://t.me/${BOT_USERNAME}?start=${rawToken}`,
      expiresAt: reg.expiresAt,
    });
  } catch (err) {
    console.error('register/phone error:', err);
    return res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ─── 2) Polling: bot tomonda holat o'zgardimi? ───────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const { registrationId } = req.query;
    if (!isValidObjectIdStr(registrationId)) {
      return res.status(400).json({ error: 'registrationId noto\'g\'ri yoki yo\'q' });
    }
    const reg = await Registration.findById(registrationId);
    if (!reg) return res.status(404).json({ error: 'Sessiya topilmadi' });

    // Lazy expiry
    let step = reg.step;
    if (step !== 'COMPLETED' && step !== 'EXPIRED' && reg.expiresAt.getTime() < Date.now()) {
      reg.step = 'EXPIRED';
      await reg.save();
      step = 'EXPIRED';
    }

    return res.json({
      step,
      telegramConfirmed: step === 'PHONE_CONFIRMED' || step === 'CONSENT_GIVEN' || step === 'COMPLETED',
      consentGiven: step === 'CONSENT_GIVEN' || step === 'COMPLETED',
      expiresAt: reg.expiresAt,
    });
  } catch (err) {
    console.error('register/status error:', err);
    return res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ─── 3) Tokenni qayta yuborish (60 sek cooldown) ─────────────────────────────
router.post('/resend', async (req, res) => {
  try {
    const { registrationId } = req.body;
    if (!isValidObjectIdStr(registrationId)) {
      return res.status(400).json({ error: 'registrationId noto\'g\'ri yoki yo\'q' });
    }
    const reg = await Registration.findById(registrationId);
    if (!reg || reg.step === 'COMPLETED') return res.status(404).json({ error: 'Sessiya topilmadi' });

    const cd = checkRate(`reg:resend:${registrationId}`, 1, 60 * 1000); // 60 sek
    if (!cd.allowed) {
      return res.status(429).json({ error: 'Iltimos kuting', retryAfterSec: cd.retryAfterSec });
    }

    // Yangi sessiya (eski token bekor bo'ladi)
    const { reg: fresh, rawToken } = await createRegistration({
      phone: reg.phone,
      ip: clientIp(req),
      userAgent: req.headers['user-agent']?.toString(),
      consents: reg.consents,
      language: reg.language,
    });
    return res.json({
      registrationId: String(fresh._id),
      token: rawToken,
      botUsername: BOT_USERNAME,
      deepLink: `https://t.me/${BOT_USERNAME}?start=${rawToken}`,
      expiresAt: fresh.expiresAt,
    });
  } catch (err) {
    console.error('register/resend error:', err);
    return res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ─── 4) Bekor qilish ─────────────────────────────────────────────────────────
router.post('/cancel', async (req, res) => {
  try {
    const { registrationId } = req.body;
    if (!isValidObjectIdStr(registrationId)) {
      return res.status(400).json({ error: 'registrationId noto\'g\'ri yoki yo\'q' });
    }
    const reg = await Registration.findById(registrationId);
    if (reg && reg.step !== 'COMPLETED') { reg.step = 'EXPIRED'; await reg.save(); }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ─── 4.5) Onlayn to'lov holatini tekshirish ("done" ekranidagi "tizimga
// kirish" tugmasi uchun) — to'lov HALI qabul qilinmagan bo'lsa foydalanuvchini
// bevosita login ekraniga (u yerda "obunangiz kutilmoqda" degan chalkash
// xato bilan) yubormaslik uchun. Faqat 3 xil holatni ajratadi, boshqa
// hech qanday shaxsiy ma'lumot qaytarmaydi (User.findOne bilan bir xil
// oshkoralik darajasi — /register/phone allaqachon shu darajada oshkora).
router.get('/pay-status', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone || typeof phone !== 'string' || !isValidUzPhone(phone)) {
      return res.status(400).json({ status: 'unknown' });
    }
    const normalized = normalizePhone(phone);
    const rl = checkRate(`reg:paystatus:${normalized}`, 20, 60 * 1000);
    if (!rl.allowed) return res.status(429).json({ status: 'unknown' });

    const user = await User.findOne({ phone: normalized }).select('_id').lean();
    if (user) return res.json({ status: 'paid' });
    const pending = await PendingRegistration.findOne({ phone: normalized }).select('_id').lean();
    if (pending) return res.json({ status: 'pending' });
    return res.json({ status: 'unknown' });
  } catch (err) {
    console.error('register/pay-status error:', err);
    return res.status(500).json({ status: 'unknown' });
  }
});

// ─── 5) Yakunlash: firma + egasi yaratiladi (JWT EMAS — obuna tasdiqini kutadi) ──
router.post('/complete', async (req, res) => {
  try {
    const { token, owner, company, logoUrl, selectedPlan, paymentMethod, promoCode } = req.body || {};

    // Token orqali faol sessiyani topamiz (256-bit sir + bot tasdig'i talab qilinadi)
    const reg = await findActiveByRawToken(token);
    if (!reg) {
      return res.status(400).json({ error: 'Sessiya yaroqsiz yoki muddati tugagan. Qaytadan boshlang.' });
    }
    if (reg.step !== 'CONSENT_GIVEN') {
      return res.status(409).json({ error: 'Avval Telegram bot orqali telefonni tasdiqlang.' });
    }

    // Validatsiya
    if (!owner?.firstName?.trim()) return res.status(400).json({ error: 'Ism kiritilishi shart' });
    if (!owner?.lastName?.trim()) return res.status(400).json({ error: 'Familiya kiritilishi shart' });
    if (!isStrongPassword(owner?.password || '')) return res.status(400).json({ error: 'Parol kamida 8 belgidan iborat bo\'lsin' });
    if (!company?.name?.trim()) return res.status(400).json({ error: 'Firma nomi kiritilishi shart' });
    if (company?.inn && !/^\d{9}$/.test(String(company.inn))) return res.status(400).json({ error: 'INN 9 raqamdan iborat bo\'lishi kerak' });

    // Bitta Telegram akkaunt = bitta firma egasi (v1.2)
    if (reg.telegramUserId) {
      const alreadyOwner = await User.findOne({ telegramUserId: reg.telegramUserId, isOwner: true });
      if (alreadyOwner) {
        return res.status(409).json({ error: 'Bu Telegram akkaunt allaqachon boshqa firma egasi. Bitta akkaunt bitta firma ocha oladi.' });
      }
    }
    // Telefon band bo'lib qolmaganini qayta tekshiramiz (race)
    const phoneTaken = await User.findOne({ phone: reg.phone });
    if (phoneTaken) {
      return res.status(409).json({ error: 'Bu raqam bilan firma mavjud. Tizimga kiring.' });
    }

    const planKey = (selectedPlan && PLAN_CONFIG[selectedPlan as string]) ? (selectedPlan as SelectedPlan) : '1month';
    const planInfo = PLAN_CONFIG[planKey];
    const isFreePlan = planInfo.amount <= 0;
    const wantsOnlinePay = !isFreePlan && paymentMethod !== 'admin';

    // ── Onlayn (avtomatik) to'lov — MUHIM XATTI-HARAKAT: firma/foydalanuvchi
    // HALI YARATILMAYDI. Avval Roxiy buyurtmasini (va PendingRegistration
    // yozuvini) yaratishga urinamiz; muvaffaqiyatli bo'lsa shu yerdan
    // ERTAROQ qaytamiz — pastdagi "darhol yaratish" yo'liga umuman
    // yetib bormaymiz.
    //
    // XATO TUZATILDI: avval firma/user HAR DOIM, to'lovdan OLDIN
    // yaratilar edi ('pending' holatda) — agar foydalanuvchi to'lamasdan
    // tashlab ketsa, bu yozuv ABADIY osilib qolardi VA uning telefon
    // raqami (User.phone unique) boshqa hech qachon ro'yxatdan o'tish
    // uchun ishlatib bo'lmas edi ("Bu raqam bilan firma mavjud" xatosi).
    // Endi: to'lansa — firma o'sha zahoti (webhook: routes/payments.ts)
    // yaratiladi; to'lanmasa — 48 soatdan keyin PendingRegistration
    // avtomatik o'chadi va telefon raqami erkin qoladi.
    if (wantsOnlinePay) {
      try {
        const { createRegistrationPaymentOrder } = await import('../services/registrationPayments');
        const passwordHash = await hashPassword(owner.password);
        const result = await createRegistrationPaymentOrder({
          phone: reg.phone,
          passwordHash,
          owner: {
            firstName: owner.firstName.trim(), lastName: owner.lastName.trim(),
            middleName: owner.middleName?.trim(), email: owner.email?.trim(),
            position: owner.position?.trim() || 'Direktor',
          },
          company: {
            name: company.name.trim(), legalName: company.legalName?.trim(),
            inn: company.inn ? String(company.inn) : undefined,
            address: company.address?.trim(), region: company.region?.trim(),
            activityType: company.activityType || 'qurilish',
            employeeRange: company.employeeRange, currency: company.currency || 'UZS',
          },
          logoUrl: logoUrl || '',
          language: reg.language || 'uz',
          telegramUserId: reg.telegramUserId,
          telegramChatId: reg.telegramChatId,
          registrationId: String(reg._id),
          planKey,
          promoCode: typeof promoCode === 'string' && promoCode.trim() ? promoCode.trim() : undefined,
        });

        if (result.ok) {
          // Sessiyani yopamiz — bir martalik token qayta ishlatilmasin
          // (foydalanuvchi to'lamasa ham, qayta urinish YANGI Telegram
          // tasdig'i orqali boshlanadi — bu allaqachon mavjud oddiy yo'l).
          reg.step = 'COMPLETED';
          reg.otpTokenHash = hashToken('used-' + String(reg._id));
          await reg.save();

          const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID;
          if (DEVELOPER_CHAT_ID) {
            const msgText = `🆕 <b>Yangi ro'yxatdan o'tish (onlayn to'lov kutilmoqda)</b>\n\n` +
              `👤 ${owner.firstName} ${owner.lastName || ''}\n` +
              `📞 ${reg.phone}\n` +
              `🏢 ${company.name.trim()}\n` +
              `📦 Tarif: ${planInfo.label} — ${result.amount.toLocaleString()} so'm\n\n` +
              `Roxiy (Click/Payme/Paynet) orqali to'lov havolasi yuborildi — to'lansa FIRMA VA OBUNA AVTOMATIK yaratiladi, hech qanday harakat kerak emas.`;
            await bot.sendMessage(DEVELOPER_CHAT_ID, msgText, { parse_mode: 'HTML' }).catch((e: any) => console.error('bot developer notify error:', e));
          }

          return res.status(201).json({
            ok: true,
            deferredPayment: true,
            subscriptionPending: true,
            isFreePlan: false,
            payUrl: result.order.pay_url,
            payProviders: result.order.providers,
            phone: reg.phone,
            language: reg.language || 'uz',
            selectedPlan: planKey,
            planLabel: planInfo.label,
            planAmount: result.amount,
            company: { branchId: result.branchId, name: company.name.trim() },
          });
        }
        console.error('register/complete: registration payment order error:', result.error);
        var payError: string | undefined = result.error;
      } catch (err: any) {
        // MUHIM: bu yerda tutilgan xato ko'pincha ROXIY_API_KEY ishlab
        // chiqarish (Render) muhitida sozlanmagani (mahalliy .env fayli
        // Git orqali serverga yuborilmaydi, alohida Render Environment
        // sozlamalariga qo'shilishi kerak) — frontend endi buni jimgina
        // yashirmasdan, foydalanuvchiga ko'rsatadi.
        console.error('register/complete: registration payment order threw:', err);
        var payError: string | undefined = err?.message || "Noma'lum xatolik";
      }
      // Bu yerga faqat Roxiy buyurtmasi MUVAFFAQIYATSIZ bo'lsa yetib keladi
      // — pastdagi "darhol yaratish" yo'liga ZAXIRA sifatida o'tamiz
      // (admin qo'lda tasdiqlaydi), ariza yo'qolib ketmasligi uchun.
    }

    // ── Bepul tarif YOKI "admin orqali" YOKI onlayn urinish muvaffaqiyatsiz
    // bo'lgan zaxira holat — firma/foydalanuvchi DARHOL yaratiladi, 'pending'
    // holatda, dasturchi bot orqali qo'lda tasdiqlaydi/rad etadi (ILGARIGIDEK).
    const branchId = await generateBranchId(new Date().getFullYear());
    const createdCompany = await Company.create({
      branchId,
      name: company.name.trim(),
      legalName: company.legalName?.trim(),
      inn: company.inn ? String(company.inn) : undefined,
      address: company.address?.trim(),
      region: company.region?.trim(),
      phone: reg.phone,
      activityType: company.activityType || 'qurilish',
      employeeRange: company.employeeRange,
      currency: company.currency || 'UZS',
      logoUrl: logoUrl || '',
      status: 'ACTIVE',
      plan: 'FREE',
    });

    let ownerUser;
    try {
      ownerUser = await User.create({
        firstName: owner.firstName.trim(),
        lastName: owner.lastName.trim(),
        middleName: owner.middleName?.trim(),
        email: owner.email?.trim(),
        position: owner.position?.trim() || 'Direktor',
        phone: reg.phone,
        role: 'direktor',
        isOwner: true,
        companyId: String(createdCompany._id),
        telegramUserId: reg.telegramUserId,
        telegramChatId: reg.telegramChatId,
        phoneVerifiedAt: new Date(),
        passwordHash: await hashPassword(owner.password),
        language: reg.language || 'uz',
        projectIds: [],
      });
    } catch (userErr) {
      // Rollback: firma yaratildi-yu, user yaratilmadi → firmani o'chiramiz
      await Company.findByIdAndDelete(createdCompany._id).catch(() => {});
      console.error('register/complete user create error:', userErr);
      return res.status(500).json({ error: 'Foydalanuvchi yaratishda xatolik' });
    }

    // Firma egasini bog'laymiz
    createdCompany.ownerUserId = String(ownerUser._id);
    await createdCompany.save();

    const now = new Date();
    const sub = await Subscription.create({
      companyId: String(createdCompany._id),
      userId: String(ownerUser._id),
      plan: 'PRO',
      selectedPlan: planKey,
      amount: planInfo.amount,
      status: 'pending',
      requestedAt: now,
    }).catch(() => null);

    // Rozilik audit izlari
    const ip = clientIp(req);
    const ua = req.headers['user-agent']?.toString();
    await ConsentLog.insertMany([
      { userId: String(ownerUser._id), registrationId: String(reg._id), companyId: String(createdCompany._id), consentType: 'terms', version: CONSENT_VERSION.terms, acceptedAt: new Date(), telegramUserId: reg.telegramUserId, ip, userAgent: ua },
      { userId: String(ownerUser._id), registrationId: String(reg._id), companyId: String(createdCompany._id), consentType: 'privacy', version: CONSENT_VERSION.privacy, acceptedAt: new Date(), telegramUserId: reg.telegramUserId, ip, userAgent: ua },
      { userId: String(ownerUser._id), registrationId: String(reg._id), companyId: String(createdCompany._id), consentType: 'owner_confirm', version: 'owner_v1', acceptedAt: new Date(), telegramUserId: reg.telegramUserId, ip, userAgent: ua },
    ]).catch((e) => console.error('ConsentLog error:', e));

    // Sessiyani yopamiz
    reg.step = 'COMPLETED';
    reg.otpTokenHash = hashToken('used-' + String(reg._id));
    await reg.save();

    // Dasturchiga bildirishnoma — bu yo'lda payUrl HECH QACHON bo'lmaydi
    // (aks holda yuqorida allaqachon return qilingan bo'lardi), shu sabab
    // har doim tasdiqlash/rad etish tugmalari bilan yuboriladi: (1) bepul
    // sinov, (2) "admin orqali" tanlangan, yoki (3) onlayn urinish
    // muvaffaqiyatsiz bo'lgan (payError to'ldirilgan) zaxira holat.
    const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID;
    if (DEVELOPER_CHAT_ID && sub) {
      const subIdStr = String(sub._id);
      const priceLine = isFreePlan ? `📦 Tarif: ${planInfo.label} (bepul sinov)` : `📦 Tarif: ${planInfo.label} — ${planInfo.amount.toLocaleString()} so'm`;
      const methodLine = isFreePlan
        ? `Bepul sinov — tasdiqlash/rad etish uchun pastdagi tugmalarni bosing:`
        : payError
          ? `Onlayn to'lov yaratilmadi (${payError}) — pastdagi tugmalar orqali qo'lda tasdiqlang/rad eting:`
          : `"Admin orqali" to'lovni tanladi — tasdiqlash yoki rad etish uchun pastdagi tugmalarni bosing:`;
      const msgText = `🆕 <b>Yangi obuna so'rovi!</b>\n\n` +
        `👤 ${ownerUser.firstName} ${ownerUser.lastName || ''}\n` +
        `📞 ${ownerUser.phone}\n` +
        `🏢 ${createdCompany.name} (${createdCompany.branchId})\n` +
        `${priceLine}\n\n${methodLine}`;
      await bot.sendMessage(DEVELOPER_CHAT_ID, msgText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Tasdiqlash', callback_data: `sub_approve_${subIdStr}` },
            { text: '❌ Rad etish',  callback_data: `sub_reject_${subIdStr}` },
          ]],
        },
      }).catch((e: any) => console.error('bot developer notify error:', e));
    }

    // JWT hali berilmaydi — obuna (bepul bo'lsa ham) dasturchi tasdig'ini kutadi.
    return res.status(201).json({
      ok: true,
      subscriptionPending: true,
      isFreePlan,
      payUrl: undefined,
      payProviders: undefined,
      payError,
      phone: ownerUser.phone,
      language: ownerUser.language || 'uz',
      selectedPlan: planKey,
      planLabel: planInfo.label,
      planAmount: planInfo.amount,
      company: {
        id: createdCompany._id,
        branchId: createdCompany.branchId,
        name: createdCompany.name,
      },
    });
  } catch (err) {
    console.error('register/complete error:', err);
    return res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
