import mongoose, { Schema, Document } from 'mongoose';

// Firma O'CHIRILISHIDAN OLDIN avtomatik olinadigan to'liq zaxira nusxa —
// routes/companies.ts DELETE /:id shu yerga yozib QO'YGANDAN KEYIN cascade
// o'chiradi, shu bilan "firma o'chirilsa qaytarib bo'lmaydi" muammosi hal
// bo'ladi (routes/companies.ts POST /backups/:id/restore orqali tiklanadi).
//
// MUHIM: bu — routes/backup.ts'dagi direktorga YUKLAB OLINADIGAN eksportdan
// FARQLI: o'sha yerda passwordHash ATAYLAB olib tashlanadi (tashqariga
// chiqadigan fayl bo'lgani uchun), bu yerda esa YO'Q — bu FAQAT bazaning
// o'zida turadigan, hech kimga yuklab berilmaydigan ICHKI xavfsizlik
// to'ri, va parolsiz tiklash foydalanuvchilarni butunlay parolsiz
// qoldirar edi (har biri qayta OTP orqali parol tiklashga majbur bo'lardi
// — buni istamaymiz).
export interface ICompanyBackup extends Document {
  companyId: string;
  companyName: string;
  branchId?: string;
  reason: 'company_deleted' | 'pre_import_restore';
  deletedBy: { userId: string; name: string; role: string };
  snapshot: {
    company: any;
    users: any[];
    objects: any[];
    materials: any[];
    transactions: any[];
    messages: any[];
    groups: any[];
    subscriptions: any[];
  };
  restoredAt?: Date;
  createdAt: Date;
}

const CompanyBackupSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  companyName: { type: String, required: true },
  branchId: { type: String },
  reason: { type: String, enum: ['company_deleted', 'pre_import_restore'], default: 'company_deleted' },
  deletedBy: { type: Schema.Types.Mixed, required: true },
  snapshot: { type: Schema.Types.Mixed, required: true },
  restoredAt: { type: Date },
}, { timestamps: true });

// 90 kundan keyin avtomatik o'chadi — abadiy saqlanmaydi (ayniqsa
// passwordHash'lar shu yerda yotgani uchun cheksiz saqlash yomon amaliyot).
CompanyBackupSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model<ICompanyBackup>('CompanyBackup', CompanyBackupSchema);
