import mongoose, { Schema, Document } from 'mongoose';

export type AuditAction =
  | 'create' | 'update' | 'delete'
  | 'approve' | 'reject' | 'confirm'
  | 'login' | 'logout'
  | 'upload' | 'download'
  | 'checkin' | 'checkout'
  | 'scan_qr' | 'send_push';

export interface IAuditLog extends Document {
  userId: string;
  userName: string;
  userRole: string;
  action: AuditAction;
  entity: string; // 'transaction' | 'material' | 'user' | 'object' | 'message' | ...
  entityId?: string;
  description: string;
  oldValue?: any;
  newValue?: any;
  ip?: string;
  userAgent?: string;
  companyId?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  userId: { type: String, required: true, index: true },
  userName: { type: String, required: true },
  userRole: { type: String, required: true },
  action: { type: String, required: true, index: true },
  entity: { type: String, required: true, index: true },
  entityId: { type: String, index: true },
  description: { type: String, required: true },
  oldValue: { type: Schema.Types.Mixed },
  newValue: { type: Schema.Types.Mixed },
  ip: String,
  userAgent: String,
  companyId: { type: String, index: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

// Compound index for efficient querying
AuditLogSchema.index({ companyId: 1, createdAt: -1 });
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
