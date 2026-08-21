import mongoose, { Schema, Document } from 'mongoose';

// Bitta "singleton" yozuv — ilovaning ENG OXIRGI chiqarilgan versiyasi haqida
// ma'lumot (landing page va Profildagi "yuklab olish" bo'limi shundan
// o'qiydi). broadcast-update CI tomonidan chaqirilganda yangilanadi.
export interface IAppRelease extends Document {
  key: string; // doim 'latest'
  version: string;
  notes?: string;
  apkUrl?: string;
  exeUrl?: string;
  updatedAt: Date;
}

const AppReleaseSchema = new Schema<IAppRelease>({
  key: { type: String, required: true, unique: true, default: 'latest' },
  version: { type: String, required: true },
  notes: { type: String },
  apkUrl: { type: String },
  exeUrl: { type: String },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IAppRelease>('AppRelease', AppReleaseSchema);
