import mongoose, { Schema, Document } from 'mongoose';

// Joylashuv qayerdan kelgani — xaritada "harakatlanmoqda" (jonli) va
// "oxirgi ma'lum joy" (statik) ko'rinishini farqlash uchun:
//  • site      — saytning o'zi (useGeoTracker), davriy so'rov — doimiy kuzatuv
//  • bot_live  — Telegram "Jonli joylashuv" (Live Location) — doimiy kuzatuv
//  • bot_once  — Telegram bir martalik joylashuv — faqat bitta nuqta
export type GpsSource = 'site' | 'bot_live' | 'bot_once';

export interface GpsLocationDoc extends Document {
  userId: string;
  companyId?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: Date;
  projectId?: string;
  source: GpsSource;
}

const GpsLocationSchema = new Schema<GpsLocationDoc>({
  userId: { type: String, required: true },
  companyId: String,
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  accuracy: Number,
  timestamp: { type: Date, default: Date.now },
  projectId: String,
  source: { type: String, enum: ['site', 'bot_live', 'bot_once'], default: 'site' },
});

GpsLocationSchema.index({ userId: 1, timestamp: -1 });
GpsLocationSchema.index({ companyId: 1, timestamp: -1 });

export default mongoose.model<GpsLocationDoc>('GpsLocation', GpsLocationSchema);
