import mongoose, { Schema, Document } from 'mongoose';

export interface IGroup extends Document {
  name: string;
  avatar?: string;
  memberIds: string[];
  adminIds: string[];
  createdBy: string;
  companyId?: string; // v1.2 multi-tenant (nullable)
  devSupport?: boolean; // har firma uchun dasturchi-support chat
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema: Schema = new Schema({
  name: { type: String, required: true },
  avatar: { type: String },
  memberIds: { type: [String], default: [] },
  adminIds: { type: [String], default: [] },
  createdBy: { type: String, required: true },
  companyId: { type: String, index: true }, // v1.2 multi-tenant
  devSupport: { type: Boolean, default: false, index: true },
}, { timestamps: true });

export default mongoose.model<IGroup>('Group', GroupSchema);
