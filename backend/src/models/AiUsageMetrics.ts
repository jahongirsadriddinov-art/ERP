import mongoose, { Schema, Document } from 'mongoose';

// Kunlik AI sarfi ($inc upsert). userId=null — firma bo'yicha jami qator.
// provider: ovoz (gemini_live/gemini_cascade), matn miyasi (gemini/openrouter/claude — llm-provider.md),
// shuningdek tool chaqiruvlari, Telegram va bot hisoblagichlari uchun ichki qiymatlar.
export const AI_USAGE_PROVIDERS = [
  'gemini_live', 'gemini_cascade', 'gemini', 'groq', 'openrouter', 'claude', 'tools', 'telegram', 'bot', 'none',
] as const;
export type AiUsageProvider = typeof AI_USAGE_PROVIDERS[number];

export interface IAiUsageMetrics extends Document {
  companyId: string;
  day: string;                  // YYYY-MM-DD (Asia/Tashkent)
  userId: string | null;
  provider: AiUsageProvider;
  modelId: string;              // 'model' nomi Document.model bilan to'qnashadi
  sessions: number;
  audioInSec: number;
  audioOutSec: number;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  telegramCalls: number;
  botMessages: number;
  bytesRelayed: number;
  costUsdMicros: number;
}

const AiUsageMetricsSchema = new Schema<IAiUsageMetrics>({
  companyId: { type: String, required: true },
  day: { type: String, required: true },
  userId: { type: String, default: null },
  provider: { type: String, enum: AI_USAGE_PROVIDERS as unknown as string[], required: true },
  modelId: { type: String, required: true },
  sessions: { type: Number, default: 0 },
  audioInSec: { type: Number, default: 0 },
  audioOutSec: { type: Number, default: 0 },
  tokensIn: { type: Number, default: 0 },
  tokensOut: { type: Number, default: 0 },
  toolCalls: { type: Number, default: 0 },
  telegramCalls: { type: Number, default: 0 },
  botMessages: { type: Number, default: 0 },
  bytesRelayed: { type: Number, default: 0 },
  costUsdMicros: { type: Number, default: 0 },
}, { timestamps: true });

AiUsageMetricsSchema.index({ companyId: 1, day: 1, userId: 1, provider: 1, modelId: 1 }, { unique: true });

export default mongoose.model<IAiUsageMetrics>('AiUsageMetrics', AiUsageMetricsSchema);
