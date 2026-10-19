import mongoose, { Schema, Document } from 'mongoose';

// Jihoz/texnika kuzatuvi — avval umuman yo'q edi (agent auditida topilgan
// bo'shliq). Oddiy inventar: kim ishlatayapti, qaysi obyektda, holati.
export interface IEquipment extends Document {
  companyId: string;
  name: string;
  type?: string;
  serialNumber?: string;
  status: 'available' | 'in_use' | 'maintenance' | 'broken';
  assignedToUserId?: string;
  objectId?: string;
  purchaseDate?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EquipmentSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  type: { type: String },
  serialNumber: { type: String },
  status: { type: String, enum: ['available', 'in_use', 'maintenance', 'broken'], default: 'available' },
  assignedToUserId: { type: String },
  objectId: { type: String },
  purchaseDate: { type: String },
  // Texnika nazorati (owner 2026-10-19): servis muddati, motor-soat, GPS-treker tokeni
  nextServiceDate: { type: String },          // YYYY-MM-DD
  serviceIntervalHours: { type: Number },     // har N motor-soatda servis
  lastServiceEngineHours: { type: Number },
  engineHours: { type: Number },              // oxirgi ma'lum motor-soat
  fuelNormPerHour: { type: Number },          // me'yor: litr/soat (bo'lmasa tarixiy medianadan)
  trackerToken: { type: String, index: true, sparse: true },
  lastSeenAt: { type: Date },
  lastLat: { type: Number },
  lastLng: { type: Number },
  notes: { type: String },
}, { timestamps: true });

EquipmentSchema.index({ companyId: 1, name: 1 });

export default mongoose.model<IEquipment>('Equipment', EquipmentSchema);
