import type { AiAttendanceStatus } from '../../models/AiAttendanceConfirmation';
import type { AiCallStatus } from '../../models/AiCallSession';
import { CHANNEL_NAMES, type ChannelName, type ChannelOutcome } from '../contracts';

// Ertalabki davomat oqimi — SOF holat mashinasi (DB/vaqt yo'q; attendanceFlow.test.ts hamma o'tishlarni
// tekshiradi). Uchta alohida fakt (design D10):
//  • voiceAnswer — qo'ng'iroqdagi ovozli javob; holatni O'ZGARTIRMAYDI (pending qoladi);
//  • buttonAnswer — tugma/veb javobi → confirmed/late/declined; HECH QACHON checked_in emas;
//  • checked_in — FAQAT Attendance'dan (reconciler / qadam oldi tekshiruvi); har qanday holatdan,
//    shu jumladan 'absent'dan ham ustun (C6).
// Zanjir faqat 'pending' holatda va yakunlanmagan (finalizedAt yo'q) bo'lsa davom etadi.

export type AttendanceStatus = AiAttendanceStatus;
export type VoiceAnswer = 'none' | 'coming' | 'late' | 'not_coming' | 'unclear';
export type ButtonAnswer = 'none' | 'confirm' | 'late' | 'decline';
/** dispatching — kanalga yuborilmoqda (marker; qulashdan keyin qayta terilmaydi), awaiting — qo'ng'iroq natijasi kutilmoqda. */
export type AttemptOutcome = ChannelOutcome | 'dispatching' | 'awaiting';

export interface FlowAttempt {
  channel: string;
  attemptNo: number;
  stepIndex?: number;
  at: Date;
  outcome: string;
  errorCode?: string;
}

export const CALL_CHANNELS: ChannelName[] = ['telegram_call', 'inapp_call'];
export const isCallChannel = (c: string): boolean => (CALL_CHANNELS as string[]).includes(c);
export const PENDING_OUTCOMES = ['dispatching', 'awaiting'];

/** Zanjir davom eta oladimi. */
export function canContinueChain(s: { status: AttendanceStatus; finalizedAt?: Date | null }): boolean {
  return s.status === 'pending' && !s.finalizedAt;
}

// ───────────── Tugma / veb javobi ─────────────
const BUTTON_STATUS: Record<Exclude<ButtonAnswer, 'none'>, AttendanceStatus> = { confirm: 'confirmed', late: 'late', decline: 'declined' };
/** Tugma javobi qabul qilinadigan holatlar (javob yo'qligi qayd etilgandan keyin ham kech javob qabul qilinadi). */
export const BUTTON_FROM: AttendanceStatus[] = ['pending', 'no_answer', 'call_failed'];

export type ButtonTransition =
  | { ok: true; changed: true; status: AttendanceStatus; buttonAnswer: Exclude<ButtonAnswer, 'none'>; notifyManager: boolean; stopChain: true }
  | { ok: true; changed: false; status: AttendanceStatus }
  | { ok: false; code: 'finalized' | 'expired' };

export function onButton(
  s: { status: AttendanceStatus; buttonAnswer: ButtonAnswer; finalizedAt?: Date | null },
  answer: Exclude<ButtonAnswer, 'none'>,
  opts: { expired?: boolean } = {},
): ButtonTransition {
  if (s.status === 'checked_in') return { ok: true, changed: false, status: s.status };    // haqiqiy kelish — ustun
  if (s.buttonAnswer !== 'none') return { ok: true, changed: false, status: s.status };    // takroriy bosish — no-op
  if (s.finalizedAt || s.status === 'absent') return { ok: false, code: 'finalized' };
  if (opts.expired) return { ok: false, code: 'expired' };
  if (!BUTTON_FROM.includes(s.status)) return { ok: true, changed: false, status: s.status };
  const status = BUTTON_STATUS[answer];
  return { ok: true, changed: true, status, buttonAnswer: answer, notifyManager: answer === 'decline', stopChain: true };
}

// ───────────── Ovozli javob ─────────────
/** Ovozli javob faqat voiceAnswer'ni yozadi; holat o'zgarmaydi (tugma kutiladi). */
export function onVoice(s: { status: AttendanceStatus; voiceAnswer: VoiceAnswer }, answer: Exclude<VoiceAnswer, 'none'>):
  { changed: boolean; voiceAnswer: VoiceAnswer; status: AttendanceStatus } {
  if (s.status === 'checked_in' || s.status === 'absent') return { changed: false, voiceAnswer: s.voiceAnswer, status: s.status };
  return { changed: s.voiceAnswer !== answer, voiceAnswer: answer, status: s.status };
}

// ───────────── Haqiqiy check-in ─────────────
/** Attendance.checkIn topildi — har doim checked_in (absent'dan ham ustun). */
export function onCheckIn(s: { status: AttendanceStatus }): { changed: boolean; status: 'checked_in' } {
  return { changed: s.status !== 'checked_in', status: 'checked_in' };
}

// ───────────── Yakunlash (absentCutoff) ─────────────
/** checked_in va declined o'z holicha qoladi; qolgan hammasi (confirmed/late ham — kelmagan) → absent. */
export function onFinalize(s: { status: AttendanceStatus }): AttendanceStatus {
  return s.status === 'checked_in' || s.status === 'declined' ? s.status : 'absent';
}

// ───────────── Kanal tartibi ─────────────
export interface OrderInput {
  fallbackOrder: ChannelName[];
  prefs?: { order?: string[] | null; disabled?: string[] | null } | null;
  optOut?: { calls?: boolean; all?: boolean } | null;
  planMode?: 'full' | 'bot_only';
  /** Jim soatlar — qo'ng'iroq kanallari chiqariladi. */
  quiet?: boolean;
}

/**
 * Samarali tartib: xodim tartibi ?? firma fallbackOrder; xodim o'chirgan kanallar va opt-out (calls)
 * chiqariladi. notify_manager'ni xodim olib tashlay olmaydi (firma tartibida bo'lsa — oxiriga qo'shiladi).
 * bot_only (C2: maxLateMin'dan kech) — faqat bot xabari.
 */
export function effectiveOrder(i: OrderInput): ChannelName[] {
  const valid = (c: unknown): c is ChannelName => (CHANNEL_NAMES as unknown[]).includes(c);
  if (i.optOut?.all) return [];
  const base = (i.prefs?.order && i.prefs.order.length ? i.prefs.order : i.fallbackOrder).filter(valid);
  const disabled = new Set((i.prefs?.disabled || []).filter((c) => c !== 'notify_manager'));
  let out = [...new Set(base)].filter((c) => !disabled.has(c));
  if (i.fallbackOrder.includes('notify_manager')) {
    out = out.filter((c) => c !== 'notify_manager');
    out.push('notify_manager');
  }
  if (i.optOut?.calls || i.quiet) out = out.filter((c) => !isCallChannel(c));
  if (i.planMode === 'bot_only') out = out.filter((c) => c === 'bot_message');
  return out;
}

// ───────────── Keyingi qadam ─────────────
export interface StepConfig {
  maxAttemptsPerChannel: number;
  backoffMin: number[];
  buttonWaitMin: number;
  busyRequeueMax: number;
  busyRequeueDelaySec: number;
  /** "Boshqa instansiya" kabi retryAt kechiktirishlari — bir kanalga necha marta. */
  deferMax: number;
}

export interface LastResult {
  channel: string;
  outcome: ChannelOutcome;
  retryable: boolean;
  retryAt?: Date;
  at: Date;
}

export type NextDecision =
  | { kind: 'attempt'; channel: ChannelName; attemptNo: number; runAt: Date; busyRequeue?: boolean }
  | { kind: 'stop'; reason: 'voice_coming' | 'voice_not_coming' }
  | { kind: 'exhausted'; status: 'no_answer' | 'call_failed' };

/** Haqiqiy urinish deb hisoblanadiganlar (busy / unavailable / skipped — hisoblanmaydi). */
const COUNTED: string[] = ['answered', 'delivered', 'no_answer', 'declined', 'failed'];

export function triesOn(attempts: FlowAttempt[], channel: string): number {
  return attempts.filter((a) => a.channel === channel && COUNTED.includes(a.outcome)).length;
}

const deferredOn = (attempts: FlowAttempt[], channel: string) =>
  attempts.filter((a) => a.channel === channel && a.outcome === 'unavailable' && a.errorCode === 'deferred').length;

const addMin = (d: Date, min: number) => new Date(d.getTime() + Math.max(0, min) * 60_000);

/** Birinchi qadam. */
export function firstDecision(order: ChannelName[], now: Date): NextDecision {
  if (!order.length) return { kind: 'exhausted', status: 'no_answer' };
  return { kind: 'attempt', channel: order[0], attemptNo: 1, runAt: now };
}

/**
 * Zanjir oxiri holati: hech kim javob bermadi → no_answer; agar qo'ng'iroq urinishlari bo'lib, ularning
 * HAMMASI texnik xato bilan tugagan va boshqa hech bir kanal (rahbardan tashqari) yetkazmagan bo'lsa → call_failed.
 */
export function exhaustedStatus(attempts: FlowAttempt[]): 'no_answer' | 'call_failed' {
  const calls = attempts.filter((a) => isCallChannel(a.channel) && COUNTED.includes(a.outcome));
  if (!calls.length || !calls.every((a) => a.outcome === 'failed')) return 'no_answer';
  const reached = attempts.some((a) => a.channel !== 'notify_manager' && (a.outcome === 'delivered' || a.outcome === 'answered'));
  return reached ? 'no_answer' : 'call_failed';
}

/**
 * Oxirgi natijadan keyingi qaror (C1: voqealar bilan zanjirlanadi). attempts — oxirgi natija HAM ichida.
 *  • busy → shu kanal +busyRequeueDelaySec (busyRequeueMax gacha), keyin keyingi kanal;
 *  • unavailable + retryAt (boshqa instansiya, 429) → shu vaqtda qayta (deferMax gacha);
 *  • unavailable/skipped → darhol keyingi kanal;
 *  • no_answer / retryable failed → shu kanal backoffMin bilan maxAttemptsPerChannel gacha;
 *  • declined (qo'ng'iroq rad etildi) / qayta urinib bo'lmaydigan xato → keyingi kanal;
 *  • delivered (bot/push) → buttonWaitMin kutib keyingi kanal (tugma bosilsa oqim to'xtaydi);
 *  • answered (qo'ng'iroq) → ovozli javob "kelaman/kechikaman" bo'lsa zanjir to'xtaydi (tugmalar yuborilgan);
 *    "kelmayman" — to'xtaydi va rahbarga xabar; noaniq — buttonWaitMin kutib keyingi kanal;
 *  • notify_manager → darhol keyingi (odatda zanjir oxiri).
 */
export function decideNext(p: {
  attempts: FlowAttempt[];
  last: LastResult;
  order: ChannelName[];
  voiceAnswer: VoiceAnswer;
  busyRequeues: number;
  cfg: StepConfig;
  now: Date;
}): NextDecision {
  const { attempts, last, order, cfg, now } = p;
  const ch = last.channel;
  const idx = order.indexOf(ch as ChannelName);

  const moveOn = (at: Date): NextDecision => {
    // Kanal tartibda bo'lmasa (sozlama o'zgargan) — hali urinilmagan birinchisiga
    const next = idx >= 0 ? order[idx + 1] : order.find((c) => !attempts.some((a) => a.channel === c));
    if (!next) return { kind: 'exhausted', status: exhaustedStatus(attempts) };
    return { kind: 'attempt', channel: next, attemptNo: triesOn(attempts, next) + 1, runAt: at };
  };
  const retrySame = (at: Date, extra: Partial<{ busyRequeue: boolean }> = {}): NextDecision =>
    idx >= 0
      ? { kind: 'attempt', channel: ch as ChannelName, attemptNo: triesOn(attempts, ch) + 1, runAt: at, ...extra }
      : moveOn(now);

  if (ch === 'notify_manager') return moveOn(now);

  switch (last.outcome) {
    case 'busy':
      return p.busyRequeues < cfg.busyRequeueMax
        ? retrySame(new Date(now.getTime() + cfg.busyRequeueDelaySec * 1000), { busyRequeue: true })
        : moveOn(now);
    case 'unavailable':
      if (last.retryAt && last.retryAt.getTime() > now.getTime() && deferredOn(attempts, ch) <= cfg.deferMax) {
        return retrySame(last.retryAt);
      }
      return moveOn(now);
    case 'skipped':
      return moveOn(now);
    case 'no_answer':
    case 'failed': {
      if (last.outcome === 'failed' && !last.retryable) return moveOn(now);
      const tries = triesOn(attempts, ch);
      if (tries < cfg.maxAttemptsPerChannel) {
        const wait = cfg.backoffMin[Math.min(tries - 1, cfg.backoffMin.length - 1)] ?? 3;
        const at = addMin(now, wait);
        // Telegram 429 retry_after backoff'dan uzoq bo'lsa — undan oldin qayta urinilmaydi
        return retrySame(last.retryAt && last.retryAt.getTime() > at.getTime() ? last.retryAt : at);
      }
      return moveOn(now);
    }
    case 'declined':
      return moveOn(now);
    case 'delivered':
      return moveOn(addMin(last.at, cfg.buttonWaitMin));
    case 'answered':
      if (p.voiceAnswer === 'coming' || p.voiceAnswer === 'late') return { kind: 'stop', reason: 'voice_coming' };
      if (p.voiceAnswer === 'not_coming') return { kind: 'stop', reason: 'voice_not_coming' };
      return moveOn(addMin(last.at, cfg.buttonWaitMin));
    default:
      return moveOn(now);
  }
}

// ───────────── Qo'ng'iroq sessiyasi natijasi → kanal natijasi ─────────────
export function mapSessionStatus(status: AiCallStatus, answered: boolean): { outcome: ChannelOutcome; retryable: boolean } {
  switch (status) {
    case 'completed': return { outcome: 'answered', retryable: false };
    case 'no_answer': return { outcome: 'no_answer', retryable: true };
    case 'busy': return { outcome: 'busy', retryable: true };
    case 'declined': return { outcome: 'declined', retryable: false };
    case 'cancelled': return { outcome: 'failed', retryable: false };
    case 'interrupted': return answered ? { outcome: 'answered', retryable: false } : { outcome: 'failed', retryable: true };
    case 'failed': return { outcome: 'failed', retryable: true };
    default: return { outcome: 'failed', retryable: true };   // hali yakunlanmagan (taymaut yo'li)
  }
}

/** Rahbarga xabar sababi. */
export type ManagerReason = 'declined' | 'voice_not_coming' | 'no_answer' | 'call_failed';
