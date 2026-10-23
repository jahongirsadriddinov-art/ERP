import mongoose, { Schema, Document } from 'mongoose';

// AI Telegram akkauntlari umumiy hovuzi (owner 2026-10-19: "har firma uchun emas, umumiy; ism berilsin, AI shu
// ismni aytadi"). Hamma firmalar uchun ishlaydi; qaysi bo'sh bo'lsa o'sha. Platforma akkaunti AiChannelConnection'da (zaxira).
// companyId — eski yozuvlar uchun (endi ishlatilmaydi). label — AI shu akkauntdan gapirganda o'zini shu ism bilan tanishtiradi.
// XAVFSIZLIK: StringSession bu yerda YO'Q — faqat worker diskida (data/accounts/<_id>.enc, shifrlangan).
// Anti-freeze (owner 2026-10-23): worker aniqlagan Telegram cheklovi (telegram/antiFreeze.ts)
export interface ITgHealth { state: 'ok' | 'frozen' | 'spam_limited' | 'banned' | 'unauthorized'; reason?: string; since?: Date; until?: Date; appealUrl?: string; at?: Date }
export const TgHealthSchema = new Schema({
  state: { type: String, enum: ['ok', 'frozen', 'spam_limited', 'banned', 'unauthorized'] },
  reason: { type: String, maxlength: 40 },
  since: Date,
  until: Date,
  appealUrl: { type: String, maxlength: 300 },
  at: Date,
}, { _id: false });

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
  /** Anti-freeze: Telegram cheklovi (frozen/spam_limited/banned/unauthorized) */
  health?: ITgHealth;
  /** Worker hisoblagichlari (bugungi qo'ng'iroq/DM/import va chegaralar, isitish) — panel uchun */
  usage?: Record<string, unknown>;
  device?: string;
  proxy?: string;
  /** Oxirgi chiquvchi qo'ng'iroq (yuk taqsimoti: eng uzoq ishlatilmagan akkaunt) */
  lastUsedAt?: Date;
  /** Worker rate_limited/flood_wait/cheklov bilan rad etdi — shu vaqtgacha tanlanmaydi */
  limitedUntil?: Date;
  /** Profil oxirgi o'zgargan vaqt — kuniga 1 marta */
  profileChangedAt?: Date;
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
  health: { type: TgHealthSchema, default: undefined },
  usage: { type: Schema.Types.Mixed },
  device: { type: String, maxlength: 120 },
  proxy: { type: String, maxlength: 80 },
  lastUsedAt: Date,
  limitedUntil: Date,
  profileChangedAt: Date,
}, { timestamps: true });

export default mongoose.model<IAiTgAccount>('AiTgAccount', AiTgAccountSchema);
