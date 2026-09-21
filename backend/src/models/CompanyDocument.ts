import mongoose, { Schema, Document } from 'mongoose';

// Hujjat/shartnoma boshqaruvi — avval umuman yo'q edi. Fayl o'zi
// /api/messages/upload (Cloudinary) orqali oldindan yuklanadi, bu yerga
// faqat natijaviy URL + metama'lumot saqlanadi (ProjectMedia bilan bir xil naqsh).
export interface ICompanyDocument extends Document {
  companyId: string;
  objectId?: string;
  category: 'contract' | 'permit' | 'invoice' | 'other';
  title: string;
  fileUrl: string;
  fileName?: string;
  uploadedBy: { userId: string; name: string; role: string };
  // Ichki elektron imzo — TASHQI xizmatga (DocuSign va h.k.) HECH NARSA
  // yubormaydi, faqat "kim, qachon, qaysi hisob bilan tasdiqlagani"ni
  // o'z bazamizda qayd etadi (qurilish firmasi ichki hujjat aylanishi
  // uchun yetarli, aniq talab: "boshqalar bilmasligi kerak").
  signatures?: Array<{ userId: string; name: string; role: string; signedAt: Date }>;
  createdAt: Date;
}

const CompanyDocumentSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  objectId: { type: String },
  category: { type: String, enum: ['contract', 'permit', 'invoice', 'other'], default: 'other' },
  title: { type: String, required: true },
  fileUrl: { type: String, required: true },
  fileName: { type: String },
  uploadedBy: { type: Schema.Types.Mixed, required: true },
  signatures: { type: [Schema.Types.Mixed], default: [] },
}, { timestamps: true });

CompanyDocumentSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.model<ICompanyDocument>('CompanyDocument', CompanyDocumentSchema);
