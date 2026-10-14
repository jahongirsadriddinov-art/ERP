import mongoose, { Schema, Document } from 'mongoose';

// Qo'ng'iroq voqealari (holat, transkript, tool chaqiruvlari). data DOIM redact()'dan o'tadi.
// Saqlash muddati sozlamadan (privacy.transcriptRetentionDays) → expiresAt TTL.
export interface IAiCallEvent extends Document {
  companyId: string;
  sessionId: string;
  correlationId: string;
  seq: number;
  type: 'state' | 'transcript_in' | 'transcript_out' | 'tool_call' | 'tool_result' | 'error' | 'usage' | 'goaway';
  at: Date;
  data?: any;
  expiresAt: Date;
}

const AiCallEventSchema = new Schema<IAiCallEvent>({
  companyId: { type: String, required: true },
  sessionId: { type: String, required: true },
  correlationId: { type: String, required: true },
  seq: { type: Number, required: true },
  type: { type: String, enum: ['state', 'transcript_in', 'transcript_out', 'tool_call', 'tool_result', 'error', 'usage', 'goaway'], required: true },
  at: { type: Date, default: () => new Date() },
  data: { type: Schema.Types.Mixed },
  expiresAt: { type: Date, required: true },
}, { timestamps: false });

AiCallEventSchema.index({ sessionId: 1, seq: 1 }, { unique: true });
AiCallEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IAiCallEvent>('AiCallEvent', AiCallEventSchema);
