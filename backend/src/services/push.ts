import webpush from 'web-push';
import mongoose, { Schema, Document } from 'mongoose';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = `mailto:${process.env.EMAIL_USER || 'admin@qurilisherp.uz'}`;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// PushSubscription model
interface PushSubDoc extends Document {
  userId: string;
  companyId?: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: Date;
}

const PushSubSchema = new Schema<PushSubDoc>({
  userId: { type: String, required: true },
  companyId: String,
  endpoint: { type: String, required: true, unique: true },
  keys: { p256dh: String, auth: String },
  createdAt: { type: Date, default: Date.now },
});
export const PushSubscription = mongoose.model<PushSubDoc>('PushSubscription', PushSubSchema);

export async function sendPushToUser(userId: string, payload: { title: string; body: string; icon?: string; url?: string; tag?: string }) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const subs = await PushSubscription.find({ userId });
  const data = JSON.stringify({ ...payload, icon: payload.icon || '/favicon.svg', badge: '/favicon.svg' });
  await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys } as any,
        data
      ).catch(async err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSubscription.deleteOne({ _id: sub._id });
        }
      })
    )
  );
}

export async function sendPushToCompany(companyId: string, payload: { title: string; body: string; icon?: string; url?: string; tag?: string }) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  const subs = await PushSubscription.find({ companyId });
  const data = JSON.stringify({ ...payload, icon: payload.icon || '/favicon.svg', badge: '/favicon.svg' });
  await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys } as any,
        data
      ).catch(async err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSubscription.deleteOne({ _id: sub._id });
        }
      })
    )
  );
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC;
}
