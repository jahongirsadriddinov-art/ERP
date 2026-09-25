import mongoose, { Schema, Document } from 'mongoose';

// Telegram-ga o'xshash "guruh video chat" — qo'ng'iroqdan farqli, hech kim
// "chaqirilmaydi" (rings), istalgan a'zo istalgan vaqt qo'shilishi/chiqishi
// mumkin. Guruh hujjatida saqlanadi (socket xotirasida emas) — shunda
// sahifa qayta yuklansa yoki boshqa a'zo keyinroq guruhga kirsa ham, hali
// faol ekanini (va "Qo'shilish" tugmasi ko'rinishini) ko'radi.
export interface IActiveVideoChat {
  startedBy: string;
  startedByName: string;
  startedAt: Date;
  mode: 'voice' | 'video';
  participantIds: string[];
}

export interface IGroup extends Document {
  name: string;
  avatar?: string;
  memberIds: string[];
  adminIds: string[];
  createdBy: string;
  companyId?: string; // v1.2 multi-tenant (nullable)
  devSupport?: boolean; // har firma uchun dasturchi-support chat
  activeVideoChat?: IActiveVideoChat;
  lastVideoChat?: { startedAt: Date; endedAt: Date; startedByName: string; durationSec: number };
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema: Schema = new Schema({
  name: { type: String, required: true },
  avatar: { type: String },
  memberIds: { type: [String], default: [] },
  adminIds: { type: [String], default: [] },
  createdBy: { type: String, required: true },
  companyId: { type: String, index: true }, // v1.2 multi-tenant
  devSupport: { type: Boolean, default: false, index: true },
  activeVideoChat: {
    type: new Schema({
      startedBy: { type: String, required: true },
      startedByName: { type: String, required: true },
      startedAt: { type: Date, required: true },
      mode: { type: String, enum: ['voice', 'video'], required: true },
      participantIds: { type: [String], default: [] },
    }, { _id: false }),
    default: undefined,
  },
  // Oxirgi tugagan video chat — eski "Qo'shilish" havolasi bosilganda
  // "tugagan, N daqiqa oldin" deb ko'rsatish uchun.
  lastVideoChat: {
    type: new Schema({
      startedAt: { type: Date },
      endedAt: { type: Date },
      startedByName: { type: String },
      durationSec: { type: Number },
    }, { _id: false }),
    default: undefined,
  },
}, { timestamps: true });

export default mongoose.model<IGroup>('Group', GroupSchema);
