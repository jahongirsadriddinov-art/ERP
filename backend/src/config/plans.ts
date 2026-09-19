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
  period?: '1month' | '3month' | '12month';
  tier?: 1 | 2 | 3;
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

// ChatGPT uslubidagi narx jadvali: har bir davr (1/3/12 oylik) ostida 3 xil
// daraja (Oddiy/Standart/Premium) — arzonroq darajada AI yordamchi va
// "hardoim kerak bo'lmaydigan" funksiyalar yo'q. Narxlar BOSHLANG'ICH
// taxminiy qiymat — admin panel (Tariflar) orqali istalgan vaqt o'zgartiriladi.
const TIER1_FEATURES = ['gps_tracking', 'reports', 'qr_tools'];
const TIER2_FEATURES = ['gps_tracking', 'reports', 'audit_log', 'multi_currency', 'qr_tools'];
const TIER3_FEATURES = ALL_FEATURE_KEYS;
const SEED_TIERED_PLANS: Array<{ key: string; label: string; days: number; amount: number; order: number; period: '1month'|'3month'|'12month'; tier: 1|2|3; features: string[] }> = [
  { key: '1month_basic',    label: "1 oylik — Oddiy",    days: 30,  amount: 250_000,   order: 10, period: '1month',  tier: 1, features: TIER1_FEATURES },
  { key: '1month_standard', label: "1 oylik — Standart", days: 30,  amount: 400_000,   order: 11, period: '1month',  tier: 2, features: TIER2_FEATURES },
  { key: '1month_premium',  label: "1 oylik — Premium",  days: 30,  amount: 600_000,   order: 12, period: '1month',  tier: 3, features: TIER3_FEATURES },
  { key: '3month_basic',    label: "3 oylik — Oddiy",    days: 90,  amount: 700_000,   order: 13, period: '3month',  tier: 1, features: TIER1_FEATURES },
  { key: '3month_standard', label: "3 oylik — Standart", days: 90,  amount: 1_100_000, order: 14, period: '3month',  tier: 2, features: TIER2_FEATURES },
  { key: '3month_premium',  label: "3 oylik — Premium",  days: 90,  amount: 1_600_000, order: 15, period: '3month',  tier: 3, features: TIER3_FEATURES },
  { key: '12month_basic',    label: "12 oylik — Oddiy",    days: 365, amount: 2_300_000, order: 16, period: '12month', tier: 1, features: TIER1_FEATURES },
  { key: '12month_standard', label: "12 oylik — Standart", days: 365, amount: 3_600_000, order: 17, period: '12month', tier: 2, features: TIER2_FEATURES },
  { key: '12month_premium',  label: "12 oylik — Premium",  days: 365, amount: 5_400_000, order: 18, period: '12month', tier: 3, features: TIER3_FEATURES },
];

// Faqat BIR MARTA (server birinchi marta shu yangi tariflarsiz ishga
// tushganda) chaqiriladi — mavjud bo'lsa hech narsa qilmaydi, shu bilan
// admin keyinchalik ularni faolsiz/o'chirgan bo'lsa ham qaytadan
// "tirilib" qolmaydi.
export async function ensureTieredPlansSeeded(): Promise<void> {
  const existingKeys = new Set(
    (await Plan.find({ key: { $in: SEED_TIERED_PLANS.map(p => p.key) } }).select('key').lean()).map(p => p.key)
  );
  const missing = SEED_TIERED_PLANS.filter(p => !existingKeys.has(p.key));
  if (missing.length === 0) return;
  await Plan.insertMany(missing.map(p => ({ ...p, active: true })));
  // Eski "tekis" pullik/dublikat tariflar yangi katakchali dizaynda
  // ko'rsatilmaydi — lekin O'CHIRMAYMIZ (mavjud obunachilar hamon shu
  // kalitga bog'liq bo'lishi mumkin, getPlanInfo() ularni baribir topa oladi).
  await Plan.updateMany({ key: { $in: ['1month', '3month', '6month', '12month'] } }, { active: false });
  console.log("✅ Davr×daraja tariflari (1/3/12 oylik × Oddiy/Standart/Premium) qo'shildi");
}

// Bazadan qayta o'qiydi va PLAN_CONFIG'ni JOYIDA (in place) yangilaydi —
// server ishga tushganda va har bir admin CRUD amalidan keyin chaqiriladi.
export async function reloadPlanCache(): Promise<void> {
  const plans = await Plan.find({ active: true }).sort({ order: 1 }).lean();
  for (const k of Object.keys(PLAN_CONFIG)) delete PLAN_CONFIG[k];
  for (const p of plans) {
    PLAN_CONFIG[p.key] = {
      label: p.label, days: p.days, amount: p.amount, features: p.features || [],
      period: p.period, tier: p.tier,
    };
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
