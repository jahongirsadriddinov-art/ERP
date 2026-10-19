import mongoose, { Schema, Document } from 'mongoose';

// Firmaning o'z Telegram akkauntlari (owner 2026-10-19: "har firma uchun alohida, hohlagancha Telegram profil;
// qaysi bo'sh bo'lsa o'sha ishlaydi"). Platforma akkaunti AiChannelConnection'da qoladi (zaxira).
// XAVFSIZLIK: StringSession bu yerda YO'Q — faqat worker diskida (data/accounts/<_id>.enc, shifrlangan).
export type AiTgAccountStatus = 'disconnected' | 'awaiting_code' | 'awaiting_password' | 'connected' | 'error';

export interface IAiTgAccount extends Document {
  companyId: string;
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
  companyId: { type: String, required: true, index: true },
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
