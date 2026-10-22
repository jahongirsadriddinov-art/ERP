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

// Owner 2026-10-22: asosiy (bazaviy) funksiyalar HAR tarifda bor — "O'zim tanlayman"da faqat QO'SHIMCHALAR tanlanadi.
// Narxlar oddiy/standart/premium tariflar bilan mos: asos = "Oddiy" (250 000/oy), hamma qo'shimcha ≈ "Premium" (600 000/oy);
// chegirmalar ham shu tariflarnikidek (3 oy ≈ 7%, 12 oy ≈ 23%).
export const BASE_FEATURE_KEYS = ['gps_tracking', 'reports', 'qr_tools'];
export const ADDON_FEATURE_KEYS = ['ai_assistant', 'backup', 'audit_log', 'multi_currency'];

export const DEFAULT_CUSTOM_PRICING: CustomPricing = {
  baseMonthly: 250_000,
  featureMonthly: { ai_assistant: 200_000, backup: 60_000, audit_log: 50_000, multi_currency: 40_000 },
  discounts: { '1': 0, '3': 0.07, '12': 0.23 },
};

export const CUSTOM_MONTHS = [1, 3, 12] as const;

export async function getCustomPricing(): Promise<CustomPricing> {
  try {
    const s: any = await AppSettings.findOne({ key: 'global' }).select('customPlanPricing').lean();
    const o = s?.customPlanPricing || {};
    // v2 (2026-10-22): eski (bazaviylarni ham sotgan) sozlama — standart narxlarga qaytiladi
    if (o.version !== 2) return DEFAULT_CUSTOM_PRICING;
    return {
      baseMonthly: Number.isFinite(o.baseMonthly) ? o.baseMonthly : DEFAULT_CUSTOM_PRICING.baseMonthly,
      featureMonthly: { ...DEFAULT_CUSTOM_PRICING.featureMonthly, ...Object.fromEntries(Object.entries((o.featureMonthly || {}) as Record<string, number>).filter(([k, v]) => ADDON_FEATURE_KEYS.includes(k) && Number.isFinite(v))) },
      discounts: { ...DEFAULT_CUSTOM_PRICING.discounts, ...(o.discounts || {}) },
    };
  } catch { return DEFAULT_CUSTOM_PRICING; }
}

/** Tanlangan muddat va funksiyalar bo'yicha yakuniy narx (so'm, 1000 ga yaxlitlangan) va kunlar. */
export function priceCustomPlan(p: CustomPricing, months: number, features: string[]): { amount: number; days: number; features: string[] } | null {
  if (!CUSTOM_MONTHS.includes(months as any)) return null;
  // Faqat qo'shimchalar narxlanadi; bazaviylari doim (bepul, asos narxida) qo'shiladi
  const addons = [...new Set(features.filter(f => ADDON_FEATURE_KEYS.includes(f) && ALL_FEATURE_KEYS.includes(f)))];
  const clean = [...BASE_FEATURE_KEYS, ...addons];
  const monthly = p.baseMonthly + addons.reduce((a, f) => a + (p.featureMonthly[f] || 0), 0);
  const disc = Math.min(0.5, Math.max(0, p.discounts[String(months) as '1' | '3' | '12'] || 0));
  const amount = Math.round((monthly * months * (1 - disc)) / 1000) * 1000;
  return { amount, days: months === 12 ? 365 : months * 30, features: clean };
}
