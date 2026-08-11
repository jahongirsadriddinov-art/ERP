import mongoose, { Schema, Document } from 'mongoose';

export type NotificationType =
  | 'message' | 'transfer' | 'expense' | 'approval_request' | 'approval_result'
  | 'system' | 'qr_scan' | 'document' | 'material' | 'gps' | 'shift';

export interface INotification extends Document {
  recipientId: string;
  companyId?: string;
  type: NotificationType;
  title: string;
  body: string;
  entity?: string;
  entityId?: string;
  url?: string;
  read: boolean;
  deliveredAt?: Date;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  recipientId: { type: String, required: true, index: true },
  companyId: { type: String, index: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  entity: String,
  entityId: String,
  url: String,
  read: { type: Boolean, default: false, index: true },
  deliveredAt: Date,
}, { timestamps: { createdAt: true, updatedAt: false } });

NotificationSchema.index({ recipientId: 1, read: 1, createdAt: -1 });

export default mongoose.model<INotification>('Notification', NotificationSchema);
