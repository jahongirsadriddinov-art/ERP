import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiCallSession from '../../models/AiCallSession';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import Attendance from '../../models/Attendance';
import User from '../../models/User';
import { LIMITS } from '../config';
import type { AiLang, AiSettingsData, AiShift, ChannelAttemptResult, ChannelCtx, ChannelName, ChannelRequest } from '../contracts';
import { getChannel } from '../channels/registry';
import type { JobQueue } from '../queue/jobQueue';
import { onSessionsEnded, type EndedSession } from '../sessions';
import { getSettings, isAiActive } from '../settings';
import { isHHmm, isWithinQuietHours, zonedToUtc } from '../lib/zonedTime';
import {
  canContinueChain, decideNext, effectiveOrder, firstDecision, isCallChannel, mapSessionStatus, PENDING_OUTCOMES,
  type FlowAttempt, type LastResult, type ManagerReason, type NextDecision, type StepConfig,
} from './attendanceFlow';
import { enqueueJob, JOBS, keys } from './jobTypes';
import { markCheckedIn } from './reconciler';
import { attendanceButtons, pickLang, tx } from './texts';

// Voqealarga asoslangan attendance qadamlari (review C1): HECH BIR ish qo'ng'iroq davomida lease ushlamaydi.
//  • attendance.step — tekshiruvlar (Attendance check-in, opt-out, AI holati, absentCutoff) → kanal
//    (FAQAT channels/registry orqali) → natija. Yuborishdan OLDIN 'dispatching' markeri yoziladi:
//    ish qulab qayta ishlasa — qayta TERILMAYDI, marker bo'yicha tiklanadi (attemptKey → AiCallSession).
//  • qo'ng'iroq: kanal awaitResponseUntil qaytaradi → natija sessions.onSessionsEnded (attendance.outcome)
//    yoki attendance.call_timeout (ring + maxDuration + 30 s) orqali keladi.
//  • har urinish natijasini YAGONA atomik CAS (dispatching/awaiting → natija) yakunlaydi — g'olib keyingi
//    qadamni qo'yadi (dedupe att:step:<conf>:<n>), shuning uchun ikki marta oldinga siljish bo'lmaydi.

export interface StepPayload { stepIndex: number; channel?: ChannelName; attemptNo?: number; busyRequeue?: boolean }

export const BUSY_REQUEUE_DELAY_SEC = 60;
const DEFER_MAX = 2;

export function stepConfig(s: AiSettingsData, shift?: AiShift): StepConfig {
  return {
    maxAttemptsPerChannel: s.calls.maxAttemptsPerChannel,
    backoffMin: s.calls.backoffMin,
    buttonWaitMin: shift?.buttonWaitMin ?? 10,
    busyRequeueMax: LIMITS.busyRequeueMax,
    busyRequeueDelaySec: BUSY_REQUEUE_DELAY_SEC,
    deferMax: DEFER_MAX,
  };
}

interface FlowCtx {
  settings: AiSettingsData;
  shift: AiShift;
  user: any;
  contact: any;
  lang: AiLang;
  name: string;
  order: ChannelName[];
}

async function loadFlowCtx(conf: any, now: Date): Promise<FlowCtx | null> {
  const settings = await getSettings(conf.companyId);
  const base = settings.attendance.shifts.find((s) => s.id === conf.shiftId);
  if (!base) return null;
  // Rejalashtirilgan paytdagi xodim vaqtlari (shaxsiy jadval, #5) — kun davomida barqaror
  const shift: AiShift = {
    ...base,
    ...(isHHmm(conf.workStart) ? { workStart: conf.workStart } : {}),
    ...(isHHmm(conf.absentCutoff) ? { absentCutoff: conf.absentCutoff } : {}),
  };
  const user: any = await User.findOne({ _id: conf.employeeId, companyId: conf.companyId })
    .select('firstName lastName language isBlocked').lean().catch(() => null);
  if (!user || user.isBlocked) return null;
  const contact: any = await AiEmployeeContact.findOne({ companyId: conf.companyId, employeeId: conf.employeeId }).lean();
  const lang = pickLang(contact?.languageOverride, user.language, settings.language);
  const order = effectiveOrder({
    fallbackOrder: settings.fallbackOrder,
    prefs: contact?.channelPrefs,
    optOut: contact?.optOut,
    planMode: conf.planMode,
    // Firma jim soatlari YOKI xodimning shaxsiy jim soatlari (/me) — qo'ng'iroq kanallari chiqariladi
    quiet: isWithinQuietHours(now, settings.calls.quietHours)
      || (!!contact?.quietHours?.from && !!contact?.quietHours?.to && isWithinQuietHours(now, contact.quietHours)),
  });
  return { settings, shift, user, contact, lang, name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim(), order };
}

const attemptKeyOf = (confId: string, step: number, attemptNo: number) => `${confId}:${step}:${attemptNo}`;

export function parseAttemptKey(k: string | undefined): { confId: string; stepIndex: number; attemptNo: number } | null {
  const m = /^([0-9a-fA-F]{24}):(\d+):(\d+)$/.exec(String(k || ''));
  return m ? { confId: m[1], stepIndex: Number(m[2]), attemptNo: Number(m[3]) } : null;
}

function channelCtx(conf: any, step: number, attemptNo: number, lang: AiLang, now: Date): ChannelCtx {
  const confId = String(conf._id);
  return {
    companyId: conf.companyId, employeeId: conf.employeeId, correlationId: conf.correlationId, purpose: 'attendance',
    lang, now, confirmationId: confId, stepIndex: step, attemptNo, attemptKey: attemptKeyOf(confId, step, attemptNo),
  };
}

function buildRequest(channel: ChannelName, conf: any, fc: FlowCtx): ChannelRequest {
  const t = tx(fc.lang);
  switch (channel) {
    case 'bot_message':
      return { kind: 'attendance', title: t.attTitle, text: t.attAsk(fc.name, fc.shift.workStart), buttons: attendanceButtons(fc.lang, conf.buttonToken), buttonToken: conf.buttonToken };
    case 'push':
      return { kind: 'attendance', title: t.attTitle, text: t.attPush(fc.shift.workStart) };
    case 'notify_manager':
      return { kind: 'manager_alert', title: t.mgrTitle, text: t.mgrNoAnswer(fc.name || '—'), urgency: 'high' };
    default:   // qo'ng'iroq kanallari
      return {
        kind: 'attendance', title: t.attTitle, buttonToken: conf.buttonToken,
        ringTimeoutSec: fc.settings.calls.ringTimeoutSec, maxDurationSec: fc.settings.calls.maxDurationSec,
      };
  }
}

// ───────────── Atomik yozuvlar ─────────────

/** Qadam M uchun urinish yozuvi (faqat bitta) — stepIndex va 'pending' holatiga CAS. */
async function pushAttempt(confId: string, step: number, a: Omit<FlowAttempt, 'stepIndex'> & { sessionId?: string; messageId?: string }): Promise<boolean> {
  const r = await AiAttendanceConfirmation.updateOne(
    { _id: confId, stepIndex: step, status: 'pending', finalizedAt: null, 'attempts.stepIndex': { $ne: step } },
    { $push: { attempts: { ...a, stepIndex: step } } },
  );
  return r.modifiedCount === 1;
}

/** Kutilayotgan (dispatching/awaiting) urinishni natija bilan yakunlaydi — g'olib yangilangan hujjatni oladi. */
async function settleAttempt(confId: string, step: number, set: { outcome: string; sessionId?: string; messageId?: string; errorCode?: string }): Promise<any | null> {
  const $set: Record<string, unknown> = { 'attempts.$.outcome': set.outcome };
  if (set.sessionId) $set['attempts.$.sessionId'] = set.sessionId;
  if (set.messageId) $set['attempts.$.messageId'] = set.messageId;
  if (set.errorCode) $set['attempts.$.errorCode'] = String(set.errorCode).slice(0, 120);
  return AiAttendanceConfirmation.findOneAndUpdate(
    { _id: confId, attempts: { $elemMatch: { stepIndex: step, outcome: { $in: PENDING_OUTCOMES } } } },
    { $set },
    { returnDocument: 'after' },
  ).lean();
}

// ───────────── Qadam ─────────────

/** attendance.step ishi. */
export async function runStep(q: JobQueue | null, confId: string, payload: StepPayload, now: Date): Promise<void> {
  const M = Math.max(0, Math.floor(Number(payload?.stepIndex) || 0));
  let conf: any = await AiAttendanceConfirmation.findById(confId).lean();
  if (!conf || !canContinueChain(conf)) return;
  if (conf.stepIndex > M) return;                                   // eskirgan ish
  if (conf.stepIndex < M) {
    // Oldingi qadam natijasi yozilgan, lekin stepIndex surilmay qolgan (advance o'rtasida qulash) — o'zimiz suramiz
    if (conf.stepIndex !== M - 1) return;
    const prev = (conf.attempts || []).find((a: any) => a.stepIndex === M - 1);
    if (!prev || PENDING_OUTCOMES.includes(prev.outcome)) return;
    const inc = payload.busyRequeue ? { $inc: { busyRequeues: 1 } } : {};
    await AiAttendanceConfirmation.updateOne({ _id: confId, stepIndex: M - 1 }, { $set: { stepIndex: M, nextActionAt: now }, ...inc });
    conf = await AiAttendanceConfirmation.findById(confId).lean();
    if (!conf || conf.stepIndex !== M || !canContinueChain(conf)) return;
  }

  const fc = await loadFlowCtx(conf, now);
  if (!fc) return;                                                  // smena o'chirilgan / xodim bloklangan
  if (now.getTime() >= zonedToUtc(conf.date, fc.shift.absentCutoff).getTime()) return;   // finalize hal qiladi

  const existing = (conf.attempts || []).find((a: any) => a.stepIndex === M);
  if (existing) { await recoverStep(q, conf, existing, now); return; }

  // C6: qadam oldi haqiqat tekshiruvi — check-in qilgan xodimga qo'ng'iroq qilinmaydi
  const att: any = await Attendance.findOne({ userId: conf.employeeId, date: conf.date, checkIn: { $exists: true, $nin: [null, ''] } })
    .select('_id checkIn').lean();
  if (att) { await markCheckedIn(confId, att, now, q); return; }
  if (fc.contact?.optOut?.all) {
    await pushAttempt(confId, M, { channel: payload.channel || 'none', attemptNo: 0, at: now, outcome: 'skipped', errorCode: 'opt_out' });
    await AiAttendanceConfirmation.updateOne({ _id: confId }, { $set: { nextActionAt: null } });
    return;
  }
  if (!(await isAiActive(conf.companyId))) return;                  // AI o'chirildi — jim to'xtaydi

  let channel = payload.channel;
  let attemptNo = payload.attemptNo || 1;
  if (!channel) {
    const d = firstDecision(fc.order, now);
    if (d.kind !== 'attempt') { await exhaust(q, confId, M, 'no_answer', conf); return; }
    channel = d.channel;
    attemptNo = d.attemptNo;
  }

  const adapter = getChannel(channel);
  const skip = async (outcome: 'skipped' | 'unavailable', errorCode: string, retryAt?: Date) => {
    if (!(await pushAttempt(confId, M, { channel: channel!, attemptNo, at: now, outcome, errorCode }))) return;
    await advance(q, confId, M, { channel: channel!, outcome, retryable: false, retryAt, at: now }, now);
  };
  if (!fc.order.includes(channel)) return skip('skipped', 'not_in_order');
  if (!adapter) return skip('skipped', 'no_adapter');

  const ctx = channelCtx(conf, M, attemptNo, fc.lang, now);
  let avail: { ok: boolean; reason?: string };
  try { avail = await adapter.isAvailable(ctx); } catch (e) { avail = { ok: false, reason: 'error' }; }
  if (!avail.ok) return skip('unavailable', String(avail.reason || 'unavailable').slice(0, 120));

  // Marker — qulashdan keyin shu urinish qayta terilmaydi
  if (!(await pushAttempt(confId, M, { channel, attemptNo, at: now, outcome: 'dispatching' }))) return;

  let res: ChannelAttemptResult;
  try {
    // Owner 2026-10-29: "davomatni bitta qilib emas, alohida qilib tashlayapti".
    // Rahbarga xabar shu yerda har bir xodim uchun ALOHIDA yuborilardi — botda
    // ketma-ket 5-10 ta bir xil xabar. Yig'ish mexanizmi (mgrBatch, 90 s oyna)
    // allaqachon bor edi, lekin eskalatsiya shu yo'ldan o'tmasdi. Endi o'tadi:
    // bir oynadagi barcha xodimlar BITTA ro'yxatli xabarda boradi.
    if (channel === 'notify_manager') {
      const queued = await notifyManagerOnce(confId, 'no_answer', now);
      res = queued ? { outcome: 'delivered', retryable: false } : { outcome: 'skipped', retryable: false };
    } else {
      res = await adapter.attempt(ctx, buildRequest(channel, conf, fc));
    }
  }
  catch (e) { res = { outcome: 'failed', retryable: true, errorCode: 'exception' }; console.error('[aiVoice/attendance] kanal xatosi:', (e as Error).message); }

  if (res.awaitResponseUntil) {
    // Qo'ng'iroq yuborildi — natija voqea bilan keladi; taymaut ishi zaxira
    const upd = await AiAttendanceConfirmation.updateOne(
      { _id: confId, attempts: { $elemMatch: { stepIndex: M, outcome: 'dispatching' } } },
      { $set: { 'attempts.$.outcome': 'awaiting', ...(res.sessionId ? { 'attempts.$.sessionId': res.sessionId } : {}), nextActionAt: res.awaitResponseUntil } },
    );
    if (upd.modifiedCount === 1) await scheduleCallTimeout(q, conf, M, new Date(res.awaitResponseUntil.getTime() + 30_000));
    return;
  }

  const deferred = res.outcome === 'unavailable' && !!res.retryAt;
  const settled = await settleAttempt(confId, M, {
    outcome: res.outcome, sessionId: res.sessionId, messageId: res.messageId,
    errorCode: deferred ? 'deferred' : res.errorCode,
  });
  if (!settled) return;
  await advance(q, confId, M, { channel, outcome: res.outcome, retryable: res.retryable, retryAt: res.retryAt, at: now }, now);
}

async function scheduleCallTimeout(q: JobQueue | null, conf: any, step: number, runAt: Date): Promise<void> {
  await enqueueJob(q, {
    type: JOBS.callTimeout, refId: String(conf._id), companyId: conf.companyId, employeeId: conf.employeeId,
    runAt, dedupeKey: keys.callTimeout(String(conf._id), step), payload: { stepIndex: step }, correlationId: conf.correlationId,
  });
}

/** Qulashdan keyin: qadam M uchun urinish allaqachon bor — qayta terilmaydi. */
async function recoverStep(q: JobQueue | null, conf: any, a: any, now: Date): Promise<void> {
  const confId = String(conf._id);
  const M = Number(a.stepIndex);
  if (a.outcome === 'dispatching') {
    if (isCallChannel(a.channel)) {
      const s: any = await AiCallSession.findOne({ attemptKey: attemptKeyOf(confId, M, a.attemptNo) })
        .select('_id isActive status answeredAt startedAt createdAt limits errorCode').lean();
      if (s?.isActive) {
        const upd = await AiAttendanceConfirmation.updateOne(
          { _id: confId, attempts: { $elemMatch: { stepIndex: M, outcome: 'dispatching' } } },
          { $set: { 'attempts.$.outcome': 'awaiting', 'attempts.$.sessionId': String(s._id) } },
        );
        if (upd.modifiedCount === 1) {
          const from = new Date(s.startedAt || s.createdAt || now).getTime();
          const ttl = ((s.limits?.ringTimeoutSec || 45) + (s.limits?.maxDurationSec || 120) + 30) * 1000;
          await scheduleCallTimeout(q, conf, M, new Date(Math.max(now.getTime(), from + ttl)));
        }
        return;
      }
      const mapped = s ? mapSessionStatus(s.status, !!s.answeredAt) : { outcome: 'failed' as const, retryable: true };
      const settled = await settleAttempt(confId, M, { outcome: mapped.outcome, sessionId: s ? String(s._id) : undefined, errorCode: s ? s.errorCode : 'dispatch_lost' });
      if (settled) await advance(q, confId, M, { channel: a.channel, outcome: mapped.outcome, retryable: mapped.retryable, at: now }, now);
      return;
    }
    // Kanal natijasi noma'lum (bot/push yuborilgan bo'lishi mumkin) — takrorlamaymiz, keyingisiga
    const settled = await settleAttempt(confId, M, { outcome: 'failed', errorCode: 'dispatch_unknown' });
    if (settled) await advance(q, confId, M, { channel: a.channel, outcome: 'failed', retryable: false, at: now }, now);
    return;
  }
  if (a.outcome === 'awaiting') {
    if (a.sessionId) {
      const s: any = await AiCallSession.findById(a.sessionId).select('startedAt createdAt limits').lean();
      const from = new Date(s?.startedAt || s?.createdAt || now).getTime();
      const ttl = ((s?.limits?.ringTimeoutSec || 45) + (s?.limits?.maxDurationSec || 120) + 30) * 1000;
      await scheduleCallTimeout(q, conf, M, new Date(Math.max(now.getTime(), from + ttl)));
    } else {
      await scheduleCallTimeout(q, conf, M, now);
    }
    return;
  }
  // Natija yozilgan, lekin keyingi qadam qo'yilmagan — davom ettiramiz (dedupe takrorni oldini oladi)
  await advance(q, confId, M, {
    channel: a.channel, outcome: a.outcome, retryable: a.outcome !== 'failed' || a.errorCode !== 'dispatch_unknown',
    retryAt: undefined, at: new Date(a.at || now),
  }, now);
}

// ───────────── Oldinga siljish ─────────────

/** Qadam M natijasidan keyingi qadamni qo'yadi (avval ish, keyin stepIndex CAS — qulash xavfsiz). */
export async function advance(q: JobQueue | null, confId: string, M: number, last: LastResult, now: Date): Promise<NextDecision | null> {
  const conf: any = await AiAttendanceConfirmation.findById(confId).lean();
  if (!conf || conf.stepIndex !== M || !canContinueChain(conf)) return null;
  if (last.channel === 'notify_manager' && last.outcome === 'delivered' && !conf.managerNotifiedAt) {
    await AiAttendanceConfirmation.updateOne({ _id: confId, managerNotifiedAt: null }, { $set: { managerNotifiedAt: now } });
  }
  const fc = await loadFlowCtx(conf, now);
  if (!fc) return null;
  if (isCallChannel(last.channel) && last.outcome === 'answered') {
    // Javob berilgan qo'ng'iroqdan keyin bot DOIM tasdiq tugmalarini yuboradi (design §5)
    await enqueueJob(q, {
      type: JOBS.buttons, refId: confId, companyId: conf.companyId, employeeId: conf.employeeId,
      dedupeKey: keys.buttons(confId, M), payload: { stepIndex: M }, correlationId: conf.correlationId, runAt: now,
    });
  }
  const d = decideNext({
    attempts: conf.attempts || [], last, order: fc.order, voiceAnswer: conf.voiceAnswer || 'none',
    busyRequeues: conf.busyRequeues || 0, cfg: stepConfig(fc.settings, fc.shift), now,
  });
  if (d.kind === 'attempt') {
    await enqueueJob(q, {
      type: JOBS.step, refId: confId, companyId: conf.companyId, employeeId: conf.employeeId, runAt: d.runAt,
      dedupeKey: keys.step(confId, M + 1), correlationId: conf.correlationId,
      payload: { stepIndex: M + 1, channel: d.channel, attemptNo: d.attemptNo, busyRequeue: !!d.busyRequeue } satisfies StepPayload,
    });
    const inc = d.busyRequeue ? { $inc: { busyRequeues: 1 } } : {};
    await AiAttendanceConfirmation.updateOne({ _id: confId, stepIndex: M }, { $set: { stepIndex: M + 1, nextActionAt: d.runAt }, ...inc });
  } else if (d.kind === 'stop') {
    await AiAttendanceConfirmation.updateOne({ _id: confId, stepIndex: M }, { $set: { stepIndex: M + 1, nextActionAt: null } });
    if (d.reason === 'voice_not_coming') await enqueueManager(q, conf, 'voice_not_coming', now);
  } else {
    await exhaust(q, confId, M, d.status, conf, now);
  }
  return d;
}

async function exhaust(q: JobQueue | null, confId: string, M: number, status: 'no_answer' | 'call_failed', conf: any, now: Date = new Date()): Promise<void> {
  const r = await AiAttendanceConfirmation.updateOne(
    { _id: confId, stepIndex: M, status: 'pending', finalizedAt: null },
    { $set: { status, nextActionAt: null } },
  );
  if (r.modifiedCount === 1) {
    const fresh: any = await AiAttendanceConfirmation.findById(confId).select('managerNotifiedAt').lean();
    if (!fresh?.managerNotifiedAt) await enqueueManager(q, conf, status, now);
  }
}

export async function enqueueManager(q: JobQueue | null, conf: any, reason: ManagerReason, now: Date): Promise<void> {
  await enqueueJob(q, {
    type: JOBS.manager, refId: String(conf._id), companyId: conf.companyId, employeeId: conf.employeeId,
    dedupeKey: keys.manager(String(conf._id)), payload: { reason }, correlationId: conf.correlationId, runAt: now,
  });
}

// ───────────── Qo'ng'iroq natijasi / taymaut ─────────────

/** attendance.outcome: sessiya yakunlandi (P5/P6 finishSession yoki sweep). */
export async function handleCallOutcome(q: JobQueue | null, sessionId: string, now: Date): Promise<void> {
  const s: any = await AiCallSession.findById(sessionId).select('isActive status answeredAt confirmationId attemptKey channel purpose errorCode').lean();
  if (!s || s.isActive || s.purpose !== 'attendance') return;
  const k = parseAttemptKey(s.attemptKey);
  if (!k) return;
  const mapped = mapSessionStatus(s.status, !!s.answeredAt);
  const settled = await settleAttempt(k.confId, k.stepIndex, { outcome: mapped.outcome, sessionId: String(s._id), errorCode: s.errorCode });
  if (!settled) return;                                             // allaqachon hal qilingan (taymaut yoki takroriy voqea)
  await advance(q, k.confId, k.stepIndex, { channel: s.channel, outcome: mapped.outcome, retryable: mapped.retryable, at: now }, now);
}

/** attendance.call_timeout: natija kelmadi — sessiya holatiga qarab yakunlash, zanjir davom etadi. */
export async function handleCallTimeout(q: JobQueue | null, confId: string, step: number, now: Date): Promise<void> {
  const conf: any = await AiAttendanceConfirmation.findById(confId).select('attempts').lean();
  const a = (conf?.attempts || []).find((x: any) => x.stepIndex === step);
  if (!a || !PENDING_OUTCOMES.includes(a.outcome)) return;
  const s: any = a.sessionId
    ? await AiCallSession.findById(a.sessionId).select('isActive status answeredAt errorCode').lean()
    : await AiCallSession.findOne({ attemptKey: attemptKeyOf(confId, step, a.attemptNo) }).select('isActive status answeredAt errorCode').lean();
  let mapped: { outcome: 'answered' | 'no_answer' | 'busy' | 'declined' | 'failed' | 'delivered' | 'unavailable' | 'skipped'; retryable: boolean };
  let errorCode: string | undefined;
  if (!s) { mapped = { outcome: 'failed', retryable: true }; errorCode = 'dispatch_lost'; }
  else if (s.isActive) { mapped = { outcome: 'no_answer', retryable: true }; errorCode = 'timeout'; }
  else { mapped = mapSessionStatus(s.status, !!s.answeredAt); errorCode = s.errorCode; }
  const settled = await settleAttempt(confId, step, { outcome: mapped.outcome, sessionId: s ? String(s._id) : undefined, errorCode });
  if (settled) await advance(q, confId, step, { channel: a.channel, outcome: mapped.outcome, retryable: mapped.retryable, at: now }, now);
}

// ───────────── Tugmalar / rahbar ─────────────

/** attendance.buttons: javob berilgan qo'ng'iroqdan keyin bot tugmalari. */
export async function sendAfterCallButtons(confId: string, now: Date): Promise<void> {
  const conf: any = await AiAttendanceConfirmation.findById(confId).lean();
  if (!conf || !canContinueChain(conf) || conf.buttonAnswer !== 'none') return;
  const fc = await loadFlowCtx(conf, now);
  const bot = getChannel('bot_message');
  if (!fc || !bot) return;
  const ctx: ChannelCtx = { companyId: conf.companyId, employeeId: conf.employeeId, correlationId: conf.correlationId, purpose: 'attendance', lang: fc.lang, now, confirmationId: confId, attemptNo: 1 };
  if (!(await bot.isAvailable(ctx).catch(() => ({ ok: false })))?.ok) return;
  const t = tx(fc.lang);
  await bot.attempt(ctx, { kind: 'attendance', title: t.attTitle, text: t.attAfterCall, buttons: attendanceButtons(fc.lang, conf.buttonToken), buttonToken: conf.buttonToken });
}

// Owner 2026-10-27: "hammaniki alohida kelyapti — bitta ro'yxat bo'lib kelsin".
// Xabarlar firma bo'yicha 90 soniya ichida yig'iladi va BITTA xabar bo'lib yuboriladi
// (20 ta xodim = 20 ta xabar emas, 1 ta ro'yxat). Yuborilgach, hammasi "xabar berildi" deb belgilanadi.
const BATCH_MS = 90_000;
const MAX_BATCH = 60;
interface BatchItem { confId: string; name: string; reason: ManagerReason; employeeId: string; correlationId?: string; lang: string }
const mgrBatch = new Map<string, { items: BatchItem[]; timer: NodeJS.Timeout | null }>();

async function flushManagerBatch(companyId: string): Promise<void> {
  const b = mgrBatch.get(companyId);
  if (!b || !b.items.length) return;
  mgrBatch.delete(companyId);
  if (b.timer) clearTimeout(b.timer);
  const items = b.items;
  const adapter = getChannel('notify_manager');
  if (!adapter) return;
  const lang = (items[0].lang === 'ru' ? 'ru' : 'uz') as AiLang;
  const t = tx(lang);
  const pick = (r: ManagerReason[]) => items.filter((i) => r.includes(i.reason)).map((i) => i.name);
  const noAnswer = pick(['no_answer', 'timeout'] as ManagerReason[]);
  const declined = pick(['declined', 'voice_not_coming'] as ManagerReason[]);
  const failed = pick(['call_failed'] as ManagerReason[]);
  const parts = [
    declined.length ? t.mgrBatchDeclined(declined) : '',
    noAnswer.length ? t.mgrBatchNoAnswer(noAnswer) : '',
    failed.length ? t.mgrBatchFailed(failed) : '',
  ].filter(Boolean);
  if (!parts.length) return;
  const now = new Date();
  const ctx: ChannelCtx = {
    companyId, employeeId: items[0].employeeId, correlationId: items[0].correlationId || '',
    purpose: 'attendance', lang, now, confirmationId: items[0].confId, attemptNo: 1,
  };
  if (!(await adapter.isAvailable(ctx).catch(() => ({ ok: false })))?.ok) return;
  const r = await adapter.attempt(ctx, { kind: 'manager_alert', title: t.mgrTitle, text: parts.join('\n'), urgency: 'high' });
  if (r.outcome !== 'delivered' && r.outcome !== 'answered') return;
  await AiAttendanceConfirmation.updateMany(
    { _id: { $in: items.map((i) => i.confId) }, managerNotifiedAt: null },
    { $set: { managerNotifiedAt: now } },
  );
}

/** attendance.manager: rahbar(lar)ga BIR marta xabar (faqat shu firma — managerChannel → lib/managers). */
export async function notifyManagerOnce(confId: string, reason: ManagerReason, now: Date): Promise<boolean> {
  const conf: any = await AiAttendanceConfirmation.findById(confId).lean();
  if (!conf || conf.managerNotifiedAt || conf.status === 'checked_in') return false;
  if (!(await isAiActive(conf.companyId))) return false;
  const adapter = getChannel('notify_manager');
  if (!adapter) return false;
  const settings = await getSettings(conf.companyId);
  const u: any = await User.findById(conf.employeeId).select('firstName lastName').lean().catch(() => null);
  const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || '—';
  const lang = pickLang(settings.language);
  const t = tx(lang);
  const text = reason === 'declined' || reason === 'voice_not_coming' ? t.mgrDeclined(name)
    : reason === 'call_failed' ? t.mgrCallFailed(name) : t.mgrNoAnswer(name);
  void text;   // yakka matn o'rniga — yig'ma ro'yxat (pastda)
  const cid = String(conf.companyId);
  let b = mgrBatch.get(cid);
  if (!b) { b = { items: [], timer: null }; mgrBatch.set(cid, b); }
  if (!b.items.some((i) => i.confId === String(confId))) {
    b.items.push({ confId: String(confId), name, reason, employeeId: String(conf.employeeId), correlationId: conf.correlationId, lang });
  }
  if (b.items.length >= MAX_BATCH) { void flushManagerBatch(cid); return true; }
  if (b.timer) clearTimeout(b.timer);
  b.timer = setTimeout(() => { void flushManagerBatch(cid); }, BATCH_MS);
  b.timer.unref?.();
  return true;
}

// ───────────── Sessiya tinglovchisi ─────────────
let listenerOff: (() => void) | null = null;

/** onSessionsEnded → attendance.outcome ishi (navbat bo'lmasa — shu yerda). Oxirgi ro'yxatga olingan navbat ishlatiladi. */
export function installSessionListener(q: JobQueue): void {
  listenerOff?.();
  listenerOff = onSessionsEnded(async (list: EndedSession[]) => {
    for (const s of list) {
      if (s.purpose !== 'attendance' || !parseAttemptKey(s.attemptKey)) continue;
      try {
        await q.enqueue({ type: JOBS.outcome, refId: s.confirmationId, companyId: s.companyId, employeeId: s.employeeId, dedupeKey: keys.outcome(s.sessionId), payload: { sessionId: s.sessionId }, runAt: q.now() });
      } catch (e) {
        console.error('[aiVoice/attendance] outcome ishi qo\'shilmadi:', (e as Error).message);
      }
    }
  });
}
