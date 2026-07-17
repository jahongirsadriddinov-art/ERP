import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  fromUserId: string;
  toUserId: string;
  groupId?: string;
  text: string;
  timestamp: string;
  read: boolean;
  type?: 'text' | 'image' | 'video' | 'file' | 'audio' | 'location';
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
  type: { type: String, enum: ['text', 'image', 'video', 'file', 'audio', 'location'] },
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

export default mongoose.model<IMessage>('Message', MessageSchema);
