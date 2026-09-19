import mongoose, { Schema, Document } from 'mongoose';

// WhatsApp Web uslubidagi QR orqali kirish (faqat laptop/planshet
// versiyasida) — lekin bitta statik QR o'rniga XAVFSIZLIK uchun 3 ta
// KETMA-KET, har 3 soniyada almashadigan kod talab qilinadi: bitta QR
// kadrini suratga olib keyinroq ishlatishga urinish YETARLI EMAS, chunki
// aynan O'SHA 3 soniyalik oynada, va ketma-ket UCHALASI ham skanerlanishi
// kerak (routes/qrlogin.ts'dagi izohga qarang).
export interface IQrLoginSession extends Document {
  sessionId: string;   // 256-bit tasodifiy, QR'ga kodlanadi (public, lekin taxmin qilib bo'lmaydi)
  codes: string[];     // 3 ta tasodifiy kod — har biri bitta 3-soniyalik "slot"ga tegishli
  scannedSlots: number[]; // qaysi slotlar (0,1,2) muvaffaqiyatli skanerlangan
  status: 'pending' | 'verified' | 'consumed';
  userId?: string;     // kim skanerladi (verified bo'lgach to'ldiriladi)
  createdAt: Date;
}

const QrLoginSessionSchema: Schema = new Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  codes: { type: [String], required: true },
  scannedSlots: { type: [Number], default: [] },
  status: { type: String, enum: ['pending', 'verified', 'consumed'], default: 'pending' },
  userId: { type: String },
}, { timestamps: true });

// 2 daqiqadan keyin avtomatik o'chadi — foydalanilmagan QR sessiyalar
// bazada abadiy qolmasligi uchun (routes/qrlogin.ts o'zi ham 60 soniyadan
// keyin "muddati tugadi" deb hisoblaydi, bu shunchaki keyingi tozalash).
QrLoginSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 });

export default mongoose.model<IQrLoginSession>('QrLoginSession', QrLoginSessionSchema);
