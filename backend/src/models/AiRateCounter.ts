import mongoose, { Schema, Document } from 'mongoose';

// Mongo'dagi qat'iy oynali (fixed-window) chastota hisoblagichi — faqat rate limit uchun.
// Semafor sifatida ISHLATILMAYDI (review B12): jarayon qulasa hisoblagich "oqib" qolardi.
export interface IAiRateCounter extends Document {
  key: string;            // `${baseKey}:${windowStartMs}`
  windowStart: Date;
  count: number;
  expiresAt: Date;
}

const AiRateCounterSchema = new Schema<IAiRateCounter>({
  key: { type: String, required: true },
  windowStart: { type: Date, required: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});

AiRateCounterSchema.index({ key: 1 }, { unique: true });
AiRateCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IAiRateCounter>('AiRateCounter', AiRateCounterSchema);
