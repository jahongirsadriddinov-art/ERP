import User from '../../models/User';
import type { ChannelAdapter, ChannelCtx, ChannelRequest } from '../contracts';
import { isObjectIdString } from '../lib/ids';

// Push kanali (P3): FAQAT createNotification — u ilova ichidagi bildirishnomani yozadi, socket orqali
// yuboradi VA sendPushToUser'ni o'zi chaqiradi (review A15: alohida push = ikki marta). Bildirishnoma qatori
// muhim — APK'ning BackgroundService so'rovi xodimga yetishning yagona yo'li (FCM yo'q).
// notifications.ts kechiktirib yuklanadi (socket.ts'ni modul darajasida tortmaslik uchun).

async function recipient(c: ChannelCtx): Promise<boolean> {
  if (!isObjectIdString(c.employeeId) || !c.companyId) return false;
  return !!(await User.exists({ _id: c.employeeId, companyId: c.companyId, isBlocked: { $ne: true } }));
}

const typeOf = (r: ChannelRequest) => (r.kind === 'attendance' ? 'shift' : 'ai') as 'shift' | 'ai';

export const pushChannel: ChannelAdapter = {
  name: 'push',
  async isAvailable(c) {
    return (await recipient(c)) ? { ok: true } : { ok: false, reason: 'no_recipient' };
  },
  async attempt(c, r) {
    if (!(await recipient(c))) return { outcome: 'unavailable', retryable: false, errorCode: 'no_recipient' };
    const title = String(r.title || r.text || '').slice(0, 120);
    const body = String(r.text || r.title || '').slice(0, 500);
    if (!title || !body) return { outcome: 'failed', retryable: false, errorCode: 'empty' };
    try {
      const { createNotification } = await import('../../services/notifications');
      await createNotification({
        recipientId: c.employeeId, companyId: c.companyId, type: typeOf(r), title, body,
        entity: c.confirmationId ? 'ai_attendance' : c.reminderId ? 'ai_reminder' : undefined,
        entityId: c.confirmationId || c.reminderId,
      });
      return { outcome: 'delivered', retryable: false };
    } catch (e) {
      return { outcome: 'failed', retryable: true, errorCode: 'notify_error' };
    }
  },
};

export default pushChannel;
