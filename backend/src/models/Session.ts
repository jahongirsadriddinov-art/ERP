import mongoose, { Schema, Document } from 'mongoose';

// Har bir muvaffaqiyatli login (parol/OTP, QR-login, dasturchi) uchun BITTA
// yozuv — "Ulangan qurilmalar" (ProfilePage) shundan o'qiydi va JWT'ni
// istalgan vaqt (revoked=true) bekor qila oladi. JWT'ning o'zi statik
// bo'lgani uchun (imzo to'g'ri bo'lsa muddati tugagunча ishlayveradi),
// requireAuth HAR so'rovda (agar token'da jti bo'lsa) shu yozuvni ham
// tekshiradi — services/sessions.ts va middleware/auth.ts'ga qarang.
export interface ISession extends Document {
  userId: string;
  jti: string;
  deviceLabel: string;
  userAgent?: string;
  ip?: string;
  loginMethod: 'password' | 'otp' | 'qr' | 'dev';
  revoked: boolean;
  lastSeenAt: Date;
  createdAt: Date;
}

const SessionSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  jti: { type: String, required: true, unique: true, index: true },
  deviceLabel: { type: String, required: true },
  userAgent: { type: String },
  ip: { type: String },
  loginMethod: { type: String, enum: ['password', 'otp', 'qr', 'dev'], default: 'password' },
  revoked: { type: Boolean, default: false },
  lastSeenAt: { type: Date, default: () => new Date() },
}, { timestamps: true });

// JWT eng uzog'i 365 kun (dasturchi) amal qiladi — shundan keyin token
// baribir yaroqsiz bo'lgani uchun yozuvni ham saqlashning ma'nosi yo'q.
// Oddiy foydalanuvchi tokeni 7 kun — lekin bitta TTL barchasiga yetadi
// (365 kun), erta o'chirib yubormaydi.
SessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 366 * 24 * 60 * 60 });

export default mongoose.model<ISession>('Session', SessionSchema);
