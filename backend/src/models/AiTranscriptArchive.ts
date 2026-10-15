import mongoose, { Schema, Document } from 'mongoose';

// AI suhbatlari/qo'ng'iroq transkriptlari arxivi (owner 2026-10-15, #3): 7 kundan eski yozuvlar firma va kun
// bo'yicha gzip JSONL faylga yoziladi (mavjud doimiy fayl ombori — StoredFile, ommaviy /uploads'dan BERILMAYDI),
// shu yozuv yaratiladi va FAQAT shundan keyin bazadagi qatorlar o'chiriladi.
// status: 'stored' — fayl saqlangan, qatorlar hali o'chirilmagan (ids shu yerda — qayta ishga tushsa davom etadi);
//         'done'   — qatorlar o'chirilgan.
export interface IAiTranscriptArchive extends Document {
  companyId: string | null;          // null — firmasiz (dasturchi) suhbatlari
  period: string;                    // YYYY-MM-DD (Asia/Tashkent)
  part: number;                      // bir kun bir necha qismga bo'linishi mumkin (hajm chegarasi)
  status: 'stored' | 'done';
  storageRef: string;
  fileName: string;
  size: number;                      // gzip bayt
  rawSize: number;                   // JSONL bayt
  sha256: string;
  counts: { conversations: number; events: number };
  convIds?: string[];
  eventIds?: string[];
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiTranscriptArchiveSchema = new Schema<IAiTranscriptArchive>({
  companyId: { type: String, default: null },
  period: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  part: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['stored', 'done'], default: 'stored' },
  storageRef: { type: String, required: true },
  fileName: { type: String, required: true },
  size: { type: Number, default: 0 },
  rawSize: { type: Number, default: 0 },
  sha256: { type: String, default: '' },
  counts: {
    conversations: { type: Number, default: 0 },
    events: { type: Number, default: 0 },
  },
  convIds: { type: [String], default: undefined, select: false },
  eventIds: { type: [String], default: undefined, select: false },
  deletedAt: Date,
}, { timestamps: true });

AiTranscriptArchiveSchema.index({ companyId: 1, period: 1, part: 1 }, { unique: true });
AiTranscriptArchiveSchema.index({ companyId: 1, period: -1 });
AiTranscriptArchiveSchema.index({ status: 1 });

export default mongoose.model<IAiTranscriptArchive>('AiTranscriptArchive', AiTranscriptArchiveSchema);
