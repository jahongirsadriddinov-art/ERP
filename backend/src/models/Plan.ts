import mongoose, { Schema, Document } from 'mongoose';

// Obuna tariflari — ENDI ADMIN (dasturchi) tomonidan boshqariladi (narx,
// muddat, yorliq, qaysi funksiyalar yoqilgan) — avval bular kodning
// ichida qattiq yozilgan edi (config/plans.ts). Haqiqiy manba shu
// kolleksiya; config/plans.ts endi shundan to'ldiriladigan KESH sifatida
// ishlaydi (server ishga tushganda va har bir admin o'zgartirishidan
// keyin qayta yuklanadi) — shu bilan barcha eski kod (PLAN_CONFIG[key]
// ko'rinishidagi sinxron o'qish) o'zgarishsiz ishlashda davom etadi.
export interface IPlan extends Document {
  key: string;         // masalan '3month' — Subscription.selectedPlan/Payment.plan shu bilan bog'lanadi
  label: string;
  days: number;
  amount: number;
  features: string[];  // FEATURE_REGISTRY'dagi kalitlar — shu tarifda yoqilgan funksiyalar
  active: boolean;      // false bo'lsa yangi ro'yxatdan o'tishda/to'lovda taklif qilinmaydi
  order: number;        // ko'rsatish tartibi
  // ChatGPT uslubidagi narx jadvali uchun: davr (1 oylik/3 oylik/12 oylik)
  // ustida 3 xil daraja (Oddiy/Standart/Premium). Ikkalasi ham ixtiyoriy —
  // eski "tekis" tariflar (bepul va h.k.) bularsiz ham ishlayveradi.
  period?: '1month' | '3month' | '12month';
  tier?: 1 | 2 | 3;
}

const PlanSchema: Schema = new Schema({
  key: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  days: { type: Number, required: true },
  amount: { type: Number, required: true },
  features: [{ type: String }],
  active: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
  period: { type: String, enum: ['1month', '3month', '12month'] },
  tier: { type: Number, enum: [1, 2, 3] },
}, { timestamps: true });

export default mongoose.model<IPlan>('Plan', PlanSchema);
