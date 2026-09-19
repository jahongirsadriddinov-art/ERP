import mongoose, { Schema, Document } from 'mongoose';

// Promokodlar — ro'yxatdan o'tishda (onlayn to'lov bosqichida) foydalanuvchi
// kiritadi, narxni kamaytiradi. Haqiqiy sarflanishi (usedCount++) FAQAT
// to'lov muvaffaqiyatli bo'lganda (routes/payments.ts webhook) sodir
// bo'ladi — validatsiya bosqichida (services/promoCodes.ts checkPromoCode)
// limitni ISHLATIB QO'YMAYDI, aks holda odamlar to'lamasdan "sinab ko'rib"
// cheklangan kodni tugatib qo'yishi mumkin edi.
export interface IPromoCode extends Document {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  active: boolean;
  maxUses?: number;
  usedCount: number;
  expiresAt?: Date;
  applicablePlans?: string[]; // bo'sh/aniqlanmagan = barcha pullik tariflarga tegishli
  createdAt: Date;
  updatedAt: Date;
}

const PromoCodeSchema: Schema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, enum: ['percent', 'fixed'], required: true },
  value: { type: Number, required: true, min: 0 },
  active: { type: Boolean, default: true },
  maxUses: { type: Number },
  usedCount: { type: Number, default: 0 },
  expiresAt: { type: Date },
  applicablePlans: [{ type: String }],
}, { timestamps: true });

export default mongoose.model<IPromoCode>('PromoCode', PromoCodeSchema);
