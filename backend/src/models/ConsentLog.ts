import mongoose, { Schema, Document } from 'mongoose';

// Huquqiy iz (audit): kim, qachon, qaysi rozilikni, qaysi versiyani, qaysi IP dan berdi.
export interface IConsentLog extends Document {
  userId?: string;
  registrationId?: string;
  companyId?: string;
  consentType: string;   // masalan: 'terms', 'privacy', 'telegram_notify', 'owner_confirm'
  version: string;       // masalan: 'terms_v1'
  acceptedAt: Date;
  telegramUserId?: string;
  ip?: string;
  userAgent?: string;
}

const ConsentLogSchema: Schema = new Schema({
  userId: { type: String, index: true },
  registrationId: { type: String, index: true },
  companyId: { type: String, index: true },
  consentType: { type: String, required: true },
  version: { type: String, required: true },
  acceptedAt: { type: Date, required: true, default: () => new Date() },
  telegramUserId: { type: String },
  ip: { type: String },
  userAgent: { type: String }
}, { timestamps: true });

export default mongoose.model<IConsentLog>('ConsentLog', ConsentLogSchema);
