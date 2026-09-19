// Obuna tariflari — sayt (routes/subscriptions.ts) va bot
// (services/bot.ts, Roxiy to'lov tugmalari) ikkalasida ham BIR XIL
// manbadan foydalanishi uchun markazlashtirilgan (avval faqat
// subscriptions.ts'da e'lon qilingan edi).
//
// Har bir tarifda BIRINCHI OY BEPUL — umumiy summadan 1 oylik narx
// (700 000) ayirilgan.
export const PLAN_CONFIG: Record<string, { label: string; days: number; amount: number }> = {
  'bepul':   { label: '1 oy bepul', days: 30,  amount: 0 },
  '1month':  { label: '1 oylik',   days: 30,  amount: 0 },
  '3month':  { label: '3 oylik',   days: 90,  amount: 1_400_000 },
  '6month':  { label: '6 oylik',   days: 180, amount: 3_500_000 },
  '12month': { label: '12 oylik',  days: 365, amount: 7_700_000 },
};

export type SelectedPlan = string;

// Object.hasOwn — PLAN_CONFIG oddiy obyekt bo'lgani uchun `PLAN_CONFIG['__proto__']`
// kabi prototip zanjiridagi nom yuborilsa, oddiy `PLAN_CONFIG[key]` yolg'on-ijobiy
// (Object.prototype) qaytarib, "tarif topildi" tekshiruvini chetlab o'tishi mumkin edi.
export function getPlanInfo(key: string): { label: string; days: number; amount: number } | undefined {
  return Object.hasOwn(PLAN_CONFIG, key) ? PLAN_CONFIG[key] : undefined;
}

// Faqat PULLIK (Roxiy orqali to'lanadigan) tariflar — sayt va bot'dagi
// "to'lash" tugmalari shu ro'yxatdan yasaladi.
export const PAYABLE_PLAN_KEYS = Object.keys(PLAN_CONFIG).filter(k => PLAN_CONFIG[k].amount > 0);
