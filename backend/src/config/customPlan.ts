// "O'zim tanlayman" tarifi — firma muddatni (1/3/12 oy) va kerakli funksiyalarni o'zi tanlaydi, narx shundan
// hisoblanadi. Narxlar standart qiymatlar; dasturchi admin panelidan o'zgartirsa AppSettings.customPlanPricing'da
// saqlanadi va shu yerdagi qiymatlar ustidan yoziladi.
import AppSettings from '../models/AppSettings';
import { ALL_FEATURE_KEYS } from './plans';

export interface CustomPricing {
  baseMonthly: number;                       // asosiy tizim (obyektlar, xodimlar, chiqimlar, chat, bot) — oyiga
  featureMonthly: Record<string, number>;    // har bir funksiya — oyiga
  discounts: Record<'1' | '3' | '12', number>; // muddat bo'yicha chegirma (0..0.5)
}

export const DEFAULT_CUSTOM_PRICING: CustomPricing = {
  baseMonthly: 150_000,
  featureMonthly: {
    ai_assistant: 120_000, gps_tracking: 80_000, reports: 50_000, backup: 30_000,
    audit_log: 30_000, multi_currency: 20_000, qr_tools: 20_000, income: 50_000,
  },
  discounts: { '1': 0, '3': 0.1, '12': 0.25 },
};

export const CUSTOM_MONTHS = [1, 3, 12] as const;

export async function getCustomPricing(): Promise<CustomPricing> {
  try {
    const s: any = await AppSettings.findOne({ key: 'global' }).select('customPlanPricing').lean();
    const o = s?.customPlanPricing || {};
    return {
      baseMonthly: Number.isFinite(o.baseMonthly) ? o.baseMonthly : DEFAULT_CUSTOM_PRICING.baseMonthly,
      featureMonthly: { ...DEFAULT_CUSTOM_PRICING.featureMonthly, ...(o.featureMonthly || {}) },
      discounts: { ...DEFAULT_CUSTOM_PRICING.discounts, ...(o.discounts || {}) },
    };
  } catch { return DEFAULT_CUSTOM_PRICING; }
}

/** Tanlangan muddat va funksiyalar bo'yicha yakuniy narx (so'm, 1000 ga yaxlitlangan) va kunlar. */
export function priceCustomPlan(p: CustomPricing, months: number, features: string[]): { amount: number; days: number; features: string[] } | null {
  if (!CUSTOM_MONTHS.includes(months as any)) return null;
  const clean = [...new Set(features.filter(f => ALL_FEATURE_KEYS.includes(f)))];
  const monthly = p.baseMonthly + clean.reduce((a, f) => a + (p.featureMonthly[f] || 0), 0);
  const disc = Math.min(0.5, Math.max(0, p.discounts[String(months) as '1' | '3' | '12'] || 0));
  const amount = Math.round((monthly * months * (1 - disc)) / 1000) * 1000;
  return { amount, days: months === 12 ? 365 : months * 30, features: clean };
}
