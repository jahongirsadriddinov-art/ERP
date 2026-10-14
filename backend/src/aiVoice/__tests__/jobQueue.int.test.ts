// Mongo ish navbati: bir martalik claim, lease muddati, backoff, dead-letter, terminal TTL,
// requires:'worker' filtri, drain, davriy ishlar dedupe (design D8, review C1/C3/C5).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiJob from '../../models/AiJob';
import { LIMITS } from '../config';
import { backoffMs, JobQueue, NonRetryableJobError } from '../queue/jobQueue';
import { startMongo, stopMongo } from './helpers';

let mongo: MongoMemoryServer;
beforeAll(async () => { mongo = await startMongo(); }, 120_000);
afterAll(async () => { await stopMongo(mongo); });
beforeEach(async () => { await AiJob.deleteMany({}); });

const quiet = () => undefined;
const mkQueue = (instanceId: string, extra: Partial<ConstructorParameters<typeof JobQueue>[0]> = {}) =>
  new JobQueue({ instanceId, log: quiet, ...extra });
const job = async (id: string): Promise<any> => AiJob.findById(id).lean();

describe('claim', () => {
  it('ikki instansiya parallel olganda har bir ish AYNAN bir marta olinadi', async () => {
    const A = mkQueue('A'), B = mkQueue('B');
    for (const q of [A, B]) q.register('t', async () => undefined, { concurrency: 1000 });
    for (let i = 0; i < 30; i++) await A.enqueue({ type: 't', payload: { i } });
    const claimed: string[] = [];
    const worker = async (q: JobQueue) => {
      for (;;) { const j = await q.claim(); if (!j) return; claimed.push(String(j._id)); }
    };
    await Promise.all([worker(A), worker(B), worker(A), worker(B)]);
    expect(claimed).toHaveLength(30);
    expect(new Set(claimed).size).toBe(30);
    const owners = await AiJob.distinct('leaseOwner');
    expect(owners.every((o: string) => o === 'A' || o === 'B')).toBe(true);
  });

  it("vaqti kelmagan ish olinmaydi; ustuvorlik bo'yicha tartib", async () => {
    const q = mkQueue('A');
    q.register('t', async () => undefined, { concurrency: 10 });
    await q.enqueue({ type: 't', runAt: new Date(Date.now() + 60_000) });
    const low = await q.enqueue({ type: 't', priority: 0 });
    const high = await q.enqueue({ type: 't', priority: 5 });
    expect(String((await q.claim())!._id)).toBe(high.id);
    expect(String((await q.claim())!._id)).toBe(low.id);
    expect(await q.claim()).toBeNull();
  });

  it("ro'yxatdan o'tmagan tur va tur bo'yicha concurrency hurmat qilinadi", async () => {
    const q = mkQueue('A');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    q.register('slow', async () => { await gate; }, { concurrency: 1 });
    await q.enqueue({ type: 'other' });
    await q.enqueue({ type: 'slow' });
    await q.enqueue({ type: 'slow' });
    const first = (await q.claim())!;
    expect(first.type).toBe('slow');
    const running = q.execute(first);
    expect(await q.claim()).toBeNull(); // slow band, other ro'yxatda yo'q
    release();
    await running;
    expect((await q.claim())!.type).toBe('slow');
  });

  it("requires:'worker' — faqat worker ulangan instansiya oladi (C3)", async () => {
    let attached = false;
    const noWorker = mkQueue('A');
    const withWorker = mkQueue('B', { hasWorker: () => attached });
    for (const q of [noWorker, withWorker]) q.register('call.place', async () => undefined);
    const w = await noWorker.enqueue({ type: 'call.place', requires: 'worker' });
    expect(await noWorker.claim()).toBeNull();
    expect(await withWorker.claim()).toBeNull(); // worker hali ulanmagan
    attached = true;
    const j = await withWorker.claim();
    expect(String(j!._id)).toBe(w.id);
    // oddiy ishlarni har ikkalasi oladi
    await noWorker.enqueue({ type: 'call.place' });
    expect(await noWorker.claim()).not.toBeNull();
  });
});

describe('natijalar, backoff, dead-letter va TTL', () => {
  it('muvaffaqiyat — done + expiresAt (7 kun)', async () => {
    const q = mkQueue('A');
    let ran = 0;
    q.register('t', async () => { ran++; });
    const { id } = await q.enqueue({ type: 't' });
    expect(await q.runOnce()).toBe(true);
    const d = await job(id);
    expect(ran).toBe(1);
    expect(d.status).toBe('done');
    expect(d.leaseOwner).toBeNull();
    expect(d.expiresAt.getTime() - d.finishedAt.getTime()).toBe(LIMITS.jobDoneTtlMs);
  });

  it("davriy ish uchun qisqa doneTtlMs (minutlik tick'lar 7 kun yig'ilmaydi); davr ichida DB'ga qayta urilmaydi", async () => {
    const now = new Date('2026-10-13T03:00:30Z');
    const q = mkQueue('A', { now: () => now });
    q.register('tick', async () => undefined, { doneTtlMs: 3600_000 });
    q.scheduleRecurring('tick', 60_000);
    await q.tick();
    for (let i = 0; i < 50 && q.isRunning(); i++) await new Promise((r) => setTimeout(r, 10));
    const d: any = await AiJob.findOne({ type: 'tick' }).lean();
    expect(d.status).toBe('done');
    expect(d.expiresAt.getTime() - d.finishedAt.getTime()).toBe(3600_000);
    const spy = vi.spyOn(AiJob, 'create');
    try { await q.tick(); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
  });

  it('xato — backoff bilan qayta navbat, attempts tugaganda dead (+expiresAt)', async () => {
    let now = new Date('2026-10-13T03:00:00Z');
    const q = mkQueue('A', { now: () => now });
    q.register('t', async () => { throw new Error('vaqtinchalik'); }, { maxAttempts: 2, backoffBaseMs: 10_000, backoffCapMs: 60_000 });
    const { id } = await q.enqueue({ type: 't' });
    await q.runOnce();
    let d = await job(id);
    expect(d.status).toBe('queued');
    expect(d.attempts).toBe(1);
    expect(d.lastError).toBe('vaqtinchalik');
    const delay = d.runAt.getTime() - now.getTime();
    expect(delay).toBeGreaterThanOrEqual(8_000);
    expect(delay).toBeLessThanOrEqual(12_000);
    expect(d.expiresAt).toBeNull();
    // vaqt kelmaguncha olinmaydi
    expect(await q.runOnce()).toBe(false);
    now = new Date(d.runAt.getTime() + 1);
    await q.runOnce();
    d = await job(id);
    expect(d.status).toBe('dead');
    expect(d.attempts).toBe(2);
    expect(d.expiresAt.getTime()).toBe(now.getTime() + LIMITS.jobFailedTtlMs);
  });

  it('NonRetryableJobError — darhol failed (+expiresAt)', async () => {
    const q = mkQueue('A');
    q.register('t', async () => { throw new NonRetryableJobError('yaroqsiz'); });
    const { id } = await q.enqueue({ type: 't' });
    await q.runOnce();
    const d = await job(id);
    expect(d.status).toBe('failed');
    expect(d.attempts).toBe(1);
    expect(d.expiresAt).toBeInstanceOf(Date);
  });

  it('handler yo\'q ish (boshqa versiyadan) — failed', async () => {
    const q = mkQueue('A');
    q.register('t', async () => undefined);
    const { id } = await q.enqueue({ type: 't' });
    const j = (await q.claim())!;
    await q.execute({ ...j, type: 'missing' } as any);
    expect((await job(id)).status).toBe('failed');
  });

  it('backoffMs: eksponensial, cap, ±20% jitter', () => {
    expect(backoffMs(1, 1000, 60_000, () => 0.5)).toBe(1000);
    expect(backoffMs(3, 1000, 60_000, () => 0.5)).toBe(4000);
    expect(backoffMs(20, 1000, 60_000, () => 0.5)).toBe(60_000);
    expect(backoffMs(3, 1000, 60_000, () => 0)).toBe(3200);
    expect(backoffMs(3, 1000, 60_000, () => 1)).toBe(4800);
  });

  it('cancel — faqat navbatdagilar, expiresAt bilan', async () => {
    const q = mkQueue('A');
    q.register('t', async () => undefined);
    const a = await q.enqueue({ type: 't', refId: 'r1' });
    await q.enqueue({ type: 't', refId: 'r2' });
    expect(await q.cancel({ refId: 'r1' })).toBe(1);
    const d = await job(a.id);
    expect(d.status).toBe('cancelled');
    expect(d.expiresAt).toBeInstanceOf(Date);
  });
});

describe('lease muddati (crash)', () => {
  it('lease tugagach ish qayta navbatga qaytadi, attempts tugagan bo\'lsa dead', async () => {
    let now = new Date('2026-10-13T03:00:00Z');
    const A = mkQueue('A', { now: () => now });
    A.register('t', async () => undefined, { maxAttempts: 2 });
    const { id } = await A.enqueue({ type: 't' });
    await A.claim(); // A "qulab tushdi" — bajarmadi
    // lease hali amal qiladi — tegilmaydi
    expect(await A.sweepExpired()).toEqual({ requeued: 0, dead: 0 });
    now = new Date(now.getTime() + LIMITS.jobLeaseMs + 1);
    expect(await A.sweepExpired()).toEqual({ requeued: 1, dead: 0 });
    let d = await job(id);
    expect(d.status).toBe('queued');
    expect(d.leaseOwner).toBeNull();
    // ikkinchi instansiya oladi va u ham qulaydi — endi attempts=max → dead
    const B = mkQueue('B', { now: () => now });
    B.register('t', async () => undefined, { maxAttempts: 2 });
    expect(String((await B.claim())!._id)).toBe(id);
    now = new Date(now.getTime() + LIMITS.jobLeaseMs + 1);
    expect(await B.sweepExpired()).toEqual({ requeued: 0, dead: 1 });
    d = await job(id);
    expect(d.status).toBe('dead');
    expect(d.lastError).toBe('lease_expired');
    expect(d.expiresAt).toBeInstanceOf(Date);
  });

  it('heartbeat lease\'ni uzaytiradi; boshqa egasi olgan bo\'lsa false', async () => {
    let now = new Date('2026-10-13T03:00:00Z');
    const q = mkQueue('A', { now: () => now });
    q.register('t', async () => undefined, { leaseMs: 30_000 });
    await q.enqueue({ type: 't' });
    const j = (await q.claim())!;
    expect(new Date(j.leaseUntil!).getTime()).toBe(now.getTime() + 30_000);
    now = new Date(now.getTime() + 20_000);
    expect(await q.heartbeat(j)).toBe(true);
    expect((await job(String(j._id))).leaseUntil.getTime()).toBe(now.getTime() + 30_000);
    await AiJob.updateOne({ _id: j._id }, { $set: { leaseOwner: 'B' } });
    expect(await q.heartbeat(j)).toBe(false);
  });

  it("lease yo'qotilgan ishning natijasi yangi egasining holatini buzmaydi", async () => {
    const q = mkQueue('A');
    q.register('t', async () => { await AiJob.updateOne({}, { $set: { leaseOwner: 'B' } }); });
    const { id } = await q.enqueue({ type: 't' });
    await q.runOnce();
    const d = await job(id);
    expect(d.status).toBe('leased'); // A 'done' yoza olmadi — B egasi
    expect(d.leaseOwner).toBe('B');
  });
});

describe('dedupe va davriy ishlar', () => {
  it('bir xil dedupeKey — mavjud ish qaytariladi; terminal ishning kaliti ham TTL o\'tguncha band', async () => {
    const q = mkQueue('A');
    q.register('t', async () => undefined);
    const a = await q.enqueue({ type: 't', dedupeKey: 'att:plan:c1:2026-10-13:main' });
    const b = await q.enqueue({ type: 't', dedupeKey: 'att:plan:c1:2026-10-13:main' });
    expect(b).toEqual({ id: a.id, duplicate: true });
    await q.runOnce();
    const c = await q.enqueue({ type: 't', dedupeKey: 'att:plan:c1:2026-10-13:main' });
    expect(c.duplicate).toBe(true);
    // qo'lda qayta ishga tushirish alohida (minutli) kalit bilan (C5)
    const m = await q.enqueue({ type: 't', dedupeKey: 'att:plan:c1:2026-10-13:main:manual:2026-10-13T05:01' });
    expect(m.duplicate).toBe(false);
  });

  it('davriy ish bir davr ichida instansiyalar soniga qaramay bir marta qo\'shiladi', async () => {
    const now = new Date('2026-10-13T03:00:30Z');
    const A = mkQueue('A', { now: () => now }), B = mkQueue('B', { now: () => now });
    for (const q of [A, B]) { q.register('tick', async () => undefined); q.scheduleRecurring('tick', 60_000); }
    await Promise.all([A.tick(), B.tick()]);
    await Promise.all([A.tick(), B.tick()]);
    // tick ishni oladi va fon rejimida bajaradi — tugashini kutamiz
    for (let i = 0; i < 50 && (A.isRunning() || B.isRunning()); i++) await new Promise((r) => setTimeout(r, 10));
    const all = await AiJob.find({ type: 'tick' }).lean();
    expect(all).toHaveLength(1);
    expect(all[0].dedupeKey).toBe('tick:2026-10-13T03:00:00.000Z');
  });
});

describe('drain (SIGTERM)', () => {
  it('tugaganlar done, ulgurmagani qaytariladi (urinish hisoblanmaydi), yangi ish olinmaydi', async () => {
    const q = mkQueue('A');
    let finishFast!: () => void;
    const fastGate = new Promise<void>((r) => { finishFast = r; });
    let abortedSeen = false;
    q.register('fast', async () => { await fastGate; }, { concurrency: 5 });
    q.register('slow', async ({ signal }) => {
      await new Promise<void>((res) => signal.addEventListener('abort', () => { abortedSeen = true; res(); }));
    }, { concurrency: 5 });
    const f = await q.enqueue({ type: 'fast' });
    const s = await q.enqueue({ type: 'slow' });
    const jf = (await q.claim())!, js = (await q.claim())!;
    const pf = q.execute(jf), ps = q.execute(js);
    setTimeout(finishFast, 20);
    const r = await q.drain(200);
    await Promise.all([pf, ps]);
    expect(r).toEqual({ finished: 1, released: 1 });
    expect(abortedSeen).toBe(true);
    expect((await job(f.id)).status).toBe('done');
    const ds = await job(s.id);
    expect(ds.status).toBe('queued');
    expect(ds.attempts).toBe(0);
    expect(ds.leaseOwner).toBeNull();
    // drain'dan keyin claim qilinmaydi
    expect(await q.claim()).toBeNull();
    // boshqa instansiya qaytarilgan ishni oladi
    const B = mkQueue('B');
    B.register('slow', async () => undefined);
    expect(String((await B.claim())!._id)).toBe(s.id);
  });
});
