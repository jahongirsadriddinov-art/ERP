import mongoose, { Schema, Document } from 'mongoose';

// Obyektga (loyihaga) bog'langan ish jarayoni rasm/video — "hozir qara
// obyektda rasmlari... bo'layotgan ish jarayoni rasmlari videolar" aniq
// talabi bo'yicha. Aniq talab: FAQAT direktor/o'rinbosar EMAS — barcha
// xodim (ishchi, brigadir, prorab ham) qo'sha olishi kerak, chunki
// ob'ektda bevosita ishlayotgan aynan ular.
export interface IProjectMedia extends Document {
  companyId: string;
  objectId: string;
  type: 'image' | 'video';
  url: string;
  caption?: string;
  uploadedBy: { userId: string; name: string; role: string };
  createdAt: Date;
}

const ProjectMediaSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  objectId: { type: String, required: true, index: true },
  type: { type: String, enum: ['image', 'video'], required: true },
  url: { type: String, required: true },
  caption: { type: String },
  uploadedBy: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

export default mongoose.model<IProjectMedia>('ProjectMedia', ProjectMediaSchema);
