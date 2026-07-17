import mongoose, { Schema, Document } from 'mongoose';

// To'lov moduli SKELETONI — hozircha bo'sh turadi. Kelajak uchun tayyor.
export interface IPayment extends Document {
  companyId: string;
  subscriptionId?: string;
  amount: number;
  currency: 'UZS' | 'USD';
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  provider?: string;    // masalan: 'payme', 'click', 'stripe'
  externalId?: string;  // provayderdagi to'lov ID
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  subscriptionId: { type: String, index: true },
  amount: { type: Number, required: true },
  currency: { type: String, enum: ['UZS', 'USD'], default: 'UZS' },
  status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  provider: { type: String },
  externalId: { type: String }
}, { timestamps: true });

export default mongoose.model<IPayment>('Payment', PaymentSchema);
