import mongoose, { Schema, Document } from 'mongoose';

// Xodimning AI kanallari bo'yicha sozlamasi/holati: kanal tartibi, Telegram identifikatori,
// eski shaxsiy qo'ng'iroq roziligi va opt-out. Owner 2026-10-16: asosiy rozilik — firma sozlamasi
// (calls.companyConsent), tgUserId — ERP bot bog'lanishidan (aiVoice/telegram/tgLink); har o'zgarish ConsentLog'ga.
export interface IAiEmployeeContact extends Document {
  companyId: string;
  employeeId: string;
  languageOverride?: 'uz' | 'ru';
  channelPrefs: { order?: string[]; disabled: string[] };
  telegram: {
    tgUserId?: string;
    username?: string;
    resolveStatus: 'unknown' | 'resolved' | 'not_found' | 'privacy_restricted' | 'blocked';
    resolvedAt?: Date;
    /** Oxirgi aniqlash urinishi (qo'ng'iroq paytida, owner 2026-10-16). */
    checkedAt?: Date;
    callConsent: 'none' | 'requested' | 'granted' | 'revoked';
    consentAt?: Date;
    consentToken?: string;          // ai:o:<token> — 7 kun amal qiladi (B5)
    consentTokenExpiresAt?: Date;
    bindingCodeHash?: string;       // t.me/<akkaunt> ga yuboriladigan bir martalik kod (A2)
    bindingCodeExpiresAt?: Date;
    /**
     * Qaysi AI Telegram akkauntlarining KONTAKTIGA qo'shilgan (owner 2026-10-30).
     * 'platform' — asosiy akkaunt (@erpfirma), qolganlari — hovuz akkaunti id'si.
     * Shu ro'yxat tufayli allaqachon qo'shilgan xodim qayta ro'yxatga chiqmaydi.
     */
    importedAccounts?: string[];
  };
  optOut: { calls: boolean; reminders: boolean; all: boolean; at?: Date; via?: string };
  /** AI tanishtiruv xabarini yuborgan vaqti (ikkinchi marta yozilmaydi). */
  introducedAt?: Date;
  botAiModeUntil?: Date;
  /** Owner 2026-10-22: AI oxirgi salomi (bir xil salom ketma-ket takrorlanmasin) — matn va ovoz uchun umumiy. */
  lastGreeting?: string;
  lastGreetingAt?: Date;
  /** Bot xabari 403 (foydalanuvchi botni bloklagan) olgan vaqt; keyingi muvaffaqiyatli yuborishda tozalanadi (P4). */
  botBlockedAt?: Date;
  /** Shaxsiy jim soatlar (P3, /me): firma jim soatlariga QO'SHIMCHA — bu oraliqda AI qo'ng'iroq qilmaydi. */
  quietHours?: { from: string; to: string };
  /** Shaxsiy ish jadvali (owner 2026-10-15): o'z ish kunlari (ISO 1..7) va ixtiyoriy ish boshlanishi. Yo'q — firma smenasi. */
  scheduleOverride?: { weekdays: number[]; workStart?: string; updatedBy?: string; updatedAt?: Date };
  stats: { lastCallAt?: Date; failuresInRow: number };
  createdAt: Date;
  updatedAt: Date;
}

const AiEmployeeContactSchema = new Schema<IAiEmployeeContact>({
  companyId: { type: String, required: true },
  employeeId: { type: String, required: true },
  languageOverride: { type: String, enum: ['uz', 'ru'] },
  channelPrefs: {
    order: { type: [String], default: undefined },
    disabled: { type: [String], default: [] },
  },
  telegram: {
    tgUserId: String,
    username: String,
    resolveStatus: { type: String, enum: ['unknown', 'resolved', 'not_found', 'privacy_restricted', 'blocked'], default: 'unknown' },
    resolvedAt: Date,
    checkedAt: Date,
    callConsent: { type: String, enum: ['none', 'requested', 'granted', 'revoked'], default: 'none' },
    consentAt: Date,
    consentToken: String,
    consentTokenExpiresAt: Date,
    bindingCodeHash: { type: String, select: false },
    bindingCodeExpiresAt: Date,
    importedAccounts: { type: [String], default: [] },
  },
  optOut: {
    calls: { type: Boolean, default: false },
    reminders: { type: Boolean, default: false },
    all: { type: Boolean, default: false },
    at: Date,
    via: String,
  },
  /** AI o'zini tanishtirib xabar yozgan vaqti (telegram/introduce.ts) — bir marta. */
  introducedAt: Date,
  botAiModeUntil: Date,
  lastGreeting: { type: String, maxlength: 300 },
  lastGreetingAt: Date,
  botBlockedAt: Date,
  quietHours: { type: { from: String, to: String, _id: false }, default: undefined },
  scheduleOverride: {
    type: { weekdays: { type: [Number], default: undefined }, workStart: String, updatedBy: String, updatedAt: Date, _id: false },
    default: undefined,
  },
  stats: {
    lastCallAt: Date,
    failuresInRow: { type: Number, default: 0 },
  },
}, { timestamps: true });

AiEmployeeContactSchema.index({ companyId: 1, employeeId: 1 }, { unique: true });
// B10: sparse unique null'ni ham indekslaydi — partial {$type:'string'} ishlatamiz.
// Bitta Telegram identifikatori ikki xodimga bog'lanmasin (unique).
AiEmployeeContactSchema.index({ 'telegram.tgUserId': 1 }, { unique: true, partialFilterExpression: { 'telegram.tgUserId': { $type: 'string' } } });
AiEmployeeContactSchema.index({ 'telegram.consentToken': 1 }, { unique: true, partialFilterExpression: { 'telegram.consentToken': { $type: 'string' } } });

export default mongoose.model<IAiEmployeeContact>('AiEmployeeContact', AiEmployeeContactSchema);
