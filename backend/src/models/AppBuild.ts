import mongoose, { Schema, Document } from 'mongoose';

// CI qurgan HAR BIR ilova build'i (APK/EXE) shu yerga tushadi — lekin
// foydalanuvchilarga DARHOL ketmaydi (owner 2026-10-28: "har bitta push bo'lgan
// yangilanish admin panelga ko'rinadi va bittasini tanlab yuboraman").
//
// Dasturchi panelda ro'yxatdan birini tanlab "Chiqarish" bosadi — o'shanda
// AppRelease('latest') yangilanadi va ilovalar yangilanishni ko'radi.
export interface IAppBuild extends Document {
  version: string;
  notes?: string;
  apkUrl?: string;
  exeUrl?: string;
  publishedAt?: Date | null;
  createdAt: Date;
}

const AppBuildSchema = new Schema<IAppBuild>({
  version: { type: String, required: true, index: true },
  notes: { type: String },
  apkUrl: { type: String },
  exeUrl: { type: String },
  publishedAt: { type: Date, default: null },
}, { timestamps: true });

// Eski build'lar 90 kundan keyin o'zi tozalanadi (ro'yxat cheksiz o'smasin).
AppBuildSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model<IAppBuild>('AppBuild', AppBuildSchema);
