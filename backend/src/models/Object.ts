import mongoose, { Schema, Document } from 'mongoose';

export interface IObject extends Document {
  name: string;
  location?: string;
  foremanId?: string;
  status: 'active' | 'paused' | 'completed';
  budget?: number;
  smetaFileUrl?: string;
  smeta?: any; // to'liq deterministik parser natijasi (ParseResult) — qurilmalar orasida sinxron bo'lishi uchun
  companyId?: string; // v1.2 multi-tenant (nullable)
  createdAt: Date;
  updatedAt: Date;
}

const ObjectSchema: Schema = new Schema({
  name: { type: String, required: true },
  location: { type: String },
  foremanId: { type: String },
  status: { type: String, enum: ['active', 'paused', 'completed'], default: 'active' },
  budget: { type: Number },
  smetaFileUrl: { type: String },
  smeta: { type: Schema.Types.Mixed },
  companyId: { type: String, index: true } // v1.2 multi-tenant
}, { timestamps: true });

export default mongoose.model<IObject>('Object', ObjectSchema);
