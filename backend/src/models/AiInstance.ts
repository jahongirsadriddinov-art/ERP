import mongoose, { Schema, Document } from 'mongoose';

// Backend instansiyalarining yurak urishi (heartbeat). Realtime (socket, worker) bitta
// instansiyaga mo'ljallangan — ikki instansiya bir vaqtda urib tursa (deploy overlap)
// ogohlantirish yoziladi (review C3). TTL eskilarini o'chiradi.
export interface IAiInstance extends Document {
  instanceId: string;
  startedAt: Date;
  lastBeatAt: Date;
  hasWorker: boolean;
  version?: string;
  expiresAt: Date;
}

const AiInstanceSchema = new Schema<IAiInstance>({
  instanceId: { type: String, required: true },
  startedAt: { type: Date, required: true },
  lastBeatAt: { type: Date, required: true },
  hasWorker: { type: Boolean, default: false },
  version: String,
  expiresAt: { type: Date, required: true },
});

AiInstanceSchema.index({ instanceId: 1 }, { unique: true });
AiInstanceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IAiInstance>('AiInstance', AiInstanceSchema);
