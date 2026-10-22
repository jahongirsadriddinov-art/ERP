import mongoose, { Schema, Document } from 'mongoose';

// Xatolar jurnali (owner 2026-10-22: "saytdagi har bir xatoni aniqlab dasturchiga yubor — aynan qayerda va qanaqa xato").
// Bir xil xato (fingerprint — xabar + kod joyi + marshrut, raqam/ID'larsiz) BITTA yozuvga guruhlanadi:
// count — necha marta, userIds — nechta foydalanuvchida, occurrences — oxirgi 20 ta holat konteksti.
// Firmaga tegishli emas (platforma darajasidagi jurnal) — faqat dasturchi ko'radi (routes/clientErrors.ts).
// Matnlar saqlashdan oldin services/errorTracker.ts → redact() orqali tozalanadi (token/parol/telefon/email yo'q).
export type ErrorSource = 'server' | 'client' | 'bot' | 'worker';

export interface IErrorOccurrence {
  at: Date;
  where?: string;
  route?: string;
  method?: string;
  status?: number;
  page?: string;
  action?: string;
  userId?: string;
  companyId?: string;
  role?: string;
  appVersion?: string;
  platform?: string;
}

export interface IErrorEvent extends Document {
  fingerprint: string;
  source: ErrorSource;
  kind?: string;
  message: string;
  stack?: string;
  componentStack?: string;
  where?: string;
  topFrame?: string;
  route?: string;
  method?: string;
  status?: number;
  page?: string;
  action?: string;
  breadcrumbs?: string[];
  lastUserId?: string;
  lastCompanyId?: string;
  lastRole?: string;
  appVersion?: string;
  platform?: string;
  userAgent?: string;
  userIds: string[];
  companyIds: string[];
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  resolved: boolean;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  reopenedCount: number;
  occurrences: IErrorOccurrence[];
}

const OccurrenceSchema = new Schema<IErrorOccurrence>({
  at: { type: Date, required: true },
  where: String, route: String, method: String, status: Number, page: String, action: String,
  userId: String, companyId: String, role: String, appVersion: String, platform: String,
}, { _id: false });

const ErrorEventSchema = new Schema<IErrorEvent>({
  fingerprint: { type: String, required: true, unique: true },
  source: { type: String, enum: ['server', 'client', 'bot', 'worker'], required: true },
  kind: String,
  message: { type: String, required: true },
  stack: String,
  componentStack: String,
  where: String,
  topFrame: String,
  route: String,
  method: String,
  status: Number,
  page: String,
  action: String,
  breadcrumbs: { type: [String], default: undefined },
  lastUserId: String,
  lastCompanyId: String,
  lastRole: String,
  appVersion: String,
  platform: String,
  userAgent: String,
  userIds: { type: [String], default: [] },
  companyIds: { type: [String], default: [] },
  count: { type: Number, default: 0 },
  firstSeen: { type: Date, required: true },
  lastSeen: { type: Date, required: true },
  resolved: { type: Boolean, default: false },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String, default: null },
  reopenedCount: { type: Number, default: 0 },
  occurrences: { type: [OccurrenceSchema], default: [] },
});

ErrorEventSchema.index({ resolved: 1, lastSeen: -1 });
ErrorEventSchema.index({ source: 1, lastSeen: -1 });

export default mongoose.model<IErrorEvent>('ErrorEvent', ErrorEventSchema);
