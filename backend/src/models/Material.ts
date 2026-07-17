import mongoose, { Schema, Document } from 'mongoose';

export interface IMaterial extends Document {
  objectId: mongoose.Types.ObjectId;
  name: string;
  needed: number;
  sent: number;
  remaining: number;
  unit: string;
  price?: number;
  companyId?: string; // v1.2 multi-tenant (nullable, obyekt orqali ham meros oladi)
}

const MaterialSchema: Schema = new Schema({
  objectId: { type: Schema.Types.ObjectId, ref: 'Object', required: true },
  name: { type: String, required: true },
  needed: { type: Number, required: true, default: 0 },
  sent: { type: Number, required: true, default: 0 },
  remaining: { type: Number, required: true, default: 0 },
  unit: { type: String, required: true },
  price: { type: Number },
  companyId: { type: String, index: true } // v1.2 multi-tenant
}, { timestamps: true });

export default mongoose.model<IMaterial>('Material', MaterialSchema);
