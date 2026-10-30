import mongoose, { Schema, Document } from 'mongoose';

// Brigada ma'lumotnomasi (owner 2026-10-29: "brigader reytingini qo'sh").
//
// NEGA FIRMADAN TASHQARI: reytingning butun ma'nosi — boshqa firmalar tajribasini
// ko'rish. Shuning uchun brigada yozuvi firmaga BOG'LANMAYDI (companyId yo'q,
// scoped() ishlatilmaydi) — hamma firma bitta ma'lumotnomani ko'radi.
//
// MAXFIYLIK: baho qoldirgan firmaning NOMI boshqa firmalarga ko'rsatilmaydi —
// faqat "nechta firma baholagan" soni. Narx indeksidagi bilan bir xil mantiq:
// yig'ma ko'rsatkich foydali, kim aytgani esa kerak emas va zarar keltiradi.
//
// Telefon — yagona kalit: bir brigada ikki marta kiritilmasin.

export interface IBrigade extends Document {
  name: string;
  leaderName?: string;
  phoneKey: string;          // faqat raqamlar (998901234567) — takrorni to'xtatish uchun
  phone: string;             // ko'rsatish uchun asl ko'rinish
  specializations: string[]; // "suvoq", "beton", "elektr" ...
  region?: string;
  note?: string;
  createdByCompanyId?: string;
  createdBy?: string;
  /** Yig'ma baho — sharh tasdiqlanganda qayta hisoblanadi (har qidiruvda sanamaslik uchun). */
  avgScore: number;
  reviewCount: number;
  firmCount: number;
  hidden: boolean;
}

const BrigadeSchema: Schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  leaderName: { type: String, trim: true, maxlength: 120 },
  phoneKey: { type: String, required: true, unique: true, index: true },
  phone: { type: String, required: true, maxlength: 32 },
  specializations: { type: [String], default: [] },
  region: { type: String, maxlength: 60 },
  note: { type: String, maxlength: 500 },
  createdByCompanyId: { type: String, index: true },
  createdBy: { type: String },
  avgScore: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  firmCount: { type: Number, default: 0 },
  hidden: { type: Boolean, default: false },
}, { timestamps: true });

// Ro'yxat "eng yaxshilar" tartibida chiqadi; qidiruv nom va mutaxassislik bo'yicha
BrigadeSchema.index({ hidden: 1, avgScore: -1, reviewCount: -1 });
BrigadeSchema.index({ name: 'text', leaderName: 'text' });
BrigadeSchema.index({ region: 1, specializations: 1 });

export default mongoose.model<IBrigade>('Brigade', BrigadeSchema);
