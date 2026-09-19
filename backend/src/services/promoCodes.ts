// Promokod tekshirish/sarflash — routes/promocodes.ts (validatsiya, hali
// login qilmagan foydalanuvchi ham chaqira oladi) va services/
// registrationPayments.ts (haqiqiy buyurtma yaratishda) IKKALASI HAM shu
// bitta funksiyani chaqiradi.
import PromoCode from '../models/PromoCode';

const RESERVED = new Set(['__PROTO__', 'CONSTRUCTOR', 'PROTOTYPE']);

export interface PromoCheckResult {
  ok: boolean;
  error?: string;
  finalAmount?: number;
  discount?: number;
  promo?: { code: string; type: 'percent' | 'fixed'; value: number };
}

export async function checkPromoCode(rawCode: string, planKey: string, amount: number): Promise<PromoCheckResult> {
  const code = String(rawCode || '').trim().toUpperCase();
  // "__proto__" kabi prototip zanjiri nomlari — PromoCode.findOne bazaviy
  // Mongo so'rovi bo'lgani uchun bu yerda in-memory obyekt indekslash xavfi
  // yo'q, lekin baribir aniq formatga mos kelishini talab qilamiz.
  if (!code || RESERVED.has(code) || !/^[A-Z0-9_-]{2,32}$/.test(code)) {
    return { ok: false, error: "Promokod noto'g'ri" };
  }
  const promo = await PromoCode.findOne({ code }).lean();
  if (!promo || !promo.active) return { ok: false, error: 'Promokod topilmadi yoki faol emas' };
  if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) return { ok: false, error: 'Promokod muddati tugagan' };
  if (typeof promo.maxUses === 'number' && promo.usedCount >= promo.maxUses) return { ok: false, error: 'Promokod limiti tugagan' };
  if (Array.isArray(promo.applicablePlans) && promo.applicablePlans.length > 0 && !promo.applicablePlans.includes(planKey)) {
    return { ok: false, error: 'Bu promokod tanlangan tarifga tegishli emas' };
  }
  const discount = promo.type === 'percent' ? Math.round(amount * (promo.value / 100)) : Math.min(promo.value, amount);
  const finalAmount = Math.max(0, amount - discount);
  return {
    ok: true,
    finalAmount,
    discount: amount - finalAmount,
    promo: { code: promo.code, type: promo.type as 'percent' | 'fixed', value: promo.value },
  };
}

// Faqat HAQIQIY to'lov/obuna yaratilganda chaqiriladi (validatsiya
// bosqichida EMAS) — checkPromoCode izohiga qarang.
export async function consumePromoCode(code: string): Promise<void> {
  if (!code) return;
  await PromoCode.updateOne({ code: code.trim().toUpperCase() }, { $inc: { usedCount: 1 } }).catch(() => {});
}
