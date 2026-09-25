import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  fromUserId: string;
  toUserId: string;
  groupId?: string;
  text: string;
  timestamp: string;
  read: boolean;
  type?: 'text' | 'image' | 'video' | 'file' | 'audio' | 'location' | 'video_invite' | 'video_event';
  videoChatGroupId?: string;
  videoEvent?: { kind: 'started' | 'ended'; durationSec?: number; by?: string };
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  location?: { lat: number; lng: number };
  replyToId?: string;
  edited?: boolean;
  pinned?: boolean;
  deleted?: boolean;
  companyId?: string; // v1.2 multi-tenant (nullable)
}

const MessageSchema: Schema = new Schema({
  fromUserId: { type: String, required: true },
  toUserId: { type: String, default: '' },
  groupId: { type: String },
  text: { type: String, default: '' },
  timestamp: { type: String },
  read: { type: Boolean, default: false },
  type: { type: String, enum: ['text', 'image', 'video', 'file', 'audio', 'location', 'video_invite', 'video_event'] },
  // 'video_invite' xabarlari uchun — qaysi guruhning video chatiga
  // taklif qilinganini bildiradi (bu DM xabari, `groupId` maydoni band —
  // u guruh xabari ekanini emas, "qaysi guruh"ni bildirish uchun ishlatiladi).
  videoChatGroupId: { type: String },
  // 'video_event' — guruhdagi tizim xabari (video chat boshlandi/tugadi + davomiyligi).
  videoEvent: { type: new Schema({ kind: String, durationSec: Number, by: String }, { _id: false }), default: undefined },
  mediaUrl: { type: String },
  fileName: { type: String },
  fileSize: { type: Number },
  location: { lat: { type: Number }, lng: { type: Number } },
  replyToId: { type: String },
  edited: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false },
  companyId: { type: String, index: true }, // v1.2 multi-tenant
}, { timestamps: true });

// Suhbat bo'yicha xabarlarni tezkor yuklash
MessageSchema.index({ fromUserId: 1, toUserId: 1, timestamp: -1 });
MessageSchema.index({ groupId: 1, timestamp: -1 });
// GET / yo'li {companyId}.sort({createdAt}) so'raydi — bir xil sabab bilan
// (Transaction.ts'dagi izohga qarang) qo'sh indeks kerak.
MessageSchema.index({ companyId: 1, createdAt: -1 });
// Global search uchun matn indeksi
MessageSchema.index({ text: 'text' });

export default mongoose.model<IMessage>('Message', MessageSchema);
