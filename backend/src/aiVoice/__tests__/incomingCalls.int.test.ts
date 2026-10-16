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
import { __resetCallBridgeForTests, initCallBridge } from '../telegram/callBridge';
import { decideIncomingCall, initIncomingCalls } from '../telegram/incomingCalls';
import { workerHub } from '../telegram/workerNamespace';
import { tone } from '../voice/audio';
import { FakeVoiceProvider } from '../voice/fakeProvider';
import { setVoiceSessionManager, VoiceSessionManager } from '../voice/sessionManager';
import { FakeWorker, startWorkerServer, useWorkerPubkey, type WorkerServer } from './fakeWorker';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

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
    disclosure: { getClip: async () => tone(60, 24_000) }, setupTimeoutMs: 1_000, touchMs: 500,
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
    expect(Object.keys(ack).sort()).toEqual(['accept', 'maxDurationSec', 'sessionId']);
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

  it("notanish / rozilik yo'q / bloklangan / AI o'chiq firma / worker band — rad, sessiya yaratilmaydi", async () => {
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { openConversation: true } });
    expect(await w.incoming({ tgUserId: '123456789' })).toEqual({ accept: false, reason: 'unknown_caller' });
    expect(await w.incoming({ tgUserId: '880002' })).toEqual({ accept: false, reason: 'no_consent' });
    expect(await w.incoming({ tgUserId: '880003' })).toEqual({ accept: false, reason: 'blocked' });
    expect(await w.incoming({ tgUserId: '880004' })).toEqual({ accept: false, reason: 'ai_disabled' });
    expect(await w.incoming({ tgUserId: '880005', workerBusy: true })).toEqual({ accept: false, reason: 'busy' });
    expect(await w.incoming({ tgUserId: 'abc' })).toEqual({ accept: false, reason: 'bad_request' });
    expect(await AiCallSession.countDocuments({})).toBe(0);
    const audits = await incomingAudits();
    const unknown = audits.find((a) => /unknown_caller/.test(a.description));
    expect(unknown).toMatchObject({ userId: 'telegram' });
    expect(unknown.companyId).toBeUndefined();
    expect(unknown.userName).not.toContain('123456789');     // to'liq Telegram id audit nomida yo'q
    for (const r of ['no_consent', 'blocked', 'ai_disabled', 'busy']) expect(audits.some((a) => a.description.endsWith(`— ${r}`)), r).toBe(true);
  });

  it("bitta raqamdan spam — rad, audit soatiga 10 tadan oshmaydi", async () => {
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { openConversation: true } });
    const before = (await incomingAudits()).length;
    for (let i = 0; i < 12; i++) expect((await decideIncomingCall({ tgUserId: '777000111' })).accept).toBe(false);
    expect((await incomingAudits()).length - before).toBe(10);
  });
});
