import mongoose, { Schema, Document } from 'mongoose';

// Bitta AI qo'ng'iroq (in-app yoki Telegram). Bir xodimga parallel qo'ng'iroq bo'lmasligi
// DB darajasida kafolatlanadi: {employeeId} unique partial (isActive:true) — E11000 = "band".
// attemptKey = `${confirmationId}:${stepIndex}:${attemptNo}` (review C1) — bitta urinish
// ikki marta terilmaydi. updatedAt har 15 s yangilanadi; yangilanmasa sessionSweep uni
// 'interrupted' qiladi (C4).
export type AiCallStatus =
  | 'queued' | 'dialing' | 'ringing' | 'connected' | 'completed' | 'no_answer' | 'busy'
  | 'declined' | 'failed' | 'cancelled' | 'interrupted';

export const AI_CALL_TERMINAL: AiCallStatus[] = ['completed', 'no_answer', 'busy', 'declined', 'failed', 'cancelled', 'interrupted'];

export interface IAiCallSession extends Document {
  companyId: string;
  employeeId: string;
  correlationId: string;          // UUID (audio kadr sarlavhasidagi 16 bayt)
  attemptKey?: string;
  purpose: 'attendance' | 'assistant' | 'reminder' | 'test';
  channel: 'telegram_call' | 'inapp_call';
  direction: 'outbound' | 'inbound';
  status: AiCallStatus;
  isActive: boolean;
  attemptNo: number;
  jobId?: string;
  confirmationId?: string;
  provider?: string;
  modelId?: string;               // 'model' nomi Document.model bilan to'qnashadi
  resumptionHandle?: string;
  instanceId?: string;            // sessiyani boshqarayotgan backend instansiyasi
  workerInstanceId?: string;      // telegram_call: worker ulangan instansiya
  socketId?: string;              // in-app: audio faqat shu socket'dan qabul qilinadi
  limits: { ringTimeoutSec: number; maxDurationSec: number };
  startedAt?: Date;
  ringingAt?: Date;
  answeredAt?: Date;
  endedAt?: Date;
  durationSec?: number;
  endReason?: string;
  errorCode?: string;
  usage: { audioInSec: number; audioOutSec: number; tokensIn: number; tokensOut: number; costUsdMicros: number };
  summary?: string;
  recording: { enabled: boolean };
  createdAt: Date;
  updatedAt: Date;
}

const AiCallSessionSchema = new Schema<IAiCallSession>({
  companyId: { type: String, required: true },
  employeeId: { type: String, required: true },
  correlationId: { type: String, required: true },
  attemptKey: { type: String },
  purpose: { type: String, enum: ['attendance', 'assistant', 'reminder', 'test'], required: true },
  channel: { type: String, enum: ['telegram_call', 'inapp_call'], required: true },
  direction: { type: String, enum: ['outbound', 'inbound'], default: 'outbound' },
  status: {
    type: String,
    enum: ['queued', 'dialing', 'ringing', 'connected', 'completed', 'no_answer', 'busy', 'declined', 'failed', 'cancelled', 'interrupted'],
    default: 'queued',
  },
  isActive: { type: Boolean, default: true },
  attemptNo: { type: Number, default: 1 },
  jobId: String,
  confirmationId: String,
  provider: String,
  modelId: String,
  resumptionHandle: { type: String, select: false },
  instanceId: String,
  workerInstanceId: String,
  socketId: String,
  limits: {
    ringTimeoutSec: { type: Number, default: 45 },
    maxDurationSec: { type: Number, default: 120 },
  },
  startedAt: Date,
  ringingAt: Date,
  answeredAt: Date,
  endedAt: Date,
  durationSec: Number,
  endReason: { type: String, maxlength: 120 },
  errorCode: { type: String, maxlength: 120 },
  usage: {
    audioInSec: { type: Number, default: 0 },
    audioOutSec: { type: Number, default: 0 },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    costUsdMicros: { type: Number, default: 0 },
  },
  summary: { type: String, maxlength: 2000 },
  recording: { enabled: { type: Boolean, default: false } },
}, { timestamps: true });

AiCallSessionSchema.index({ employeeId: 1 }, { unique: true, partialFilterExpression: { isActive: true }, name: 'one_active_call_per_employee' });
AiCallSessionSchema.index({ correlationId: 1 }, { unique: true });
AiCallSessionSchema.index({ attemptKey: 1 }, { unique: true, partialFilterExpression: { attemptKey: { $type: 'string' } } });
AiCallSessionSchema.index({ companyId: 1, createdAt: -1 });
AiCallSessionSchema.index({ confirmationId: 1 });
AiCallSessionSchema.index({ status: 1, updatedAt: 1 });
AiCallSessionSchema.index({ isActive: 1, updatedAt: 1 }, { partialFilterExpression: { isActive: true } });

export default mongoose.model<IAiCallSession>('AiCallSession', AiCallSessionSchema);
