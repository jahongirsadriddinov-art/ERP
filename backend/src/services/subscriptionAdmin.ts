import Subscription from '../models/Subscription';
import Company from '../models/Company';
import User from '../models/User';
import { getPlanInfo, type SelectedPlan } from '../config/plans';
import { extendPeriodEnd } from '../utils/subscriptionPeriod';
import { invalidateSubscription } from '../middleware/subscriptionGate';

// Obunani ADMIN qo'li bilan faollashtirish (owner 2026-10-30).
//
// Savol shundan chiqdi: "obuna so'rovi adminga keldi, lekin to'lov qilishi
// kerak-ku — admin nima qiladi?". Javob: "admin orqali" yo'li NAQD yoki BANK
// O'TKAZMASI bilan to'laydiganlar uchun. Mijoz admin bilan kelishadi, admin
// pulni oladi va obunani o'zi ochadi.
//
// Oldin bu amal faqat admin panelida bor edi — Telegram'dagi so'rov xabarida
// esa bosiladigan hech narsa yo'q edi, admin panelga kirib firmani qidirishi
// kerak edi. Endi xabarning o'zida tugma bor va shu funksiya chaqiriladi.
//
// Hisob-kitob /renew bilan BIR XIL: extendPeriodEnd — qolgan kunlar
// yo'qolmaydi, yangi muddat ustiga qo'shiladi.

export interface ActivateResult {
  ok: boolean;
  company?: string;
  plan?: string;
  until?: string;
  error?: string;
}

export async function activateSubscriptionByAdmin(
  subscriptionId: string,
  planKey: string,
  byUserId: string,
  now: Date = new Date(),
): Promise<ActivateResult> {
  const sub: any = await Subscription.findById(subscriptionId).catch(() => null);
  if (!sub) return { ok: false, error: 'Obuna topilmadi' };

  // Tarif FAOL ro'yxatdan topilmasa — aniq xato (PLAN_CONFIG bazadan quriladi,
  // o'chirilgan tarif kaliti undefined bo'lib qolishi mumkin).
  const key = (getPlanInfo(planKey) ? planKey : sub.selectedPlan || 'bepul') as SelectedPlan;
  const plan = getPlanInfo(key);
  if (!plan) return { ok: false, error: `Tarif topilmadi: "${planKey}"` };

  const until = extendPeriodEnd(sub.currentPeriodEnd, plan.days);
  sub.status = 'active';
  sub.selectedPlan = key;
  sub.amount = plan.amount;
  sub.approvedAt = now;
  sub.approvedBy = String(byUserId || '');
  sub.currentPeriodStart = now;
  sub.currentPeriodEnd = until;
  await sub.save();
  invalidateSubscription(String(sub.companyId || ''));

  const company: any = await Company.findById(sub.companyId).select('name').lean().catch(() => null);

  // Firma rahbarlariga xabar — kutib o'tirmasin
  try {
    const { bot } = await import('./bot');
    const bosses: any[] = await User.find({
      companyId: String(sub.companyId), telegramChatId: { $exists: true, $ne: '' },
      $or: [{ role: { $in: ['direktor', 'orinbosar'] } }, { isOwner: true }],
    }).select('telegramChatId').lean();
    const text = `✅ <b>Obuna faollashtirildi</b>\n\nTarif: ${plan.label}\nMuddat: ${until.toLocaleDateString('uz-UZ')} gacha`;
    for (const b of bosses) {
      await bot.sendMessage(b.telegramChatId, text, { parse_mode: 'HTML' }).catch(() => undefined);
    }
  } catch { /* xabar yetmasa ham faollashtirish bekor qilinmaydi */ }

  return {
    ok: true,
    company: company?.name || String(sub.companyId || ''),
    plan: plan.label,
    until: until.toLocaleDateString('uz-UZ'),
  };
}
