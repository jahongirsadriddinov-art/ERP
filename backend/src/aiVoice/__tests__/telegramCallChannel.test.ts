// Telegram qo'ng'iroq kanali (P6): natijalar xaritasi, rozilik/maxfiylik/akkaunt cheklovlari, vaqtinchalik
// worker uzilishida qayta navbat (fallback emas), worker RPC/voqealari bilan to'liq oqim.
// Haqiqiy Telegram yo'q — soxta worker (socket.io-client) va FakeVoiceProvider.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiCallSession from '../../models/AiCallSession';
import AiChannelConnection from '../../models/AiChannelConnection';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import User from '../../models/User';
import { telegramCallChannel } from '../channels/telegramCallChannel';
import { aiConfig, INSTANCE_ID } from '../config';
import type { ChannelCtx } from '../contracts';
import { ensurePlatformConnection } from '../lib/workerLease';
import { localDate } from '../lib/zonedTime';
import { invalidateSettings } from '../settings';
import { __resetCallBridgeForTests, initCallBridge, mapEndReason } from '../telegram/callBridge';
import { workerHub } from '../telegram/workerNamespace';
import { tone } from '../voice/audio';
import { FakeVoiceProvider } from '../voice/fakeProvider';
import { setVoiceSessionManager, VoiceSessionManager } from '../voice/sessionManager';
import type { VoiceSessionManagerApi } from '../voice/types';
import { FakeWorker, startWorkerServer, useWorkerPubkey, type WorkerServer } from './fakeWorker';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany;
let srv: WorkerServer;
let mgr: VoiceSessionManager;
const workers: FakeWorker[] = [];
const saved = { en: process.env.AI_VOICE_ENABLED, pub: process.env.AIV_WORKER_PUBKEY, cap: process.env.AI_LIVE_MAX_CONCURRENT };
const PLATFORM_TG = { scope: 'platform', companyId: null, type: 'telegram_user' } as const;
let tgSeq = 7000;

const ctx = (employeeId: string, extra: Partial<ChannelCtx> = {}): ChannelCtx => ({
  companyId: A.companyId, employeeId, correlationId: 'c-1', purpose: 'attendance', lang: 'uz', now: new Date(), attemptNo: 1, ...extra,
});
const req = { kind: 'attendance' as const, ringTimeoutSec: 45, maxDurationSec: 120 };

async function account(set: Record<string, unknown> = {}) {
  await ensurePlatformConnection();
  await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { status: 'connected', lastHealthAt: new Date(), ...set } });
}
async function contact(employeeId: string, tg: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  await AiEmployeeContact.updateOne(
    { companyId: A.companyId, employeeId },
    { $set: { telegram: { tgUserId: String(++tgSeq), callConsent: 'granted', resolveStatus: 'resolved', ...tg }, ...extra } },
    { upsert: true },
  );
}
async function setCompanyConsent(v: boolean) {
  await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { 'calls.companyConsent': v } });
  invalidateSettings();
}
const conn = async (): Promise<any> => AiChannelConnection.findOne(PLATFORM_TG).lean();
async function worker(): Promise<FakeWorker> { const w = await FakeWorker.ready(srv.url); workers.push(w); return w; }
const reason = async (employeeId: string) => {
  const r = await telegramCallChannel.isAvailable(ctx(employeeId));
  return r.ok ? 'ok' : r.reason;
};

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  process.env.AI_LIVE_MAX_CONCURRENT = '5';
  useWorkerPubkey();
  mongo = await startMongo();
  A = await seedCompany('TgCh');
  srv = await startWorkerServer();
  initCallBridge();
}, 120_000);

beforeEach(() => {
  mgr = new VoiceSessionManager({
    providerFor: (k) => (k === 'gemini_live' ? new FakeVoiceProvider() : null),
    disclosure: { getClip: async () => tone(60, 24_000) }, setupTimeoutMs: 1_000, touchMs: 500,
  });
  setVoiceSessionManager(mgr);
});

afterEach(async () => {
  const downs = workers.map(() => new Promise((r) => workerHub.once('down', r)));
  for (const w of workers.splice(0)) w.close();
  await Promise.race([Promise.all(downs), new Promise((r) => setTimeout(r, 1_000))]);
  await mgr.drain(2_000);
  mgr.dispose();
  setVoiceSessionManager(null);
  __resetCallBridgeForTests();
  await AiCallSession.deleteMany({});
  await AiChannelConnection.deleteMany({});
  await AiEmployeeContact.deleteMany({});
});

afterAll(async () => {
  await srv.close();
  for (const [k, v] of [['AI_VOICE_ENABLED', saved.en], ['AIV_WORKER_PUBKEY', saved.pub], ['AI_LIVE_MAX_CONCURRENT', saved.cap]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await stopMongo(mongo);
});

describe('natijalar xaritasi (worker tugash sababi → sessiya holati)', () => {
  it.each([
    ['completed', true, 'completed'], ['hangup', true, 'completed'], ['hangup', false, 'no_answer'],
    ['busy', false, 'busy'], ['declined', false, 'declined'], ['timeout', false, 'no_answer'],
    ['privacy', false, 'cancelled'], ['blocked', false, 'cancelled'], ['outdated', false, 'cancelled'], ['flood_wait', false, 'cancelled'],
    ['network', true, 'interrupted'], ['network', false, 'failed'], ['error', false, 'failed'], [undefined, false, 'failed'],
  ] as const)('%s (javob berilgan: %s) → %s', (r, answered, status) => {
    expect(mapEndReason(r as any, answered).status).toBe(status);
  });
});

describe('mavjudlik: rozilik, maxfiylik, akkaunt, chegaralar', () => {
  it("AI o'chiq — disabled", async () => {
    await account(); await contact(A.workerId);
    process.env.AI_VOICE_ENABLED = 'false';
    try { expect(await reason(A.workerId)).toBe('disabled'); } finally { process.env.AI_VOICE_ENABLED = 'true'; }
  });

  it('akkaunt ulanmagan / flood-wait / platforma kunlik chegarasi', async () => {
    await contact(A.workerId);
    expect(await reason(A.workerId)).toBe('account_not_connected');
    await account({ status: 'awaiting_code' });
    expect(await reason(A.workerId)).toBe('account_not_connected');
    await account({ floodWaitUntil: new Date(Date.now() + 60_000) });
    expect(await reason(A.workerId)).toBe('flood_wait');
    await account({ floodWaitUntil: null, dailyCallDay: localDate(new Date()), dailyCallCount: aiConfig.tgDailyCap });
    expect(await reason(A.workerId)).toBe('daily_cap');
    // Kecha hisoblagichi bugunga ta'sir qilmaydi
    await account({ dailyCallDay: '2000-01-01' });
    expect(await reason(A.workerId)).toBe('ok');
  });

  it("xodim: kompaniya roziligi / eski shaxsiy rozilik / opt-out / bog'lanmagan / aniqlanmagan / maxfiylik", async () => {
    await account();
    // Owner 2026-10-16: kompaniya roziligi o'chiq — faqat eski shaxsiy 'granted' o'tadi
    await setCompanyConsent(false);
    await contact(A.workerId, { callConsent: 'none' });
    expect(await reason(A.workerId)).toBe('no_consent');
    await contact(A.workerId, { callConsent: 'revoked' });
    expect(await reason(A.workerId)).toBe('no_consent');
    await contact(A.workerId, { callConsent: 'granted' });
    expect(await reason(A.workerId)).toBe('ok');
    // Kompaniya roziligi yoqilgan (standart) — xodimdan so'ralmaydi
    await setCompanyConsent(true);
    await contact(A.workerId, { callConsent: 'revoked' });
    expect(await reason(A.workerId)).toBe('ok');
    await contact(A.workerId, {}, { optOut: { calls: true, reminders: false, all: false } });
    expect(await reason(A.workerId)).toBe('opt_out');
    await contact(A.workerId, { tgUserId: undefined }, { optOut: { calls: false, reminders: false, all: false } });
    expect(await reason(A.workerId)).toBe('not_bound');
    // Aniqlanmagan — qo'ng'iroq paytida worker aniqlaydi; yaqinda not_found bo'lgan — kutiladi
    await contact(A.workerId, { resolveStatus: 'unknown' });
    expect(await reason(A.workerId)).toBe('ok');
    await contact(A.workerId, { resolveStatus: 'not_found', checkedAt: new Date() });
    expect(await reason(A.workerId)).toBe('not_resolved');
    await contact(A.workerId, { resolveStatus: 'not_found', checkedAt: new Date(Date.now() - 7 * 3600_000) });
    expect(await reason(A.workerId)).toBe('ok');
    await contact(A.workerId, { resolveStatus: 'privacy_restricted' });
    expect(await reason(A.workerId)).toBe('privacy_restricted');
    // Kontakt umuman yo'q: bot bog'lanishi bo'lmasa — not_bound; ERP botga bog'langach — tgUserId backfill, ok
    await User.updateOne({ _id: A.worker2Id }, { $unset: { telegramChatId: 1, telegramUserId: 1 } });
    expect(await reason(A.worker2Id)).toBe('not_bound');
    await User.updateOne({ _id: A.worker2Id }, { $set: { telegramChatId: '5550001' } });
    expect(await reason(A.worker2Id)).toBe('ok');
    expect((await AiEmployeeContact.findOne({ employeeId: A.worker2Id }).lean() as any).telegram).toMatchObject({ tgUserId: '5550001', resolveStatus: 'unknown' });
  });

  it("worker uzoq vaqt ko'rinmagan — worker_offline (keyingi kanalga o'tiladi)", async () => {
    await account({ lastHealthAt: new Date(Date.now() - 10 * 60_000) });
    await contact(A.workerId);
    expect(await reason(A.workerId)).toBe('worker_offline');
  });

  it("worker vaqtincha uzilgan (yaqinda ko'ringan) — fallback EMAS: unavailable + retryAt (qayta navbat)", async () => {
    await account({ lastHealthAt: new Date(Date.now() - 60_000) });
    await contact(A.workerId);
    expect(await reason(A.workerId)).toBe('ok');
    const t0 = Date.now();
    const r = await telegramCallChannel.attempt(ctx(A.workerId), req);
    expect(r).toMatchObject({ outcome: 'unavailable', retryable: true, errorCode: 'worker_not_here' });
    expect(r.retryAt!.getTime()).toBeGreaterThanOrEqual(t0 + 10_000);
    expect(await AiCallSession.countDocuments({})).toBe(0);
    expect((await conn()).dailyCallCount || 0).toBe(0);
  });
});

describe("worker bilan oqim", () => {
  it("terish → jiringlash → ulanish → yakun; kunlik hisoblagich; akkaunt bandligida qayta navbat", async () => {
    const w = await worker();
    await account(); await contact(A.workerId); await contact(A.worker2Id);
    const ct: any = await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean();

    const r = await telegramCallChannel.attempt(ctx(A.workerId), req);
    expect(r).toMatchObject({ outcome: 'no_answer', retryable: true });
    expect(r.sessionId).toMatch(/^[0-9a-f]{24}$/);
    expect(r.awaitResponseUntil!.getTime()).toBeGreaterThan(Date.now() + 100_000);
    const place = w.rpcsOf('call.place');
    expect(place).toHaveLength(1);
    expect(place[0].params).toEqual({ sessionId: r.sessionId, tgUserId: ct.telegram.tgUserId, timeoutSec: 45, maxDurationSec: 120 });
    expect((await conn()).dailyCallCount).toBe(1);
    const s: any = await AiCallSession.findById(r.sessionId).lean();
    expect(s).toMatchObject({ channel: 'telegram_call', isActive: true, workerInstanceId: INSTANCE_ID });

    // A1: bitta akkaunt — bir vaqtda 1 ta qo'ng'iroq; ikkinchisi kaskadga emas, qayta navbatga
    const r2 = await telegramCallChannel.attempt(ctx(A.worker2Id), req);
    expect(r2).toMatchObject({ outcome: 'unavailable', retryable: true, errorCode: 'account_busy' });
    expect(r2.retryAt).toBeInstanceOf(Date);
    expect((await conn()).dailyCallCount).toBe(1);

    await w.callState(r.sessionId!, 'ringing');
    await vi.waitFor(async () => expect((await AiCallSession.findById(r.sessionId).lean() as any).status).toBe('ringing'));
    await w.callState(r.sessionId!, 'connected');
    await vi.waitFor(async () => expect((await AiCallSession.findById(r.sessionId).lean() as any).status).toBe('connected'));
    await w.callState(r.sessionId!, 'ended', 'completed');
    await vi.waitFor(async () => {
      const d: any = await AiCallSession.findById(r.sessionId).lean();
      expect(d).toMatchObject({ isActive: false, status: 'completed' });
    });
  });

  it("call.place rad etildi (busy_worker) — qayta navbat, kunlik rezerv qaytariladi, sessiya yopiladi", async () => {
    const w = await worker();
    w.handlers['call.place'] = () => ({ accepted: false, reason: 'busy_worker' });
    await account(); await contact(A.workerId);
    const r = await telegramCallChannel.attempt(ctx(A.workerId), req);
    expect(r).toMatchObject({ outcome: 'unavailable', retryable: true, errorCode: 'account_busy' });
    expect((await conn()).dailyCallCount).toBe(0);
    expect(await AiCallSession.countDocuments({ isActive: true })).toBe(0);
  });

  it("peer_unknown — bir marta telefon bilan qayta (faqat shu qo'ng'iroq uchun); baribir noma'lum — not_found", async () => {
    const w = await worker();
    w.handlers['call.place'] = () => ({ accepted: false, reason: 'peer_unknown' });
    await account(); await contact(A.workerId);
    const r = await telegramCallChannel.attempt(ctx(A.workerId), req);
    expect(r).toMatchObject({ outcome: 'unavailable', retryable: false, errorCode: 'peer_unknown' });
    const place = w.rpcsOf('call.place');
    expect(place).toHaveLength(2);
    expect((place[0].params as any).phone).toBeUndefined();
    const u: any = await User.findById(A.workerId).select('phone').lean();
    expect((place[1].params as any).phone).toBe(u.phone);
    const ct: any = await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean();
    expect(ct.telegram.resolveStatus).toBe('not_found');
    expect(ct.telegram.checkedAt).toBeInstanceOf(Date);
  });

  it("aniqlanmagan peer — telefon bilan qabul qilindi: resolved", async () => {
    const w = await worker();
    w.handlers['call.place'] = (p: any) => (p.phone ? { accepted: true } : { accepted: false, reason: 'peer_unknown' });
    await account(); await contact(A.workerId, { resolveStatus: 'unknown' });
    const r = await telegramCallChannel.attempt(ctx(A.workerId), req);
    expect(r).toMatchObject({ outcome: 'no_answer' });
    expect((await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean() as any).telegram.resolveStatus).toBe('resolved');
    await w.callState(r.sessionId!, 'ended', 'completed');
  });

  it("worker javob bermadi (uzilish) — qayta navbat, fallback emas", async () => {
    const w = await worker();
    w.silent = true;
    await account(); await contact(A.workerId);
    const r = await telegramCallChannel.attempt(ctx(A.workerId), req);
    expect(r).toMatchObject({ outcome: 'unavailable', retryable: true, errorCode: 'worker_timeout' });
    expect(r.retryAt).toBeInstanceOf(Date);
    expect((await conn()).dailyCallCount).toBe(0);
    expect(await AiCallSession.countDocuments({ isActive: true })).toBe(0);
  }, 20_000);

  it("maxfiylik sababli tugadi — 'cancelled' va kontakt privacy_restricted", async () => {
    const w = await worker();
    await account(); await contact(A.workerId);
    const r = await telegramCallChannel.attempt(ctx(A.workerId), req);
    await w.callState(r.sessionId!, 'ended', 'privacy');
    await vi.waitFor(async () => expect((await AiCallSession.findById(r.sessionId).lean() as any).status).toBe('cancelled'));
    expect((await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean() as any).telegram.resolveStatus).toBe('privacy_restricted');
    expect(await reason(A.workerId)).toBe('privacy_restricted');
  });

  it("backend sessiyani yakunlasa — worker'ga call.hangup yuboriladi", async () => {
    const w = await worker();
    await account(); await contact(A.workerId);
    const r = await telegramCallChannel.attempt(ctx(A.workerId), req);
    await mgr.get(r.sessionId!)!.end('hangup');
    await vi.waitFor(() => expect(w.rpcsOf('call.hangup').map((x) => (x.params as any).sessionId)).toEqual([r.sessionId]));
  });

  it("Live sig'imi to'lgan — kaskadga emas, kutib qayta urinish; kunlik rezerv qaytariladi", async () => {
    await worker();
    await account(); await contact(A.workerId);
    const stub: VoiceSessionManagerApi = {
      start: async () => ({ ok: false, reason: 'platform_cap' }), get: () => undefined,
      endAllForUser: async () => 0, drain: async () => undefined,
    };
    setVoiceSessionManager(stub);
    const r = await telegramCallChannel.attempt(ctx(A.workerId), req);
    expect(r).toMatchObject({ outcome: 'unavailable', retryable: true, errorCode: 'platform_cap' });
    expect((await conn()).dailyCallCount).toBe(0);
  });
});
