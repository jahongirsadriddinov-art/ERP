import mongoose, { Schema, Document } from 'mongoose';

export type TxType = 'transfer' | 'expense' | 'income' | 'oylik' | 'material' | 'jihozlar' | 'transport' | 'boshqa';

export interface ITransaction extends Document {
  type: TxType;
  
  // Transfer fields
  materialName?: string;
  quantity?: number;
  unit?: string;
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
  
  // Additional fields
  confirmedDate?: string;
  defect?: string;
  note?: string;
  sourceTransferId?: string; // tasdiqlangan material yukxatidan avtomatik yaratilgan chiqim uchun

  companyId?: string; // v1.2 multi-tenant (nullable)
}

const TransactionSchema: Schema = new Schema({
  type: { type: String, enum: ['transfer', 'expense', 'income', 'oylik', 'material', 'jihozlar', 'transport', 'boshqa'], required: true },
  
  materialName: { type: String },
  quantity: { type: Number },
  unit: { type: String },
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
  
  confirmedDate: { type: String },
  defect: { type: String },
  note: { type: String },
  sourceTransferId: { type: String },
  companyId: { type: String, index: true } // v1.2 multi-tenant
}, { timestamps: true });

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);
