// In-app ovozli qo'ng'iroq socket'i (P5): haqiqiy socket.io server + socket.io-client, FakeVoiceProvider.
// Foydalanuvchi o'zi qo'ng'iroq qilishi (chat AI kontakti), smenadan tashqari rad etish, soatlik limit,
// AI qo'ng'irog'i (kanal) → aiv:incoming, ko'p tabli atomik qabul, rad etish/band, kadr hajmi/tezligi/
// egasi cheklovlari, long-polling rad etiladi, presence (A11), qayta ulanishda qayta bog'lanish.
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiRateCounter from '../../models/AiRateCounter';
import AiCallSession from '../../models/AiCallSession';
import AiConversation from '../../models/AiConversation';
import { __setActorCacheTtlForTests } from '../actor';
import { inAppCallChannel } from '../channels/inAppCallChannel';
import { decodeAudioFrame, encodeAudioFrame, type ChannelCtx } from '../contracts';
import { invalidateSettings } from '../settings';
import { __resetInAppSocketsForTests, hasFreshPresence, registerAiVoiceSocket } from '../socket/inAppSocket';
import { tone } from '../voice/audio';
import { FakeVoiceProvider } from '../voice/fakeProvider';
import { setVoiceSessionManager, VoiceSessionManager } from '../voice/sessionManager';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany;
let httpServer: http.Server;
let io: Server;
let url = '';
let live: FakeVoiceProvider;
let mgr: VoiceSessionManager;
const clients: ClientSocket[] = [];
const saved = { en: process.env.AI_VOICE_ENABLED, cap: process.env.AI_LIVE_MAX_CONCURRENT };
const CLIP = tone(100, 24_000);

async function client(userId: string, role: string, transports: string[] = ['websocket']): Promise<ClientSocket> {
  const c = ioc(url, { transports, auth: { userId, companyId: A.companyId, role }, forceNew: true, reconnection: false });
  clients.push(c);
  await new Promise<void>((res, rej) => { c.once('connect', () => res()); c.once('connect_error', rej); });
  return c;
}
const ask = (c: ClientSocket, ev: string, data: unknown): Promise<any> => c.timeout(5_000).emitWithAck(ev, data);
const nextEvent = (c: ClientSocket, ev: string, ms = 5_000): Promise<any> =>
  new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms); c.once(ev, (d: any) => { clearTimeout(t); res(d); }); });

async function setLimits(patch: Record<string, unknown>) {
  await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: patch });
  invalidateSettings(A.companyId);
}

function chCtx(employeeId: string): ChannelCtx {
  return { companyId: A.companyId, employeeId, correlationId: 'x', purpose: 'attendance', lang: 'uz', now: new Date(), attemptNo: 1 };
}

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  process.env.AI_LIVE_MAX_CONCURRENT = '5';
  mongo = await startMongo();
  await AiConversation.init();
  __setActorCacheTtlForTests(0);
  A = await seedCompany('P5S');
  httpServer = http.createServer();
  io = new Server(httpServer);
  // services/socket.ts'dagi JWT tekshiruvi o'rniga — test socket.data'ni handshake'dan oladi
  io.use((s, next) => { Object.assign(s.data, s.handshake.auth); next(); });
  io.on('connection', (s) => registerAiVoiceSocket(s));
  await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
}, 120_000);

beforeEach(() => {
  // Har testga yangi menejer va soxta provayder
  live = new FakeVoiceProvider();
  mgr = new VoiceSessionManager({
    providerFor: (k) => (k === 'gemini_live' ? live : null),
    disclosure: { getClip: async () => CLIP }, setupTimeoutMs: 1_000, touchMs: 500,
  });
  setVoiceSessionManager(mgr);
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await mgr.drain(2_000);
  setVoiceSessionManager(null);
  __resetInAppSocketsForTests();
  await AiCallSession.updateMany({ isActive: true }, { $set: { isActive: false, status: 'cancelled' } });
  await setLimits({ 'limits.userSessionsPerHour': 6, 'tools.allowOffShiftAssistant': false });
});

afterAll(async () => {
  io?.close();
  await new Promise((res) => httpServer?.close(() => res(undefined)));
  __setActorCacheTtlForTests(10_000);
  process.env.AI_VOICE_ENABLED = saved.en;
  if (saved.cap === undefined) delete process.env.AI_LIVE_MAX_CONCURRENT; else process.env.AI_LIVE_MAX_CONCURRENT = saved.cap;
  await stopMongo(mongo);
});

describe('aiv:start (foydalanuvchi AI\'ga qo\'ng\'iroq qiladi)', () => {
  it('ack → aiv:ready → disclosure audio (correlationId sarlavhada) → mijoz audiosi provayderga → hangup', async () => {
    const c = await client(A.ownerId, 'direktor');
    const ready = nextEvent(c, 'aiv:ready');
    const frames: Buffer[] = [];
    c.on('aiv:audio', (b: Buffer) => frames.push(Buffer.from(b)));
    const ack = await ask(c, 'aiv:start', { purpose: 'assistant' });
    expect(ack).toMatchObject({ ok: true });
    expect(ack.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await ready).toMatchObject({ sessionId: ack.sessionId, correlationId: ack.correlationId, inputSampleRate: 16000 });
    await vi.waitFor(() => expect(frames.reduce((a, f) => a + f.length - 20, 0)).toBe(CLIP.length));
    const f0 = decodeAudioFrame(frames[0])!;
    expect(f0.correlationId).toBe(ack.correlationId);
    await new Promise((r) => setTimeout(r, 150));                  // disclosure tugashi (uplink ochiladi)
    c.emit('aiv:audio', encodeAudioFrame(ack.correlationId, 0, Buffer.alloc(1280)));
    await vi.waitFor(() => expect(live.last!.pushedBytes).toBe(1280));
    const end = nextEvent(c, 'aiv:end');
    expect(await ask(c, 'aiv:hangup', {})).toEqual({ ok: true });
    expect(await end).toEqual({ sessionId: ack.sessionId, reason: 'hangup' });
    const doc: any = await AiCallSession.findById(ack.sessionId).lean();
    expect(doc).toMatchObject({ status: 'completed', direction: 'inbound', channel: 'inapp_call' });
  });

  it('long-polling transporti rad etiladi (unsupported_transport)', async () => {
    const c = await client(A.ownerId, 'direktor', ['polling']);
    expect(await ask(c, 'aiv:start', { purpose: 'assistant' })).toMatchObject({ ok: false, code: 'unsupported_transport' });
  });

  it('noto\'g\'ri so\'rov — bad_request', async () => {
    const c = await client(A.ownerId, 'direktor');
    expect(await ask(c, 'aiv:start', { purpose: 'attendance' })).toMatchObject({ ok: false, code: 'bad_request' });
  });

  it('ishchi smenadan tashqarida — off_shift; allowOffShiftAssistant yoqilsa — ruxsat', async () => {
    const c = await client(A.workerId, 'ishchi');
    expect(await ask(c, 'aiv:start', { purpose: 'assistant' })).toMatchObject({ ok: false, code: 'off_shift' });
    await setLimits({ 'tools.allowOffShiftAssistant': true });
    expect(await ask(c, 'aiv:start', { purpose: 'assistant' })).toMatchObject({ ok: true });
  });

  it('userSessionsPerHour — limitdan keyin rad', async () => {
    await setLimits({ 'limits.userSessionsPerHour': 1 });
    await AiRateCounter.deleteMany({});             // oldingi testlardagi ulangan qo'ng'iroqlar hisobga kirmasin
    const c = await client(A.orinbosarId, 'orinbosar');
    const readyP = nextEvent(c, 'aiv:ready');
    const a1 = await ask(c, 'aiv:start', { purpose: 'assistant' });
    expect(a1.ok).toBe(true);
    await readyP;                                   // faqat ULANGAN qo'ng'iroq soatlik limitga yoziladi
    await ask(c, 'aiv:hangup', { sessionId: a1.sessionId });
    await vi.waitFor(async () => expect(((await AiCallSession.findById(a1.sessionId).lean()) as any).isActive).toBe(false));
    const r = await ask(c, 'aiv:start', { purpose: 'assistant' });
    expect(r).toMatchObject({ ok: false, code: 'limit' });
    expect(String(r.message)).toMatch(/matn bilan davom etamiz/);
  });

  it('userSessionsPerHour — ulanmay qolgan urinish (ready kelmadi) limitni yemaydi', async () => {
    await setLimits({ 'limits.userSessionsPerHour': 1, 'tools.allowOffShiftAssistant': true });
    await AiRateCounter.deleteMany({});
    live = new FakeVoiceProvider({ failOpen: new Error('429 RESOURCE_EXHAUSTED quota') });   // AI ulanmaydi
    const c = await client(A.prorabId, 'prorab');
    for (let i = 0; i < 2; i++) {
      const endP = nextEvent(c, 'aiv:end');
      const errP = nextEvent(c, 'aiv:error');
      const a = await ask(c, 'aiv:start', { purpose: 'assistant' });
      expect(a).toMatchObject({ ok: true });
      expect(await errP).toMatchObject({ code: 'ai_quota' });   // sabab end'dan oldin (mijoz matnga o'tadi)
      await endP;
      await vi.waitFor(async () => expect(((await AiCallSession.findById(a.sessionId).lean()) as any).isActive).toBe(false));
    }
  });
});

describe('AI → foydalanuvchi (inAppCallChannel)', () => {
  it('presence: socket yo\'q — offline; ko\'rinmaydi — not_visible; visible — ok', async () => {
    expect(await inAppCallChannel.isAvailable(chCtx(A.prorabId))).toEqual({ ok: false, reason: 'offline' });
    const c = await client(A.prorabId, 'prorab');
    expect(await inAppCallChannel.isAvailable(chCtx(A.prorabId))).toEqual({ ok: false, reason: 'not_visible' });
    c.emit('aiv:presence', { visible: true });
    await vi.waitFor(() => expect(hasFreshPresence(A.prorabId, A.companyId)).toBe(true));
    expect(await inAppCallChannel.isAvailable(chCtx(A.prorabId))).toEqual({ ok: true });
    expect(hasFreshPresence(A.prorabId, A.companyId, Date.now() + 61_000)).toBe(false);
  });

  it('ikki tab: ikkalasi ham aiv:incoming oladi, birinchi accept yutadi, ikkinchisi answered_elsewhere', async () => {
    const t1 = await client(A.prorabId, 'prorab');
    const t2 = await client(A.prorabId, 'prorab');
    t1.emit('aiv:presence', { visible: true });
    await vi.waitFor(() => expect(hasFreshPresence(A.prorabId, A.companyId)).toBe(true));
    const in1 = nextEvent(t1, 'aiv:incoming');
    const in2 = nextEvent(t2, 'aiv:incoming');
    const res = await inAppCallChannel.attempt(chCtx(A.prorabId), { kind: 'attendance' });
    expect(res).toMatchObject({ outcome: 'no_answer', retryable: true });
    expect(res.awaitResponseUntil).toBeInstanceOf(Date);
    const [i1, i2] = await Promise.all([in1, in2]);
    expect(i1.sessionId).toBe(res.sessionId);
    expect(i2).toMatchObject({ sessionId: res.sessionId, purpose: 'attendance', companyName: 'P5S' });
    const lostEnd = nextEvent(t2, 'aiv:end').catch(() => null);
    const ready = nextEvent(t1, 'aiv:ready');
    const [a1, a2] = await Promise.all([ask(t1, 'aiv:accept', { sessionId: i1.sessionId }), ask(t2, 'aiv:accept', { sessionId: i1.sessionId })]);
    const wins = [a1, a2].filter((a) => a.ok);
    expect(wins).toHaveLength(1);
    const loser = a1.ok ? a2 : a1;
    expect(loser).toMatchObject({ ok: false, code: 'answered_elsewhere' });
    if (a1.ok) {
      await ready;
      expect(await lostEnd).toMatchObject({ reason: 'answered_elsewhere' });
    }
    await vi.waitFor(async () => expect(((await AiCallSession.findById(res.sessionId).lean()) as any).status).toBe('connected'));
  });

  it('rad etish → declined; band (WebRTC qo\'ng\'irog\'ida) → busy', async () => {
    const c = await client(A.worker2Id, 'ishchi');
    c.emit('aiv:presence', { visible: true });
    await vi.waitFor(() => expect(hasFreshPresence(A.worker2Id, A.companyId)).toBe(true));
    for (const [reason, status] of [['declined', 'declined'], ['busy', 'busy']] as const) {
      const inc = nextEvent(c, 'aiv:incoming');
      const res = await inAppCallChannel.attempt(chCtx(A.worker2Id), { kind: 'attendance' });
      const i = await inc;
      expect(await ask(c, 'aiv:decline', { sessionId: i.sessionId, reason })).toEqual({ ok: true });
      await vi.waitFor(async () => expect(((await AiCallSession.findById(res.sessionId).lean()) as any).status).toBe(status));
    }
  });

  it('boshqa foydalanuvchi begona sessiyani qabul qila olmaydi', async () => {
    const victim = await client(A.workerId, 'ishchi');
    victim.emit('aiv:presence', { visible: true });
    await vi.waitFor(() => expect(hasFreshPresence(A.workerId, A.companyId)).toBe(true));
    const inc = nextEvent(victim, 'aiv:incoming');
    await inAppCallChannel.attempt(chCtx(A.workerId), { kind: 'attendance' });
    const i = await inc;
    const attacker = await client(A.worker2Id, 'ishchi');
    expect(await ask(attacker, 'aiv:accept', { sessionId: i.sessionId })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await ask(attacker, 'aiv:hangup', { sessionId: i.sessionId })).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('audio kadr cheklovlari (A10)', () => {
  async function connectedCall() {
    const c = await client(A.ownerId, 'direktor');
    const ready = nextEvent(c, 'aiv:ready');
    const ack = await ask(c, 'aiv:start', { purpose: 'assistant' });
    await ready;
    await new Promise((r) => setTimeout(r, 150));
    return { c, ack };
  }

  it('>8 KB, toq uzunlik, noma\'lum correlationId va bog\'lanmagan socket kadrlari tashlanadi', async () => {
    const { c, ack } = await connectedCall();
    const other = await client(A.ownerId, 'direktor');                            // shu foydalanuvchining 2-tabi
    c.emit('aiv:audio', encodeAudioFrame(ack.correlationId, 1, Buffer.alloc(8_200)));
    const odd = Buffer.concat([encodeAudioFrame(ack.correlationId, 2, Buffer.alloc(640)), Buffer.alloc(1)]);
    c.emit('aiv:audio', odd);
    c.emit('aiv:audio', encodeAudioFrame('11111111-2222-4333-8444-555555555555', 3, Buffer.alloc(640)));
    other.emit('aiv:audio', encodeAudioFrame(ack.correlationId, 4, Buffer.alloc(640)));
    c.emit('aiv:audio', 'not-binary');
    c.emit('aiv:audio', encodeAudioFrame(ack.correlationId, 5, Buffer.alloc(640)));   // yagona to'g'ri kadr
    await vi.waitFor(() => expect(live.last!.pushedBytes).toBe(640));
    await new Promise((r) => setTimeout(r, 100));
    expect(live.last!.pushedBytes).toBe(640);
  });

  it('>60 kadr/s — ortiqchasi tashlanadi', async () => {
    const { c, ack } = await connectedCall();
    for (let i = 0; i < 90; i++) c.emit('aiv:audio', encodeAudioFrame(ack.correlationId, i, Buffer.alloc(640)));
    await vi.waitFor(() => expect(live.last!.pushedBytes).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 300));
    expect(live.last!.pushedBytes).toBeLessThanOrEqual(60 * 640);
    expect(live.last!.pushedBytes).toBeGreaterThanOrEqual(50 * 640);
  });

  it('qayta ulanish: yangi socket aiv:accept bilan qayta bog\'lanadi, audio yangi socket\'ga', async () => {
    const { c, ack } = await connectedCall();
    c.disconnect();
    const c2 = await client(A.ownerId, 'direktor');
    const r = await ask(c2, 'aiv:accept', { sessionId: ack.sessionId });
    expect(r).toEqual({ ok: true, sessionId: ack.sessionId, correlationId: ack.correlationId });
    const frame = nextEvent(c2, 'aiv:audio');
    live.last!.speak(tone(40, 24_000));
    expect(decodeAudioFrame(Buffer.from(await frame))!.correlationId).toBe(ack.correlationId);
    c2.emit('aiv:audio', encodeAudioFrame(ack.correlationId, 9, Buffer.alloc(640)));
    await vi.waitFor(() => expect(live.last!.pushedBytes).toBe(640));
  });

  it('aiv:confirm-action — noto\'g\'ri so\'rov / topilmagan amal', async () => {
    const c = await client(A.ownerId, 'direktor');
    expect(await ask(c, 'aiv:confirm-action', { pendingActionId: 'x', accept: true })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await ask(c, 'aiv:confirm-action', { pendingActionId: '0123456789abcdef01234567', accept: true })).toMatchObject({ ok: false, code: 'not_found' });
  });
});
