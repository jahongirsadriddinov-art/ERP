import { Router } from 'express';
import Subscription from '../models/Subscription';
import User from '../models/User';
import Company from '../models/Company';
import Payment from '../models/Payment';
import { requireDeveloper, requireAuth, requireOwnerOrAdmin } from '../middleware/auth';
import { getTenant } from '../middleware/tenantContext';
import { bot } from '../services/bot';
import { createSubscriptionPaymentOrder } from '../services/subscriptionPayments';
import { extendPeriodEnd } from '../utils/subscriptionPeriod';
import { PLAN_CONFIG, SelectedPlan, getPlanInfo, ALL_FEATURE_KEYS } from '../config/plans';

const router = Router();

// PLAN_CONFIG/SelectedPlan endi config/plans.ts'da yashaydi (bot.ts ham
// shu tariflardan Roxiy to'lov tugmalarini yasay olishi uchun) — bu
// yerdan qayta eksport qilinadi, chunki register.ts va bot.ts hali ham
// shu manzildan import qiladi.
export { PLAN_CONFIG, SelectedPlan };

const SITE_URL = process.env.SITE_URL || 'http://localhost:5173';

// GET /api/admin/subscriptions/my — joriy firma obuna holati (direktor/o'rinbosar uchun)
router.get('/my', requireAuth, async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.companyId) return res.status(400).json({ error: 'Firma topilmadi' });

    const sub = await Subscription.findOne({ companyId: String(t.companyId) }).sort({ createdAt: -1 }).lean();
    if (!sub) return res.json({ status: 'none' });

    const now = new Date();
    let status = (sub as any).status;
    if (status === 'active' && (sub as any).currentPeriodEnd && (sub as any).currentPeriodEnd < now) {
      status = 'expired';
    }
    const daysLeft = (sub as any).currentPeriodEnd
      ? Math.max(0, Math.ceil(((sub as any).currentPeriodEnd.getTime() - now.getTime()) / 86400000))
      : null;

    // Tarif topilmasa (eski/o'chirilgan kalit) — HAMMA funksiyani yoqilgan
    // deb hisoblaymiz (mavjud, to'lagan mijozni to'satdan cheklab
    // qo'ymaslik uchun), aks holda o'sha tarifda admin belgilagan ro'yxat.
    const planInfo = getPlanInfo((sub as any).selectedPlan);
    const features = planInfo ? planInfo.features : ALL_FEATURE_KEYS;

    return res.json({
      id: (sub as any)._id,
      status,
      plan: (sub as any).plan,
      selectedPlan: (sub as any).selectedPlan,
      amount: (sub as any).amount,
      currentPeriodEnd: (sub as any).currentPeriodEnd,
      daysLeft,
      requestedAt: (sub as any).requestedAt || (sub as any).createdAt,
      approvedAt: (sub as any).approvedAt,
      features,
    });
  } catch (err) {
    console.error('subscriptions/my error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/admin/subscriptions/pay — firma admin/orinbosari o'zi Click/Payme/
// Paynet orqali to'lab, obunani DASTURCHI TASDIG'ISIZ avtomatik faollashtiradi
// (webhook: routes/payments.ts). Bepul tarif uchun ishlamaydi (amount<=0).
router.post('/pay', requireAuth, requireOwnerOrAdmin, async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.companyId) return res.status(400).json({ error: 'Firma topilmadi' });

    const planKey = (req.body?.selectedPlan || '') as SelectedPlan;
    // Haqiqiy yaratish/tekshirish mantig'i services/subscriptionPayments.ts'da —
    // bot.ts'dagi "💳 To'lash" tugmalari ham AYNAN shu funksiyani chaqiradi,
    // shu sabab ikkalasida ham bir xil tekshiruvlar (rad etilgan obuna,
    // noto'g'ri tarif) qo'llanadi.
    const result = await createSubscriptionPaymentOrder(String(t.companyId), (req as any).user?.userId, planKey);
    if (!result.ok) return res.status(result.httpStatus).json({ error: result.error });

    res.json({ ok: true, payUrl: result.order.pay_url, providers: result.order.providers });
  } catch (err: any) {
    console.error('subscriptions/pay error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/admin/subscriptions — barcha obunalar (dasturchi uchun)
router.get('/', requireDeveloper, async (req, res) => {
  try {
    const subs = await Subscription.find().sort({ requestedAt: -1, createdAt: -1 });

    const enriched = await Promise.all(subs.map(async (s) => {
      const [company, user, payments] = await Promise.all([
        Company.findById(s.companyId).lean().catch(() => null),
        s.userId ? User.findById(s.userId).lean().catch(() => null) : Promise.resolve(null),
        // Dasturchi har bir obunaning HAQIQIY to'lov tarixini (avtomatik
        // Roxiy orqalimi, qachon, qancha, qaysi holatda) ko'ra olishi
        // uchun — oxirgi 10 tasi kifoya (juda uzun ro'yxat kerak emas).
        Payment.find({ subscriptionId: String(s._id) }).sort({ createdAt: -1 }).limit(10).lean().catch(() => []),
      ]);
      const now = new Date();
      let computedStatus = s.status;
      if (computedStatus === 'active' && s.currentPeriodEnd && s.currentPeriodEnd < now) {
        computedStatus = 'expired';
      }
      const daysLeft = s.currentPeriodEnd
        ? Math.max(0, Math.ceil((s.currentPeriodEnd.getTime() - now.getTime()) / 86400000))
        : null;
      return {
        id: s._id,
        companyId: s.companyId,
        companyName: (company as any)?.name || '—',
        branchId: (company as any)?.branchId || '—',
        userId: s.userId,
        userName: user ? `${(user as any).firstName} ${(user as any).lastName || ''}`.trim() : '—',
        userPhone: (user as any)?.phone || (company as any)?.phone || '—',
        userTelegramChatId: (user as any)?.telegramChatId,
        plan: s.plan,
        selectedPlan: s.selectedPlan,
        amount: s.amount,
        status: computedStatus,
        currentPeriodEnd: s.currentPeriodEnd,
        daysLeft,
        requestedAt: s.requestedAt || s.createdAt,
        approvedAt: s.approvedAt,
        approvedBy: s.approvedBy,
        // 'roxiy-auto' — foydalanuvchi o'zi Click/Payme/Paynet orqali to'lab,
        // dasturchi tasdig'isiz avtomatik faollashgan (routes/payments.ts).
        autoActivated: s.approvedBy === 'roxiy-auto',
        rejectedAt: s.rejectedAt,
        payments: payments.map((p: any) => ({
          id: p._id,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          provider: p.provider,
          plan: p.plan,
          createdAt: p.createdAt,
        })),
      };
    }));

    res.json(enriched);
  } catch (err) {
    console.error('subscriptions GET error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/admin/subscriptions/:id/approve
router.post('/:id/approve', requireDeveloper, async (req, res) => {
  try {
    const sub = await Subscription.findById(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Obuna topilmadi' });

    // Developer can override plan, days, amount from request body
    const planKey = (req.body.selectedPlan || sub.selectedPlan || 'bepul') as SelectedPlan;
    const planInfo = PLAN_CONFIG[planKey] || PLAN_CONFIG['bepul'];
    const days = req.body.days ?? planInfo.days;
    const amount = req.body.amount ?? planInfo.amount;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86400000);

    sub.status = 'active';
    sub.selectedPlan = planKey;
    sub.amount = amount;
    sub.approvedAt = now;
    sub.approvedBy = String((req as any).user?.userId || '');
    sub.currentPeriodStart = now;
    sub.currentPeriodEnd = expiresAt;
    await sub.save();

    // Update company status to ACTIVE
    await Company.findByIdAndUpdate(sub.companyId, { status: 'ACTIVE' }).catch(() => {});

    // Foydalanuvchiga bot orqali xabar
    if (sub.userId) {
      const user = await User.findById(sub.userId).lean().catch(() => null);
      if (user && (user as any).telegramChatId) {
        const chatId = (user as any).telegramChatId;
        const expStr = expiresAt.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
        await bot.sendMessage(chatId,
          `✅ <b>Tabriklaymiz!</b>\n\nSizning obunangiz tasdiqlandi!\n\n` +
          `📦 Tarif: <b>${planInfo.label}</b>\n` +
          `📅 Muddat: <b>${expStr}</b> gacha\n\n` +
          `Endi tizimga kirishingiz mumkin:\n${SITE_URL}`,
          { parse_mode: 'HTML' }
        ).catch((e: any) => console.error('bot approve notify error:', e));
      }
    }

    res.json({ ok: true, expiresAt });
  } catch (err) {
    console.error('subscriptions approve error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/admin/subscriptions/:id/reject
router.post('/:id/reject', requireDeveloper, async (req, res) => {
  try {
    const sub = await Subscription.findById(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Obuna topilmadi' });

    sub.status = 'rejected';
    sub.rejectedAt = new Date();
    sub.rejectedBy = String((req as any).user?.userId || '');
    await sub.save();

    // Foydalanuvchiga xabar
    if (sub.userId) {
      const user = await User.findById(sub.userId).lean().catch(() => null);
      if (user && (user as any).telegramChatId) {
        await bot.sendMessage((user as any).telegramChatId,
          `❌ <b>Obuna rad etildi</b>\n\nAfsuski, obunangiz rad etildi.\n\n` +
          `To'lov va boshqa savollar uchun: <a href="https://t.me/Sadriddinov_Jahongir">@Sadriddinov_Jahongir</a>`,
          { parse_mode: 'HTML' }
        ).catch((e: any) => console.error('bot reject notify error:', e));
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('subscriptions reject error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST /api/admin/subscriptions/:id/renew — muddatni uzaytirish
router.post('/:id/renew', requireDeveloper, async (req, res) => {
  try {
    const { selectedPlan } = req.body;
    const sub = await Subscription.findById(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Obuna topilmadi' });

    const planKey = ((selectedPlan || sub.selectedPlan || 'bepul') as SelectedPlan);
    const planInfo = PLAN_CONFIG[planKey] || PLAN_CONFIG['bepul'];

    const expiresAt = extendPeriodEnd(sub.currentPeriodEnd, planInfo.days);

    sub.status = 'active';
    sub.selectedPlan = planKey;
    sub.amount = planInfo.amount;
    sub.approvedAt = new Date();
    sub.approvedBy = String((req as any).user?.userId || '');
    sub.currentPeriodStart = new Date();
    sub.currentPeriodEnd = expiresAt;
    await sub.save();

    res.json({ ok: true, expiresAt });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
