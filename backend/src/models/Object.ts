import mongoose, { Schema, Document } from 'mongoose';

export interface IObject extends Document {
  name: string;
  location?: string;
  lat?: number;            // obyekt nuqtasi (geozona uchun)
  lng?: number;
  geofenceRadius?: number; // "Ishga keldim" ruxsat etilgan radius (m), standart 300
  foremanId?: string;
  status: 'active' | 'paused' | 'completed';
  budget?: number;
  budgetAlertLevel?: number; // 0 | 80 | 100 — oxirgi yuborilgan byudjet ogohlantirishi
  smetaFileUrl?: string;
  smeta?: any; // to'liq deterministik parser natijasi (ParseResult) — qurilmalar orasida sinxron bo'lishi uchun
  companyId?: string; // v1.2 multi-tenant (nullable)
  clientShareToken?: string; // mijoz portali — login talab qilmaydigan ochiq havola (routes/publicClient.ts)
  // Plan-fakt (owner 2026-10-19): reja muddati va bajarilish foizi
  startDate?: Date;
  endDate?: Date;
  progressManual?: number;           // rahbar/prorab qo'lda kiritgan foiz (bo'lsa — ustun)
  progressAi?: { percent: number; at: Date; note?: string; mediaId?: string };   // AI foto-nazorat bahosi
  createdAt: Date;
  updatedAt: Date;
}

const ObjectSchema: Schema = new Schema({
  name: { type: String, required: true },
  location: { type: String },
  lat: { type: Number },
  lng: { type: Number },
  geofenceRadius: { type: Number },
  foremanId: { type: String },
  status: { type: String, enum: ['active', 'paused', 'completed'], default: 'active' },
  budget: { type: Number },
  budgetAlertLevel: { type: Number, default: 0 },
  smetaFileUrl: { type: String },
  smeta: { type: Schema.Types.Mixed },
  companyId: { type: String, index: true }, // v1.2 multi-tenant
  clientShareToken: { type: String, index: true, sparse: true },
  startDate: { type: Date },
  endDate: { type: Date },
  progressManual: { type: Number, min: 0, max: 100 },
  progressAi: { type: Schema.Types.Mixed },
}, { timestamps: true });

// Search uchun indekslar
ObjectSchema.index({ companyId: 1, name: 1 });
ObjectSchema.index({ name: 'text', location: 'text' });

export default mongoose.model<IObject>('Object', ObjectSchema);
