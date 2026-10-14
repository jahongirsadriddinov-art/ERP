import mongoose, { Schema, Document } from 'mongoose';

// Har bir AI tool chaqiruvining izi (o'qish ham, yozish ham). Yozuvlar mavjud logAudit()'ga ham
// ko'chiriladi. Tasdiq kutayotgan amal: pending.token = tokenning SHA-256 xeshi (o'zi emas),
// pending.args shifrlangan (lib/crypto). Tasdiq faqat atomik findOneAndUpdate orqali (review B3).
export type AiAuditStatus =
  | 'ok' | 'denied' | 'not_found' | 'error' | 'needs_confirmation' | 'confirmed' | 'cancelled' | 'expired';

export interface IAiActionAudit extends Document {
  companyId: string;
  actorUserId: string;
  actorRole: string;
  targetUserId?: string;
  channel: string;
  purpose?: string;
  sessionId?: string;
  correlationId: string;
  tool: string;
  kind: 'read' | 'write';
  argsRedacted?: any;
  status: AiAuditStatus;
  resultSummary?: string;
  errorCode?: string;
  idempotencyKey?: string;
  pending?: {
    token?: string;
    expiresAt?: Date;
    args?: any;                    // EncryptedBlob — select:false
    channel?: string;              // tasdiq qaysi kanaldan kelishi kerak (bog'langan)
    confirmVia?: 'ui' | 'bot';
    summary?: string;
  };
  confirmedAt?: Date;
  latencyMs?: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiActionAuditSchema = new Schema<IAiActionAudit>({
  companyId: { type: String, required: true },
  actorUserId: { type: String, required: true },
  actorRole: { type: String, required: true },
  targetUserId: String,
  channel: { type: String, required: true },
  purpose: String,
  sessionId: String,
  correlationId: { type: String, required: true },
  tool: { type: String, required: true },
  kind: { type: String, enum: ['read', 'write'], required: true },
  argsRedacted: Schema.Types.Mixed,
  status: {
    type: String,
    enum: ['ok', 'denied', 'not_found', 'error', 'needs_confirmation', 'confirmed', 'cancelled', 'expired'],
    required: true,
  },
  resultSummary: { type: String, maxlength: 500 },
  errorCode: { type: String, maxlength: 120 },
  idempotencyKey: String,
  pending: {
    token: String,
    expiresAt: Date,
    args: { type: Schema.Types.Mixed, select: false },
    channel: String,
    confirmVia: { type: String, enum: ['ui', 'bot'] },
    summary: { type: String, maxlength: 300 },
  },
  confirmedAt: Date,
  latencyMs: Number,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

AiActionAuditSchema.index({ companyId: 1, createdAt: -1 });
AiActionAuditSchema.index({ correlationId: 1 });
AiActionAuditSchema.index({ companyId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
AiActionAuditSchema.index({ 'pending.token': 1 }, { unique: true, partialFilterExpression: { 'pending.token': { $type: 'string' } } });
AiActionAuditSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IAiActionAudit>('AiActionAudit', AiActionAuditSchema);
