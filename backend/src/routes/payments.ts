import { linkTelegram } from '../services/telegramIdentity';
import crypto from 'crypto';
import express, { Router, type Request } from 'express';
import Payment from '../models/Payment';
import Subscription from '../models/Subscription';
import Company from '../models/Company';
import User from '../models/User';
import PendingRegistration from '../models/PendingRegistration';
import ConsentLog from '../models/ConsentLog';
import { bot } from '../services/bot';
import { extendPeriodEnd } from '../utils/subscriptionPeriod';
import { consumePromoCode } from '../services/promoCodes';

const SITE_URL = process.env.SITE_URL || 'http://localhost:5173';

// MUHIM: bu router HECH QANDAY auth talab qilmaydi (index.ts'da requireAuth'siz
// ulanadi) — chunki Roxiy'ning o'zi (bizning foydalanuvchimiz emas) shu yerga
// to'lovdan keyin GET so'rov yuboradi. O'rniga — pastda HAR BIR TO'LOVGA
// ALOHIDA berilgan `wt` (webhookToken) tekshiriladi (services/roxiy.ts'dagi
// izohga qarang).
const router = Router();

// Express `req.query`da bir xil kalit ikki marta kelsa massivga aylantiradi
// (masalan ?status=paid&status=paid) — bunday holatda ham xavfsiz, aniq bitta
// satr yoki `undefined` qaytaradi (massivni "to'g'ri" status deb hech qachon
// qabul qilmaymiz).
function singleString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  return undefined;
}

// ── Roxiy imzosi (owner 2026-10-19: kassa sozlamasida "Webhook imzo siri", sarlavha X-Rox-Signature) ──────────
// Imzo formati Roxiy hujjatlarida yozilmagan — keng tarqalgan HMAC-SHA256 variantlari tekshiriladi (xom tana yoki
// so'rov satri; hex/base64; "sha256=", "t=…,v1=…"; sir "whsec_" bilan/siz). Natija logga yoziladi (sir va imzoning
// o'zi yozilmaydi). ROXIY_WEBHOOK_SECRET — Render'da; ROXIY_REQUIRE_SIGNATURE=1 — imzosiz/noto'g'ri xabar to'lovni
// faollashtira olmaydi (sinov to'lovida logda "imzo: valid" ko'ringach yoqiladi).
type SigState = 'valid' | 'invalid' | 'missing' | 'no_secret';
const roxiySecret = () => (process.env.ROXIY_WEBHOOK_SECRET || '').trim();
const signatureRequired = () => process.env.ROXIY_REQUIRE_SIGNATURE === '1' && !!roxiySecret();

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function verifyRoxiySignature(secret: string, header: string, messages: string[], timestamp?: string): boolean {
  if (!secret || !header) return false;
  const h = header.trim();
  // Imzo qiymatlari: "sha256=<sig>", "t=<ts>,v1=<sig>", "v1,<sig>" yoki to'g'ridan-to'g'ri "<sig>"
  const parts = h.split(/[,\s]+/).filter(Boolean);
  let ts = timestamp || '';
  const sigs: string[] = [];
  for (const part of parts) {
    const m = /^([a-z0-9]+)=(.+)$/i.exec(part);
    if (m && m[1].toLowerCase() === 't') ts = ts || m[2];
    else if (m) sigs.push(m[2]);
    else if (!/^v\d$/i.test(part)) sigs.push(part);
  }
  if (!sigs.length) sigs.push(h);
  const keys: Buffer[] = [Buffer.from(secret)];
  if (secret.startsWith('whsec_')) {
    keys.push(Buffer.from(secret.slice(6)));
    const b = Buffer.from(secret.slice(6), 'base64');
    if (b.length >= 16) keys.push(b);
  }
  const msgs = new Set<string>();
  for (const m of messages) {
    if (typeof m !== 'string') continue;
    msgs.add(m);
    if (ts) { msgs.add(`${ts}.${m}`); msgs.add(`${ts}${m}`); }
  }
  for (const key of keys) {
    for (const msg of msgs) {
      const d = crypto.createHmac('sha256', key).update(msg).digest();
      const hex = d.toString('hex');
      const b64 = d.toString('base64');
      for (const sig of sigs) {
        if (safeEq(sig.toLowerCase(), hex) || safeEq(sig, b64) || safeEq(sig, b64.replace(/=+$/, ''))) return true;
      }
    }
  }
  return false;
}

function signatureState(req: Request): SigState {
  const secret = roxiySecret();
  if (!secret) return 'no_secret';
  const header = String(req.headers['x-rox-signature'] || '');
  if (!header) return 'missing';
  const raw = (req as any).rawBody;
  const rawBody = Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof req.body === 'string' ? req.body : '';
  const url = String(req.originalUrl || '');
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const ts = String(req.headers['x-rox-timestamp'] || '');
  return verifyRoxiySignature(secret, header, [rawBody, query, url].filter((m) => m !== ''), ts || undefined) ? 'valid' : 'invalid';
}

function logWebhook(req: Request, sig: SigState, note: string) {
  const body = req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 20) : [];
  console.log(`[roxiy] webhook ${req.method} imzo: ${sig} — ${note} (content-type: ${String(req.headers['content-type'] || '-').slice(0, 60)}; maydonlar: ${body.join(',') || '-'})`);
}

/**
 * To'lovni yakunlash (GET qaytish manzili va imzolangan POST uchun umumiy). Atomik "pending → paid": takroriy
 * xabar obunani ikki marta uzaytirmaydi.
 */
async function settleRoxiy(payment: any, p: { status?: string; orderHash?: string; amount: number }, done: () => unknown, fail: (code: number, msg: string) => unknown) {
    const status = p.status;
    const orderHash = p.orderHash;
    // order_hash — qo'shimcha tekshiruv: Roxiy boshqa buyurtma haqida xabar bersa, moslikni ushlab qoladi
    if (orderHash && payment.externalId && orderHash !== payment.externalId) {
      console.error('roxiy webhook order_hash mismatch', { expected: payment.externalId, got: orderHash });
      return fail(400, 'order_hash mismatch');
    }
    if (status !== 'paid') {
      // Faqat "paid" Payment holatini o'zgartiradi (oraliq statuslar keyingi haqiqiy "paid"ni to'smasin)
      console.warn('roxiy webhook: non-paid status, ignoring', { orderHash, status });
      return done();
    }
    const amount = p.amount;
    if (!Number.isFinite(amount)) return fail(400, 'invalid amount');
    const claimed = await Payment.findOneAndUpdate(
      { _id: payment._id, provider: 'roxiy', status: 'pending', amount },
      { status: 'paid' },
      { new: false }
    );
    if (!claimed) {
      if (payment.status === 'paid') return done();
      console.error('roxiy webhook amount mismatch', { orderHash, expected: payment.amount, got: amount });
      return fail(400, 'amount mismatch');
    }

    if (claimed.pendingRegistrationId) {
      const pending = await PendingRegistration.findById(claimed.pendingRegistrationId);
      if (!pending) {
        console.error('roxiy webhook: pendingRegistrationId topilmadi (allaqachon o\'chirilganmi?)', claimed.pendingRegistrationId);
        return done();
      }
      try {
        // Juda kam uchraydigan poyga holati: shu oraliqda boshqa yo'l bilan
        // (masalan alohida bepul ro'yxatdan o'tish) xuddi shu telefon band
        // bo'lib qolgan bo'lishi mumkin — bunday holatda takroriy User
        // yaratib bo'lmaydi (unique index xato beradi), oldindan tekshiramiz.
        const phoneTaken = await User.findOne({ phone: pending.phone });
        if (phoneTaken) throw new Error(`Telefon allaqachon band: ${pending.phone}`);

        const createdCompany = await Company.create({
          branchId: pending.branchId,
          name: pending.company.name,
          legalName: pending.company.legalName,
          inn: pending.company.inn,
          address: pending.company.address,
          region: pending.company.region,
          phone: pending.phone,
          activityType: pending.company.activityType || 'qurilish',
          employeeRange: pending.company.employeeRange,
          currency: pending.company.currency || 'UZS',
          logoUrl: pending.logoUrl || '',
          status: 'ACTIVE',
          plan: 'FREE',
        });
        const ownerUser = await User.create({
          firstName: pending.owner.firstName,
          lastName: pending.owner.lastName,
          middleName: pending.owner.middleName,
          email: pending.owner.email,
          position: pending.owner.position || 'Direktor',
          phone: pending.phone,
          role: 'direktor',
          isOwner: true,
          companyId: String(createdCompany._id),
          telegramUserId: pending.telegramUserId,
          telegramChatId: pending.telegramChatId,
          phoneVerifiedAt: new Date(),
          passwordHash: pending.passwordHash,
          language: pending.language || 'uz',
          projectIds: [],
        });
        createdCompany.ownerUserId = String(ownerUser._id);
        await createdCompany.save();
        // Bitta Telegram ↔ bitta xodim (owner 2026-10-23)
        if (pending.telegramChatId) await linkTelegram(String(ownerUser._id), String(pending.telegramChatId), pending.telegramUserId).catch(() => undefined);

        const now = new Date();
        const days = typeof claimed.days === 'number' && claimed.days > 0 ? claimed.days : 30;
        const sub = await Subscription.create({
          companyId: String(createdCompany._id),
          userId: String(ownerUser._id),
          plan: 'PRO',
          selectedPlan: claimed.plan || pending.planKey,
          ...(claimed.plan === 'custom' ? { customFeatures: (claimed as any).features || [] } : {}),
          amount: claimed.amount,
          status: 'active',
          requestedAt: pending.createdAt,
          approvedAt: now,
          approvedBy: 'roxiy-auto',
          currentPeriodStart: now,
          currentPeriodEnd: extendPeriodEnd(undefined, days, now),
        });

        await ConsentLog.insertMany([
          { userId: String(ownerUser._id), registrationId: pending.registrationId, companyId: String(createdCompany._id), consentType: 'terms', version: 'terms_v1', acceptedAt: now },
          { userId: String(ownerUser._id), registrationId: pending.registrationId, companyId: String(createdCompany._id), consentType: 'privacy', version: 'privacy_v1', acceptedAt: now },
          { userId: String(ownerUser._id), registrationId: pending.registrationId, companyId: String(createdCompany._id), consentType: 'owner_confirm', version: 'owner_v1', acceptedAt: now },
        ]).catch((e) => console.error('ConsentLog error (deferred reg):', e));

        if (claimed.promoCode) await consumePromoCode(claimed.promoCode);
        await PendingRegistration.findByIdAndDelete(pending._id).catch(() => {});

        if (pending.telegramChatId) {
          const expStr = sub.currentPeriodEnd!.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
          await bot.sendMessage(pending.telegramChatId,
            `✅ <b>To'lov qabul qilindi — firmangiz tayyor!</b>\n\n🏢 ${createdCompany.name} (${createdCompany.branchId})\n📅 Muddat: <b>${expStr}</b> gacha\n\nEndi tizimga kirishingiz mumkin.`,
            { parse_mode: 'HTML' }
          ).catch((e: any) => console.error('roxiy webhook bot notify error:', e));
        }
        const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID;
        if (DEVELOPER_CHAT_ID) {
          await bot.sendMessage(DEVELOPER_CHAT_ID,
            `🆕✅ <b>Yangi firma (to'lov orqali avtomatik yaratildi)</b>\n\n🏢 ${createdCompany.name} (${createdCompany.branchId})\n📞 ${pending.phone}\n💰 ${claimed.amount.toLocaleString('uz-UZ')} so'm`,
            { parse_mode: 'HTML' }
          ).catch((e: any) => console.error('bot developer notify error:', e));
        }
      } catch (err) {
        console.error('roxiy webhook: deferred registration creation failed', err);
        // To'lov 'paid' bo'lib qoldi, lekin firma yaratilmadi — juda kam
        // uchraydigan holat. Dasturchini xabardor qilamiz — qo'lda hal
        // qilishi kerak (masalan mijozga qo'lda firma ochib berish).
        const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID;
        if (DEVELOPER_CHAT_ID) {
          await bot.sendMessage(DEVELOPER_CHAT_ID,
            `⚠️ <b>XATOLIK</b>: to'lov qabul qilindi, lekin firma avtomatik yaratilmadi (telefon: ${pending.phone}). Qo'lda tekshiring! Xato: ${(err as any)?.message || err}`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
      }
      return done();
    }

    if (claimed.subscriptionId) {
      const sub = await Subscription.findById(claimed.subscriptionId);
      if (sub) {
        // Kunlar SOF Payment yozuvidan (to'lov yaratilgan paytdagi nusxa) —
        // sub.selectedPlan yoki PLAN_CONFIG'ni HOZIR qidirish emas: birinchisi
        // to'lov 'pending' turgan paytda boshqa /pay so'rovi bilan
        // almashtirilib ketishi mumkin edi, ikkinchisi esa keyinchalik
        // o'zgarishi/o'chirilishi mumkin — ikkalasi ham TO'LANGAN summaga
        // mos kelmaydigan kun sonini "sokin" berib qo'yishi mumkin edi.
        const days = typeof claimed.days === 'number' && claimed.days > 0 ? claimed.days : 30;
        const now = new Date();

        sub.status = 'active';
        sub.plan = 'PRO';
        sub.selectedPlan = claimed.plan ? claimed.plan : sub.selectedPlan;
        if (claimed.plan === 'custom') sub.customFeatures = Array.isArray((claimed as any).features) ? (claimed as any).features : [];
        else sub.customFeatures = undefined;
        sub.amount = claimed.amount;
        sub.approvedAt = now;
        sub.approvedBy = 'roxiy-auto'; // qo'lda tasdiqlash EMAS — auditda ajratish uchun
        sub.currentPeriodStart = now;
        sub.currentPeriodEnd = extendPeriodEnd(sub.currentPeriodEnd, days, now);

        const [, , user] = await Promise.all([
          sub.save(),
          Company.findByIdAndUpdate(sub.companyId, { status: 'ACTIVE' }).catch(() => null),
          sub.userId ? User.findById(sub.userId).lean().catch(() => null) : Promise.resolve(null),
        ]);

        if (claimed.promoCode) await consumePromoCode(claimed.promoCode);

        if (user && (user as any).telegramChatId) {
          const expStr = sub.currentPeriodEnd.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
          await bot.sendMessage((user as any).telegramChatId,
            `✅ <b>To'lov qabul qilindi!</b>\n\nObunangiz avtomatik faollashtirildi.\n📅 Muddat: <b>${expStr}</b> gacha`,
            { parse_mode: 'HTML' }
          ).catch((e: any) => console.error('roxiy webhook bot notify error:', e));
        }
      }
    }

    return done();
}

const firstStr = (...vals: unknown[]): string | undefined => {
  for (const v of vals) {
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
};

// GET /api/payments/roxiy/webhook?status=paid&order_id=..&order_hash=..&amount=..&note=..&wt=..
// To'lov tugagach Roxiy shu yerga qaytadi (callback_url). `wt` — shu BITTA to'lovga berilgan token.
router.get('/roxiy/webhook', async (req, res) => {
  try {
    const webhookToken = singleString(req.query.wt);
    if (!webhookToken) return res.status(400).send('missing token');
    const payment = await Payment.findOne({ webhookToken, provider: 'roxiy' });
    if (!payment) {
      console.warn('roxiy webhook: unknown webhookToken');
      return res.status(404).send('order not found');
    }
    const sig = signatureState(req);
    if (signatureRequired() && sig !== 'valid') {
      // Imzo majburiy: imzosiz qaytish (masalan brauzer) to'lovni faollashtirmaydi — imzolangan xabar kutiladi
      logWebhook(req, sig, 'imzo majburiy — GET faollashtirmadi');
      return res.redirect(302, SITE_URL);
    }
    if (sig !== 'no_secret') logWebhook(req, sig, 'GET');
    const amountRaw = singleString(req.query.amount);
    return await settleRoxiy(payment, {
      status: singleString(req.query.status)?.toLowerCase(),
      orderHash: singleString(req.query.order_hash),
      amount: amountRaw === undefined ? NaN : Number(amountRaw),
    }, () => res.redirect(302, SITE_URL), (code, msg) => res.status(code).send(msg));
  } catch (err) {
    console.error('roxiy webhook error:', err);
    res.status(500).send('error');
  }
});

// POST /api/payments/roxiy/webhook — Roxiy kassa sozlamasidagi webhook (X-Rox-Signature bilan imzolangan).
// Imzosiz POST faqat shu to'lovning `wt` tokeni bilan qabul qilinadi (aks holda order_hash'ni bilgan har kim yozardi).
router.post('/roxiy/webhook', express.text({ type: () => true, limit: '64kb' }), async (req, res) => {
  try {
    let body: any = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = Object.fromEntries(new URLSearchParams(body)); }
    }
    if (!body || typeof body !== 'object') body = {};
    const d = body.data && typeof body.data === 'object' ? body.data : body;
    const sig = signatureState(req);
    const wt = singleString(req.query.wt) || firstStr(d.wt);
    const orderHash = firstStr(d.order_hash, d.orderHash, d.hash);
    let payment: any = null;
    if (wt) payment = await Payment.findOne({ webhookToken: wt, provider: 'roxiy' });
    if (!payment && orderHash) payment = await Payment.findOne({ externalId: orderHash, provider: 'roxiy' });
    if (!payment) { logWebhook(req, sig, "to'lov topilmadi"); return res.status(404).json({ ok: false, error: 'order not found' }); }
    const tokenOk = !!wt && payment.webhookToken === wt;
    if (sig !== 'valid' && (signatureRequired() || !tokenOk)) {
      logWebhook(req, sig, "rad etildi (imzo yoki token yo'q)");
      return res.status(401).json({ ok: false, error: 'bad signature' });
    }
    logWebhook(req, sig, 'POST qabul qilindi');
    return await settleRoxiy(payment, {
      status: firstStr(d.status, d.state)?.toLowerCase(),
      orderHash,
      amount: Number(firstStr(d.amount, d.sum)),
    }, () => res.status(200).json({ ok: true }), (code, msg) => res.status(code).json({ ok: false, error: msg }));
  } catch (err) {
    console.error('roxiy webhook POST error:', err);
    res.status(500).json({ ok: false, error: 'error' });
  }
});

export default router;
