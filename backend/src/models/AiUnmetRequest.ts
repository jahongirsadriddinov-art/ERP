import mongoose, { Schema, Document } from 'mongoose';

// "AI qila olmadi" (owner 2026-10-22): AI navbati rad / noma'lum tool / tool xatosi / "qila olmayman" javobi bilan
// tugasa — shu yerda saqlanadi va dasturchiga (bot) xabar beriladi. Dasturchi /api/ai-voice/platform/unmet orqali
// ko'radi. Matnlar qisqartirilgan va redaksiya qilingan (telefon va h.k.). 90 kundan keyin o'chadi.
export type AiUnmetReason =
  | 'refusal' | 'unknown_tool' | 'bad_args' | 'tool_error' | 'tool_denied' | 'rounds' | 'provider_failed' | 'cant_reply';

export const AI_UNMET_REASONS: AiUnmetReason[] = [
  'refusal', 'unknown_tool', 'bad_args', 'tool_error', 'tool_denied', 'rounds', 'provider_failed', 'cant_reply',
];

export interface IAiUnmetRequest extends Document {
  companyId: string;               // firma yoki 'platform' (dasturchining o'zi)
  userId: string;
  channel: string;
  userText: string;
  aiReply: string;
  reason: AiUnmetReason;
  toolName?: string;
  toolMessage?: string;
  provider?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiUnmetRequestSchema = new Schema<IAiUnmetRequest>({
  companyId: { type: String, required: true },
  userId: { type: String, required: true },
  channel: { type: String, required: true },
  userText: { type: String, maxlength: 1000, default: '' },
  aiReply: { type: String, maxlength: 1000, default: '' },
  reason: { type: String, enum: AI_UNMET_REASONS, required: true },
  toolName: { type: String, maxlength: 64 },
  toolMessage: { type: String, maxlength: 300 },
  provider: { type: String, maxlength: 32 },
}, { timestamps: true });

AiUnmetRequestSchema.index({ companyId: 1, createdAt: -1 });
AiUnmetRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86_400, name: 'ttl_90d' });

export default mongoose.model<IAiUnmetRequest>('AiUnmetRequest', AiUnmetRequestSchema);
