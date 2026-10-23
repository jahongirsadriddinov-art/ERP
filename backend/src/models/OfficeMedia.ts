import mongoose, { Schema, Document } from 'mongoose';

// AI ofis (owner 2026-10-23): dasturchining ofisdagi musiqasi va kinosi — har dasturchi uchun bitta hujjat.
//  • yandex — Yandex Musiqa ulashish havolasi (rasmiy iframe vidjeti uchun; xost qat'iy tekshiriladi);
//  • tracks — o'zi yuklagan qo'shiqlar (https havola: /api/messages/upload orqali);
//  • cinema — kinozal ekrani uchun havola (YouTube / VK Video / Rutube / mp4-webm / Kinopoisk — faqat "ochish").
export interface IOfficeMedia extends Document {
  userId: string;
  yandex: string;
  tracks: { id: string; name: string; url: string }[];
  cinema: string;
  updatedAt: Date;
}

const OfficeMediaSchema = new Schema<IOfficeMedia>({
  userId: { type: String, required: true, unique: true, maxlength: 40 },
  yandex: { type: String, default: '', maxlength: 2000 },
  tracks: {
    type: [{ _id: false, id: { type: String, maxlength: 40 }, name: { type: String, maxlength: 120 }, url: { type: String, maxlength: 2000 } }],
    default: [],
  },
  cinema: { type: String, default: '', maxlength: 2000 },
}, { timestamps: true });

export default mongoose.model<IOfficeMedia>('OfficeMedia', OfficeMediaSchema);
