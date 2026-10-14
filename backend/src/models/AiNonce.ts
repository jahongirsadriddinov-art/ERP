import mongoose, { Schema, Document } from 'mongoose';

// Server tomonidan berilgan bir martalik challenge (worker Ed25519 autentifikatsiyasi, A5).
// usedAt o'rnatilgach qayta ishlatib bo'lmaydi; TTL eskilarini o'chiradi.
export interface IAiNonce extends Document {
  nonce: string;
  purpose: string;
  subject?: string;      // masalan workerId
  usedAt?: Date | null;
  expiresAt: Date;
}

const AiNonceSchema = new Schema<IAiNonce>({
  nonce: { type: String, required: true },
  purpose: { type: String, required: true },
  subject: String,
  usedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

AiNonceSchema.index({ nonce: 1 }, { unique: true });
// usedAt'dan keyin ham replay aniqlanishi uchun hujjat expiresAt+10 daqiqagacha saqlanadi
AiNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 600 });

export default mongoose.model<IAiNonce>('AiNonce', AiNonceSchema);
