import mongoose, { Schema, Document } from 'mongoose';

// Kunlik hisobot (owner 2026-10-19: "ovozli hisobot"): prorab/ishchi botga ovoz yoki matn yuboradi ("bugun 20 qop
// sement ishlatildi, devor 2-qavatgacha chiqdi, kran buzildi") — AI tartibli yozuvga aylantiradi, foydalanuvchi
// tasdiqlaydi. Obyekt sahifasida (plan-fakt) va ertalabki brifingda ko'rinadi; jiddiy muammo — rahbarga xabar.
export interface IDailyReport extends Document {
  companyId: string;
  objectId?: string;
  objectName?: string;
  userId: string;
  userName: string;
  date: string;                       // YYYY-MM-DD
  summary: string;
  workDone: string[];
  materialsUsed: Array<{ name: string; qty: number; unit: string }>;
  workersCount?: number;
  issues: Array<{ text: string; severity: 'low' | 'medium' | 'high' }>;
  source: 'bot' | 'app';
  transcript?: string;
  createdAt: Date;
}

const DailyReportSchema = new Schema<IDailyReport>({
  companyId: { type: String, required: true, index: true },
  objectId: { type: String, index: true },
  objectName: { type: String },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  date: { type: String, required: true },
  summary: { type: String, required: true, maxlength: 1000 },
  workDone: { type: [String], default: [] },
  materialsUsed: { type: [new Schema({ name: String, qty: Number, unit: String }, { _id: false })], default: [] },
  workersCount: { type: Number },
  issues: { type: [new Schema({ text: String, severity: { type: String, enum: ['low', 'medium', 'high'] } }, { _id: false })], default: [] },
  source: { type: String, enum: ['bot', 'app'], default: 'bot' },
  transcript: { type: String, maxlength: 4000 },
}, { timestamps: true });

DailyReportSchema.index({ companyId: 1, date: -1 });

export default mongoose.model<IDailyReport>('DailyReport', DailyReportSchema);
