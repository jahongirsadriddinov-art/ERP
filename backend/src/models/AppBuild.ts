import mongoose, { Schema, Document } from 'mongoose';

// CI qurgan HAR BIR ilova build'i (APK/EXE/DMG) shu yerga tushadi — lekin
// foydalanuvchilarga DARHOL ketmaydi (owner 2026-10-28: "har bitta push bo'lgan
// yangilanish admin panelga ko'rinadi va bittasini tanlab yuboraman").
//
// Dasturchi panelda ro'yxatdan HAR BIR qurilma turini (Android/Windows/macOS)
// ALOHIDA "Chiqarish" bosadi (owner 2026-11-05: "hammasiga alohida qil") —
// o'shanda AppRelease('latest').<platform> yangilanadi va o'sha platformadagi
// ilovalar yangilanishni ko'radi — boshqa platformalarga tegmaydi.
export interface IAppBuild extends Document {
  version: string;
  notes?: string;
  apkUrl?: string;
  exeUrl?: string;
  dmgUrl?: string;
  apkPublishedAt?: Date | null;
  exePublishedAt?: Date | null;
  dmgPublishedAt?: Date | null;
  createdAt: Date;
}

const AppBuildSchema = new Schema<IAppBuild>({
  version: { type: String, required: true, index: true },
  notes: { type: String },
  apkUrl: { type: String },
  exeUrl: { type: String },
  dmgUrl: { type: String },
  apkPublishedAt: { type: Date, default: null },
  exePublishedAt: { type: Date, default: null },
  dmgPublishedAt: { type: Date, default: null },
}, { timestamps: true });

// Eski build'lar 90 kundan keyin o'zi tozalanadi (ro'yxat cheksiz o'smasin).
AppBuildSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model<IAppBuild>('AppBuild', AppBuildSchema);
