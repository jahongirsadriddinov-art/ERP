import mongoose, { Schema, Document } from 'mongoose';

// AI Telegram akkauntlari umumiy hovuzi (owner 2026-10-19: "har firma uchun emas, umumiy; ism berilsin, AI shu
// ismni aytadi"). Hamma firmalar uchun ishlaydi; qaysi bo'sh bo'lsa o'sha. Platforma akkaunti AiChannelConnection'da (zaxira).
// companyId — eski yozuvlar uchun (endi ishlatilmaydi). label — AI shu akkauntdan gapirganda o'zini shu ism bilan tanishtiradi.
// XAVFSIZLIK: StringSession bu yerda YO'Q — faqat worker diskida (data/accounts/<_id>.enc, shifrlangan).
export type AiTgAccountStatus = 'disconnected' | 'awaiting_code' | 'awaiting_password' | 'connected' | 'error';

export interface IAiTgAccount extends Document {
  companyId?: string | null;
  label?: string;
  status: AiTgAccountStatus;
  tgUserId?: string;
  username?: string;
  displayName?: string;
  phoneMasked?: string;
  lastError?: string;
  lastHealthAt?: Date;
  floodWaitUntil?: Date;
  connectedAt?: Date;
  connectedBy?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiTgAccountSchema = new Schema<IAiTgAccount>({
  companyId: { type: String, default: null },
  label: { type: String, maxlength: 60 },
  status: { type: String, enum: ['disconnected', 'awaiting_code', 'awaiting_password', 'connected', 'error'], default: 'disconnected' },
  tgUserId: String,
  username: String,
  displayName: String,
  phoneMasked: String,
  lastError: { type: String, maxlength: 200 },
  lastHealthAt: Date,
  floodWaitUntil: Date,
  connectedAt: Date,
  connectedBy: String,
  createdBy: String,
}, { timestamps: true });

export default mongoose.model<IAiTgAccount>('AiTgAccount', AiTgAccountSchema);
