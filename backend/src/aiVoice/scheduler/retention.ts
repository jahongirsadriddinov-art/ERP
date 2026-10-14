import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiCallEvent from '../../models/AiCallEvent';
import AiCallSession from '../../models/AiCallSession';
import AiConversation from '../../models/AiConversation';
import AiReminder from '../../models/AiReminder';
import { getSettings } from '../settings';

// Kunlik saqlash muddati tozalovchisi (retention.sweep). TTL indekslar (AiCallEvent/AiActionAudit expiresAt)
// asosiy ishni qiladi; bu yerda — firma sozlamasi KAMAYTIRILGAN bo'lsa eski yozuvlar ham kesiladi va
// TTL'siz kolleksiyalar tozalanadi:
//  • transcriptRetentionDays: AiCallEvent, sessiya summary'si, ovozli/bot AiConversation (chat emas);
//  • auditRetentionDays: yakunlangan AiCallSession va AiAttendanceConfirmation;
//  • yopilgan eslatmalar (done/cancelled/missed/failed) — 90 kundan keyin.
// Faol sessiyalarga va oddiy chat suhbatlariga tegilmaydi.

const DAY = 86_400_000;
export const CLOSED_REMINDER_KEEP_DAYS = 90;

export interface RetentionStats { companies: number; events: number; summaries: number; sessions: number; confirmations: number; conversations: number; reminders: number }

export async function retentionSweep(now: Date = new Date()): Promise<RetentionStats> {
  const stats: RetentionStats = { companies: 0, events: 0, summaries: 0, sessions: 0, confirmations: 0, conversations: 0, reminders: 0 };
  const ids = new Set<string>();
  for (const m of [AiCallSession, AiCallEvent, AiAttendanceConfirmation] as any[]) {
    for (const c of await m.distinct('companyId')) if (c) ids.add(String(c));
  }
  for (const companyId of ids) {
    try {
      const s = await getSettings(companyId);
      const tCut = new Date(now.getTime() - s.privacy.transcriptRetentionDays * DAY);
      const aCut = new Date(now.getTime() - s.privacy.auditRetentionDays * DAY);
      stats.events += (await AiCallEvent.deleteMany({ companyId, at: { $lt: tCut } })).deletedCount || 0;
      stats.summaries += (await AiCallSession.updateMany(
        { companyId, isActive: false, createdAt: { $lt: tCut }, summary: { $exists: true } }, { $unset: { summary: 1 } },
      )).modifiedCount || 0;
      stats.conversations += (await AiConversation.deleteMany(
        { companyId, source: { $in: ['voice_inapp', 'telegram_call', 'bot'] }, updatedAt: { $lt: tCut } },
      )).deletedCount || 0;
      stats.sessions += (await AiCallSession.deleteMany({ companyId, isActive: false, createdAt: { $lt: aCut } })).deletedCount || 0;
      stats.confirmations += (await AiAttendanceConfirmation.deleteMany({ companyId, createdAt: { $lt: aCut } })).deletedCount || 0;
      stats.companies++;
    } catch (e) {
      console.error(`[aiVoice/retention] ${companyId} xatosi:`, (e as Error).message);
    }
  }
  stats.reminders = (await AiReminder.deleteMany({
    status: { $in: ['done', 'cancelled', 'missed', 'failed'] }, updatedAt: { $lt: new Date(now.getTime() - CLOSED_REMINDER_KEEP_DAYS * DAY) },
  })).deletedCount || 0;
  return stats;
}
