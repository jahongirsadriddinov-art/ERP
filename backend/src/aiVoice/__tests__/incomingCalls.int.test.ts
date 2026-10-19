// "Ochiq muloqot": kiruvchi Telegram qo'ng'irog'i qarori (soxta worker → /aiv-worker → incomingCalls),
// platforma toggle'i (faqat dasturchi, audit, bazada saqlanadi, workerga yuboriladi).
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiCallSession from '../../models/AiCallSession';
import AiChannelConnection from '../../models/AiChannelConnection';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AuditLog from '../../models/AuditLog';
import User from '../../models/User';
import { JWT_SECRET } from '../../middleware/auth';
import { mountAiVoiceRoutes } from '../bootstrap';
import { ensurePlatformConnection } from '../lib/workerLease';
import { invalidateSettings } from '../settings';
import { __resetCallBridgeForTests, initCallBridge } from '../telegram/callBridge';
import { decideIncomingCall, initIncomingCalls } from '../telegram/incomingCalls';
import { workerHub } from '../telegram/workerNamespace';
import { tone } from '../voice/audio';
import { FakeVoiceProvider } from '../voice/fakeProvider';
import { setVoiceSessionManager, VoiceSessionManager } from '../voice/sessionManager';
import { FakeWorker, startWorkerServer, useWorkerPubkey, type WorkerServer } from './fakeWorker';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';
import AiTgAccount from '../../models/AiTgAccount';

let mongo: MongoMemoryServer;
let A: SeedCompany;
let OFF: SeedCompany;
let srv: WorkerServer;
let mgr: VoiceSessionManager;
let w: FakeWorker;
let dev: string;
const saved = { en: process.env.AI_VOICE_ENABLED, pub: process.env.AIV_WORKER_PUBKEY, cap: process.env.AI_LIVE_MAX_CONCURRENT };
const PLATFORM_TG = { scope: 'platform', companyId: null, type: 'telegram_user' } as const;

const app = express();
app.use(express.json());
mountAiVoiceRoutes(app);
const P = '/api/ai-voice/platform/telegram-account';
const tok = (id: string) => `Bearer ${jwt.sign({ userId: id }, JWT_SECRET)}`;
const setOpen = (id: string, body: unknown) => request(app).post(`${P}/open-conversation`).set('Authorization', tok(id)).send(body as object);

async function contact(c: SeedCompany, employeeId: string, tgUserId: string, consent = 'granted') {
  await AiEmployeeContact.create({ companyId: c.companyId, employeeId, telegram: { tgUserId, callConsent: consent, resolveStatus: 'resolved' } } as any);
}
const incomingAudits = () => AuditLog.find({ entity: 'ai_telegram_incoming' }).sort({ createdAt: 1 }).lean() as Promise<any[]>;

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  process.env.AI_LIVE_MAX_CONCURRENT = '5';
  useWorkerPubkey();
  mongo = await startMongo();
  await AuditLog.init();
  A = await seedCompany('TgIn');
  OFF = await seedCompany('OffTgIn', { aiEnabled: false });
  dev = String((await User.create({ firstName: 'DevIn', phone: '+998900077001', role: 'dasturchi' } as any))._id);
  srv = await startWorkerServer();
  initCallBridge();
  initIncomingCalls();
  await ensurePlatformConnection();
  await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { status: 'connected', lastHealthAt: new Date() } });
  await contact(A, A.workerId, '880001');
  await contact(A, A.prorabId, '880002', 'requested');
  await contact(A, A.worker2Id, '880003');
  await contact(A, A.orinbosarId, '880005');
  await contact(OFF, OFF.workerId, '880004');
  await User.updateOne({ _id: A.worker2Id }, { $set: { isBlocked: true } });
  // Ishchi rollar smenadan tashqarida bloklanmasin (in-app bilan bir xil qoida — bu yerda sinalmaydi)
  await (await import('../../models/AiAssistantSettings')).default.updateOne({ companyId: A.companyId }, { $set: { 'tools.allowOffShiftAssistant': true } });
  // Bitta worker butun fayl uchun (lease yopilgandan keyin 10 s band bo'ladi)
  w = await FakeWorker.ready(srv.url);
}, 120_000);

beforeEach(async () => {
  mgr = new VoiceSessionManager({
    providerFor: (k) => (k === 'gemini_live' ? new FakeVoiceProvider() : null),
    clipOnLive: true, disclosure: { getClip: async () => tone(60, 24_000) }, setupTimeoutMs: 1_000, touchMs: 500,
  });
  setVoiceSessionManager(mgr);
});

afterEach(async () => {
  w.audio.length = 0;
  await mgr.drain(2_000);
  mgr.dispose();
  setVoiceSessionManager(null);
  __resetCallBridgeForTests();
  await AiCallSession.deleteMany({});
});

afterAll(async () => {
  const down = new Promise((r) => workerHub.once('down', r));
  w.close();
  await Promise.race([down, new Promise((r) => setTimeout(r, 1_000))]);
  await srv.close();
  for (const [k, v] of [['AI_VOICE_ENABLED', saved.en], ['AIV_WORKER_PUBKEY', saved.pub], ['AI_LIVE_MAX_CONCURRENT', saved.cap]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await stopMongo(mongo);
});

describe('platforma toggle', () => {
  it("faqat dasturchi; standart o'chiq; bazada saqlanadi, audit yoziladi, workerga yuboriladi", async () => {
    expect((await setOpen(A.ownerId, { enabled: true })).status).toBe(403);
    expect((await request(app).post(`${P}/open-conversation`).send({ enabled: true })).status).toBe(401);
    const g = await request(app).get(P).set('Authorization', tok(dev));
    expect(g.body.openConversation).toBe(false);
    // Worker ulanganda joriy holat (o'chiq) yuborilgan
    await vi.waitFor(() => expect(w.rpcsOf('incoming.config').map((r) => r.params)).toContainEqual({ open: false }));
    expect((await setOpen(dev, { enabled: 'yes' })).status).toBe(400);

    const r = await setOpen(dev, { enabled: true });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, openConversation: true, workerSynced: true });
    expect((await AiChannelConnection.findOne(PLATFORM_TG).lean() as any)).toMatchObject({ openConversation: true, openConversationBy: dev });
    expect(w.rpcsOf('incoming.config').at(-1)!.params).toEqual({ open: true });
    expect((await request(app).get(P).set('Authorization', tok(dev))).body.openConversation).toBe(true);
    const a: any = await AuditLog.findOne({ entity: 'ai_telegram_account', description: /Ochiq muloqot.*yoqildi/ }).lean();
    expect(a?.userId).toBe(dev);

    expect((await setOpen(dev, { enabled: false })).body.openConversation).toBe(false);
    expect((await AiChannelConnection.findOne(PLATFORM_TG).lean() as any).openConversation).toBe(false);
  });
});

async function setCompanyConsent(v: boolean) {
  await (await import('../../models/AiAssistantSettings')).default.updateOne({ companyId: A.companyId }, { $set: { 'calls.companyConsent': v } });
  invalidateSettings();
}

describe("kiruvchi qo'ng'iroq qarori", () => {
  it("o'chiq bo'lsa — rad (closed), sessiya yo'q, audit bor", async () => {
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { openConversation: false } });
    expect(await w.incoming({ tgUserId: '880001' })).toEqual({ accept: false, reason: 'closed' });
    expect(await AiCallSession.countDocuments({})).toBe(0);
    expect((await incomingAudits()).at(-1)).toMatchObject({ userId: 'telegram', description: expect.stringMatching(/rad etildi — closed/) });
  });

  it("yoqilgan: bog'langan + rozilik — qabul, user-initiated sessiya (xodim aktyor), audio yo'li va yakun", async () => {
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { openConversation: true } });
    const ack = await w.incoming({ tgUserId: '880001', workerBusy: false });
    expect(ack).toMatchObject({ accept: true, maxDurationSec: expect.any(Number) });
    if (!ack.accept) throw new Error('accept kutilgan');
    // Workerga firma/xodim id'lari ketmaydi
    // avatar — video avatar ko'rinishi (owner 2026-10-18); firma/xodim id'lari workerga ketmaydi
    expect(Object.keys(ack).sort()).toEqual(['accept', 'avatar', 'maxDurationSec', 'sessionId']);
    const s: any = await AiCallSession.findById(ack.sessionId).lean();
    expect(s).toMatchObject({ companyId: A.companyId, employeeId: A.workerId, channel: 'telegram_call', direction: 'inbound', purpose: 'assistant', isActive: true });
    const au = (await incomingAudits()).at(-1);
    expect(au).toMatchObject({ userId: A.workerId, entityId: ack.sessionId, description: expect.stringMatching(/qabul qilindi/) });

    // Ikkinchi qo'ng'iroq shu payt — band (A1)
    expect(await w.incoming({ tgUserId: '880005' })).toMatchObject({ accept: false, reason: 'busy' });

    await w.callState(ack.sessionId, 'dialing');
    await w.callState(ack.sessionId, 'connected');
    await vi.waitFor(async () => expect((await AiCallSession.findById(ack.sessionId).lean() as any).status).toBe('connected'));
    await vi.waitFor(() => expect(w.audio.length).toBeGreaterThan(0), { timeout: 5_000 });   // disclosure → worker
    await w.callState(ack.sessionId, 'ended', 'completed');
    await vi.waitFor(async () => expect((await AiCallSession.findById(ack.sessionId).lean() as any)).toMatchObject({ isActive: false, status: 'completed' }));
  });

  it("firma akkauntiga kiruvchi (owner 2026-10-19): Ochiq muloqot o'chiq bo'lsa ham qabul; boshqa firma xodimi / noma'lum akkaunt — rad; band akkaunt — busy", async () => {
    const own = await AiTgAccount.create({ companyId: A.companyId, status: 'connected', lastHealthAt: new Date() });
    const own2 = await AiTgAccount.create({ companyId: A.companyId, status: 'connected', lastHealthAt: new Date() });
    const other = await AiTgAccount.create({ companyId: OFF.companyId, status: 'connected', lastHealthAt: new Date() });
    expect(await w.incoming({ tgUserId: '880001', account: String(other._id) })).toEqual({ accept: false, reason: 'other_company' });
    expect(await w.incoming({ tgUserId: '880001', account: '0123456789abcdef01234567' })).toEqual({ accept: false, reason: 'unknown_account' });
    const ack = await w.incoming({ tgUserId: '880001', account: String(own._id) });
    expect(ack).toMatchObject({ accept: true });
    if (!ack.accept) throw new Error('accept kutilgan');
    expect((await AiCallSession.findById(ack.sessionId).lean() as any).tgAccountId).toBe(String(own._id));
    // Shu akkaunt band; boshqa akkaunt va platforma alohida
    expect(await w.incoming({ tgUserId: '880005', account: String(own._id) })).toMatchObject({ accept: false, reason: 'busy' });
    await AiTgAccount.deleteMany({});
    void own2;
  });

  it("notanish / rozilik yo'q / bloklangan / AI o'chiq firma / worker band — rad, sessiya yaratilmaydi", async () => {
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { openConversation: true } });
    expect(await w.incoming({ tgUserId: '123456789' })).toEqual({ accept: false, reason: 'unknown_caller' });
    // Kompaniya roziligi o'chiq va shaxsiy rozilik yo'q — rad (owner 2026-10-16)
    await setCompanyConsent(false);
    expect(await w.incoming({ tgUserId: '880002' })).toEqual({ accept: false, reason: 'no_consent' });
    expect(await w.incoming({ tgUserId: '880003' })).toEqual({ accept: false, reason: 'blocked' });
    expect(await w.incoming({ tgUserId: '880004' })).toEqual({ accept: false, reason: 'ai_disabled' });
    expect(await w.incoming({ tgUserId: '880005', workerBusy: true })).toEqual({ accept: false, reason: 'busy' });
    expect(await w.incoming({ tgUserId: 'abc' })).toEqual({ accept: false, reason: 'bad_request' });
    await setCompanyConsent(true);
    expect(await AiCallSession.countDocuments({})).toBe(0);
    const audits = await incomingAudits();
    const unknown = audits.find((a) => /unknown_caller/.test(a.description));
    expect(unknown).toMatchObject({ userId: 'telegram' });
    expect(unknown.companyId).toBeUndefined();
    expect(unknown.userName).not.toContain('123456789');     // to'liq Telegram id audit nomida yo'q
    for (const r of ['no_consent', 'blocked', 'ai_disabled', 'busy']) expect(audits.some((a) => a.description.endsWith(`— ${r}`)), r).toBe(true);
  });

  it("owner 2026-10-16: kontakt/kod yo'q, ERP botga bog'langan + kompaniya roziligi — qabul, tgUserId darhol backfill", async () => {
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { openConversation: true } });
    await User.updateOne({ _id: A.ownerId }, { $set: { telegramChatId: '880010' } });
    expect(await AiEmployeeContact.countDocuments({ employeeId: A.ownerId })).toBe(0);
    const ack = await w.incoming({ tgUserId: '880010' });
    expect(ack).toMatchObject({ accept: true });
    const ct: any = await AiEmployeeContact.findOne({ companyId: A.companyId, employeeId: A.ownerId }).lean();
    expect(ct.telegram).toMatchObject({ tgUserId: '880010', callConsent: 'none' });
    if (ack.accept) await w.callState(ack.sessionId, 'ended', 'completed');
    // Bot bog'lanishi boshqa xodimga o'tdi — eski kontakt endi bu id bilan qabul qilinmaydi
    await User.updateOne({ _id: A.ownerId }, { $set: { telegramChatId: '880011' } });
    await vi.waitFor(async () => expect(await AiCallSession.countDocuments({ isActive: true })).toBe(0));
    expect(await w.incoming({ tgUserId: '880010' })).toEqual({ accept: false, reason: 'unknown_caller' });
    // Dasturchining bot bog'lanishi — xodim emas: firma kontekstisiz ovozli sessiya yo'q (aniq sabab)
    await User.updateOne({ _id: dev }, { $set: { telegramChatId: '880012' } });
    expect(await w.incoming({ tgUserId: '880012' })).toEqual({ accept: false, reason: 'developer_unsupported' });
    expect(await AiCallSession.countDocuments({ isActive: true })).toBe(0);
  });

  it("bitta raqamdan spam — rad, audit soatiga 10 tadan oshmaydi", async () => {
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { openConversation: true } });
    const before = (await incomingAudits()).length;
    for (let i = 0; i < 12; i++) expect((await decideIncomingCall({ tgUserId: '777000111' })).accept).toBe(false);
    expect((await incomingAudits()).length - before).toBe(10);
  });
});

describe("owner 2026-10-17: cheklovlar va osilgan sessiyalar", () => {
  const connectAndEnd = async (tgUserId: string) => {
    const ack = await w.incoming({ tgUserId, workerBusy: false });
    expect(ack).toMatchObject({ accept: true });
    if (!ack.accept) throw new Error('accept kutilgan');
    await w.callState(ack.sessionId, 'connected');
    await vi.waitFor(async () => expect((await AiCallSession.findById(ack.sessionId).lean() as any).status).toBe('connected'));
    await w.callState(ack.sessionId, 'ended', 'completed');
    await vi.waitFor(async () => expect((await AiCallSession.findById(ack.sessionId).lean() as any).isActive).toBe(false));
  };

  it("ishchi: ulangan qo'ng'iroqdan keyin qisqa tanaffus; ulanmagan urinish sanalmaydi; o'rinbosarga limit yo'q", async () => {
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { openConversation: true } });
    // Ulanmagan (network) urinish — tanaffus boshlanmaydi
    const a1 = await w.incoming({ tgUserId: '880001', workerBusy: false });
    if (!a1.accept) throw new Error('accept kutilgan');
    await w.callState(a1.sessionId, 'ended', 'network');
    await vi.waitFor(async () => expect((await AiCallSession.findById(a1.sessionId).lean() as any).isActive).toBe(false));
    await connectAndEnd('880001');
    const r = await w.incoming({ tgUserId: '880001', workerBusy: false });
    expect(r).toMatchObject({ accept: false, reason: expect.stringMatching(/^limit_cooldown_\d+s$/) });
    // O'rinbosar — ketma-ket (spam himoyasi ham bog'langan xodimga qo'llanmaydi)
    for (let i = 0; i < 3; i++) await connectAndEnd('880005');
  });

  it("bazada osilib qolgan Telegram sessiyasi (worker'da qo'ng'iroq yo'q) — darhol yopiladi, keyingi qo'ng'iroq 'busy' emas", async () => {
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { openConversation: true } });
    const old = new Date(Date.now() - 60_000);
    const { insertedId } = await AiCallSession.collection.insertOne({
      companyId: A.companyId, employeeId: A.prorabId, correlationId: '00000000-0000-4000-8000-00000000abcd', purpose: 'assistant',
      channel: 'telegram_call', direction: 'inbound', status: 'connected', isActive: true, attemptNo: 1, answeredAt: old,
      limits: { ringTimeoutSec: 40, maxDurationSec: 300 }, usage: {}, recording: { enabled: false }, createdAt: old, updatedAt: new Date(),
    } as any);
    const ack = await w.incoming({ tgUserId: '880005', workerBusy: false });
    expect(ack).toMatchObject({ accept: true });
    const stale: any = await AiCallSession.findById(insertedId).lean();
    expect(stale).toMatchObject({ isActive: false, endReason: 'tg:stale' });
    if (ack.accept) await w.callState(ack.sessionId, 'ended', 'completed');
  });
});
