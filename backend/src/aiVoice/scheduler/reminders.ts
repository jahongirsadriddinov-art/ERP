import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiReminder from '../../models/AiReminder';
import User from '../../models/User';
import type { ChannelCtx, ChannelName } from '../contracts';
import { getChannel } from '../channels/registry';
import type { JobQueue } from '../queue/jobQueue';
import { getSettings, isAiActive } from '../settings';
import { enqueueJob, JOBS, keys } from './jobTypes';
import { nextOccurrence } from './recurrence';
import { pickLang, reminderButtons, tx } from './texts';

// Shaxsiy eslatmalar (design §5, review C2/C9). Yuborish atomikligi (C9): AVVAL reminder.fire ishi
// dedupe `rem:<id>:<nextFireAt ISO>` bilan qo'shiladi, KEYIN nextFireAt eski qiymatiga CAS bilan suriladi —
// oraliqda qulash eng yomoni takroriy qo'shish (e'tiborsiz qoladi). 6 soatdan ortiq kechikkan bir martalik
// eslatma — 'missed'; takroriylari keyingi KELAJAKDAGI vaqtga o'tadi (to'plab yuborilmaydi).
// Eslatmalarda jim soatlar yo'q (faqat qo'ng'iroqlarda). Vaqt zonasi — Asia/Tashkent.

export const MISSED_AFTER_MS = 6 * 3600_000;
/** v1: eslatmalar faqat qo'ng'iroqsiz kanallar orqali. */
export const REMINDER_CHANNELS: ChannelName[] = ['bot_message', 'push'];

const recOf = (r: any) => ({
  freq: r.recurrence?.freq || 'none', interval: r.recurrence?.interval || 1, byWeekday: r.recurrence?.byWeekday || [],
  until: r.recurrence?.until || null, count: r.recurrence?.count ?? null,
});

/** reminder.tick: muddati kelgan eslatmalar. */
export async function reminderTick(q: JobQueue | null, now: Date): Promise<{ queued: number; missed: number; skipped: number }> {
  const due: any[] = await AiReminder.find({ status: 'active', nextFireAt: { $ne: null, $lte: now } })
    .sort({ nextFireAt: 1 }).limit(200).lean();
  let queued = 0, missed = 0, skipped = 0;
  for (const r of due) {
    try {
      const res = await processDue(q, r, now);
      if (res === 'queued') queued++; else if (res === 'missed') missed++; else if (res === 'skipped') skipped++;
    } catch (e) {
      console.error('[aiVoice/reminders] tick xatosi:', (e as Error).message);
    }
  }
  return { queued, missed, skipped };
}

async function processDue(q: JobQueue | null, r: any, now: Date): Promise<'queued' | 'missed' | 'skipped' | 'lost'> {
  const old: Date = new Date(r.nextFireAt);
  const rec = recOf(r);
  const anchor = new Date(r.dueAt);
  if (now.getTime() - old.getTime() > MISSED_AFTER_MS) {
    if (rec.freq === 'none') {
      const u = await AiReminder.updateOne({ _id: r._id, status: 'active', nextFireAt: old }, { $set: { status: 'missed', nextFireAt: null } });
      return u.modifiedCount ? 'missed' : 'lost';
    }
    const next = nextOccurrence(rec, anchor, now, r.fireCount || 0);
    const u = await AiReminder.updateOne({ _id: r._id, status: 'active', nextFireAt: old },
      { $set: next ? { nextFireAt: next } : { nextFireAt: null, status: 'done' } });
    return u.modifiedCount ? 'skipped' : 'lost';
  }
  // C9: avval ish (dedupe), keyin CAS
  await enqueueJob(q, {
    type: JOBS.reminderFire, refId: String(r._id), companyId: r.companyId, employeeId: r.targetUserId,
    dedupeKey: keys.reminderFire(String(r._id), old), payload: { fireAt: old.toISOString() }, correlationId: r.correlationId, runAt: now,
  });
  let next: Date | null = null;
  if (rec.freq !== 'none') {
    next = nextOccurrence(rec, anchor, old, (r.fireCount || 0) + 1);
    if (next && next.getTime() <= now.getTime()) next = nextOccurrence(rec, anchor, now, (r.fireCount || 0) + 1);
  }
  const u = await AiReminder.updateOne({ _id: r._id, status: 'active', nextFireAt: old }, { $set: { nextFireAt: next } });
  return u.modifiedCount ? 'queued' : 'lost';
}

/** reminder.fire: maqsadga yetkazish (birinchi muvaffaqiyatli kanal), fireCount/lastFiredAt. */
export async function fireReminder(reminderId: string, now: Date): Promise<'delivered' | 'skipped' | 'undelivered'> {
  const r: any = await AiReminder.findById(reminderId).lean();
  if (!r || r.status === 'cancelled' || r.status === 'missed' || r.status === 'failed') return 'skipped';
  const markFired = async () => {
    const set: Record<string, unknown> = { lastFiredAt: now };
    const fresh: any = await AiReminder.findById(reminderId).select('recurrence nextFireAt status').lean();
    if (fresh && fresh.status === 'active' && (fresh.recurrence?.freq || 'none') === 'none' && !fresh.nextFireAt) set.status = 'done';
    if (fresh && fresh.status === 'active' && (fresh.recurrence?.freq || 'none') !== 'none' && !fresh.nextFireAt) set.status = 'done';
    await AiReminder.updateOne({ _id: reminderId }, { $set: set, $inc: { fireCount: 1 } });
  };
  if (!(await isAiActive(r.companyId))) return 'skipped';
  const target: any = await User.findOne({ _id: r.targetUserId, companyId: r.companyId, isBlocked: { $ne: true } }).select('language').lean().catch(() => null);
  if (!target) { await markFired(); return 'skipped'; }
  const contact: any = await AiEmployeeContact.findOne({ companyId: r.companyId, employeeId: r.targetUserId }).select('optOut languageOverride').lean();
  if (contact?.optOut?.reminders || contact?.optOut?.all) { await markFired(); return 'skipped'; }
  const settings = await getSettings(r.companyId);
  const lang = pickLang(contact?.languageOverride, target.language, settings.language);
  const t = tx(lang);
  const wanted: string[] = r.channels?.length ? r.channels : settings.reminders.defaultChannels;
  const channels = (wanted.filter((c) => (REMINDER_CHANNELS as string[]).includes(c)) as ChannelName[]);
  const ctx: ChannelCtx = {
    companyId: r.companyId, employeeId: r.targetUserId, correlationId: r.correlationId, purpose: 'reminder', lang, now,
    reminderId: String(r._id), attemptNo: (r.fireCount || 0) + 1,
  };
  let retryable = false;
  for (const name of channels) {
    const ch = getChannel(name);
    if (!ch) continue;
    try {
      if (!(await ch.isAvailable(ctx)).ok) continue;
      const res = await ch.attempt(ctx, {
        kind: 'reminder', title: t.remTitle, text: String(r.text).slice(0, 500),
        buttons: name === 'bot_message' ? reminderButtons(lang, String(r._id)) : undefined,
      });
      if (res.outcome === 'delivered' || res.outcome === 'answered') { await markFired(); return 'delivered'; }
      if (res.retryable) retryable = true;
    } catch (e) {
      retryable = true;
      console.error('[aiVoice/reminders] yetkazish xatosi:', (e as Error).message);
    }
  }
  if (retryable) throw new Error('reminder_delivery_retry');      // navbat backoff bilan qayta urinadi
  await markFired();
  return 'undelivered';
}

// ───────────── Tugma / veb amali (api.reminderAction) ─────────────
export const SNOOZE_DEFAULT_MIN = 10;

export async function applyReminderAction(p: {
  companyId: string; userId: string; reminderId: string; action: 'done' | 'snooze'; snoozeMin?: number; now: Date;
}): Promise<{ ok: true; status: 'active' | 'done'; nextFireAt?: Date; already: boolean } | { ok: false; code: 'not_found' | 'forbidden' }> {
  if (!/^[0-9a-fA-F]{24}$/.test(String(p.reminderId || ''))) return { ok: false, code: 'not_found' };
  const r: any = await AiReminder.findOne({ _id: p.reminderId, companyId: p.companyId }).lean();
  if (!r) return { ok: false, code: 'not_found' };
  if (String(r.targetUserId) !== String(p.userId)) return { ok: false, code: 'forbidden' };
  const recurring = (r.recurrence?.freq || 'none') !== 'none';
  if (p.action === 'done') {
    if (r.status === 'done') return { ok: true, status: 'done', already: true };
    if (r.status !== 'active') return { ok: false, code: 'not_found' };
    if (recurring) return { ok: true, status: 'active', nextFireAt: r.nextFireAt || undefined, already: false };   // bu safargi hodisa qabul qilindi
    const u = await AiReminder.updateOne({ _id: r._id, status: 'active' }, { $set: { status: 'done', nextFireAt: null } });
    return { ok: true, status: 'done', already: u.modifiedCount === 0 };
  }
  // snooze
  const min = Math.min(120, Math.max(1, Math.floor(p.snoozeMin || SNOOZE_DEFAULT_MIN)));
  const target = new Date(p.now.getTime() + min * 60_000);
  if (r.status !== 'active' && r.status !== 'done') return { ok: false, code: 'not_found' };
  const cur = r.nextFireAt ? new Date(r.nextFireAt).getTime() : null;
  // Takroriy bosish: allaqachon (now, now+min] oralig'ida rejalashtirilgan — no-op
  if (r.status === 'active' && cur && cur > p.now.getTime() && cur <= target.getTime()) {
    return { ok: true, status: 'active', nextFireAt: new Date(cur), already: true };
  }
  const u = await AiReminder.updateOne(
    { _id: r._id, status: r.status, nextFireAt: r.nextFireAt ?? null },
    { $set: { status: 'active', nextFireAt: target } },
  );
  if (!u.modifiedCount) {
    const fresh: any = await AiReminder.findById(r._id).select('status nextFireAt').lean();
    return { ok: true, status: fresh?.status === 'done' ? 'done' : 'active', nextFireAt: fresh?.nextFireAt || undefined, already: true };
  }
  return { ok: true, status: 'active', nextFireAt: target, already: false };
}
