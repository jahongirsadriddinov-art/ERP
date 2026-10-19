import mongoose, { Schema } from 'mongoose';
import User from '../models/User';
import Notification from '../models/Notification';
import { createNotification } from './notifications';

// ─── Rahbarlarga ogohlantirish (owner 2026-10-19) ───────────────────────────────────────────────────────────
// Foto-nazorat, o'g'irlikka qarshi nazorat, narx monitoringi, hujjat muddatlari, texnika va kunlik brifing — barchasi
// shu yerdan. Qoida (owner): "har doim telefon qilmasin — eslatsin; kerak bo'lsa o'zi qiladi":
//  • odatda — ilova bildirishnomasi + Telegram xabari (qo'ng'iroqsiz);
//  • faqat severity='critical' bo'lsa va 30 daqiqada o'qilmasa — AI qo'ng'iroq qiladi (firma AI yoqilgan bo'lsa);
//  • bir xil ogohlantirish (key) dedupeHours ichida qayta yuborilmaydi.

export type AlertSeverity = 'info' | 'warning' | 'critical';

interface IAlertLog { companyId: string; key: string; expiresAt: Date; createdAt: Date }
const AlertLogSchema = new Schema<IAlertLog>({
  companyId: { type: String, required: true },
  key: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: () => new Date() },
});
AlertLogSchema.index({ companyId: 1, key: 1 }, { unique: true });
AlertLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AlertLog = (mongoose.models.AlertLog as mongoose.Model<IAlertLog>) || mongoose.model<IAlertLog>('AlertLog', AlertLogSchema);

export const ESCALATE_JOB = 'alert.escalate';
const ESCALATE_AFTER_MS = 30 * 60_000;

export interface AlertInput {
  companyId: string;
  key: string;                 // dedupe kaliti, masalan "theft:<objectId>:<material>"
  title: string;
  body: string;
  severity?: AlertSeverity;
  url?: string;
  entity?: string;
  entityId?: string;
  dedupeHours?: number;        // standart 24
  telegram?: boolean;          // standart true
  recipients?: string[];       // berilmasa — direktor/o'rinbosar/egasi
}

export async function bossIds(companyId: string): Promise<string[]> {
  const rows: any[] = await User.find({
    companyId: String(companyId), isBlocked: { $ne: true },
    $or: [{ role: { $in: ['direktor', 'orinbosar'] } }, { isOwner: true }],
  }).select('_id').lean();
  return rows.map((r) => String(r._id));
}

async function sendTelegram(userIds: string[], text: string): Promise<number> {
  if (!userIds.length) return 0;
  let bot: any = null;
  try { bot = (await import('./bot')).bot; } catch { return 0; }
  if (!bot) return 0;
  const rows: any[] = await User.find({ _id: { $in: userIds }, telegramChatId: { $exists: true, $ne: '' } }).select('telegramChatId').lean();
  let n = 0;
  for (const r of rows) {
    await bot.sendMessage(r.telegramChatId, text, { disable_web_page_preview: true }).then(() => { n++; }, () => undefined);
  }
  return n;
}

/** Ogohlantirish yuboradi. Dedupe tufayli yuborilmasa — { sent: false }. */
export async function alertBosses(a: AlertInput): Promise<{ sent: boolean; recipients: number }> {
  const companyId = String(a.companyId || '');
  if (!companyId || !a.key) return { sent: false, recipients: 0 };
  const hours = Math.max(1, a.dedupeHours ?? 24);
  try {
    await AlertLog.create({ companyId, key: a.key.slice(0, 200), expiresAt: new Date(Date.now() + hours * 3600_000) });
  } catch (e: any) {
    if (e?.code === 11000) return { sent: false, recipients: 0 };   // yaqinda shu ogohlantirish yuborilgan
  }
  const recipients = a.recipients?.length ? a.recipients : await bossIds(companyId);
  if (!recipients.length) return { sent: false, recipients: 0 };
  const severity = a.severity || 'warning';
  const icon = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
  const entity = a.entity || 'alert';
  const entityId = a.entityId || a.key.slice(0, 120);
  for (const rid of recipients) {
    await createNotification({
      recipientId: rid, companyId, type: 'ai', title: `${icon} ${a.title}`.slice(0, 140), body: a.body.slice(0, 1000),
      entity, entityId, url: a.url,
    });
  }
  if (a.telegram !== false) await sendTelegram(recipients, `${icon} ${a.title}\n\n${a.body}`.slice(0, 3800));
  if (severity === 'critical') await scheduleEscalation(companyId, recipients, a.title, a.body, entity, entityId);
  return { sent: true, recipients: recipients.length };
}

// ── Eskalatsiya: jiddiy ogohlantirish 30 daqiqada o'qilmasa — AI qo'ng'iroq qiladi ──────────────────────────
const registered = new WeakSet<object>();
async function queueApi() {
  try {
    const { getSharedQueue } = await import('../aiVoice/queue/jobQueue');
    return getSharedQueue();
  } catch { return null; }
}

export async function ensureEscalationJob(): Promise<any> {
  const q: any = await queueApi();
  if (!q || registered.has(q)) return q;
  registered.add(q);
  if (q.registeredTypes().includes(ESCALATE_JOB)) return q;
  q.register(ESCALATE_JOB, async ({ job }: any) => {
    const p = (job.payload || {}) as { entity?: string; entityId?: string; title?: string; body?: string };
    const employeeId = String(job.employeeId || '');
    const companyId = String(job.companyId || '');
    if (!employeeId || !companyId) return;
    // O'qilgan bo'lsa — qo'ng'iroq shart emas
    const unread = await Notification.exists({ recipientId: employeeId, entity: p.entity, entityId: p.entityId, read: false });
    if (!unread) return;
    const { isAiActive } = await import('../aiVoice/settings');
    if (!(await isAiActive(companyId).catch(() => false))) return;
    const { ensureCallbackJob, CALLBACK_JOB, callbackOrder } = await import('../aiVoice/tools/erp/requestCallback');
    const qq: any = await queueApi();
    if (!qq) return;
    ensureCallbackJob(qq);
    await qq.enqueue({
      type: CALLBACK_JOB, companyId, employeeId, refId: employeeId,
      payload: { order: callbackOrder(undefined, 'web'), lang: 'uz', reason: `${p.title || 'Muhim ogohlantirish'}: ${p.body || ''}`.slice(0, 300) },
      runAt: qq.now(), maxAttempts: 3,
      dedupeKey: `alertcall:${employeeId}:${p.entityId}`,
    });
  }, { concurrency: 1, maxAttempts: 2 });
  return q;
}

async function scheduleEscalation(companyId: string, recipients: string[], title: string, body: string, entity: string, entityId: string) {
  const q: any = await ensureEscalationJob();
  if (!q) return;
  const runAt = new Date(q.now().getTime() + ESCALATE_AFTER_MS);
  for (const rid of recipients) {
    await q.enqueue({
      type: ESCALATE_JOB, companyId, employeeId: rid, refId: rid,
      payload: { entity, entityId, title: title.slice(0, 120), body: body.slice(0, 300) },
      runAt, maxAttempts: 2, dedupeKey: `alertesc:${rid}:${entityId}`,
    }).catch(() => undefined);
  }
}
