import mongoose, { Schema, Document } from 'mongoose';

// Xavfsizlik hodisasi hisoboti — avval umuman yo'q edi. Har qanday xodim
// (nafaqat admin) hodisani darhol qayd etishi kerak — ObjectMedia (ish
// jarayoni rasm/video) bilan bir xil "hamma kirita oladi" tamoyili.
export interface ISafetyIncident extends Document {
  companyId: string;
  objectId?: string;
  reportedBy: { userId: string; name: string; role: string };
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved';
  photos?: string[];
  occurredAt: Date;
  resolvedAt?: Date;
  resolvedBy?: { userId: string; name: string };
  createdAt: Date;
}

const SafetyIncidentSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  objectId: { type: String },
  reportedBy: { type: Schema.Types.Mixed, required: true },
  title: { type: String, required: true },
  description: { type: String },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  status: { type: String, enum: ['open', 'investigating', 'resolved'], default: 'open' },
  photos: [{ type: String }],
  occurredAt: { type: Date, default: () => new Date() },
  resolvedAt: { type: Date },
  resolvedBy: { type: Schema.Types.Mixed },
}, { timestamps: true });

SafetyIncidentSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.model<ISafetyIncident>('SafetyIncident', SafetyIncidentSchema);
