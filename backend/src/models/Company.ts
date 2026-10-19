import mongoose, { Schema, Document } from 'mongoose';

// Firma (tenant). Har bir firma alohida branchId oladi va o'z ma'lumotlarini ko'radi.
export interface ICompany extends Document {
  branchId: string;        // ko'rinadigan ID, masalan "BR-2026-0001"
  name: string;            // firma nomi (rahbar qo'yadi — hamma ko'radi, faqat rahbar o'zgartiradi)
  logoUrl?: string;        // firma logotipi (server URL, base64 emas)
  legalName?: string;      // yuridik nom
  inn?: string;            // INN / STIR
  address?: string;
  region?: string;         // viloyat
  phone: string;           // firma egasining raqami
  activityType?: 'qurilish' | 'tamirlash' | 'loyihalash' | 'boshqa';
  employeeRange?: '1-10' | '11-50' | '51-200' | '200+';
  currency: 'UZS' | 'USD';
  customUsdRate?: number;  // firma o'zi belgilagan 1 USD = X UZS (bo'lmasa CBU kursi ishlatiladi)
  customEurRate?: number;  // firma o'zi belgilagan 1 EUR = X UZS
  ownerUserId?: string;    // User._id (firma egasi)
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  plan: 'FREE' | 'PRO' | 'ENTERPRISE'; // hozir hamma FREE
  features?: { briefing?: boolean; theft?: boolean; prices?: boolean; docs?: boolean; equipment?: boolean; photoAi?: boolean; piecework?: boolean };
  trialEndsAt?: Date;      // hozir null / uzoq sana
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema: Schema = new Schema({
  branchId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  logoUrl: { type: String },
  legalName: { type: String },
  inn: { type: String },
  address: { type: String },
  region: { type: String },
  phone: { type: String, required: true },
  activityType: { type: String, enum: ['qurilish', 'tamirlash', 'loyihalash', 'boshqa'], default: 'qurilish' },
  employeeRange: { type: String, enum: ['1-10', '11-50', '51-200', '200+'] },
  currency: { type: String, enum: ['UZS', 'USD'], default: 'UZS' },
  customUsdRate: { type: Number },
  customEurRate: { type: Number },
  ownerUserId: { type: String, index: true },
  status: { type: String, enum: ['PENDING', 'ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  plan: { type: String, enum: ['FREE', 'PRO', 'ENTERPRISE'], default: 'FREE' },
  trialEndsAt: { type: Date },
  lastMonthlySummary: { type: String }, // 'YYYY-MM' — oylik xulosa yuborilgan oxirgi oy
  // Ixtiyoriy funksiyalar (owner 2026-10-19): firma o'zi yoqadi/o'chiradi — services/insights.ts, ishbay hisob
  features: {
    briefing: { type: Boolean, default: true },     // ertalabki kunlik brifing (xabar)
    theft: { type: Boolean, default: true },        // material o'g'irligi/anomaliya nazorati
    prices: { type: Boolean, default: true },       // material narxi monitoringi
    docs: { type: Boolean, default: true },         // hujjat muddatlari
    equipment: { type: Boolean, default: true },    // texnika nazorati
    photoAi: { type: Boolean, default: true },      // AI foto-nazorat
    piecework: { type: Boolean, default: false },   // ishbay (bajarilgan hajm × narx) — ixtiyoriy
  },
}, { timestamps: true });

export default mongoose.model<ICompany>('Company', CompanySchema);
