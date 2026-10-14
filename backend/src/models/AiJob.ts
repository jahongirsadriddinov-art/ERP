import mongoose, { Schema, Document } from 'mongoose';

// Mongo'da saqlanadigan ish navbati (Redis'siz). dedupeKey — idempotent tick'lar uchun
// (unique partial, null tuzog'isiz — B10). requires:'worker' — faqat Telegram worker socket'i
// ulangan instansiya oladi (C3). Har bir yakuniy holatda expiresAt qo'yiladi (C5), aks holda
// 'dead'/'failed' ishning dedupeKey'i abadiy band bo'lib qolardi.
export type AiJobStatus = 'queued' | 'leased' | 'done' | 'failed' | 'dead' | 'cancelled';
export const AI_JOB_TERMINAL: AiJobStatus[] = ['done', 'failed', 'dead', 'cancelled'];

export interface IAiJob extends Document {
  type: string;
  companyId?: string;
  employeeId?: string;
  refId?: string;
  payload?: any;
  runAt: Date;
  priority: number;
  status: AiJobStatus;
  attempts: number;
  maxAttempts: number;
  leaseOwner?: string | null;
  leaseUntil?: Date | null;
  lastError?: string;
  dedupeKey?: string;
  correlationId?: string;
  requires?: 'worker';
  startedAt?: Date;
  finishedAt?: Date;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AiJobSchema = new Schema<IAiJob>({
  type: { type: String, required: true },
  companyId: String,
  employeeId: String,
  refId: String,
  payload: Schema.Types.Mixed,
  runAt: { type: Date, required: true, default: () => new Date() },
  priority: { type: Number, default: 0 },
  status: { type: String, enum: ['queued', 'leased', 'done', 'failed', 'dead', 'cancelled'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  leaseOwner: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
  lastError: { type: String, maxlength: 1000 },
  dedupeKey: String,
  correlationId: String,
  requires: { type: String, enum: ['worker'] },
  startedAt: Date,
  finishedAt: Date,
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

AiJobSchema.index({ status: 1, runAt: 1, priority: -1 });
AiJobSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
AiJobSchema.index({ leaseUntil: 1 }, { partialFilterExpression: { status: 'leased' } });
AiJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IAiJob>('AiJob', AiJobSchema);
