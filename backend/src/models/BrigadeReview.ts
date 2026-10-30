import mongoose, { Schema, Document } from 'mongoose';

// Brigada haqida baho (owner 2026-10-29 qarorlari):
//
//  1) "O'rinbosarlar va direktor tasdiqlaydi; chiqargan ma'lumotini qayerdan
//     olganini aytadi, link beradi va tekshiriladi."
//     → sharh 'pending' holatda yaratiladi, manba havolasi SHART, tasdiqlaguncha
//       boshqa firmalarga ko'rinmaydi va yig'ma bahoga qo'shilmaydi.
//
//  2) "Pul berayotganda kelishilgan summa kvadrat yoki boshqa turda bo'lsa
//     hisoblaydi, qanchaga kelishganini yozib; agar shtrafi ham bo'lsa yozadi."
//     → kelishuv shu yerda qayd etiladi: birlik narxi × hajm = kelishilgan summa,
//       shtraf ayiriladi, to'lanadigan summa saqlanadi. Hisob SERVERDA qilinadi —
//       klient yuborgan jamiga ishonilmaydi.
//
//  3) Nizolar asosiy tizimda hal qilinadi → rad etilgan sharhda sabab yoziladi va
//     muallif ko'radi; yozuv o'chirilmaydi (tarix qoladi).

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface IBrigadeReview extends Document {
  brigadeId: mongoose.Types.ObjectId;
  companyId: string;          // baho qoldirgan firma (boshqalarga KO'RSATILMAYDI)
  authorId: string;
  score: number;              // 1..5
  comment?: string;
  /** Kelishuv: birlik narxi × hajm − shtraf */
  workType?: string;
  unit?: string;              // m2, m3, dona, kun ...
  volume?: number;
  ratePerUnit?: number;
  agreedTotal?: number;       // serverda hisoblanadi
  penalty?: number;
  penaltyReason?: string;
  payable?: number;           // serverda hisoblanadi
  /** Manba — qarorning 1-sharti */
  sourceUrl: string;
  sourceNote?: string;
  status: ReviewStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  rejectReason?: string;
  /** Havola haqiqatan tekshirildimi (tasdiqlovchi belgilaydi) */
  sourceVerified: boolean;
}

const BrigadeReviewSchema: Schema = new Schema({
  brigadeId: { type: Schema.Types.ObjectId, ref: 'Brigade', required: true, index: true },
  companyId: { type: String, required: true, index: true },
  authorId: { type: String, required: true },
  score: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, maxlength: 1000 },
  workType: { type: String, maxlength: 80 },
  unit: { type: String, maxlength: 16 },
  volume: { type: Number, min: 0 },
  ratePerUnit: { type: Number, min: 0 },
  agreedTotal: { type: Number, min: 0 },
  penalty: { type: Number, min: 0, default: 0 },
  penaltyReason: { type: String, maxlength: 300 },
  payable: { type: Number, min: 0 },
  sourceUrl: { type: String, required: true, maxlength: 500 },
  sourceNote: { type: String, maxlength: 300 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: { type: String },
  reviewedAt: { type: Date },
  rejectReason: { type: String, maxlength: 300 },
  sourceVerified: { type: Boolean, default: false },
}, { timestamps: true });

// Bitta firma bitta brigadaga bitta baho beradi (qayta yozsa — eskisi tahrirlanadi).
// Shu tufayli bir firma reytingni ko'p sharh bilan ko'tarib yubora olmaydi.
BrigadeReviewSchema.index({ brigadeId: 1, companyId: 1 }, { unique: true });
BrigadeReviewSchema.index({ companyId: 1, status: 1, createdAt: -1 });

export default mongoose.model<IBrigadeReview>('BrigadeReview', BrigadeReviewSchema);
