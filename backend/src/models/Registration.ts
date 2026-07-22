import mongoose, { Schema, Document } from 'mongoose';

// Ro'yxatdan o'tish sessiyasi (sayt -> bot -> sayt). Vaqtinchalik, 15 daqiqa amal qiladi.
export type RegistrationStep =
  | 'PHONE_ENTERED'
  | 'BOT_STARTED'
  | 'PHONE_CONFIRMED'
  | 'CONSENT_GIVEN'
  | 'COMPLETED'
  | 'EXPIRED';

export interface IRegistration extends Document {
  phone: string;
  otpTokenHash: string;        // botga beriladigan deep-link tokenning HASH'i (raw saqlanmaydi)
  sessionTokenHash?: string;   // bot tasdiqlagach saytga qaytish uchun bir martalik token hash
  telegramUserId?: string;
  telegramChatId?: string;     // bot orqali bog'langan chat (complete'da User'ga ko'chiriladi)
  telegramUsername?: string;
  step: RegistrationStep;
  language?: 'uz' | 'uz-cyrl' | 'ru'; // ro'yxatdan o'tishda tanlangan til — yaratilgan User'ga ko'chiriladi
  consents: any;               // qaysi rozilik qachon berilgan (json)
  phoneAttempts: number;       // botda noto'g'ri raqam yuborish urinishlari
  ip?: string;
  userAgent?: string;
  expiresAt: Date;             // 15 daqiqa
  createdAt: Date;
  updatedAt: Date;
}

const RegistrationSchema: Schema = new Schema({
  phone: { type: String, required: true, index: true },
  otpTokenHash: { type: String, required: true, index: true },
  sessionTokenHash: { type: String, index: true },
  telegramUserId: { type: String },
  telegramChatId: { type: String },
  telegramUsername: { type: String },
  step: {
    type: String,
    enum: ['PHONE_ENTERED', 'BOT_STARTED', 'PHONE_CONFIRMED', 'CONSENT_GIVEN', 'COMPLETED', 'EXPIRED'],
    default: 'PHONE_ENTERED'
  },
  language: { type: String, enum: ['uz', 'uz-cyrl', 'ru'], default: 'uz' },
  consents: { type: Schema.Types.Mixed, default: {} },
  phoneAttempts: { type: Number, default: 0 },
  ip: { type: String },
  userAgent: { type: String },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

// Muddati o'tgan sessiyalarni Mongo avtomatik tozalaydi (lazy cleanup bilan birga).
RegistrationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IRegistration>('Registration', RegistrationSchema);
