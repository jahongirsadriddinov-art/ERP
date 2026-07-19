import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscription extends Document {
  companyId: string;
  userId?: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  selectedPlan?: string;
  amount?: number;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'pending' | 'expired' | 'rejected';
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  requestedAt?: Date;
  approvedAt?: Date;
  approvedBy?: string;
  rejectedAt?: Date;
  rejectedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  userId: { type: String, index: true },
  plan: { type: String, enum: ['FREE', 'PRO', 'ENTERPRISE'], default: 'FREE' },
  selectedPlan: { type: String },
  amount: { type: Number },
  status: {
    type: String,
    enum: ['active', 'trialing', 'past_due', 'canceled', 'pending', 'expired', 'rejected'],
    default: 'active'
  },
  currentPeriodStart: { type: Date },
  currentPeriodEnd: { type: Date },
  requestedAt: { type: Date },
  approvedAt: { type: Date },
  approvedBy: { type: String },
  rejectedAt: { type: Date },
  rejectedBy: { type: String },
}, { timestamps: true });

export default mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
