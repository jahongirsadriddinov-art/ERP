// Osilgan sessiyalar tozalovchisi (review C4) va faol sessiyalardan olinadigan parallellik (B12, A6).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiCallSession from '../../models/AiCallSession';
import AiJob from '../../models/AiJob';
import AiCallEvent from '../../models/AiCallEvent';
import { LIMITS } from '../config';
import { newCorrelationId } from '../lib/ids';
import { registerAllHandlers } from '../queue/handlers';
import { JobQueue } from '../queue/jobQueue';
import { SESSION_SWEEP_JOB, sweepStaleSessions } from '../queue/sessionSweep';
import {
  aiEndSessionsForUser, countActiveSessions, finishSession, recordCallEvent, liveCapacity, onSessionsEnded, telegramCapacity, touchSession,
  type EndedSession,
} from '../sessions';
import { startMongo, stopMongo } from './helpers';

let mongo: MongoMemoryServer;
beforeAll(async () => { mongo = await startMongo(); }, 120_000);
afterAll(async () => { await stopMongo(mongo); });
beforeEach(async () => { await AiCallSession.deleteMany({}); await AiJob.deleteMany({}); });

const NOW = new Date('2026-10-14T03:30:00Z');
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);

async function mkSession(employeeId: string, opts: { updatedSecAgo: number; companyId?: string; channel?: 'telegram_call' | 'inapp_call'; maxDurationSec?: number; ringTimeoutSec?: number; answered?: boolean }) {
  const s = await AiCallSession.create({
    companyId: opts.companyId || 'c1', employeeId, correlationId: newCorrelationId(), purpose: 'attendance',
    channel: opts.channel || 'telegram_call', status: 'connected', isActive: true, attemptKey: `conf-${employeeId}:0:1`,
    limits: { maxDurationSec: opts.maxDurationSec ?? 120, ringTimeoutSec: opts.ringTimeoutSec ?? 45 },
  });
  // timestamps: true updatedAt'ni o'zi qo'yadi — to'g'ridan-to'g'ri kolleksiya orqali o'tmishga suramiz
  const set: Record<string, unknown> = { updatedAt: ago(opts.updatedSecAgo) };
  if (opts.answered) set.answeredAt = ago(opts.updatedSecAgo + 30);
  await AiCallSession.collection.updateOne({ _id: s._id }, { $set: set });
  return String(s._id);
}

describe('sweepStaleSessions', () => {
  let events: EndedSession[][] = [];
  let off: () => void;
  beforeEach(() => { events = []; off = onSessionsEnded((l) => { events.push(l); }); });
  afterEach(() => off());

  it("chegara: updatedAt < now − (maxDuration + ringTimeout + 60 s) bo'lsa 'interrupted'", async () => {
    const limit = 120 + 45 + LIMITS.sessionSweepGraceSec; // 225 s
    const stale = await mkSession('e-stale', { updatedSecAgo: limit + 1, answered: true });
    const edge = await mkSession('e-edge', { updatedSecAgo: limit - 1 });
    const fresh = await mkSession('e-fresh', { updatedSecAgo: 5 });
    const long = await mkSession('e-long', { updatedSecAgo: limit + 100, maxDurationSec: 600 }); // uzun qo'ng'iroq

    const ended = await sweepStaleSessions(NOW);
    expect(ended.map((e) => e.sessionId)).toEqual([stale]);
    expect(ended[0]).toMatchObject({ employeeId: 'e-stale', status: 'interrupted', reason: 'stale_sweep', attemptKey: 'conf-e-stale:0:1' });
    const s: any = await AiCallSession.findById(stale).lean();
    expect(s).toMatchObject({ isActive: false, status: 'interrupted', endReason: 'stale_sweep' });
    expect(s.endedAt.getTime()).toBe(NOW.getTime());
    expect(s.durationSec).toBe(30);
    for (const id of [edge, fresh, long]) expect((await AiCallSession.findById(id).lean() as any).isActive).toBe(true);
    // tinglovchilar (scheduler/socket) xabardor bo'ldi
    expect(events).toHaveLength(1);
    expect(events[0][0].sessionId).toBe(stale);
  });

  it("tozalangach xodim endi 'band' emas — yangi faol sessiya ochiladi (partial unique indeks)", async () => {
    await mkSession('e1', { updatedSecAgo: 3600 });
    await expect(AiCallSession.create({ companyId: 'c1', employeeId: 'e1', correlationId: newCorrelationId(), purpose: 'attendance', channel: 'inapp_call' }))
      .rejects.toMatchObject({ code: 11000 });
    await sweepStaleSessions(NOW);
    await AiCallSession.create({ companyId: 'c1', employeeId: 'e1', correlationId: newCorrelationId(), purpose: 'attendance', channel: 'inapp_call' });
    expect(await countActiveSessions()).toBe(1);
  });

  it('touchSession sessiyani tirik saqlaydi; qayta sweep — idempotent', async () => {
    const id = await mkSession('e2', { updatedSecAgo: 3600 });
    expect(await touchSession(id)).toBe(true);           // updatedAt = hozir (haqiqiy soat)
    expect(await sweepStaleSessions(new Date())).toHaveLength(0);
    const id2 = await mkSession('e3', { updatedSecAgo: 3600 });
    expect(await sweepStaleSessions(NOW)).toHaveLength(1);
    expect(await sweepStaleSessions(NOW)).toHaveLength(0);
    expect(await touchSession(id2)).toBe(false);          // yakunlangan sessiyani "tiriltirib" bo'lmaydi
  });

  it('parallel ikki instansiya sweep qilsa — har sessiya bir marta yakunlanadi', async () => {
    for (let i = 0; i < 10; i++) await mkSession(`p${i}`, { updatedSecAgo: 3600 });
    const [a, b] = await Promise.all([sweepStaleSessions(NOW), sweepStaleSessions(NOW)]);
    expect(a.length + b.length).toBe(10);
    expect(new Set([...a, ...b].map((e) => e.sessionId)).size).toBe(10);
  });
});

describe('session.sweep ishi navbatda', () => {
  it("registerAllHandlers uni ro'yxatga oladi va daqiqada bir marta qo'shadi", async () => {
    await mkSession('q1', { updatedSecAgo: 3600 });
    const q = new JobQueue({ instanceId: 'A', now: () => NOW, log: () => undefined });
    registerAllHandlers(q);
    expect(q.registeredTypes()).toContain(SESSION_SWEEP_JOB);
    await q.tick();
    for (let i = 0; i < 100 && q.isRunning(); i++) await new Promise((r) => setTimeout(r, 10));
    const jobs: any[] = await AiJob.find({ type: SESSION_SWEEP_JOB }).lean();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('done');
    expect(jobs[0].dedupeKey).toBe(`${SESSION_SWEEP_JOB}:2026-10-14T03:30:00.000Z`);
    expect(await countActiveSessions()).toBe(0);
  });
});

describe('finishSession (P5/P6 oddiy yakun → P3 runner tinglovchisi, C1)', () => {
  it('atomik: bir marta yakunlanadi, tinglovchi attemptKey bilan xabar oladi; takroriy voqea — null', async () => {
    const events: EndedSession[][] = [];
    const off = onSessionsEnded((l) => { events.push(l); });
    try {
      const id = await mkSession('f1', { updatedSecAgo: 1, answered: true });
      const [a, b] = await Promise.all([
        finishSession(id, 'completed', 'hangup', { usage: { tokensIn: 10, audioInSec: 3 }, summary: 'tel +998901234567' }),
        finishSession(id, 'completed', 'hangup'),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect((a || b)).toMatchObject({ sessionId: id, status: 'completed', attemptKey: 'conf-f1:0:1' });
      const s: any = await AiCallSession.findById(id).lean();
      expect(s).toMatchObject({ isActive: false, status: 'completed', endReason: 'hangup' });
      // Poygani qaysi chaqiruv yutishi tasodifiy: usage/summary faqat ularni bergan chaqiruv yutgan bo'lsa yoziladi
      if (a) {
        expect(s.usage.tokensIn).toBe(10);
        expect(s.summary).toContain('***67');
        expect(s.summary).not.toContain('901234567');
      } else {
        expect(s.usage?.tokensIn || 0).toBe(0);
      }
      expect(events).toHaveLength(1);
      expect(await finishSession(id, 'failed', 'late_event')).toBeNull();
      expect(await finishSession('not-an-id', 'failed', 'x')).toBeNull();
    } finally { off(); }
  });

  it('usage va summary (telefon maskalangan, sana saqlanadi) yoziladi', async () => {
    const id = await mkSession('f2', { updatedSecAgo: 1, answered: true });
    expect(await finishSession(id, 'completed', 'hangup', { usage: { tokensIn: 7 }, summary: '2026-10-15 09:00 da keladi, tel 901234567' })).not.toBeNull();
    const s: any = await AiCallSession.findById(id).lean();
    expect(s.usage.tokensIn).toBe(7);
    expect(s.summary).toBe('2026-10-15 09:00 da keladi, tel ***67');
  });
});

describe('aiEndSessionsForUser va sig\'im (hisoblagichsiz)', () => {
  it("blok/bekor qilish: yangi sessiya ham darhol 'interrupted'", async () => {
    await mkSession('blocked', { updatedSecAgo: 1 });
    expect(await aiEndSessionsForUser('blocked', 'revoked')).toBe(1);
    const s: any = await AiCallSession.findOne({ employeeId: 'blocked' }).lean();
    expect(s).toMatchObject({ isActive: false, status: 'interrupted', endReason: 'revoked' });
    expect(await aiEndSessionsForUser('blocked')).toBe(0);
  });

  it('platforma, firma va Telegram sig\'imi faol sessiyalarni sanashdan olinadi', async () => {
    const saved = { live: process.env.AI_LIVE_MAX_CONCURRENT, tg: process.env.AI_TG_MAX_CONCURRENT };
    process.env.AI_LIVE_MAX_CONCURRENT = '3';
    process.env.AI_TG_MAX_CONCURRENT = '1';
    try {
      expect(await liveCapacity('c1', 2)).toEqual({ ok: true });
      expect(await telegramCapacity()).toBe(true);
      await mkSession('a', { updatedSecAgo: 1, channel: 'telegram_call' });
      await mkSession('b', { updatedSecAgo: 1, channel: 'inapp_call' });
      expect(await telegramCapacity()).toBe(false);
      expect(await liveCapacity('c1', 2)).toEqual({ ok: false, reason: 'company_cap' });
      expect(await liveCapacity('c2', 2)).toEqual({ ok: true });
      await mkSession('c', { updatedSecAgo: 1, companyId: 'c2', channel: 'inapp_call' });
      expect(await liveCapacity('c3', 5)).toEqual({ ok: false, reason: 'platform_cap' });
      // jarayon "qulasa" — sweep sig'imni qaytaradi (oqib ketadigan hisoblagich yo'q)
      await AiCallSession.collection.updateMany({}, { $set: { updatedAt: ago(3600) } });
      await sweepStaleSessions(NOW);
      expect(await liveCapacity('c3', 5)).toEqual({ ok: true });
      expect(await telegramCapacity()).toBe(true);
    } finally {
      for (const [k, v] of [['AI_LIVE_MAX_CONCURRENT', saved.live], ['AI_TG_MAX_CONCURRENT', saved.tg]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});

describe('recordCallEvent', () => {
  it("data redaksiya qilinadi, expiresAt sozlamadan, takroriy seq e'tiborsiz", async () => {
    const at = new Date('2026-10-14T03:00:00Z');
    const base = { companyId: '64b7f0c2a1b2c3d4e5f60700', sessionId: 's1', correlationId: newCorrelationId(), type: 'transcript_in' as const, at };
    expect(await recordCallEvent({ ...base, seq: 1, data: { text: 'raqamim +998 90 123 45 67', token: 'sir' } })).toBe(true);
    expect(await recordCallEvent({ ...base, seq: 1, data: { text: 'takror' } })).toBe(false);
    const ev: any = await AiCallEvent.findOne({ sessionId: 's1', seq: 1 }).lean();
    expect(ev.data).toEqual({ text: 'raqamim ***67' });
    expect(ev.expiresAt.getTime()).toBe(at.getTime() + 30 * 86_400_000); // standart 30 kun
  });
});
