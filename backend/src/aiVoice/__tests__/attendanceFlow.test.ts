// Davomat holat mashinasi (sof): barcha o'tishlar — ovozli javob holatni o'zgartirmaydi, tugma hech qachon
// checked_in qo'ymaydi, check-in hamma narsadan (absent'dan ham) ustun, opt-out, urinishlar chegarasi.
import { describe, it, expect } from 'vitest';
import {
  canContinueChain, decideNext, effectiveOrder, exhaustedStatus, firstDecision, mapSessionStatus, onButton, onCheckIn,
  onFinalize, onVoice, triesOn, type AttendanceStatus, type FlowAttempt, type LastResult, type StepConfig,
} from '../scheduler/attendanceFlow';

const NOW = new Date('2026-10-14T03:00:00Z');
const cfg: StepConfig = { maxAttemptsPerChannel: 2, backoffMin: [3, 10], buttonWaitMin: 10, busyRequeueMax: 5, busyRequeueDelaySec: 60, deferMax: 2 };
const ORDER = ['bot_message', 'telegram_call', 'inapp_call', 'push', 'notify_manager'] as const;
const ALL: AttendanceStatus[] = ['pending', 'confirmed', 'late', 'declined', 'no_answer', 'call_failed', 'checked_in', 'absent'];
const att = (channel: string, outcome: string, extra: Partial<FlowAttempt> = {}): FlowAttempt => ({ channel, attemptNo: 1, at: NOW, outcome, ...extra });
const last = (channel: string, outcome: LastResult['outcome'], extra: Partial<LastResult> = {}): LastResult => ({ channel, outcome, retryable: true, at: NOW, ...extra });
const decide = (attempts: FlowAttempt[], l: LastResult, extra: Partial<Parameters<typeof decideNext>[0]> = {}) =>
  decideNext({ attempts, last: l, order: [...ORDER], voiceAnswer: 'none', busyRequeues: 0, cfg, now: NOW, ...extra });
const min = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe('tugma (onButton)', () => {
  it.each([['confirm', 'confirmed'], ['late', 'late'], ['decline', 'declined']] as const)('pending + %s → %s', (answer, status) => {
    const t = onButton({ status: 'pending', buttonAnswer: 'none' }, answer);
    expect(t).toMatchObject({ ok: true, changed: true, status, buttonAnswer: answer, stopChain: true, notifyManager: answer === 'decline' });
  });
  it('tugma HECH QACHON checked_in qo\'ymaydi (har qanday boshlang\'ich holatda)', () => {
    for (const s of ALL) for (const a of ['confirm', 'late', 'decline'] as const) {
      const t = onButton({ status: s, buttonAnswer: 'none' }, a);
      if (t.ok && t.changed) expect(t.status).not.toBe('checked_in');
    }
  });
  it("kech javob: no_answer/call_failed'dan ham qabul qilinadi", () => {
    expect(onButton({ status: 'no_answer', buttonAnswer: 'none' }, 'confirm')).toMatchObject({ changed: true, status: 'confirmed' });
    expect(onButton({ status: 'call_failed', buttonAnswer: 'none' }, 'late')).toMatchObject({ changed: true, status: 'late' });
  });
  it('takroriy bosish — no-op (already)', () => {
    expect(onButton({ status: 'confirmed', buttonAnswer: 'confirm' }, 'decline')).toEqual({ ok: true, changed: false, status: 'confirmed' });
  });
  it("checked_in — tugma holatni o'zgartirmaydi", () => {
    expect(onButton({ status: 'checked_in', buttonAnswer: 'none' }, 'decline')).toEqual({ ok: true, changed: false, status: 'checked_in' });
  });
  it('yakunlangan / absent / muddati o\'tgan — rad', () => {
    expect(onButton({ status: 'pending', buttonAnswer: 'none', finalizedAt: NOW }, 'confirm')).toEqual({ ok: false, code: 'finalized' });
    expect(onButton({ status: 'absent', buttonAnswer: 'none' }, 'confirm')).toEqual({ ok: false, code: 'finalized' });
    expect(onButton({ status: 'pending', buttonAnswer: 'none' }, 'confirm', { expired: true })).toEqual({ ok: false, code: 'expired' });
  });
});

describe('ovozli javob (onVoice)', () => {
  it("faqat voiceAnswer yoziladi — holat 'pending' qoladi", () => {
    for (const a of ['coming', 'late', 'not_coming', 'unclear'] as const) {
      expect(onVoice({ status: 'pending', voiceAnswer: 'none' }, a)).toEqual({ changed: true, voiceAnswer: a, status: 'pending' });
    }
    expect(onVoice({ status: 'pending', voiceAnswer: 'coming' }, 'coming').changed).toBe(false);
  });
  it("checked_in/absent'da yozilmaydi", () => {
    expect(onVoice({ status: 'checked_in', voiceAnswer: 'none' }, 'coming').changed).toBe(false);
    expect(onVoice({ status: 'absent', voiceAnswer: 'none' }, 'coming').changed).toBe(false);
  });
});

describe('check-in va yakunlash', () => {
  it('check-in HAR holatdan ustun, shu jumladan absent', () => {
    for (const s of ALL) expect(onCheckIn({ status: s })).toEqual({ changed: s !== 'checked_in', status: 'checked_in' });
  });
  it("finalize: checked_in va declined qoladi, qolgani absent (confirmed/late ham — kelmagan)", () => {
    const exp: Record<AttendanceStatus, AttendanceStatus> = {
      pending: 'absent', confirmed: 'absent', late: 'absent', declined: 'declined', no_answer: 'absent', call_failed: 'absent', checked_in: 'checked_in', absent: 'absent',
    };
    for (const s of ALL) expect(onFinalize({ status: s })).toBe(exp[s]);
  });
  it('zanjir faqat pending va yakunlanmagan holatda davom etadi', () => {
    for (const s of ALL) expect(canContinueChain({ status: s })).toBe(s === 'pending');
    expect(canContinueChain({ status: 'pending', finalizedAt: NOW })).toBe(false);
  });
});

describe('kanal tartibi (effectiveOrder)', () => {
  const fallbackOrder = [...ORDER];
  it('standart — firma fallbackOrder', () => {
    expect(effectiveOrder({ fallbackOrder })).toEqual([...ORDER]);
  });
  it("xodim tartibi + o'chirilgan kanallar; notify_manager'ni xodim olib tashlay olmaydi", () => {
    expect(effectiveOrder({ fallbackOrder, prefs: { order: ['push', 'bot_message'], disabled: ['push', 'notify_manager'] } }))
      .toEqual(['bot_message', 'notify_manager']);
  });
  it("opt-out: calls → qo'ng'iroqsiz; all → hech narsa", () => {
    expect(effectiveOrder({ fallbackOrder, optOut: { calls: true } })).toEqual(['bot_message', 'push', 'notify_manager']);
    expect(effectiveOrder({ fallbackOrder, optOut: { all: true } })).toEqual([]);
  });
  it("jim soatlar — qo'ng'iroqlar chiqariladi; bot_only — faqat bot (C2)", () => {
    expect(effectiveOrder({ fallbackOrder, quiet: true })).toEqual(['bot_message', 'push', 'notify_manager']);
    expect(effectiveOrder({ fallbackOrder, planMode: 'bot_only' })).toEqual(['bot_message']);
  });
  it("noma'lum kanal nomlari tashlanadi", () => {
    expect(effectiveOrder({ fallbackOrder: ['bot_message'], prefs: { order: ['bot_message', 'sms', 'bot_message'] } })).toEqual(['bot_message']);
  });
});

describe('keyingi qadam (decideNext)', () => {
  it("birinchi qadam — tartibdagi birinchi kanal; bo'sh tartib — darhol no_answer", () => {
    expect(firstDecision([...ORDER], NOW)).toEqual({ kind: 'attempt', channel: 'bot_message', attemptNo: 1, runAt: NOW });
    expect(firstDecision([], NOW)).toEqual({ kind: 'exhausted', status: 'no_answer' });
  });
  it('bot yetkazildi → buttonWaitMin kutib keyingi kanal (eskalatsiya)', () => {
    const a = [att('bot_message', 'delivered')];
    expect(decide(a, last('bot_message', 'delivered'))).toEqual({ kind: 'attempt', channel: 'telegram_call', attemptNo: 1, runAt: min(10) });
  });
  it("javobsiz qo'ng'iroq → backoff bilan qayta, maxAttemptsPerChannel'dan keyin keyingi kanal", () => {
    let a = [att('bot_message', 'delivered'), att('telegram_call', 'no_answer')];
    expect(decide(a, last('telegram_call', 'no_answer'))).toEqual({ kind: 'attempt', channel: 'telegram_call', attemptNo: 2, runAt: min(3) });
    a = [...a, att('telegram_call', 'no_answer', { attemptNo: 2 })];
    expect(decide(a, last('telegram_call', 'no_answer'))).toEqual({ kind: 'attempt', channel: 'inapp_call', attemptNo: 1, runAt: NOW });
  });
  it("retryable failed — qayta; qayta urinib bo'lmaydigan failed / declined — keyingi", () => {
    const a = [att('telegram_call', 'failed')];
    expect(decide(a, last('telegram_call', 'failed', { retryable: true }))).toMatchObject({ channel: 'telegram_call', attemptNo: 2 });
    expect(decide(a, last('telegram_call', 'failed', { retryable: false }))).toMatchObject({ channel: 'inapp_call', attemptNo: 1 });
    expect(decide([att('telegram_call', 'declined')], last('telegram_call', 'declined'))).toMatchObject({ channel: 'inapp_call' });
  });
  it('bot 429 (failed + retryAt) — backoff va retry_after dan kechrog\'ida qayta', () => {
    const a = [att('bot_message', 'failed', { errorCode: 'rate_limited' })];
    expect(decide(a, last('bot_message', 'failed', { retryAt: new Date(NOW.getTime() + 30_000) }))).toMatchObject({ channel: 'bot_message', attemptNo: 2, runAt: min(3) });
    expect(decide(a, last('bot_message', 'failed', { retryAt: min(7) }))).toMatchObject({ channel: 'bot_message', attemptNo: 2, runAt: min(7) });
  });
  it('busy → +60 s shu kanal, chegara (5) dan keyin keyingi kanal', () => {
    const a = [att('telegram_call', 'busy')];
    expect(decide(a, last('telegram_call', 'busy'), { busyRequeues: 0 }))
      .toEqual({ kind: 'attempt', channel: 'telegram_call', attemptNo: 1, runAt: new Date(NOW.getTime() + 60_000), busyRequeue: true });
    expect(decide(a, last('telegram_call', 'busy'), { busyRequeues: 5 })).toMatchObject({ channel: 'inapp_call', attemptNo: 1 });
  });
  it('unavailable → keyingi; retryAt bilan — shu vaqtda qayta (deferMax gacha)', () => {
    expect(decide([att('telegram_call', 'unavailable')], last('telegram_call', 'unavailable'))).toMatchObject({ channel: 'inapp_call' });
    const retryAt = new Date(NOW.getTime() + 15_000);
    const one = [att('inapp_call', 'unavailable', { errorCode: 'deferred' })];
    expect(decide(one, last('inapp_call', 'unavailable', { retryAt }))).toEqual({ kind: 'attempt', channel: 'inapp_call', attemptNo: 1, runAt: retryAt });
    const three = [...one, ...one, ...one];
    expect(decide(three, last('inapp_call', 'unavailable', { retryAt }))).toMatchObject({ channel: 'push' });
  });
  it("javob berilgan qo'ng'iroq: kelaman/kechikaman → to'xtaydi; kelmayman → to'xtaydi (rahbarga); noaniq → kutib keyingi", () => {
    const a = [att('telegram_call', 'answered')];
    expect(decide(a, last('telegram_call', 'answered'), { voiceAnswer: 'coming' })).toEqual({ kind: 'stop', reason: 'voice_coming' });
    expect(decide(a, last('telegram_call', 'answered'), { voiceAnswer: 'late' })).toEqual({ kind: 'stop', reason: 'voice_coming' });
    expect(decide(a, last('telegram_call', 'answered'), { voiceAnswer: 'not_coming' })).toEqual({ kind: 'stop', reason: 'voice_not_coming' });
    expect(decide(a, last('telegram_call', 'answered'), { voiceAnswer: 'unclear' })).toEqual({ kind: 'attempt', channel: 'inapp_call', attemptNo: 1, runAt: min(10) });
  });
  it('rahbar xabaridan keyin — zanjir tugaydi: no_answer yoki call_failed', () => {
    const reached = [att('bot_message', 'delivered'), att('telegram_call', 'failed'), att('notify_manager', 'delivered')];
    expect(decide(reached, last('notify_manager', 'delivered'))).toEqual({ kind: 'exhausted', status: 'no_answer' });
    const techFail = [att('bot_message', 'unavailable'), att('telegram_call', 'failed'), att('telegram_call', 'failed'), att('notify_manager', 'delivered')];
    expect(decide(techFail, last('notify_manager', 'delivered'))).toEqual({ kind: 'exhausted', status: 'call_failed' });
  });
  it("urinishlar cheklangan: oxirgi kanal ham tugasa — exhausted (cheksiz aylanish yo'q)", () => {
    const order = ['telegram_call'] as any;
    let a: FlowAttempt[] = [];
    let decisions = 0;
    let d = firstDecision(order, NOW);
    while (d.kind === 'attempt' && decisions < 20) {
      a = [...a, att(d.channel, 'no_answer', { attemptNo: d.attemptNo })];
      d = decideNext({ attempts: a, last: last(d.channel, 'no_answer'), order, voiceAnswer: 'none', busyRequeues: 0, cfg, now: NOW });
      decisions++;
    }
    expect(d).toEqual({ kind: 'exhausted', status: 'no_answer' });
    expect(triesOn(a, 'telegram_call')).toBe(cfg.maxAttemptsPerChannel);
  });
  it('exhaustedStatus: qo\'ng\'iroq bo\'lmasa no_answer', () => {
    expect(exhaustedStatus([att('bot_message', 'delivered')])).toBe('no_answer');
    expect(exhaustedStatus([att('inapp_call', 'failed')])).toBe('call_failed');
    expect(exhaustedStatus([att('inapp_call', 'failed'), att('inapp_call', 'no_answer')])).toBe('no_answer');
  });
});

describe('mapSessionStatus', () => {
  it('sessiya holati → kanal natijasi', () => {
    expect(mapSessionStatus('completed', true)).toEqual({ outcome: 'answered', retryable: false });
    expect(mapSessionStatus('no_answer', false)).toEqual({ outcome: 'no_answer', retryable: true });
    expect(mapSessionStatus('busy', false).outcome).toBe('busy');
    expect(mapSessionStatus('declined', false).outcome).toBe('declined');
    expect(mapSessionStatus('failed', false)).toEqual({ outcome: 'failed', retryable: true });
    expect(mapSessionStatus('cancelled', false)).toEqual({ outcome: 'failed', retryable: false });
    expect(mapSessionStatus('interrupted', true).outcome).toBe('answered');
    expect(mapSessionStatus('interrupted', false)).toEqual({ outcome: 'failed', retryable: true });
  });
});
