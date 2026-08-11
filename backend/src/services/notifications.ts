import Notification, { NotificationType } from '../models/Notification';
import { sendPushToUser } from './push';
import { emitToUser } from './socket';

interface CreateNotifParams {
  recipientId: string;
  companyId?: string;
  type: NotificationType;
  title: string;
  body: string;
  entity?: string;
  entityId?: string;
  url?: string;
}

export async function createNotification(params: CreateNotifParams): Promise<void> {
  try {
    const notif = await Notification.create({
      recipientId: params.recipientId,
      companyId: params.companyId,
      type: params.type,
      title: params.title,
      body: params.body,
      entity: params.entity,
      entityId: params.entityId,
      url: params.url,
      read: false,
      deliveredAt: new Date(),
    });

    // Real-time: emit to user if online
    emitToUser(params.recipientId, 'notification:new', {
      id: notif._id,
      type: notif.type,
      title: notif.title,
      body: notif.body,
      entity: notif.entity,
      entityId: notif.entityId,
      url: notif.url,
      read: false,
      createdAt: notif.createdAt,
    });

    // Web Push: send if user has push subscription
    await sendPushToUser(params.recipientId, {
      title: params.title,
      body: params.body,
      url: params.url,
      tag: params.type,
    }).catch(() => {}); // push failure should not break main flow
  } catch (err) {
    console.error('createNotification error:', (err as Error).message);
  }
}
