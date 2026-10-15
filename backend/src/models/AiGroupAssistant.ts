import mongoose, { Schema, Document } from 'mongoose';

// Chat guruhiga qo'shilgan "AI yordamchi" (egasi so'rovi, 2026-10-15). Guruh hujjatiga tegmaymiz —
// alohida kichik kolleksiya: qaysi guruhda AI yoqilgan, kim qo'shgan/o'zgartirgan.
export interface IAiGroupAssistant extends Document {
  companyId: string;
  groupId: string;
  enabled: boolean;
  addedBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiGroupAssistantSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  groupId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },
  addedBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model<IAiGroupAssistant>('AiGroupAssistant', AiGroupAssistantSchema);
