import { Request } from 'express';
import Subscription, { subscriptionChangeGen } from '../models/Subscription';

// XAVFSIZLIK/BIZNES (audit 2026-10-19, #27): obuna holati avval FAQAT login paytida tekshirilardi —
// muddati tugagan yoki rad etilgan firmaning ochiq turgan sessiyasi (token 7 kun) ishlayverardi.
// Endi har so'rovda tekshiriladi (login'dagi issueSession bilan AYNAN bir xil qoida), firma bo'yicha
// 60 s keshlanadi — oddiy ishlashda qo'shimcha DB yuki deyarli yo'q.
export type BlockedSubStatus = 'pending' | 'expired' | 'rejected';

const cache = new Map<string, { status: BlockedSubStatus | null; at: number; gen: number }>();
const TTL = 60_000;

export async function subscriptionBlockOf(companyId: string): Promise<BlockedSubStatus | null> {
  const c = cache.get(companyId);
  const gen = typeof subscriptionChangeGen === 'function' ? subscriptionChangeGen() : 0; // testlarda model mock bo'lishi mumkin
  if (c && c.gen === gen && Date.now() - c.at < TTL) return c.status;
  let status: BlockedSubStatus | null = null;
  try {
    const sub: any = await Subscription.findOne({ companyId }).sort({ createdAt: -1 }).select('status currentPeriodEnd').lean();
    if (sub) {
      if (sub.status === 'active' && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) < new Date()) status = 'expired';
      else if (sub.status === 'pending' || sub.status === 'expired' || sub.status === 'rejected') status = sub.status;
    }
  } catch { status = null; } // baza xatosi ishni to'xtatib qo'ymasin
  cache.set(companyId, { status, at: Date.now(), gen });
  return status;
}
export function invalidateSubscription(companyId?: string) {
  if (companyId) cache.delete(String(companyId)); else cache.clear();
}

// Obuna tugagan bo'lsa ham ochiq qoladigan yo'llar: kirish/chiqish, obunani ko'rish va to'lash, tariflar, holat
const ALLOW = [/^\/api\/auth/, /^\/api\/sessions/, /^\/api\/push/, /^\/api\/errors/, /^\/api\/status/,
  /^\/api\/admin\/subscriptions/, /^\/api\/plans/, /^\/api\/payments/, /^\/api\/promocodes/, /^\/api\/currency/];

export function subscriptionGateApplies(req: Request): boolean {
  const p = (req.originalUrl || '').split('?')[0];
  return !ALLOW.some(re => re.test(p));
}

export function subscriptionBlockedResponse(status: BlockedSubStatus) {
  return {
    subscriptionStatus: status,
    error: status === 'pending'
      ? "Obunangiz hali admin tomonidan tasdiqlanmagan. Iltimos kuting yoki @Sadriddinov_Jahongir bilan bog'laning."
      : "Obunangiz muddati tugagan yoki rad etilgan. To'lovni yangilash uchun @Sadriddinov_Jahongir bilan bog'laning.",
  };
}
