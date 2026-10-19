import mongoose, { Schema, Document } from 'mongoose';

// Texnika jurnali (owner 2026-10-19: "texnika telemetriyasi"): ishlagan soat, yoqilg'i, joylashuv — qo'lda (prorab)
// yoki GPS-treker orqali (POST /api/public/telemetry/:token — Traccar/OsmAnd va oddiy JSON). Insights shu
// yozuvlardan yoqilg'i anomaliyasi va servis muddatini hisoblaydi.
export interface IEquipmentLog extends Document {
  companyId: string;
  equipmentId: string;
  objectId?: string;
  date: string;              // YYYY-MM-DD (Toshkent)
  hours?: number;            // shu kuni ishlagan soat
  engineHours?: number;      // umumiy motor-soat (hisoblagich)
  fuel?: number;             // quyilgan/sarflangan yoqilg'i (litr)
  lat?: number;
  lng?: number;
  speed?: number;
  source: 'manual' | 'tracker';
  note?: string;
  createdBy?: string;
  createdAt: Date;
}

const EquipmentLogSchema = new Schema<IEquipmentLog>({
  companyId: { type: String, required: true, index: true },
  equipmentId: { type: String, required: true, index: true },
  objectId: { type: String },
  date: { type: String, required: true },
  hours: { type: Number, min: 0, max: 24 },
  engineHours: { type: Number, min: 0 },
  fuel: { type: Number, min: 0, max: 5000 },
  lat: { type: Number },
  lng: { type: Number },
  speed: { type: Number },
  source: { type: String, enum: ['manual', 'tracker'], default: 'manual' },
  note: { type: String, maxlength: 300 },
  createdBy: { type: String },
}, { timestamps: true });

EquipmentLogSchema.index({ equipmentId: 1, date: -1 });

export default mongoose.model<IEquipmentLog>('EquipmentLog', EquipmentLogSchema);
