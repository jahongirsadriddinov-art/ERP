import mongoose, { Schema, Document } from 'mongoose';

// WhatsApp Web uslubidagi QR orqali kirish (faqat laptop/planshet
// versiyasida) — lekin bitta statik QR o'rniga XAVFSIZLIK uchun 3 ta
// ALOHIDA, har 2 soniyada almashadigan kod talab qilinadi: bitta QR
// kadrini suratga olib keyinroq ishlatishga urinish YETARLI EMAS, chunki
// 3 ta TURLI rotatsiya skanerlanishi kerak (routes/qrlogin.ts'dagi
// izohga qarang). Kodlarning o'zi bazada saqlanmaydi — sessionId +
// rotatsiya raqamidan DETERMINISTIK hisoblanadi, shu sabab bu yerda
// alohida "codes" maydoni yo'q.
export interface IQrLoginSession extends Document {
  sessionId: string;   // 256-bit tasodifiy, QR'ga kodlanadi (public, lekin taxmin qilib bo'lmaydi)
  scannedSlots: number[]; // qaysi rotatsiya raqamlari muvaffaqiyatli skanerlangan
  status: 'pending' | 'verified' | 'consumed';
  userId?: string;     // kim skanerladi (verified bo'lgach to'ldiriladi)
  createdAt: Date;
}

const QrLoginSessionSchema: Schema = new Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  scannedSlots: { type: [Number], default: [] },
  status: { type: String, enum: ['pending', 'verified', 'consumed'], default: 'pending' },
  userId: { type: String },
}, { timestamps: true });

// Yozuv o'zi 10 daqiqadan keyin bazadan o'chadi (resurs tozalash) — lekin
// foydalanuvchi buni HECH QACHON sezmaydi: routes/qrlogin.ts'dagi ichki
// "muddat" ancha qisqaroq (5 daqiqa) va shu vaqt yetganda frontend
// (QrLoginPanel.tsx) sezmasdan YANGI sessiya so'raydi — sahifa ochiq
// turgan ekan, QR "umuman tugamaydi", faqat sekin-asta yangi sessiyaga o'tadi.
QrLoginSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 10 * 60 });

export default mongoose.model<IQrLoginSession>('QrLoginSession', QrLoginSessionSchema);
