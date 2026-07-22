import { Router } from 'express';
import Subscription from '../models/Subscription';
import User from '../models/User';
import Company from '../models/Company';
import { requireDeveloper } from '../middleware/auth';
import { bot } from '../services/bot';

const router = Router();

// Har bir tarifda BIRINCHI OY BEPUL — umumiy summadan 1 oylik narx (700 000) ayirilgan.
export const PLAN_CONFIG: Record<string, { label: string; days: number; amount: number }> = {
  'bepul':   { label: '1 oy bepul', days: 30,  amount: 0 },
  '1month':  { label: '1 oylik',   days: 30,  amount: 0 },
  '3month':  { label: '3 oylik',   days: 90,  amount: 1_400_000 },
  '6month':  { label: '6 oylik',   days: 180, amount: 3_500_000 },
  '12month': { label: '12 oylik',  days: 365, amount: 7_700_000 },
};

export type SelectedPlan = string;

const SITE_URL = process.env.SITE_URL || 'http://localhost:5173';

// GET /api/admin/subscriptions — barcha obunalar (dasturchi uchun)
router.get('/', requireDeveloper, async (req, res) => {
  try {
    const subs = await Subscription.find().sort({ requestedAt: -1, createdAt: -1 });

    const enriched = await Promise.all(subs.map(async (s) => {
      const [company, user] = await Promise.all([
        Company.findById(s.companyId).lean().catch(() => null),
        s.userId ? User.findById(s.userId).lean().catch(() => null) : Promise.resolve(null),
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
        rejectedAt: s.rejectedAt,
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

    const base = (sub.currentPeriodEnd && sub.currentPeriodEnd > new Date()) ? sub.currentPeriodEnd : new Date();
    const expiresAt = new Date(base.getTime() + planInfo.days * 86400000);

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
