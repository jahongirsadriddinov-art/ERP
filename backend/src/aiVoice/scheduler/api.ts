import AiAttendanceConfirmation, { type AiAttendanceStatus } from '../../models/AiAttendanceConfirmation';
import { getSharedQueue } from '../queue/jobQueue';
import { getSettings, isAiActive } from '../settings';
import { isObjectIdString } from '../lib/ids';
import { endOfLocalDay, localDate, zonedParts } from '../lib/zonedTime';
import { onButton, onVoice, type VoiceAnswer } from './attendanceFlow';
import { enqueueManager } from './attendanceRunner';
import { cancelSteps, JOBS, keys } from './jobTypes';
import { applyReminderAction } from './reminders';

// Paketlararo yakuniy imzolar (P1 stub → P3 to'ldirdi). Chaqiruvchilar:
//  • P4 bot ilgaklari — ai:a:<token>:c|l|d (davomat), ai:r:<id>:d|s (eslatma);
//  • P3 meRoutes — POST /me/attendance/:id/respond, eslatmalar;
//  • P8 adminRoutes — POST /admin/attendance/run-now;
//  • P2/P5 (ixtiyoriy) — recordVoiceAnswer (qo'ng'iroqdagi ovozli javob).
// Hamma o'tishlar ATOMIK (findOneAndUpdate) va takroriy bosish — no-op (already:true).

export type AttendanceAnswer = 'confirm' | 'late' | 'decline';

export interface RespondAttendanceInput {
  companyId: string;
  /** Javob beruvchi = tasdiq egasi (bot: query.from.id bilan tekshirilgan foydalanuvchi; web: req.user). */
  employeeId: string;
  /** Bot yo'li: ai:a:<buttonToken>:… */
  buttonToken?: string;
  /** Veb yo'li: /me/attendance/:id */
  confirmationId?: string;
  answer: AttendanceAnswer;
  via: 'bot' | 'web';
  at?: Date;
}

export type RespondAttendanceResult =
  | { ok: true; status: AiAttendanceStatus; already: boolean }
  | { ok: false; code: 'not_found' | 'expired' | 'finalized' | 'not_implemented' };

const ANSWERS: AttendanceAnswer[] = ['confirm', 'late', 'decline'];

/**
 * Tugma/veb javobi: buttonAnswer + status (confirmed/late/declined). HECH QACHON checked_in qo'ymaydi
 * (bu faqat reconciler — Attendance'dan). Token yozuvi shu xodim va firmaga tegishli bo'lishi shart.
 * Muddati: finalizedAt yoki kun oxirigacha (B5).
 */
export async function respondAttendance(input: RespondAttendanceInput): Promise<RespondAttendanceResult> {
  const at = input.at || new Date();
  if (!ANSWERS.includes(input.answer) || !input.companyId || !input.employeeId) return { ok: false, code: 'not_found' };
  let filter: Record<string, unknown>;
  if (input.buttonToken !== undefined) {
    if (!/^[0-9A-Za-z]{10}$/.test(String(input.buttonToken))) return { ok: false, code: 'not_found' };
    filter = { buttonToken: String(input.buttonToken) };
  } else if (isObjectIdString(input.confirmationId)) {
    filter = { _id: input.confirmationId };
  } else {
    return { ok: false, code: 'not_found' };
  }
  // Yozuv shu xodim va shu firmaga bog'langan bo'lishi shart (B5) — aks holda "topilmadi" (mavjudligini oshkor qilmaymiz)
  Object.assign(filter, { companyId: String(input.companyId), employeeId: String(input.employeeId) });
  const conf: any = await AiAttendanceConfirmation.findOne(filter).lean();
  if (!conf) return { ok: false, code: 'not_found' };

  const expired = at.getTime() >= endOfLocalDay(conf.date).getTime();
  const t = onButton(conf, input.answer, { expired });
  if (!t.ok) return t;
  if (!t.changed) return { ok: true, status: t.status, already: true };

  const won: any = await AiAttendanceConfirmation.findOneAndUpdate(
    { _id: conf._id, buttonAnswer: 'none', status: conf.status, finalizedAt: null },
    { $set: { buttonAnswer: t.buttonAnswer, buttonAt: at, status: t.status, nextActionAt: null } },
    { returnDocument: 'after' },
  ).lean();
  if (!won) {
    // Poyga: boshqa bosish/reconciler oldinroq yozdi
    const fresh: any = await AiAttendanceConfirmation.findById(conf._id).select('status finalizedAt buttonAnswer').lean();
    if (!fresh) return { ok: false, code: 'not_found' };
    if (fresh.buttonAnswer === 'none' && (fresh.finalizedAt || fresh.status === 'absent')) return { ok: false, code: 'finalized' };
    return { ok: true, status: fresh.status, already: true };
  }
  const q = getSharedQueue();
  await cancelSteps(q, String(conf._id));
  if (t.notifyManager) await enqueueManager(q, won, 'declined', at);
  return { ok: true, status: won.status, already: false };
}

/**
 * Qo'ng'iroqdagi ovozli javob (P2 attendanceCall tool'i / P5 sessiya): faqat voiceAnswer (+ETA) yoziladi,
 * holat 'pending' qoladi — tasdiq tugma yoki haqiqiy check-in bilan (design D10).
 */
export async function recordVoiceAnswer(p: {
  companyId: string; employeeId: string; confirmationId: string; answer: Exclude<VoiceAnswer, 'none'>; etaMin?: number;
}): Promise<{ ok: true; changed: boolean } | { ok: false; code: 'not_found' | 'bad_request' }> {
  if (!isObjectIdString(p.confirmationId) || !['coming', 'late', 'not_coming', 'unclear'].includes(p.answer)) return { ok: false, code: 'bad_request' };
  const conf: any = await AiAttendanceConfirmation.findOne({ _id: p.confirmationId, companyId: p.companyId, employeeId: p.employeeId })
    .select('status voiceAnswer').lean();
  if (!conf) return { ok: false, code: 'not_found' };
  const v = onVoice(conf, p.answer);
  if (!v.changed) return { ok: true, changed: false };
  const set: Record<string, unknown> = { voiceAnswer: v.voiceAnswer };
  if (typeof p.etaMin === 'number' && Number.isFinite(p.etaMin)) set.voiceEtaMin = Math.max(0, Math.min(600, Math.round(p.etaMin)));
  const r = await AiAttendanceConfirmation.updateOne({ _id: conf._id, status: { $nin: ['checked_in', 'absent'] } }, { $set: set });
  return { ok: true, changed: r.modifiedCount === 1 };
}

export interface ReminderActionInput {
  companyId: string;
  /** Eslatma maqsadi (targetUserId) bo'lishi shart. */
  userId: string;
  reminderId: string;
  action: 'done' | 'snooze';
  /** snooze uchun, standart 10. */
  snoozeMin?: number;
  via: 'bot' | 'web' | 'voice';
  at?: Date;
}

export type ReminderActionResult =
  | { ok: true; status: 'active' | 'done'; nextFireAt?: Date; already: boolean }
  | { ok: false; code: 'not_found' | 'forbidden' | 'not_implemented' };

export async function reminderAction(input: ReminderActionInput): Promise<ReminderActionResult> {
  if (input.action !== 'done' && input.action !== 'snooze') return { ok: false, code: 'not_found' };
  return applyReminderAction({
    companyId: String(input.companyId), userId: String(input.userId), reminderId: String(input.reminderId),
    action: input.action, snoozeMin: input.snoozeMin, now: input.at || new Date(),
  });
}

export interface RunPlanNowInput { companyId: string; shiftId: string; requestedBy: string; now?: Date }
export type RunPlanNowResult =
  | { ok: true; jobId: string; duplicate: boolean }
  | { ok: false; code: 'not_found' | 'disabled' | 'queue_unavailable' | 'not_implemented' };

/**
 * Qo'lda rejalashtirish (C5): dedupe `att:plan:<company>:<date>:<shift>:manual:<minute>` —
 * avtomatik reja yoki 'dead' ish kalitni band qilmaydi; reja tasdiq unique indeksi bilan idempotent.
 */
export async function runAttendancePlanNow(input: RunPlanNowInput): Promise<RunPlanNowResult> {
  const now = input.now || new Date();
  if (!input.companyId || !(await isAiActive(input.companyId))) return { ok: false, code: 'disabled' };
  const s = await getSettings(input.companyId);
  if (!s.attendance.enabled) return { ok: false, code: 'disabled' };
  const shift = s.attendance.shifts.find((x) => x.id === input.shiftId);
  if (!shift) return { ok: false, code: 'not_found' };
  const q = getSharedQueue();
  if (!q) return { ok: false, code: 'queue_unavailable' };
  const p = zonedParts(now);
  const date = localDate(now);
  const minute = `${date}T${p.hhmm}`;
  const r = await q.enqueue({
    type: JOBS.plan, companyId: input.companyId, runAt: now,
    dedupeKey: keys.planManual(input.companyId, date, shift.id, minute),
    payload: { shiftId: shift.id, date, manual: true, requestedBy: String(input.requestedBy || '') },
  });
  return { ok: true, jobId: r.id, duplicate: r.duplicate };
}
