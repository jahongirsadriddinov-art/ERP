import { Router } from 'express';
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

// GET /api/payments/roxiy/webhook?status=paid&order_id=..&order_hash=..&amount=..&note=..&wt=..
// To'lov tugagach Roxiy shu yerga qaytadi.
router.get('/roxiy/webhook', async (req, res) => {
  try {
    const webhookToken = singleString(req.query.wt);
    if (!webhookToken) return res.status(400).send('missing token');

    // `wt` — shu BITTA to'lov uchun generatsiya qilingan, boshqa hech qanday
    // yozuvga mos kelmaydigan token (services/subscriptionPayments.ts). Bu
    // topilmasa — so'rov soxta yoki eskirgan.
    const payment = await Payment.findOne({ webhookToken, provider: 'roxiy' });
    if (!payment) {
      console.warn('roxiy webhook: unknown webhookToken');
      return res.status(404).send('order not found');
    }

    const status = singleString(req.query.status)?.toLowerCase();
    const orderHash = singleString(req.query.order_hash);
    // order_hash — qo'shimcha (himoya qatlami sifatida) tekshiruv: token
    // to'g'ri bo'lsa-yu, lekin Roxiy boshqa buyurtma haqida xabar bersa
    // (masalan ichki xatolik), bu moslikni ushlab qoladi.
    if (orderHash && payment.externalId && orderHash !== payment.externalId) {
      console.error('roxiy webhook order_hash mismatch for valid token', { expected: payment.externalId, got: orderHash });
      return res.status(400).send('order_hash mismatch');
    }

    if (status !== 'paid') {
      // Roxiy'ning to'liq status lug'ati hujjatlashtirilmagan (faqat "paid"
      // misoli berilgan). XATO TUZATILDI: avval "failed/cancelled/expired"
      // kabi statuslarda Payment'ni darhol 'failed'ga o'tkazardik — lekin
      // agar bunday oraliq/vaqtinchalik status HAQIQIY "paid" xabaridan
      // OLDIN kelib qolsa (masalan foydalanuvchi avval bekor qilib, keyin
      // qaytib to'lasa), keyinroq kelgan haqiqiy "paid" webhooki pastdagi
      // atomik filtr `status:'pending'`ga mos kelmay, MUVAFFAQIYATLI
      // to'lov ABADIY faollashtirilmay qolardi. Shu sabab endi bu yerda
      // HECH NARSA yozilmaydi — faqat "paid"dan boshqa hech qanday status
      // Payment holatini o'zgartirmaydi (yozuv 'pending'da qoladi, keyin
      // haqiqiy "paid" kelsa muammosiz ishlaydi).
      console.warn('roxiy webhook: non-paid status, ignoring', { orderHash, status });
      return res.status(200).send('ok');
    }

    const amountRaw = singleString(req.query.amount);
    const amount = amountRaw === undefined ? NaN : Number(amountRaw);
    if (!Number.isFinite(amount)) return res.status(400).send('invalid amount');

    // Atomik "pending -> paid" o'tishi: Roxiy webhookni qayta yuborsa
    // (odatiy retry xatti-harakati) yoki ikkita so'rov bir vaqtda kelsa
    // ham, FAQAT BITTASI shu filtrga mos kelib topadi — shu sabab obuna
    // muddati ikki marta uzaytirilmaydi va Telegram xabari ikki marta
    // yuborilmaydi. `new: false` — eski (pending) hujjatni qaytaradi,
    // pastda subscriptionId/plan/days shundan olinadi.
    const claimed = await Payment.findOneAndUpdate(
      { webhookToken, provider: 'roxiy', status: 'pending', amount },
      { status: 'paid' },
      { new: false }
    );

    if (!claimed) {
      // MUHIM: bu "server-to-server" webhook sifatida hujjatlashtirilgan,
      // lekin callback_url'ning haqiqatda foydalanuvchi brauzeri qaytadigan
      // manzil ham bo'lishi (Roxiy tomonidan aniq ko'rsatilmagan) ehtimolini
      // yopish uchun — yakuniy (muvaffaqiyatli) holatlarda saytga
      // yo'naltiramiz, aks holda brauzer bu yerda xom matn ko'rib qolardi.
      if (payment.status === 'paid') return res.redirect(302, SITE_URL);
      console.error('roxiy webhook amount mismatch', { orderHash, expected: payment.amount, got: amount });
      return res.status(400).send('amount mismatch');
    }

    // ── RO'YXATDAN O'TISH to'lovi: firma/foydalanuvchi HALI YO'Q, faqat
    // HOZIR (to'lov muvaffaqiyatli tasdiqlangach) yaratiladi — services/
    // registrationPayments.ts va models/PendingRegistration.ts'dagi
    // izohlarga qarang (nega firma to'lovdan OLDIN emas, KEYIN yaratiladi).
    if (claimed.pendingRegistrationId) {
      const pending = await PendingRegistration.findById(claimed.pendingRegistrationId);
      if (!pending) {
        console.error('roxiy webhook: pendingRegistrationId topilmadi (allaqachon o\'chirilganmi?)', claimed.pendingRegistrationId);
        return res.redirect(302, SITE_URL);
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

        const now = new Date();
        const days = typeof claimed.days === 'number' && claimed.days > 0 ? claimed.days : 30;
        const sub = await Subscription.create({
          companyId: String(createdCompany._id),
          userId: String(ownerUser._id),
          plan: 'PRO',
          selectedPlan: claimed.plan || pending.planKey,
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
      return res.redirect(302, SITE_URL);
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

    res.redirect(302, SITE_URL);
  } catch (err) {
    console.error('roxiy webhook error:', err);
    res.status(500).send('error');
  }
});

export default router;
