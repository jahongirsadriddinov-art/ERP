import mongoose, { Schema, Document } from 'mongoose';

export type TxType = 'transfer' | 'expense' | 'income' | 'oylik' | 'material' | 'jihozlar' | 'transport' | 'boshqa';

export type Currency = 'UZS' | 'USD' | 'EUR';

export interface ITransaction extends Document {
  type: TxType;

  // Transfer fields
  materialName?: string;
  quantity?: number;
  unit?: string;
  price?: number; // yuboruvchi kiritgan birlik narxi (so'm) — Material.price'dan ustuvor
  projectId?: string;
  fromUserId?: string;
  fromUserName?: string;

  // Shared fields
  toUserId?: string;
  toUserName?: string;
  status: 'pending' | 'confirmed' | 'rejected';
  date: string;

  // Expense/Income fields
  amount?: number;
  description?: string;
  createdById?: string;
  confirmedById?: string;

  // Currency system — snapshot at transaction time
  currency?: Currency;
  originalAmount?: number;    // amount in original currency
  uzsAmount?: number;         // converted to UZS at time of creation
  usdRate?: number;           // USD/UZS rate at transaction time
  eurRate?: number;           // EUR/UZS rate at transaction time
  rateDate?: string;          // date of exchange rate used

  // Additional fields
  confirmedDate?: string;
  defect?: string;
  note?: string;
  sourceTransferId?: string; // tasdiqlangan material yukxatidan avtomatik yaratilgan chiqim uchun

  // Expense approval chain
  approvalHistory?: Array<{ userId: string; name: string; role: string; action: 'approved' | 'rejected'; date: string; note?: string }>;
  requiresAdminApproval?: boolean; // chiqim admin tasdiqlashini talab qiladi

  companyId?: string; // v1.2 multi-tenant (nullable)
}

const TransactionSchema: Schema = new Schema({
  type: { type: String, enum: ['transfer', 'expense', 'income', 'oylik', 'material', 'jihozlar', 'transport', 'boshqa'], required: true },
  
  materialName: { type: String },
  quantity: { type: Number },
  unit: { type: String },
  price: { type: Number },
  projectId: { type: String },
  fromUserId: { type: String },
  fromUserName: { type: String },
  
  toUserId: { type: String },
  toUserName: { type: String },
  status: { type: String, enum: ['pending', 'confirmed', 'rejected'], default: 'pending' },
  date: { type: String },
  
  amount: { type: Number },
  description: { type: String },
  createdById: { type: String },
  confirmedById: { type: String },
  
  // Currency snapshot
  currency: { type: String, enum: ['UZS', 'USD', 'EUR'], default: 'UZS' },
  originalAmount: { type: Number },
  uzsAmount: { type: Number },
  usdRate: { type: Number },
  eurRate: { type: Number },
  rateDate: { type: String },

  confirmedDate: { type: String },
  defect: { type: String },
  note: { type: String },
  sourceTransferId: { type: String },
  approvalHistory: [{ userId: String, name: String, role: String, action: String, date: String, note: String }],
  requiresAdminApproval: { type: Boolean, default: false },
  companyId: { type: String, index: true } // v1.2 multi-tenant
}, { timestamps: true });

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);
