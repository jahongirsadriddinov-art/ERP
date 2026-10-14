import mongoose, { Schema, Document } from 'mongoose';

// Ertalabki "ishga kelasizmi?" tasdig'i. Uchta alohida fakt (design D10): voiceAnswer
// (ovozli javob), buttonAnswer (tugma), checkInAt (FAQAT reconciler Attendance'dan to'ldiradi).
// AI hech qachon Attendance yozmaydi.
export type AiAttendanceStatus =
  | 'pending' | 'confirmed' | 'late' | 'declined' | 'no_answer' | 'call_failed' | 'checked_in' | 'absent';

export interface IAiAttendanceAttempt {
  channel: string;
  attemptNo: number;
  stepIndex?: number;
  at: Date;
  outcome: string;
  sessionId?: string;
  messageId?: string;
  errorCode?: string;
}

export interface IAiAttendanceConfirmation extends Document {
  companyId: string;
  employeeId: string;
  date: string;                   // YYYY-MM-DD (Asia/Tashkent)
  shiftId: string;
  objectIds: string[];
  scheduledAt: Date;
  planMode: 'full' | 'bot_only';  // maxLateMin'dan kech rejalashtirilsa — faqat bot xabari (C2)
  status: AiAttendanceStatus;
  voiceAnswer: 'none' | 'coming' | 'late' | 'not_coming' | 'unclear';
  voiceEtaMin?: number;
  buttonAnswer: 'none' | 'confirm' | 'late' | 'decline';
  buttonAt?: Date;
  buttonToken?: string;
  checkInAt?: Date;
  attendanceId?: string;
  attempts: IAiAttendanceAttempt[];
  stepIndex: number;
  busyRequeues: number;           // "band" tufayli qayta navbat — 5 tagacha (C4)
  nextActionAt?: Date;
  managerNotifiedAt?: Date;
  correlationId: string;
  finalizedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AttemptSchema = new Schema<IAiAttendanceAttempt>({
  channel: { type: String, required: true },
  attemptNo: { type: Number, default: 1 },
  stepIndex: Number,
  at: { type: Date, default: () => new Date() },
  outcome: { type: String, required: true },
  sessionId: String,
  messageId: String,
  errorCode: String,
}, { _id: false });

const AiAttendanceConfirmationSchema = new Schema<IAiAttendanceConfirmation>({
  companyId: { type: String, required: true },
  employeeId: { type: String, required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  shiftId: { type: String, required: true },
  objectIds: { type: [String], default: [] },
  scheduledAt: { type: Date, required: true },
  planMode: { type: String, enum: ['full', 'bot_only'], default: 'full' },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'late', 'declined', 'no_answer', 'call_failed', 'checked_in', 'absent'],
    default: 'pending',
  },
  voiceAnswer: { type: String, enum: ['none', 'coming', 'late', 'not_coming', 'unclear'], default: 'none' },
  voiceEtaMin: Number,
  buttonAnswer: { type: String, enum: ['none', 'confirm', 'late', 'decline'], default: 'none' },
  buttonAt: Date,
  buttonToken: String,
  checkInAt: Date,
  attendanceId: String,
  attempts: { type: [AttemptSchema], default: [] },
  stepIndex: { type: Number, default: 0 },
  busyRequeues: { type: Number, default: 0 },
  nextActionAt: Date,
  managerNotifiedAt: Date,
  correlationId: { type: String, required: true },
  finalizedAt: Date,
}, { timestamps: true });

AiAttendanceConfirmationSchema.index({ companyId: 1, employeeId: 1, date: 1, shiftId: 1 }, { unique: true });
AiAttendanceConfirmationSchema.index({ companyId: 1, date: 1, status: 1 });
AiAttendanceConfirmationSchema.index({ status: 1, nextActionAt: 1 });
AiAttendanceConfirmationSchema.index({ employeeId: 1, date: 1 });
AiAttendanceConfirmationSchema.index({ buttonToken: 1 }, { unique: true, partialFilterExpression: { buttonToken: { $type: 'string' } } });

export default mongoose.model<IAiAttendanceConfirmation>('AiAttendanceConfirmation', AiAttendanceConfirmationSchema);
