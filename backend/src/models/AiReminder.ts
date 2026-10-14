import mongoose, { Schema, Document } from 'mongoose';

// Shaxsiy eslatma (bir martalik yoki takroriy). nextFireAt UTC'da saqlanadi.
// 6 soatdan ortiq kechikkan bir martalik eslatma 'missed' bo'ladi; takroriylari
// keyingi kelajakdagi vaqtga o'tadi (review C2).
export interface IAiReminder extends Document {
  companyId: string;
  ownerId: string;
  targetUserId: string;
  text: string;
  timezone: 'Asia/Tashkent';
  dueAt: Date;
  recurrence: {
    freq: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
    interval: number;
    byWeekday: number[];          // ISO: 1=Dushanba … 7=Yakshanba
    until?: Date;
    count?: number;
  };
  nextFireAt?: Date | null;
  status: 'active' | 'done' | 'cancelled' | 'failed' | 'missed';
  channels: string[];
  lastFiredAt?: Date;
  fireCount: number;
  createdVia: 'ui' | 'voice' | 'bot' | 'telegram_call';
  idempotencyKey?: string;
  sourceSessionId?: string;
  correlationId: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiReminderSchema = new Schema<IAiReminder>({
  companyId: { type: String, required: true },
  ownerId: { type: String, required: true },
  targetUserId: { type: String, required: true },
  text: { type: String, required: true, maxlength: 500 },
  timezone: { type: String, enum: ['Asia/Tashkent'], default: 'Asia/Tashkent' },
  dueAt: { type: Date, required: true },
  recurrence: {
    freq: { type: String, enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly'], default: 'none' },
    interval: { type: Number, default: 1, min: 1, max: 365 },
    byWeekday: { type: [Number], default: [] },
    until: Date,
    count: { type: Number, min: 1 },
  },
  nextFireAt: { type: Date, default: null },
  status: { type: String, enum: ['active', 'done', 'cancelled', 'failed', 'missed'], default: 'active' },
  channels: { type: [String], default: [] },
  lastFiredAt: Date,
  fireCount: { type: Number, default: 0 },
  createdVia: { type: String, enum: ['ui', 'voice', 'bot', 'telegram_call'], default: 'ui' },
  idempotencyKey: String,
  sourceSessionId: String,
  correlationId: { type: String, required: true },
}, { timestamps: true });

AiReminderSchema.index({ status: 1, nextFireAt: 1 });
AiReminderSchema.index({ companyId: 1, targetUserId: 1, status: 1 });
AiReminderSchema.index({ companyId: 1, ownerId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

export default mongoose.model<IAiReminder>('AiReminder', AiReminderSchema);
