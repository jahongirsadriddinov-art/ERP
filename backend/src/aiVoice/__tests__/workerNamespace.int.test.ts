// "/aiv-worker" namespace (P6, review A4/A5/A10): faqat websocket, Ed25519 challenge-response
// (noto'g'ri imzo / takrorlangan challenge rad etiladi), fencing lease (ikkinchi worker lease tugaguncha
// rad etiladi), voqea/audio faqat lease egasidan, RPC requestId va timeout.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiChannelConnection from '../../models/AiChannelConnection';
import { encodeAudioFrame } from '../contracts';
import { LIMITS } from '../config';
import { callWorker, WorkerRpcFailure } from '../telegram/workerRpc';
import { getActiveWorker, workerConnectedHere, workerHub } from '../telegram/workerNamespace';
import { FakeWorker, otherKeys, RpcErr, startWorkerServer, useWorkerPubkey, type WorkerServer } from './fakeWorker';
import { startMongo, stopMongo } from './helpers';

let mongo: MongoMemoryServer;
let srv: WorkerServer;
const workers: FakeWorker[] = [];
const saved = { en: process.env.AI_VOICE_ENABLED, pub: process.env.AIV_WORKER_PUBKEY };
const PLATFORM_TG = { scope: 'platform', companyId: null, type: 'telegram_user' } as const;

async function track(p: Promise<FakeWorker>): Promise<FakeWorker> { const w = await p; workers.push(w); return w; }

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  useWorkerPubkey();
  mongo = await startMongo();
}, 120_000);

beforeEach(async () => { srv = await startWorkerServer(); });

afterEach(async () => {
  for (const w of workers.splice(0)) w.close();
  await srv.close();
  await AiChannelConnection.deleteMany({});
});

afterAll(async () => {
  if (saved.en === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = saved.en;
  if (saved.pub === undefined) delete process.env.AIV_WORKER_PUBKEY; else process.env.AIV_WORKER_PUBKEY = saved.pub;
  await stopMongo(mongo);
});

describe('ulanish va autentifikatsiya', () => {
  it('long-polling transporti rad etiladi (A10: faqat websocket)', async () => {
    await expect(FakeWorker.connect(srv.url, { transports: ['polling'] })).rejects.toThrow(/websocket_only/);
  });

  it("noto'g'ri workerId handshake'i rad etiladi", async () => {
    await expect(FakeWorker.connect(srv.url, { workerId: 'bad id with spaces' })).rejects.toThrow(/bad_handshake/);
  });

  it("boshqa kalit bilan imzo — bad_signature va socket uziladi; lease olinmaydi", async () => {
    const w = await track(FakeWorker.connect(srv.url));
    const disc = w.waitDisconnect();
    expect(await w.auth({ key: otherKeys.privateKey })).toMatchObject({ ok: false, error: 'bad_signature' });
    expect(await disc).toBe(true);
    expect(workerConnectedHere()).toBe(false);
  });

  it('takrorlangan (replay) challenge — ikkinchi ulanishda rad etiladi', async () => {
    const w1 = await track(FakeWorker.connect(srv.url));
    const { nonce } = await w1.nonce();
    expect(await w1.auth()).toEqual({ ok: true });
    const w2 = await track(FakeWorker.connect(srv.url));
    expect(await w2.auth({ nonce })).toEqual({ ok: false, error: 'replayed_or_expired' });
  });

  it("autentifikatsiyasiz lease, voqea va audio e'tiborsiz", async () => {
    const w = await track(FakeWorker.connect(srv.url));
    expect(await w.acquire()).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(await w.event({ type: 'health', status: { version: 'x', connected: true, activeCalls: 0 }, at: Date.now() })).toEqual({ ok: false });
    expect(workerConnectedHere()).toBe(false);
  });
});

describe('fencing lease (A4)', () => {
  it("birinchi worker lease oladi; ikkinchisi lease tugaguncha (+grace) rad etiladi", async () => {
    const w1 = await track(FakeWorker.ready(srv.url, 'tgw-one'));
    expect(workerConnectedHere()).toBe(true);
    expect(getActiveWorker()?.workerId).toBe('tgw-one');
    const doc: any = await AiChannelConnection.findOne(PLATFORM_TG).lean();
    expect(doc.leaseId).toBe(w1.leaseId);
    expect(doc.workerInstanceId).toBeTruthy();

    const w2 = await track(FakeWorker.connect(srv.url, { workerId: 'tgw-two' }));
    expect((await w2.auth()).ok).toBe(true);
    const r = await w2.acquire();
    expect(r).toMatchObject({ ok: false, reason: 'held' });
    expect((r as any).retryAfterMs).toBeGreaterThan(LIMITS.workerLeaseGraceMs - 1);

    // w1 uzildi — lease hali amalda: w2 baribir kutadi (eski jarayon Telethon'ni hali ushlab turishi mumkin)
    const down = new Promise((res) => workerHub.once('down', res));
    w1.close();
    await down;
    expect(workerConnectedHere()).toBe(false);
    expect((await w2.acquire()).ok).toBe(false);

    // Lease muddati + grace o'tdi — endi w2 oladi
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { leaseUntil: new Date(Date.now() - LIMITS.workerLeaseGraceMs - 1_000) } });
    const r2 = await w2.acquire();
    expect(r2.ok).toBe(true);
    expect(getActiveWorker()?.workerId).toBe('tgw-two');
  });

  it("yangilash: o'z lease'i — ok; begona/eskirgan leaseId — lost va worker faol emas", async () => {
    const w = await track(FakeWorker.ready(srv.url));
    expect((await w.renew()).ok).toBe(true);
    expect(await w.renew('00000000-0000-4000-8000-000000000000')).toMatchObject({ ok: false, reason: 'lost' });
    expect(workerConnectedHere()).toBe(false);
  });

  it("release'dan keyin boshqa worker darhol oladi", async () => {
    const w1 = await track(FakeWorker.ready(srv.url, 'tgw-one'));
    expect(await w1.release()).toEqual({ ok: true });
    expect(workerConnectedHere()).toBe(false);
    const w2 = await track(FakeWorker.ready(srv.url, 'tgw-two'));
    expect(getActiveWorker()?.workerId).toBe(w2.workerId);
  });

  it("voqea va audio faqat lease egasidan qabul qilinadi", async () => {
    const owner = await track(FakeWorker.ready(srv.url, 'tgw-one'));
    const other = await track(FakeWorker.connect(srv.url, { workerId: 'tgw-two' }));
    await other.auth();
    const events: any[] = [];
    const frames: Buffer[] = [];
    const onEv = (e: any) => events.push(e);
    const onAu = (b: Buffer) => frames.push(b);
    workerHub.on('event', onEv);
    workerHub.on('audio', onAu);
    try {
      const health = { type: 'health' as const, status: { version: 'x', connected: true, activeCalls: 0 }, at: Date.now() };
      expect(await other.event(health)).toEqual({ ok: false });
      expect(await owner.event(health)).toEqual({ ok: true });
      const f = encodeAudioFrame('01234567-89ab-cdef-0123-456700000000', 1, Buffer.alloc(640));
      other.sendAudio(f);
      owner.sendAudio(f);
      owner.sendAudio(Buffer.alloc(9 * 1024));   // juda katta — tashlanadi
      await new Promise((r) => setTimeout(r, 150));
      expect(events).toHaveLength(1);
      expect(frames).toHaveLength(1);
    } finally {
      workerHub.off('event', onEv);
      workerHub.off('audio', onAu);
    }
  });
});

describe('RPC (workerRpc)', () => {
  it("worker yo'q — worker_offline", async () => {
    await expect(callWorker('status', {})).rejects.toMatchObject({ code: 'worker_offline' });
  });

  it("javob: requestId noyob va mos; xato kodi va retryAfterSec uzatiladi", async () => {
    const w = await track(FakeWorker.ready(srv.url));
    expect(await callWorker('status', {})).toMatchObject({ connected: true });
    await callWorker('status', {});
    const ids = w.rpcsOf('status').map((r) => r.requestId);
    expect(new Set(ids).size).toBe(ids.length);
    w.handlers['contact.resolve'] = () => { throw new RpcErr('flood_wait', 42); };
    const e = await callWorker('contact.resolve', { employeeId: 'x', expectedTgUserId: '1', allowImport: false }).catch((x) => x);
    expect(e).toBeInstanceOf(WorkerRpcFailure);
    expect(e).toMatchObject({ code: 'flood_wait', retryAfterSec: 42 });
    // Xavfli belgili kod — 'error' ga almashtiriladi
    w.handlers.status = () => { throw new RpcErr('<script>'); };
    await expect(callWorker('status', {})).rejects.toMatchObject({ code: 'error' });
  });

  it('javob kelmasa — timeout', async () => {
    const w = await track(FakeWorker.ready(srv.url));
    w.silent = true;
    const t0 = Date.now();
    await expect(callWorker('status', {}, { timeoutMs: 300 })).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("boshqa requestId bilan javob — bad_response", async () => {
    const w = await track(FakeWorker.ready(srv.url));
    w.wrongRequestId = true;
    await expect(callWorker('status', {})).rejects.toMatchObject({ code: 'bad_response' });
  });
});

describe("to'xtatish (SIGTERM)", () => {
  it("lease egasiga lease.revoked yuboriladi, lease backend tomonidan bo'shatilmaydi", async () => {
    const w = await track(FakeWorker.ready(srv.url));
    const lid = w.leaseId;
    await srv.close();
    expect(w.revoked).toEqual([{ leaseId: lid }]);
    const doc: any = await AiChannelConnection.findOne(PLATFORM_TG).lean();
    expect(doc.leaseId).toBe(lid);
    srv = await startWorkerServer();   // afterEach uchun
  });
});
