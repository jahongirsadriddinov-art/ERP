import mongoose, { Schema, Document } from 'mongoose';

// Ichki e'lonlar taxtasi — direktordan/o'rinbosardan BARCHA xodimga bir
// yo'nalishli xabar (chat'dan farqli — javob/muhokama uchun EMAS, faqat
// e'lon qilish uchun).
//
// Kengaytirildi: rasm/video/lokatsiya biriktirish, "kamida N soniya ko'rish"
// (minViewSeconds — e'lon qo'ygan odam belgilaydi, yopish tugmasi shu vaqtgacha
// bloklanadi), har bir foydalanuvchi uchun "ko'rildi" belgisi (seenBy — e'lon
// har foydalanuvchiga tizimga kirganda BIR MARTA avtomatik ko'rsatiladi) va
// dasturchi (super-admin) tomonidan BARCHA firmalarga yuboriladigan global e'lon
// (isGlobal — companyId'siz).
export interface IAnnouncement extends Document {
  companyId?: string;
  isGlobal?: boolean;
  title: string;
  body: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  location?: { lat: number; lng: number };
  minViewSeconds: number;
  seenBy: string[];
  postedBy: { userId: string; name: string; role: string };
  createdAt: Date;
}

const AnnouncementSchema: Schema = new Schema({
  companyId: { type: String, index: true },
  isGlobal: { type: Boolean, default: false, index: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  mediaUrl: { type: String },
  mediaType: { type: String, enum: ['image', 'video'] },
  location: { lat: { type: Number }, lng: { type: Number } },
  minViewSeconds: { type: Number, default: 2, min: 2, max: 60 },
  seenBy: { type: [String], default: [] },
  postedBy: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

AnnouncementSchema.index({ companyId: 1, createdAt: -1 });
AnnouncementSchema.index({ isGlobal: 1, createdAt: -1 });

export default mongoose.model<IAnnouncement>('Announcement', AnnouncementSchema);
