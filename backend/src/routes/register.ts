import { Router } from 'express';
import jwt from 'jsonwebtoken';
import Registration from '../models/Registration';
import User from '../models/User';
import Company from '../models/Company';
import Subscription from '../models/Subscription';
import ConsentLog from '../models/ConsentLog';
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

function clientIp(req: any): string {
  return (req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip || '').trim();
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
    if (!registrationId) return res.status(400).json({ error: 'registrationId kerak' });
    const reg = await Registration.findById(String(registrationId));
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
    if (!registrationId) return res.status(400).json({ error: 'registrationId kerak' });
    const reg = await Registration.findById(String(registrationId));
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
    if (!registrationId) return res.status(400).json({ error: 'registrationId kerak' });
    const reg = await Registration.findById(String(registrationId));
    if (reg && reg.step !== 'COMPLETED') { reg.step = 'EXPIRED'; await reg.save(); }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ─── 5) Yakunlash: firma + egasi yaratiladi (JWT EMAS — obuna tasdiqini kutadi) ──
router.post('/complete', async (req, res) => {
  try {
    const { token, owner, company, logoUrl, selectedPlan } = req.body || {};

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

    // ── Yaratish (standalone Mongo — transaction talab qilinmaydi; branchId atomik) ──
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

    // Obuna: tanlangan tarif bilan, admin tasdiqini kutadi (PENDING)
    const planKey = (selectedPlan && PLAN_CONFIG[selectedPlan as string]) ? (selectedPlan as SelectedPlan) : '1month';
    const planInfo = PLAN_CONFIG[planKey];
    const sub = await Subscription.create({
      companyId: String(createdCompany._id),
      userId: String(ownerUser._id),
      plan: 'PRO',
      selectedPlan: planKey,
      amount: planInfo.amount,
      status: 'pending',
      requestedAt: new Date(),
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

    // Dasturchiga bildirishnoma
    const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID;
    if (DEVELOPER_CHAT_ID && sub) {
      const planInfo2 = PLAN_CONFIG[planKey];
      const subIdStr = String(sub._id);
      const msgText = `🆕 <b>Yangi obuna so'rovi!</b>\n\n` +
        `👤 ${ownerUser.firstName} ${ownerUser.lastName || ''}\n` +
        `📞 ${ownerUser.phone}\n` +
        `🏢 ${createdCompany.name} (${createdCompany.branchId})\n` +
        `📦 Tarif: ${planInfo2.label} — ${planInfo2.amount.toLocaleString()} so'm\n\n` +
        `Tasdiqlash yoki rad etish uchun admin panelga kiring yoki pastdagi tugmalarni bosing:`;
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

    // JWT BERILMAYDI — foydalanuvchi admin tasdiqini kutishi kerak
    return res.status(201).json({
      ok: true,
      subscriptionPending: true,
      phone: ownerUser.phone,
      language: ownerUser.language || 'uz',
      selectedPlan: planKey,
      planLabel: PLAN_CONFIG[planKey].label,
      planAmount: PLAN_CONFIG[planKey].amount,
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
