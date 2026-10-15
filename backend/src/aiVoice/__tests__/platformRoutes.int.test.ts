// /api/ai-voice/platform/telegram-account (P6, review B7/B8): faqat dasturchi, no-store, login (telefon →
// kod → 2FA) soxta worker orqali; telefon/kod/parol hech qayerda saqlanmaydi, audit/log qilinmaydi;
// Telegram sessiyasi bazada yo'q; sinov qo'ng'irog'i faqat rozilik bilan, audit + soatiga 5 ta.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiCallSession from '../../models/AiCallSession';
import AiChannelConnection from '../../models/AiChannelConnection';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AuditLog from '../../models/AuditLog';
import User from '../../models/User';
import { JWT_SECRET } from '../../middleware/auth';
import { mountAiVoiceRoutes } from '../bootstrap';
import { __resetPlatformRoutesForTests, LOGIN_MAX, TEST_CALL_MAX } from '../routes/platformRoutes';
import { workerHub } from '../telegram/workerNamespace';
import { tone } from '../voice/audio';
import { FakeVoiceProvider } from '../voice/fakeProvider';
import { setVoiceSessionManager, VoiceSessionManager } from '../voice/sessionManager';
import { FakeWorker, RpcErr, startWorkerServer, useWorkerPubkey, type WorkerServer } from './fakeWorker';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany;
let srv: WorkerServer;
let mgr: VoiceSessionManager;
let devSeq = 0;
const workers: FakeWorker[] = [];
const saved = { en: process.env.AI_VOICE_ENABLED, pub: process.env.AIV_WORKER_PUBKEY, cap: process.env.AI_LIVE_MAX_CONCURRENT };
const PLATFORM_TG = { scope: 'platform', companyId: null, type: 'telegram_user' } as const;

const PHONE = '+998935551234';
const CODE = '73519';
const PASSWORD = 'Sir-Parol-2FA-xyz!';

const app = express();
app.use(express.json());
mountAiVoiceRoutes(app);

const P = '/api/ai-voice/platform/telegram-account';
const tok = (id: string) => `Bearer ${jwt.sign({ userId: id }, JWT_SECRET)}`;
const post = (path: string, id: string, body: unknown = {}) => request(app).post(`${P}${path}`).set('Authorization', tok(id)).send(body as object);
const get = (path: string, id: string) => request(app).get(`${P}${path}`).set('Authorization', tok(id));

async function newDev(): Promise<string> {
  devSeq++;
  return String((await User.create({ firstName: `Dev${devSeq}`, phone: `+99890009${String(devSeq).padStart(4, '0')}`, role: 'dasturchi' } as any))._id);
}
async function worker(): Promise<FakeWorker> { const w = await FakeWorker.ready(srv.url); workers.push(w); return w; }

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  process.env.AI_LIVE_MAX_CONCURRENT = '5';
  useWorkerPubkey();
  mongo = await startMongo();
  await AuditLog.init();
  A = await seedCompany('TgPl');
  srv = await startWorkerServer();
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
  __resetPlatformRoutesForTests();
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

describe('kirish huquqi', () => {
  it("faqat dasturchi: firma egasi/direktor — 403; tokensiz — 401; javoblar no-store", async () => {
    const dev = await newDev();
    for (const [m, path] of [['get', ''], ['post', '/login/start'], ['post', '/login/code'], ['post', '/login/password'], ['post', '/logout'], ['post', '/test-call'], ['get', '/test-targets'], ['post', '/udp-probe']] as const) {
      const r = m === 'get' ? await get(path, A.ownerId) : await post(path, A.ownerId, {});
      expect(r.status, path).toBe(403);
    }
    expect((await request(app).get(P)).status).toBe(401);
    const r = await get('', dev);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toMatchObject({ aiVoiceEnabled: true, account: { status: 'disconnected', workerConnected: false }, worker: { connectedHere: false } });
  });

  it("worker ulanmagan — 503 worker_offline (validatsiyadan keyin)", async () => {
    const dev = await newDev();
    expect((await post('/login/start', dev, { phone: 'abc' })).body).toEqual({ error: 'phone_invalid' });
    const r = await post('/login/start', dev, { phone: PHONE });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'worker_offline' });
  });
});

describe('login: telefon → kod → 2FA (B8)', () => {
  it("to'liq oqim; maxfiy qiymatlar hech qayerda saqlanmaydi, log/audit qilinmaydi, javobda qaytmaydi", async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k));
    try {
      const dev = await newDev();
      const w = await worker();
      w.handlers['auth.start'] = () => ({ status: 'awaiting_code', phoneMasked: 'x' });
      w.handlers['auth.code'] = () => ({ status: 'awaiting_password' });
      w.handlers['auth.password'] = () => ({ status: 'connected', tgUserId: '5550001', username: 'qurilish_ai', displayName: 'AI Yordamchi' });

      const r1 = await post('/login/start', dev, { phone: PHONE });
      expect(r1.status).toBe(200);
      expect(r1.headers['cache-control']).toBe('no-store');
      expect(r1.body.status).toBe('awaiting_code');
      expect(r1.body.loginAttemptId).toMatch(/^[0-9a-f-]{36}$/);
      expect(r1.body.phoneMasked).not.toContain('551234');
      expect(w.rpcsOf('auth.start')[0].params).toEqual({ loginAttemptId: r1.body.loginAttemptId, phone: PHONE });
      expect((await AiChannelConnection.findOne(PLATFORM_TG).lean() as any).status).toBe('awaiting_code');

      // Boshqa dasturchi bu urinishni davom ettira olmaydi
      const dev2 = await newDev();
      expect((await post('/login/code', dev2, { loginAttemptId: r1.body.loginAttemptId, code: CODE })).status).toBe(410);
      // Noto'g'ri formatli kod — RPC'siz rad
      expect((await post('/login/code', dev, { loginAttemptId: r1.body.loginAttemptId, code: '12' })).body).toEqual({ error: 'code_invalid' });
      expect(w.rpcsOf('auth.code')).toHaveLength(0);

      const r2 = await post('/login/code', dev, { loginAttemptId: r1.body.loginAttemptId, code: CODE });
      expect(r2.body).toEqual({ status: 'awaiting_password', loginAttemptId: r1.body.loginAttemptId });
      expect((w.rpcsOf('auth.code')[0].params as any).code).toBe(CODE);

      const r3 = await post('/login/password', dev, { loginAttemptId: r1.body.loginAttemptId, password: PASSWORD });
      expect(r3.status).toBe(200);
      expect(r3.body).toMatchObject({ status: 'connected', account: { status: 'connected', username: 'qurilish_ai', workerConnected: true } });
      // Urinish yopildi — qayta ishlatib bo'lmaydi
      expect((await post('/login/password', dev, { loginAttemptId: r1.body.loginAttemptId, password: PASSWORD })).status).toBe(410);

      const doc: any = await AiChannelConnection.findOne(PLATFORM_TG).lean();
      expect(doc).toMatchObject({ status: 'connected', tgUserId: '5550001', username: 'qurilish_ai', connectedBy: dev });
      // Bazada Telegram sessiyasi yoki unga o'xshash maydon YO'Q
      expect(Object.keys(doc).filter((k) => /session|authkey|string_?session/i.test(k))).toEqual([]);

      // Butun baza: telefon (to'liq), kod, parol hech qayerda yo'q
      const dump: string[] = [];
      for (const c of await mongoose.connection.db!.listCollections().toArray()) {
        dump.push(JSON.stringify(await mongoose.connection.db!.collection(c.name).find({}).toArray()));
      }
      const all = dump.join('\n');
      expect(all).not.toContain(PHONE);
      expect(all).not.toContain('935551234');
      expect(all).not.toContain(PASSWORD);
      expect(all).not.toMatch(new RegExp(`"${CODE}"`));
      // Audit bor, lekin qiymatlarsiz
      const audits: any[] = await AuditLog.find({ entity: 'ai_telegram_account' }).lean();
      expect(audits.length).toBeGreaterThanOrEqual(2);
      // Konsol: hech bir chaqiruvda maxfiy qiymat yo'q
      const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map((x) => String(x instanceof Error ? x.message : typeof x === 'object' ? JSON.stringify(x) : x)).join(' '))).join('\n');
      for (const secret of [PHONE, CODE, PASSWORD]) expect(logged).not.toContain(secret);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it("worker xatolari HTTP kodlariga o'tadi; flood-wait akkauntga yoziladi", async () => {
    const dev = await newDev();
    const w = await worker();
    w.handlers['auth.start'] = () => ({ status: 'awaiting_code' });
    w.handlers['auth.code'] = () => { throw new RpcErr('code_invalid'); };
    const r1 = await post('/login/start', dev, { phone: PHONE });
    const r2 = await post('/login/code', dev, { loginAttemptId: r1.body.loginAttemptId, code: CODE });
    expect(r2.status).toBe(400);
    expect(r2.body).toEqual({ error: 'code_invalid' });
    w.handlers['auth.start'] = () => { throw new RpcErr('flood_wait', 300); };
    const r3 = await post('/login/start', dev, { phone: PHONE });
    expect(r3.status).toBe(429);
    expect(r3.body).toEqual({ error: 'flood_wait', retryAfterSec: 300 });
    const doc: any = await AiChannelConnection.findOne(PLATFORM_TG).lean();
    expect(new Date(doc.floodWaitUntil).getTime()).toBeGreaterThan(Date.now() + 200_000);
  });

  it(`login qadamlari: ${LOGIN_MAX} ta / 10 daqiqa`, async () => {
    const dev = await newDev();
    const w = await worker();
    w.handlers['auth.start'] = () => ({ status: 'awaiting_code' });
    for (let i = 0; i < LOGIN_MAX; i++) expect((await post('/login/start', dev, { phone: PHONE })).status).toBe(200);
    const r = await post('/login/start', dev, { phone: PHONE });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('rate_limited');
    expect(w.rpcsOf('auth.start')).toHaveLength(LOGIN_MAX);
  });

  it("chiqish (logout): worker RPC, akkaunt ma'lumotlari tozalanadi, audit", async () => {
    const dev = await newDev();
    const w = await worker();
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { status: 'connected', tgUserId: '5550001', username: 'qurilish_ai', phoneMasked: '+9989*****34' } });
    const r = await post('/logout', dev);
    expect(r.status).toBe(200);
    expect(w.rpcsOf('auth.logout')).toHaveLength(1);
    const doc: any = await AiChannelConnection.findOne(PLATFORM_TG).lean();
    expect(doc.status).toBe('disconnected');
    expect(doc.tgUserId).toBeUndefined();
    expect(doc.username).toBeUndefined();
    expect(await AuditLog.countDocuments({ entity: 'ai_telegram_account', action: 'delete', userId: dev })).toBe(1);
  });

  it("UDP tekshiruv natijasi saqlanadi", async () => {
    const dev = await newDev();
    await worker();
    const r = await post('/udp-probe', dev);
    expect(r.body).toEqual({ ok: true, details: 'fake' });
    expect((await get('', dev)).body.account.udpOk).toBe(true);
  });
});

describe("sinov qo'ng'irog'i (B7)", () => {
  async function ready() {
    const w = await worker();
    await AiChannelConnection.updateOne(PLATFORM_TG, { $set: { status: 'connected', lastHealthAt: new Date() } });
    return w;
  }

  it("rozilik yo'q — 409 no_consent, qo'ng'iroq yo'q; nomzodlar ro'yxatida faqat rozilik berganlar", async () => {
    const dev = await newDev();
    const w = await ready();
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.worker2Id, telegram: { tgUserId: '880001', callConsent: 'requested' } } as any);
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, telegram: { tgUserId: '880002', callConsent: 'granted', resolveStatus: 'resolved' } } as any);
    const r = await post('/test-call', dev, { userId: A.worker2Id });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'no_consent' });
    expect(w.rpcsOf('call.place')).toHaveLength(0);
    expect((await post('/test-call', dev, { userId: 'bad' })).status).toBe(400);
    const t = await get('/test-targets', dev);
    expect(t.body.targets.map((x: any) => x.userId)).toEqual([A.workerId]);
    expect(t.body.targets[0]).toMatchObject({ companyName: 'TgPl', resolveStatus: 'resolved' });
  });

  it("rozilik bor — 202, worker'ga call.place, firma bilan audit yozuvi", async () => {
    const dev = await newDev();
    const w = await ready();
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, telegram: { tgUserId: '880003', callConsent: 'granted', resolveStatus: 'resolved' } } as any);
    const r = await post('/test-call', dev, { userId: A.workerId });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ placed: true, outcome: 'no_answer' });
    expect(w.rpcsOf('call.place')[0].params).toMatchObject({ sessionId: r.body.sessionId, tgUserId: '880003', maxDurationSec: 60 });
    const s: any = await AiCallSession.findById(r.body.sessionId).lean();
    expect(s).toMatchObject({ purpose: 'test', channel: 'telegram_call', companyId: A.companyId });
    const a: any = await AuditLog.findOne({ entity: 'ai_telegram_account', action: 'create', userId: dev }).lean();
    expect(a).toMatchObject({ companyId: A.companyId, entityId: A.workerId });
  });

  it("rozilik bor, lekin kanal mavjud emas (aniqlanmagan) — 409 placed:false, baribir audit", async () => {
    const dev = await newDev();
    await ready();
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, telegram: { tgUserId: '880004', callConsent: 'granted', resolveStatus: 'unknown' } } as any);
    const r = await post('/test-call', dev, { userId: A.workerId });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ placed: false, outcome: 'unavailable', errorCode: 'not_resolved' });
    expect(await AuditLog.countDocuments({ entity: 'ai_telegram_account', action: 'create', userId: dev, companyId: A.companyId })).toBe(1);
  });

  it(`${TEST_CALL_MAX} ta / soat`, async () => {
    const dev = await newDev();
    await ready();
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, telegram: { tgUserId: '880005', callConsent: 'granted', resolveStatus: 'unknown' } } as any);
    for (let i = 0; i < TEST_CALL_MAX; i++) expect((await post('/test-call', dev, { userId: A.workerId })).status).toBe(409);
    const r = await post('/test-call', dev, { userId: A.workerId });
    expect(r.status).toBe(429);
  });
});
