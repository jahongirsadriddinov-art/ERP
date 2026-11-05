import mongoose, { Schema, Document } from 'mongoose';

// Bitta "singleton" yozuv — ilovaning ENG OXIRGI chiqarilgan versiyasi haqida
// ma'lumot (landing page va Profildagi "yuklab olish" bo'limi shundan
// o'qiydi). broadcast-update CI tomonidan chaqirilganda yangilanadi.
//
// 2026-11-05: HAR BIR QURILMA TURI (Android/Windows/macOS) endi MUSTAQIL
// chiqariladi (owner: "notebook ga alohida apk alohida exe alohida mac os
// ga alohida ... hammasiga alohida qil") — shu sabab `android`/`windows`/
// `macos` har biri o'z versiyasi/havolasi/vaqti bilan alohida saqlanadi.
// Tepadagi `version`/`apkUrl`/`exeUrl`/`updatedAt` maydonlari ESKI
// (allaqachon o'rnatilgan) ilovalar uchun moslik ko'prigi sifatida
// saqlanadi — ular bitta umumiy "version" bilan taqqoslashni biladi, xolos.
// Bu ko'prik HAR DOIM eng OXIRGI chiqarilgan platformani aks ettiradi.
export interface IAppReleasePlatform {
  version: string;
  notes?: string;
  url?: string;
  updatedAt?: Date;
}

export interface IAppRelease extends Document {
  key: string; // doim 'latest'
  version: string;
  notes?: string;
  apkUrl?: string;
  exeUrl?: string;
  dmgUrl?: string;
  updatedAt: Date;
  android?: IAppReleasePlatform;
  windows?: IAppReleasePlatform;
  macos?: IAppReleasePlatform;
}

const PlatformSchema = new Schema<IAppReleasePlatform>({
  version: { type: String, required: true },
  notes: { type: String },
  url: { type: String },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const AppReleaseSchema = new Schema<IAppRelease>({
  key: { type: String, required: true, unique: true, default: 'latest' },
  version: { type: String, required: true },
  notes: { type: String },
  apkUrl: { type: String },
  exeUrl: { type: String },
  dmgUrl: { type: String },
  updatedAt: { type: Date, default: Date.now },
  android: { type: PlatformSchema },
  windows: { type: PlatformSchema },
  macos: { type: PlatformSchema },
});

export default mongoose.model<IAppRelease>('AppRelease', AppReleaseSchema);
