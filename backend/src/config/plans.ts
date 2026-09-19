// Obuna tariflari — sayt (routes/subscriptions.ts), bot (services/bot.ts,
// Roxiy to'lov tugmalari) va admin panel (routes/plans.ts) BIR XIL
// manbadan (Plan kolleksiyasi, models/Plan.ts) foydalanadi.
//
// PLAN_CONFIG shu yerda ESKI kod bilan mosligi uchun saqlab qolingan
// (ko'plab joy hali ham `PLAN_CONFIG[key]` deb sinxron o'qiydi) — lekin
// endi bu qattiq yozilgan literal EMAS, balki bazadan to'ldiriladigan
// KESH: server ishga tushganda (`reloadPlanCache()` index.ts'da
// chaqiriladi) va har bir admin o'zgartirishidan keyin (routes/plans.ts)
// qayta to'ldiriladi. Obyektning O'ZI (reference) HECH QACHON
// almashtirilmaydi — faqat ICHKI kalitlari — shu sabab uni import qilgan
// BARCHA fayllar (ular obyektning o'ziga, kontentiga emas, birinchi
// import paytidagi referensga ega) yangilanishlarni ko'radi.
import Plan from '../models/Plan';

export interface PlanInfo {
  label: string;
  days: number;
  amount: number;
  features: string[];
}

export const PLAN_CONFIG: Record<string, PlanInfo> = {};

export type SelectedPlan = string;

// Ilova qo'llab-quvvatlaydigan barcha funksiyalar ro'yxati — admin panelda
// har bir tarif uchun shu ro'yxatdan belgilanadi. Yangi funksiya
// cheklashni yoqish uchun: (1) shu yerga qo'shing, (2) tegishli frontend
// joyida `features.includes('shu_kalit')` tekshiruvini qo'shing.
export const FEATURE_REGISTRY = [
  { key: 'ai_assistant', label: 'AI Yordamchi (✨)' },
  { key: 'gps_tracking', label: 'GPS kuzatuv' },
  { key: 'reports', label: 'Hisobotlar (grafik/PDF)' },
  { key: 'backup', label: 'Zaxira nusxa (backup)' },
  { key: 'audit_log', label: 'Audit jurnali' },
  { key: 'multi_currency', label: 'Valyuta konvertori (USD/EUR)' },
  { key: 'qr_tools', label: 'QR skaner/generator' },
] as const;
export type FeatureKey = typeof FEATURE_REGISTRY[number]['key'];
export const ALL_FEATURE_KEYS: string[] = FEATURE_REGISTRY.map(f => f.key);

// Birinchi marta ishga tushganda (Plan kolleksiyasi bo'sh bo'lsa) —
// eskidan qattiq yozilgan qiymatlar bilan urug'lanadi, HAMMA funksiya
// yoqilgan holda (mavjud mijozlarni to'satdan cheklab qo'ymaslik uchun).
const SEED_PLANS: Array<{ key: string; label: string; days: number; amount: number; order: number }> = [
  { key: 'bepul',   label: "1 oy bepul", days: 30,  amount: 0,         order: 0 },
  { key: '1month',  label: "1 oylik",    days: 30,  amount: 0,         order: 1 },
  { key: '3month',  label: "3 oylik",    days: 90,  amount: 1_400_000, order: 2 },
  { key: '6month',  label: "6 oylik",    days: 180, amount: 3_500_000, order: 3 },
  { key: '12month', label: "12 oylik",   days: 365, amount: 7_700_000, order: 4 },
];

export async function ensurePlansSeeded(): Promise<void> {
  const count = await Plan.countDocuments();
  if (count > 0) return;
  await Plan.insertMany(SEED_PLANS.map(p => ({ ...p, features: ALL_FEATURE_KEYS, active: true })));
  console.log('✅ Plan kolleksiyasi urug\'lantirildi (5 ta standart tarif, barcha funksiyalar yoqilgan)');
}

// Bazadan qayta o'qiydi va PLAN_CONFIG'ni JOYIDA (in place) yangilaydi —
// server ishga tushganda va har bir admin CRUD amalidan keyin chaqiriladi.
export async function reloadPlanCache(): Promise<void> {
  const plans = await Plan.find({ active: true }).sort({ order: 1 }).lean();
  for (const k of Object.keys(PLAN_CONFIG)) delete PLAN_CONFIG[k];
  for (const p of plans) {
    PLAN_CONFIG[p.key] = { label: p.label, days: p.days, amount: p.amount, features: p.features || [] };
  }
}

// Object.hasOwn — PLAN_CONFIG oddiy obyekt bo'lgani uchun `PLAN_CONFIG['__proto__']`
// kabi prototip zanjiridagi nom yuborilsa, oddiy `PLAN_CONFIG[key]` yolg'on-ijobiy
// (Object.prototype) qaytarib, "tarif topildi" tekshiruvini chetlab o'tishi mumkin edi.
export function getPlanInfo(key: string): PlanInfo | undefined {
  return Object.hasOwn(PLAN_CONFIG, key) ? PLAN_CONFIG[key] : undefined;
}

// Faqat PULLIK (Roxiy orqali to'lanadigan) tariflar — sayt va bot'dagi
// "to'lash" tugmalari shu ro'yxatdan yasaladi.
export function getPayablePlanKeys(): string[] {
  return Object.keys(PLAN_CONFIG).filter(k => PLAN_CONFIG[k].amount > 0);
}
