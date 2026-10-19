import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscription extends Document {
  companyId: string;
  userId?: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  selectedPlan?: string;
  customFeatures?: string[]; // "O'zim tanlayman" (custom) tarifida tanlangan funksiyalar
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
  customFeatures: { type: [String], default: undefined },
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

// Obuna o'zgarganda (tasdiq/rad/uzaytirish/to'lov) middleware/subscriptionGate.ts keshi darhol eskiradi
let changeGen = 0;
export const subscriptionChangeGen = () => changeGen;
const bump = () => { changeGen++; };
SubscriptionSchema.post('save', bump);
SubscriptionSchema.post(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], bump);
SubscriptionSchema.post('insertMany', bump);

export default mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
