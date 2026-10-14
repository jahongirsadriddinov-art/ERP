import type { ChannelAdapter, ChannelCtx } from '../contracts';
import { notifyManagersInApp, resolveManagers } from '../lib/managers';
import { getChannel } from './registry';

// Rahbarga xabar kanali (P3). ctx.employeeId — HAQIDA xabar berilayotgan xodim; qabul qiluvchilar
// lib/managers.resolveManagers orqali FAQAT SHU firmadan (obyekt prorabi, bo'lmasa direktor/o'rinbosar/egasi).
// Har rahbarga: ilova ichidagi bildirishnoma (createNotification — push'ni o'zi yuboradi) + bot xabari
// (registry'dagi bot_message kanali orqali, ctx.employeeId = rahbar). Xabar matni chaqiruvchidan keladi.

export const managerChannel: ChannelAdapter = {
  name: 'notify_manager',
  async isAvailable(c) {
    const m = await resolveManagers(c.companyId, c.employeeId);
    return m.length ? { ok: true } : { ok: false, reason: 'no_managers' };
  },
  async attempt(c, r) {
    if (!(await resolveManagers(c.companyId, c.employeeId)).length) return { outcome: 'unavailable', retryable: false, errorCode: 'no_managers' };
    const text = String(r.text || r.title || '').slice(0, 500);
    if (!text) return { outcome: 'failed', retryable: false, errorCode: 'empty' };
    const title = String(r.title || text).slice(0, 120);
    let managers;
    try {
      managers = await notifyManagersInApp(c.companyId, c.employeeId, {
        title, body: text, entity: c.confirmationId ? 'ai_attendance' : undefined, entityId: c.confirmationId,
      });
    } catch (e) {
      return { outcome: 'failed', retryable: true, errorCode: 'notify_error' };
    }
    if (!managers.length) return { outcome: 'unavailable', retryable: false, errorCode: 'no_managers' };
    const bot = getChannel('bot_message');
    if (bot) {
      for (const m of managers) {
        const mctx: ChannelCtx = { ...c, employeeId: m.userId, attemptKey: undefined, stepIndex: undefined };
        try {
          if ((await bot.isAvailable(mctx)).ok) await bot.attempt(mctx, { kind: 'manager_alert', title, text, urgency: r.urgency });
        } catch (e) {
          console.error('[aiVoice/managerChannel] bot xabari xatosi:', (e as Error).message);
        }
      }
    }
    return { outcome: 'delivered', retryable: false };
  },
};

export default managerChannel;
