import mongoose, { Schema, Document } from 'mongoose';

// Telegram (user-account / bot) ulanishi holati. XAVFSIZLIK (review A5):
// StringSession BU YERDA SAQLANMAYDI — u faqat worker diskida (TG_SESSION_KEY bilan
// shifrlangan). Backend faqat holat, metama'lumot va fencing lease'ni biladi.
// activeCalls hisoblagichi YO'Q (B12) — parallellik faol AiCallSession'larni sanash orqali.
export type AiConnectionStatus =
  | 'disconnected' | 'awaiting_code' | 'awaiting_password' | 'connected' | 'error' | 'flood_wait' | 'banned';

export interface IAiChannelConnection extends Document {
  scope: 'platform' | 'company';
  companyId: string | null;
  type: 'telegram_user' | 'telegram_bot';
  status: AiConnectionStatus;
  tgUserId?: string;
  username?: string;
  displayName?: string;
  phoneMasked?: string;
  workerId?: string;
  workerVersion?: string;
  workerInstanceId?: string;   // worker socket'i ulangan backend instansiyasi (INSTANCE_ID)
  leaseId?: string | null;     // fencing lease (A4)
  leaseUntil?: Date | null;
  lastHealthAt?: Date;
  udpProbe?: { ok?: boolean; at?: Date };
  dailyCallCount: number;
  dailyCallDay?: string;
  floodWaitUntil?: Date;
  lastError?: string;
  connectedBy?: string;
  connectedAt?: Date;
  /** "Ochiq muloqot": bog'langan xodimlarning kiruvchi qo'ng'iroqlarini AI qabul qiladi (standart o'chiq). */
  openConversation?: boolean;
  avatarEnabled?: boolean;   // video avatar (dasturchi o'chirsa — kamera ko'rish baribir ishlaydi)
  openConversationBy?: string;
  openConversationAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiChannelConnectionSchema = new Schema<IAiChannelConnection>({
  scope: { type: String, enum: ['platform', 'company'], required: true },
  companyId: { type: String, default: null },
  type: { type: String, enum: ['telegram_user', 'telegram_bot'], required: true },
  status: {
    type: String,
    enum: ['disconnected', 'awaiting_code', 'awaiting_password', 'connected', 'error', 'flood_wait', 'banned'],
    default: 'disconnected',
  },
  tgUserId: String,
  username: String,
  displayName: String,
  phoneMasked: String,
  workerId: String,
  workerVersion: String,
  workerInstanceId: String,
  leaseId: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
  lastHealthAt: Date,
  udpProbe: { ok: Boolean, at: Date },
  dailyCallCount: { type: Number, default: 0 },
  dailyCallDay: String,
  floodWaitUntil: Date,
  lastError: { type: String, maxlength: 500 },
  connectedBy: String,
  connectedAt: Date,
  openConversation: { type: Boolean, default: false },
  avatarEnabled: { type: Boolean, default: true },
  openConversationBy: String,
  openConversationAt: Date,
}, { timestamps: true });

AiChannelConnectionSchema.index({ scope: 1, companyId: 1, type: 1 }, { unique: true });

export default mongoose.model<IAiChannelConnection>('AiChannelConnection', AiChannelConnectionSchema);
