import mongoose, { Schema, Document } from 'mongoose';

// Ish haqi hisob-kitobi — avval umuman yo'q edi. Bitta xodim × bitta oy
// uchun bitta yozuv; Attendance'dan hisoblangan ish kunlari/soatlari
// asosida (User.baseSalary — kunlik/oylik stavka) hisoblanadi, so'ng admin
// bonus/ushlab qolish qo'shib "finalized" qilishi mumkin.
export interface IPayrollRecord extends Document {
  companyId: string;
  userId: string;
  userName: string;
  period: string; // "YYYY-MM"
  baseSalary: number;
  presentDays: number;
  totalWorkHours: number;
  bonuses: number;
  deductions: number;
  netPay: number;
  status: 'draft' | 'finalized' | 'paid';
  calculatedBy: { userId: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}

const PayrollRecordSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  period: { type: String, required: true },
  baseSalary: { type: Number, default: 0 },
  presentDays: { type: Number, default: 0 },
  totalWorkHours: { type: Number, default: 0 },
  bonuses: { type: Number, default: 0 },
  deductions: { type: Number, default: 0 },
  netPay: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'finalized', 'paid'], default: 'draft' },
  calculatedBy: { type: Schema.Types.Mixed },
}, { timestamps: true });

PayrollRecordSchema.index({ companyId: 1, period: 1, userId: 1 }, { unique: true });

export default mongoose.model<IPayrollRecord>('PayrollRecord', PayrollRecordSchema);
