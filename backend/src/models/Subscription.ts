import mongoose, { Schema, Document } from 'mongoose';

// To'lov moduli SKELETONI — hozircha bo'sh turadi (BILLING_ENABLED=false).
// Arxitektura kelajakda to'lov qo'shilsa ishlashga tayyor bo'lishi uchun oldindan yaratildi.
export interface ISubscription extends Document {
  companyId: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  plan: { type: String, enum: ['FREE', 'PRO', 'ENTERPRISE'], default: 'FREE' },
  status: { type: String, enum: ['active', 'trialing', 'past_due', 'canceled'], default: 'active' },
  currentPeriodStart: { type: Date },
  currentPeriodEnd: { type: Date }
}, { timestamps: true });

export default mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
