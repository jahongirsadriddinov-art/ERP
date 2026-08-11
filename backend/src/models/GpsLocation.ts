import mongoose, { Schema, Document } from 'mongoose';

export interface GpsLocationDoc extends Document {
  userId: string;
  companyId?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: Date;
  projectId?: string;
}

const GpsLocationSchema = new Schema<GpsLocationDoc>({
  userId: { type: String, required: true },
  companyId: String,
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  accuracy: Number,
  timestamp: { type: Date, default: Date.now },
  projectId: String,
});

GpsLocationSchema.index({ userId: 1, timestamp: -1 });
GpsLocationSchema.index({ companyId: 1, timestamp: -1 });

export default mongoose.model<GpsLocationDoc>('GpsLocation', GpsLocationSchema);
