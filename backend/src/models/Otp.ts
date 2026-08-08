import mongoose, { Schema, Document } from 'mongoose';

// Login uchun SMS OTP (Eskiz.uz). Vaqtinchalik — 2 daqiqa amal qiladi, keyin
// MongoDB TTL index avtomatik o'chiradi (Registration modelidagi xuddi shu
// pattern). Kod HECH QACHON plain text saqlanmaydi — faqat hash (utils/tokens
// hashPassword/verifyPassword, scrypt — loyihada bcrypt/argon2 dependency
// yo'q, parol hash uchun ham shu ishlatiladi).
export interface IOtp extends Document {
  phone: string;
  otpHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OtpSchema: Schema = new Schema({
  phone: { type: String, required: true, index: true },
  otpHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

// Muddati o'tgan OTP'larni Mongo avtomatik tozalaydi.
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IOtp>('Otp', OtpSchema);
