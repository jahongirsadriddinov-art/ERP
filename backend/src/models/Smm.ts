import mongoose, { Schema } from 'mongoose';

// SMM avtopilot va Instagram (owner 2026-10-23: "rasmli postlar, Instagram'ni ula, agent o'zi boshqarsin").
// MUHIM (owner): yaratilgan rasm/videolar QURILMADA (brauzer IndexedDB) saqlanadi — server faqat metama'lumot
// (matn, holat, havolalar, statistika) saqlaydi. E'lon paytida fayl VAQTINCHA serverga yuklanadi (SmmTempMedia,
// taxmin qilib bo'lmaydigan havola, 1 soat TTL) va Instagram/Telegram ishi tugashi bilan o'chiriladi.

export type SmmMode = 'off' | 'approve' | 'auto';
export type SmmFormat = 'post' | 'carousel' | 'reel' | 'story';
export const SMM_FORMATS: SmmFormat[] = ['post', 'carousel', 'reel', 'story'];

/** Yagona sozlamalar yozuvi (key: 'global'). Instagram tokeni (yangilangan) — shifrlangan holda. */
const SmmSettingsSchema = new Schema({
  key: { type: String, required: true, unique: true, default: 'global' },
  mode: { type: String, enum: ['off', 'approve', 'auto'], default: 'off' },
  /** ISO hafta kunlari (1 = dushanba … 7 = yakshanba), Asia/Tashkent. */
  days: { type: [Number], default: [1, 3, 5] },
  times: { type: [String], default: ['10:00'] },
  formats: { type: [String], default: ['post', 'carousel', 'reel', 'story'] },
  language: { type: String, enum: ['uz', 'ru', 'both'], default: 'uz' },
  targets: {
    telegram: { type: Boolean, default: true },
    instagram: { type: Boolean, default: true },
  },
  dailyCap: { type: Number, default: 3, min: 1, max: 10 },
  /** Favqulodda to'xtatish (kill-switch): avtopilot hech narsa tayyorlamaydi va e'lon qilmaydi. */
  paused: { type: Boolean, default: false },
  updatedBy: String,
  // ── Instagram tokeni (avtomatik yangilanadi) ──
  igToken: { type: Schema.Types.Mixed },          // EncryptedBlob (AI_SECRETS_KEY) — faqat shifrlangan
  igTokenSource: String,                           // env tokenining sha256 boshi — egasi env'ni almashtirsa eskisi tashlanadi
  igTokenExpiresAt: Date,
  igLastRefreshAt: Date,
  igRefreshError: String,
  igRefreshCheckAt: Date,
  igUserId: String,                                // INSTAGRAM_USER_ID berilmasa /me'dan aniqlangan
  igUsername: String,
  insightsAt: Date,
  // -- Telegram kanal (UI'dan ulanadi, env AGENT_TG_CHANNEL_ID'dan ustun) --
  tgChannelId: String,
  tgChannelUsername: String,
  tgChannelTitle: String,
  tgChannelCheckedAt: Date,
  /** Kanal postlari ostida "sayt" tugmasi. */
  tgSiteButton: { type: Boolean, default: true },
  /** Premium (custom) emoji kanal postida: oxirgi rad etish sababi (Telegram xatosi) yoki muvaffaqiyat vaqti. */
  tgPremiumError: String,
  tgPremiumAt: Date,
  tgPremiumOkAt: Date,
}, { timestamps: true });

/** Avtopilot ishga tushishi (slot) — unique key bir nechta instansiyada ikki marta ishlamaslik uchun (leader-safe). */
const SmmRunSchema = new Schema({
  key: { type: String, required: true, unique: true },   // smm:YYYY-MM-DD:HH:mm
  date: { type: String },                                 // Toshkent sanasi (kunlik limit)
  status: { type: String, enum: ['running', 'prepared', 'published', 'skipped', 'failed'], default: 'running' },
  mode: String,
  format: String,
  category: String,
  topic: { type: String, maxlength: 300 },
  taskId: String,
  note: { type: String, maxlength: 500 },
}, { timestamps: true });
SmmRunSchema.index({ createdAt: -1 });
SmmRunSchema.index({ date: 1, status: 1 });

/** Instagram media statistikasi (har yangilanishda bitta yozuv — vaqt bo'yicha tarix). */
const SmmInsightSchema = new Schema({
  scope: { type: String, enum: ['media', 'account'], required: true },
  mediaId: String,
  taskId: String,
  index: Number,
  kind: String,
  at: { type: Date, default: Date.now },
  metrics: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: false });
SmmInsightSchema.index({ scope: 1, mediaId: 1, at: -1 });
SmmInsightSchema.index({ scope: 1, at: -1 });
SmmInsightSchema.index({ at: 1 }, { expireAfterSeconds: 400 * 86400 });

/** Vaqtinchalik fayl (e'lon uchun) — bo'laklarga bo'lingan (Mongo hujjati ≤16 MB), TTL bilan o'chadi. */
const SmmTempMediaSchema = new Schema({
  token: { type: String, required: true },
  part: { type: Number, default: 0 },
  parts: { type: Number, default: 1 },
  mime: String,
  size: Number,
  data: { type: Buffer, required: true },
  expireAt: { type: Date, required: true },
});
SmmTempMediaSchema.index({ token: 1, part: 1 }, { unique: true });
SmmTempMediaSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

const model = (name: string, schema: Schema): any => (mongoose.models as any)[name] || mongoose.model(name, schema);
export const SmmSettings = model('SmmSettings', SmmSettingsSchema);
export const SmmRun = model('SmmRun', SmmRunSchema);
export const SmmInsight = model('SmmInsight', SmmInsightSchema);
export const SmmTempMedia = model('SmmTempMedia', SmmTempMediaSchema);
