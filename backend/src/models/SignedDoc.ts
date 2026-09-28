import mongoose, { Schema, Document } from 'mongoose';

// Elektron hujjat (shartnoma / bajarilgan ishlar dalolatnomasi / yuk xati) va unga qo'yilgan
// imzolar. Hujjat mazmuni `data` ichida (shablon maydonlari + jadval qatorlari); PDF qurilmada
// (brauzer/ilovada) chiziladi. Mijoz tizimga kirmasdan, maxsus havola (shareToken) orqali imzolaydi.
export type SignedDocType = 'shartnoma' | 'akt' | 'nakladnoy';
export type SignSide = 'executor' | 'customer';

export interface ISignature {
  side: SignSide;
  name: string;
  image: string;       // PNG data URL (imzo rasmi)
  stamp?: string;      // PNG data URL (pechat/muhr rasmi) — ixtiyoriy
  signedAt: Date;
  userId?: string;     // tizim foydalanuvchisi imzolagan bo'lsa
  ip?: string;
}

export interface ISignedDoc extends Document {
  companyId?: string;
  type: SignedDocType;
  number: string;
  title: string;
  data: any;
  projectId?: string;
  createdBy: string;
  createdByName?: string;
  status: 'draft' | 'partially_signed' | 'signed';
  signatures: ISignature[];
  shareToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SignatureSchema = new Schema({
  side: { type: String, enum: ['executor', 'customer'], required: true },
  name: { type: String, required: true },
  image: { type: String, required: true },
  stamp: { type: String },
  signedAt: { type: Date, default: Date.now },
  userId: { type: String },
  ip: { type: String },
}, { _id: false });

const SignedDocSchema = new Schema({
  companyId: { type: String, index: true },
  type: { type: String, enum: ['shartnoma', 'akt', 'nakladnoy'], required: true },
  number: { type: String, required: true },
  title: { type: String, required: true },
  data: { type: Schema.Types.Mixed, default: {} },
  projectId: { type: String },
  createdBy: { type: String, required: true },
  createdByName: { type: String },
  status: { type: String, enum: ['draft', 'partially_signed', 'signed'], default: 'draft' },
  signatures: { type: [SignatureSchema], default: [] },
  shareToken: { type: String, index: true, sparse: true },
}, { timestamps: true });

SignedDocSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.model<ISignedDoc>('SignedDoc', SignedDocSchema);
