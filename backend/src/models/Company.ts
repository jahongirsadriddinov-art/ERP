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
  ownerUserId?: string;    // User._id (firma egasi)
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  plan: 'FREE' | 'PRO' | 'ENTERPRISE'; // hozir hamma FREE
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
  ownerUserId: { type: String, index: true },
  status: { type: String, enum: ['PENDING', 'ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  plan: { type: String, enum: ['FREE', 'PRO', 'ENTERPRISE'], default: 'FREE' },
  trialEndsAt: { type: Date }
}, { timestamps: true });

export default mongoose.model<ICompany>('Company', CompanySchema);
