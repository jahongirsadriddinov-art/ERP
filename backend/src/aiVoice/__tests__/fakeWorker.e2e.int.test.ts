// To'liq stek (review E): soxta worker (socket.io-client, Python worker protokoli) → /aiv-worker →
// telegramCallChannel → VoiceSessionManager (FakeVoiceProvider) → ritmli (paced) kadrlar worker'ga qaytadi.
// Haqiqiy Telegram va Gemini Live YO'Q — bu jonli qo'ng'iroq muvaffaqiyatini isbotlamaydi.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiCallSession from '../../models/AiCallSession';
import AiChannelConnection from '../../models/AiChannelConnection';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import { telegramCallChannel } from '../channels/telegramCallChannel';
import { decodeAudioFrame, encodeAudioFrame, type ChannelCtx } from '../contracts';
import { ensurePlatformConnection } from '../lib/workerLease';
import { __resetCallBridgeForTests, FLUSH_SEQ, initCallBridge, sessionFrameUuid } from '../telegram/callBridge';
import { workerHub } from '../telegram/workerNamespace';
import { tone } from '../voice/audio';
import { FakeVoiceProvider } from '../voice/fakeProvider';
import { setVoiceSessionManager, VoiceSessionManager } from '../voice/sessionManager';
import { FakeWorker, startWorkerServer, useWorkerPubkey, type WorkerServer } from './fakeWorker';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany;
let srv: WorkerServer;
let live: FakeVoiceProvider;
let mgr: VoiceSessionManager;
let w: FakeWorker;
const saved = { en: process.env.AI_VOICE_ENABLED, pub: process.env.AIV_WORKER_PUBKEY, cap: process.env.AI_LIVE_MAX_CONCURRENT };
const PLATFORM_TG = { scope: 'platform', companyId: null, type: 'telegram_user' } as const;
const CLIP_MS = 1_000;
const CLIP = tone(CLIP_MS, 24_000);

const ctx = (): ChannelCtx => ({ companyId: A.companyId, employeeId: A.workerId, correlationId: 'e2e', purpose: 'attendance', lang: 'uz', now: new Date(), attemptNo: 1 });
const pcmBytes = (frames: { buf: Buffer }[]) => frames.reduce((n, f) => n + (decodeAudioFrame(f.buf)?.pcm.length || 0), 0);

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  process.env.AI_LIVE_MAX_CONCURRENT = '5';
  useWorkerPubkey();
  mongo = await startMongo();
  A = await seedCompany('TgE2E');
  srv = await startWorkerServer();
  initCallBridge();
  live = new FakeVoiceProvider();
  mgr = new VoiceSessionManager({
    providerFor: (k) => (k === 'gemini_live' ? live : null),
    clipOnLive: true, disclosure: { getClip: async () => CLIP }, setupTimeoutMs: 1_000, touchMs: 500,
  });
  setVoiceSessionManager(mgr);
  w = await FakeWorker.ready(srv.url);
  await ensurePlatformConnection();
  await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { status: 'connected', lastHealthAt: new Date() } });
  await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, telegram: { tgUserId: '990001', callConsent: 'granted', resolveStatus: 'resolved' } } as any);
}, 120_000);

afterEach(async () => {
  w.audio.length = 0;
  w.rpcs.length = 0;
});

afterAll(async () => {
  const down = new Promise((r) => workerHub.once('down', r));
  w.close();
  await Promise.race([down, new Promise((r) => setTimeout(r, 1_000))]);
  await mgr.drain(2_000);
  mgr.dispose();
  setVoiceSessionManager(null);
  __resetCallBridgeForTests();
  await srv.close();
  for (const [k, v] of [['AI_VOICE_ENABLED', saved.en], ['AIV_WORKER_PUBKEY', saved.pub], ['AI_LIVE_MAX_CONCURRENT', saved.cap]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await stopMongo(mongo);
});

describe("soxta worker → VoiceSessionManager → worker", () => {
  it("terish, ulanish, ritmli disclosure, ikki tomonlama audio, barge-in, yakun", async () => {
    const r = await telegramCallChannel.attempt(ctx(), { kind: 'attendance', ringTimeoutSec: 45, maxDurationSec: 120 });
    expect(r).toMatchObject({ outcome: 'no_answer', retryable: true });
    const sid = r.sessionId!;
    const uuid = sessionFrameUuid(sid);
    expect(w.rpcsOf('call.place')).toHaveLength(1);

    // Python worker kabi: dialing → ringing → connected
    await w.callState(sid, 'dialing');
    await w.callState(sid, 'ringing');
    await vi.waitFor(async () => expect((await AiCallSession.findById(sid).lean() as any).status).toBe('ringing'));
    const tConnected = Date.now();
    await w.callState(sid, 'connected');

    // 1) Disclosure klipi (1 s, 24 kHz) worker'ga to'liq yetadi — bir zumda emas, ijro ritmida
    await vi.waitFor(() => expect(pcmBytes(w.audio)).toBe(CLIP.length), { timeout: 5_000 });
    const frames = w.audio.map((f) => ({ at: f.at, d: decodeAudioFrame(f.buf)! }));
    expect(frames.every((f) => f.d.correlationId === uuid)).toBe(true);
    expect(frames.every((f) => f.d.pcm.length <= 8 * 1024 - 20)).toBe(true);
    const seqs = frames.map((f) => f.d.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));        // tartib saqlanadi
    const span = frames[frames.length - 1].at - frames[0].at;
    expect(span).toBeGreaterThanOrEqual(CLIP_MS - 400 - 150);     // ~leadMs (400) oldinda, qolgani real vaqtda
    expect(frames[frames.length - 1].at - tConnected).toBeLessThan(CLIP_MS + 1_500);
    expect(live.last).toBeTruthy();
    const vs = live.last!;

    // 2) Disclosure tugagach (uplink klip davomida yopiq — A8) — worker'dan 16 kHz kadrlar modelga boradi
    await new Promise((res) => setTimeout(res, Math.max(0, tConnected + CLIP_MS + 300 - Date.now())));
    for (let i = 0; i < 5; i++) w.sendAudio(encodeAudioFrame(uuid, i, tone(20, 16_000)));
    await vi.waitFor(() => expect(vs.pushedBytes).toBe(5 * 640));
    // Begona correlationId'li kadr e'tiborsiz
    w.sendAudio(encodeAudioFrame('01234567-89ab-cdef-0123-456700000000', 9, tone(20, 16_000)));
    await new Promise((res) => setTimeout(res, 100));
    expect(vs.pushedBytes).toBe(5 * 640);

    // 3) Model gapiradi → worker'ga; barge-in → "tozalash" kadri (faqat sarlavha, seq=FLUSH)
    w.audio.length = 0;
    vs.speak(tone(2_000, 24_000));
    await vi.waitFor(() => expect(pcmBytes(w.audio)).toBeGreaterThan(0));
    vs.interrupt();
    await vi.waitFor(() => expect(w.audio.some((f) => f.buf.length === 20 && f.buf.readUInt32LE(16) === FLUSH_SEQ)).toBe(true));
    const sentBefore = pcmBytes(w.audio);
    await new Promise((res) => setTimeout(res, 300));
    expect(pcmBytes(w.audio)).toBe(sentBefore);                    // eskirgan ovoz yuborilmaydi
    expect(sentBefore).toBeLessThan(2 * 48_000);

    // 4) Suhbatdosh go'shakni qo'ydi
    await w.callState(sid, 'ended', 'completed');
    await vi.waitFor(async () => expect(await AiCallSession.findById(sid).lean()).toMatchObject({ isActive: false, status: 'completed' }));
    await vi.waitFor(() => expect(vs.closed).toBe(true));
    // Worker o'zi yakunlagan — hangup qaytarib yuborilmaydi
    expect(w.rpcsOf('call.hangup')).toHaveLength(0);
  }, 20_000);

  it("javob berilmadi (worker timeout) — no_answer, model sessiyasi ochilmaydi/yopiladi", async () => {
    const opens = live.sessions.length;
    const r = await telegramCallChannel.attempt(ctx(), { kind: 'attendance', ringTimeoutSec: 45, maxDurationSec: 120 });
    expect(r).toMatchObject({ outcome: 'no_answer' });
    const sid = r.sessionId!;
    await w.callState(sid, 'ringing');
    await w.callState(sid, 'ended', 'timeout');
    await vi.waitFor(async () => expect(await AiCallSession.findById(sid).lean()).toMatchObject({ isActive: false, status: 'no_answer' }));
    expect(w.audio).toHaveLength(0);
    for (const s of live.sessions.slice(opens)) await vi.waitFor(() => expect(s.closed).toBe(true));
  });
});
