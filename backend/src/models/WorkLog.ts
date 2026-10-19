import mongoose, { Schema, Document } from 'mongoose';

// Ishbay hisob (owner 2026-10-19: "ixtiyoriy qil — xohlasa qiladi"): bajarilgan ish hajmi × birlik narxi.
// Prorab/brigadir yoki rahbar kiritadi, rahbar (yoki o'sha obyekt prorabi) tasdiqlaydi; tasdiqlangan yozuvlar
// oylik hisob-kitobiga (PayrollRecord.pieceworkPay) qo'shiladi. Firma sozlamasida (features.piecework) yoqiladi.
export interface IWorkLog extends Document {
  companyId: string;
  objectId: string;
  userId: string;            // ishni bajargan xodim
  userName: string;
  workName: string;          // "G'isht terish", "Shtukaturka"
  unit: string;              // m2, m3, dona
  volume: number;
  rate: number;              // 1 birlik narxi (so'm)
  amount: number;            // volume × rate
  date: string;              // YYYY-MM-DD
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
  createdBy: { userId: string; name: string; role: string };
  decidedBy?: { userId: string; name: string; at: Date };
  createdAt: Date;
}

const WorkLogSchema = new Schema<IWorkLog>({
  companyId: { type: String, required: true, index: true },
  objectId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  userName: { type: String, required: true },
  workName: { type: String, required: true, maxlength: 200 },
  unit: { type: String, required: true, maxlength: 20 },
  volume: { type: Number, required: true, min: 0 },
  rate: { type: Number, required: true, min: 0 },
  amount: { type: Number, required: true, min: 0 },
  date: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  note: { type: String, maxlength: 300 },
  createdBy: { type: Schema.Types.Mixed, required: true },
  decidedBy: { type: Schema.Types.Mixed },
}, { timestamps: true });

WorkLogSchema.index({ companyId: 1, userId: 1, date: 1 });

export default mongoose.model<IWorkLog>('WorkLog', WorkLogSchema);
