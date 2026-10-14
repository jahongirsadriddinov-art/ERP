// Scheduler testlari uchun soxta kanallar (faqat channels/registry orqali ulanadi), soxta soatli navbat va
// firma jadvali sozlash yordamchilari.
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiCallSession from '../../models/AiCallSession';
import type { AiShift, ChannelAttemptResult, ChannelCtx, ChannelName, ChannelRequest } from '../contracts';
import { clearChannels, registerChannel } from '../channels/registry';
import { newCorrelationId } from '../lib/ids';
import { JobQueue } from '../queue/jobQueue';
import { registerHandlers } from '../scheduler';
import { defaultShift, invalidateSettings } from '../settings';

export interface SentRecord { channel: ChannelName; ctx: ChannelCtx; req: ChannelRequest }

export interface FakeBehavior {
  available?: (ctx: ChannelCtx) => boolean | Promise<boolean>;
  attempt?: (ctx: ChannelCtx, req: ChannelRequest) => Promise<ChannelAttemptResult>;
}

export class FakeChannels {
  sent: SentRecord[] = [];
  dials = 0;
  behaviors: Partial<Record<ChannelName, FakeBehavior>> = {};

  register(names: ChannelName[]): void {
    for (const name of names) {
      registerChannel({
        name,
        isAvailable: async (ctx) => {
          const b = this.behaviors[name];
          const ok = b?.available ? await b.available(ctx) : true;
          return ok ? { ok: true } : { ok: false, reason: 'fake_unavailable' };
        },
        attempt: async (ctx, req) => {
          this.sent.push({ channel: name, ctx: { ...ctx }, req });
          const b = this.behaviors[name];
          if (b?.attempt) return b.attempt(ctx, req);
          return { outcome: 'delivered', retryable: false, messageId: String(this.sent.length) };
        },
      });
    }
  }

  of(name: ChannelName, employeeId?: string): SentRecord[] {
    return this.sent.filter((s) => s.channel === name && (!employeeId || s.ctx.employeeId === employeeId));
  }
}

/** P5/P6 o'rnini bosuvchi qo'ng'iroq: AiCallSession (attemptKey bilan) yaratadi va natijani keyin kutadi. */
export function fakeCallAttempt(fc: FakeChannels, channel: 'telegram_call' | 'inapp_call', now: () => Date, opts: { hang?: boolean } = {}) {
  return async (ctx: ChannelCtx, req: ChannelRequest): Promise<ChannelAttemptResult> => {
    let s: any;
    try {
      s = await AiCallSession.create({
        companyId: ctx.companyId, employeeId: ctx.employeeId, correlationId: newCorrelationId(), attemptKey: ctx.attemptKey,
        purpose: 'attendance', channel, status: 'ringing', isActive: true, confirmationId: ctx.confirmationId, attemptNo: ctx.attemptNo,
        startedAt: now(), limits: { ringTimeoutSec: req.ringTimeoutSec || 45, maxDurationSec: req.maxDurationSec || 120 },
      });
    } catch (e: any) {
      if (e?.code === 11000) return { outcome: 'busy', retryable: true, errorCode: 'busy' };
      throw e;
    }
    fc.dials++;
    if (opts.hang) await new Promise<never>(() => undefined);     // "qulash": natija hech qachon qaytmaydi
    const until = new Date(now().getTime() + ((req.ringTimeoutSec || 45) + (req.maxDurationSec || 120)) * 1000);
    return { outcome: 'delivered', retryable: false, sessionId: String(s._id), awaitResponseUntil: until };
  };
}

export function resetChannels(): void { clearChannels(); }

export class Clock {
  constructor(public t: Date) {}
  now = (): Date => this.t;
  set(d: Date | string): void { this.t = new Date(d); }
  addMin(n: number): void { this.t = new Date(this.t.getTime() + n * 60_000); }
  addSec(n: number): void { this.t = new Date(this.t.getTime() + n * 1000); }
}

export function mkQueue(clock: Clock, instanceId = 'test-A'): JobQueue {
  const q = new JobQueue({ instanceId, now: clock.now, log: () => undefined });
  registerHandlers(q);
  return q;
}

/** Bajarilishi kerak bo'lgan barcha ishlarni (runAt ≤ soat) ketma-ket bajaradi. */
export async function drain(q: JobQueue, max = 500): Promise<number> {
  let n = 0;
  while (n < max && (await q.runOnce())) n++;
  return n;
}

/** Firma davomatini yoqadi (bitta smena). */
export async function enableAttendance(companyId: string, shift: Partial<AiShift> = {}, extra: Record<string, unknown> = {}): Promise<AiShift> {
  const sh = { ...defaultShift('main'), ...shift };
  await AiAssistantSettings.updateOne({ companyId }, {
    $set: { enabled: true, 'attendance.enabled': true, 'attendance.shifts': [sh], ...extra },
    $setOnInsert: { companyId },
  }, { upsert: true });
  invalidateSettings(companyId);
  return sh;
}
