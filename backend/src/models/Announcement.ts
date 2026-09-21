import mongoose, { Schema, Document } from 'mongoose';

// Ichki e'lonlar taxtasi — direktordan/o'rinbosardan BARCHA xodimga bir
// yo'nalishli xabar (chat'dan farqli — javob/muhokama uchun EMAS, faqat
// e'lon qilish uchun). Avval umuman yo'q edi.
export interface IAnnouncement extends Document {
  companyId: string;
  title: string;
  body: string;
  postedBy: { userId: string; name: string; role: string };
  createdAt: Date;
}

const AnnouncementSchema: Schema = new Schema({
  companyId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  postedBy: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

AnnouncementSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.model<IAnnouncement>('Announcement', AnnouncementSchema);
