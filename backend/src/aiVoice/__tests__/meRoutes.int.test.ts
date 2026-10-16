// /api/ai-voice/me (P3, supertest): faqat o'z ma'lumotlari — boshqa foydalanuvchini o'zgartirib bo'lmaydi;
// workGate ALLOW (smenasi yopiq ishchi ham kiradi, boshqa yo'l 423); dasturchi 403; AI o'chiq — faqat GET /.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../../models/User';
import ConsentLog from '../../models/ConsentLog';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiReminder from '../../models/AiReminder';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiCallSession from '../../models/AiCallSession';
import { JWT_SECRET, requireAuth, blockDeveloper } from '../../middleware/auth';
import meRoutes from '../routes/meRoutes';
import { __setSettingsCacheTtlForTests } from '../settings';
import { newButtonToken, newCorrelationId } from '../lib/ids';
import { localDate } from '../lib/zonedTime';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
const ENV = process.env.AI_VOICE_ENABLED;
let A: SeedCompany, B: SeedCompany;
let devId = '';

// bootstrap.mountAiVoiceRoutes bilan bir xil ulanish (requireAuth ichida workGate ishlaydi)
const app = express();
app.use(express.json());
app.use('/api/ai-voice/me', requireAuth, blockDeveloper, meRoutes);
app.use('/api/ai-voice/admin', requireAuth, blockDeveloper, Router().get('/settings', (_q, r) => { r.json({ ok: true }); }));

const tok = (userId: string) => `Bearer ${jwt.sign({ userId }, JWT_SECRET)}`;
const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, userId: string, body?: unknown) => {
  const r = request(app)[method](`/api/ai-voice/me${path}`).set('Authorization', tok(userId));
  return body !== undefined ? r.send(body as object) : r;
};

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  __setSettingsCacheTtlForTests(0);
  mongo = await startMongo();
  A = await seedCompany('MeA');
  B = await seedCompany('MeB');
  devId = String((await User.create({ firstName: 'Dev', phone: '+998909990001', role: 'dasturchi' } as any))._id);
}, 120_000);
afterAll(async () => {
  if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV;
  await stopMongo(mongo);
});
beforeEach(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  await AiEmployeeContact.deleteMany({});
  await AiReminder.deleteMany({});
  await AiAttendanceConfirmation.deleteMany({});
});

describe('auth / workGate', () => {
  it('tokensiz 401, dasturchi 403', async () => {
    expect((await request(app).get('/api/ai-voice/me')).status).toBe(401);
    expect((await api('get', '/', devId)).status).toBe(403);
  });
  it("smenasi yopiq ishchi (bugun check-in yo'q): /me ochiq, boshqa yo'l 423", async () => {
    expect((await api('get', '/', A.workerId)).status).toBe(200);
    expect((await api('get', '/reminders', A.workerId)).status).toBe(200);
    expect((await api('get', '/attendance/today', A.workerId)).status).toBe(200);
    const admin = await request(app).get('/api/ai-voice/admin/settings').set('Authorization', tok(A.workerId));
    expect(admin.status).toBe(423);
  });
  it("AI o'chiq — GET / holatni ko'rsatadi, qolgani 403 ai_disabled", async () => {
    process.env.AI_VOICE_ENABLED = 'false';
    const r = await api('get', '/', A.workerId);
    expect(r.status).toBe(200);
    expect(r.body.status.aiActive).toBe(false);
    expect((await api('get', '/reminders', A.workerId)).body).toEqual({ error: 'ai_disabled' });
    expect((await api('patch', '/', A.workerId, { optOut: { calls: true } })).status).toBe(403);
  });
});

describe('GET/PATCH /', () => {
  // Owner 2026-10-16: PATCH faqat rahbarlar (o'zi uchun)
  let BOSS: string;
  beforeAll(() => { BOSS = A.orinbosarId; });
  it('standart sozlamalar va holat', async () => {
    const r = await api('get', '/', A.workerId);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ disabledChannels: [], callConsent: 'none', optOut: { calls: false, reminders: false, all: false }, quietHours: null });
    expect(r.body.status).toMatchObject({ aiActive: true, telegramLinked: false, planHasFeature: true });
  });
  it("owner 2026-10-16: xodim AI sozlamalarini o'zgartira olmaydi — PATCH 403, GET faqat ko'rish", async () => {
    for (const id of [A.workerId, A.prorabId]) {
      for (const body of [{ callConsent: 'granted' }, { optOut: { calls: true } }, { disabledChannels: ['push'] }, { channelOrder: ['push'] },
        { quietHours: { from: '22:00', to: '07:00' } }, { languageOverride: 'ru' }]) {
        expect((await api('patch', '/', id, body)).status).toBe(403);
      }
    }
    expect(await AiEmployeeContact.countDocuments({ employeeId: A.workerId, $or: [{ 'optOut.calls': true }, { quietHours: { $exists: true } }] })).toBe(0);
    expect(await ConsentLog.countDocuments({ userId: A.workerId })).toBe(0);
    const g = await api('get', '/', A.workerId);
    expect(g.status).toBe(200);
    expect(g.body.status).toMatchObject({ canEdit: false, companyConsent: true, callsAllowed: true });
    expect((await api('get', '/', BOSS)).body.status.canEdit).toBe(true);
  });
  it("o'z sozlamalari: til, kanal tartibi, opt-out, rozilik (ConsentLog source:'me')", async () => {
    const r = await api('patch', '/', BOSS, {
      languageOverride: 'ru', channelOrder: ['push', 'bot_message'], disabledChannels: ['telegram_call'],
      optOut: { calls: true }, callConsent: 'granted',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ languageOverride: 'ru', channelOrder: ['push', 'bot_message'], disabledChannels: ['telegram_call'], callConsent: 'granted', optOut: { calls: true } });
    const logs: any[] = await ConsentLog.find({ userId: BOSS }).lean();
    expect(logs.map((l) => [l.consentType, l.source]).sort()).toEqual([['ai_call', 'me'], ['ai_opt_out', 'me']]);
    // null — o'chiradi
    const r2 = await api('patch', '/', BOSS, { languageOverride: null, channelOrder: null });
    expect(r2.body.languageOverride).toBeUndefined();
    expect(r2.body.channelOrder).toBeUndefined();
  });
  it("shaxsiy jim soatlar: o'rnatish (yarim tundan o'tuvchi ham), null — o'chirish", async () => {
    const r = await api('patch', '/', BOSS, { quietHours: { from: '22:00', to: '08:30' } });
    expect(r.status).toBe(200);
    expect(r.body.quietHours).toEqual({ from: '22:00', to: '08:30' });
    expect((await api('get', '/', BOSS)).body.quietHours).toEqual({ from: '22:00', to: '08:30' });
    const r2 = await api('patch', '/', BOSS, { quietHours: null });
    expect(r2.body.quietHours).toBeNull();
    for (const q of [{ from: '25:00', to: '07:00' }, { from: '08:00', to: '08:00' }, { from: '08:00' }, { from: '08:00', to: '09:00', x: 1 }, 'night']) {
      expect((await api('patch', '/', BOSS, { quietHours: q })).status).toBe(400);
    }
  });
  it("boshqa foydalanuvchini o'zgartirib bo'lmaydi (employeeId/userId maydonlari rad etiladi)", async () => {
    for (const body of [{ employeeId: A.worker2Id, optOut: { all: true } }, { userId: A.worker2Id }, { companyId: B.companyId }]) {
      expect((await api('patch', '/', BOSS, body)).status).toBe(400);
    }
    expect(await AiEmployeeContact.countDocuments({ employeeId: A.worker2Id })).toBe(0);
    expect(await AiEmployeeContact.countDocuments({ companyId: B.companyId })).toBe(0);
  });
  it("noto'g'ri qiymatlar — 400", async () => {
    for (const body of [{ channelOrder: ['sms'] }, { channelOrder: ['push', 'push'] }, { optOut: { calls: 'yes' } }, { callConsent: 'none' }, { languageOverride: 'en' }, { optOut: {} }]) {
      expect((await api('patch', '/', BOSS, body)).status).toBe(400);
    }
  });
});

describe('/reminders', () => {
  const due = () => new Date(Date.now() + 3600_000).toISOString();
  it("yaratish (o'zi uchun), ro'yxat, tahrirlash, o'chirish; idempotencyKey", async () => {
    const c = await api('post', '/reminders', A.workerId, { text: 'Hisobot', dueAt: due(), idempotencyKey: 'k1' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ text: 'Hisobot', targetUserId: A.workerId, ownerId: A.workerId, status: 'active', recurrence: { freq: 'none' } });
    expect(c.body.nextFireAt).toBe(c.body.dueAt);
    const again = await api('post', '/reminders', A.workerId, { text: 'Hisobot', dueAt: due(), idempotencyKey: 'k1' });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(c.body.id);
    const list = await api('get', '/reminders', A.workerId);
    expect(list.body.reminders.map((r: any) => r.id)).toEqual([c.body.id]);
    expect(list.body.reminders[0].canCancel).toBe(true);
    const p = await api('patch', `/reminders/${c.body.id}`, A.workerId, { text: 'Hisobot 2', recurrence: { freq: 'weekly', byWeekday: [1, 3] } });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ text: 'Hisobot 2', recurrence: { freq: 'weekly', byWeekday: [1, 3] } });
    expect((await api('delete', `/reminders/${c.body.id}`, A.workerId)).status).toBe(200);
    expect((await AiReminder.findById(c.body.id).lean() as any).status).toBe('cancelled');
  });
  it("boshqaga eslatma qo'yib, boshqanikini o'zgartirib/o'chirib bo'lmaydi", async () => {
    expect((await api('post', '/reminders', A.workerId, { text: 'x', dueAt: due(), targetUserId: A.worker2Id })).status).toBe(403);
    const other = await AiReminder.create({ companyId: A.companyId, ownerId: A.worker2Id, targetUserId: A.worker2Id, text: 'begona', dueAt: new Date(Date.now() + 3600_000), nextFireAt: new Date(Date.now() + 3600_000), correlationId: newCorrelationId() });
    const id = String(other._id);
    expect((await api('patch', `/reminders/${id}`, A.workerId, { text: 'buzildi' })).status).toBe(404);
    expect((await api('delete', `/reminders/${id}`, A.workerId)).status).toBe(404);
    expect((await api('post', `/reminders/${id}/action`, A.workerId, { action: 'done' })).status).toBe(404);
    expect((await api('get', '/reminders', A.workerId)).body.reminders).toHaveLength(0);
    expect((await AiReminder.findById(id).lean() as any)).toMatchObject({ text: 'begona', status: 'active' });
    // Boshqa firma foydalanuvchisi ham ko'rmaydi
    expect((await api('patch', `/reminders/${id}`, B.workerId, { text: 'buzildi' })).status).toBe(404);
  });
  it("validatsiya: o'tgan vaqt, matn uzunligi, kanallar, takrorlanish", async () => {
    expect((await api('post', '/reminders', A.workerId, { text: 'x', dueAt: new Date(Date.now() - 3600_000).toISOString() })).status).toBe(400);
    expect((await api('post', '/reminders', A.workerId, { text: 'x'.repeat(501), dueAt: due() })).status).toBe(400);
    expect((await api('post', '/reminders', A.workerId, { text: 'x', dueAt: due(), channels: ['telegram_call'] })).status).toBe(400);
    expect((await api('post', '/reminders', A.workerId, { text: 'x', dueAt: due(), recurrence: { freq: 'hourly' } })).status).toBe(400);
    expect((await api('post', '/reminders', A.workerId, { text: 'x', dueAt: due(), recurrence: { freq: 'weekly', byWeekday: [0] } })).status).toBe(400);
    // O'tgan vaqtli takroriy — keyingi hodisadan boshlanadi
    const r = await api('post', '/reminders', A.workerId, { text: 'har kuni', dueAt: new Date(Date.now() - 3600_000).toISOString(), recurrence: { freq: 'daily' } });
    expect(r.status).toBe(201);
    expect(new Date(r.body.nextFireAt).getTime()).toBeGreaterThan(Date.now());
  });
  it('veb amali: done/snooze (maqsad foydalanuvchi)', async () => {
    const c = await api('post', '/reminders', A.workerId, { text: 'Tekshir', dueAt: due() });
    const s = await api('post', `/reminders/${c.body.id}/action`, A.workerId, { action: 'snooze', snoozeMin: 15 });
    expect(s.body).toMatchObject({ ok: true, status: 'active', already: false });
    const d = await api('post', `/reminders/${c.body.id}/action`, A.workerId, { action: 'done' });
    expect(d.body).toMatchObject({ ok: true, status: 'done' });
  });
});

describe('/attendance', () => {
  async function mkConf(employeeId: string, companyId = A.companyId) {
    return AiAttendanceConfirmation.create({
      companyId, employeeId, date: localDate(), shiftId: 'main', scheduledAt: new Date(), buttonToken: newButtonToken(), correlationId: newCorrelationId(),
    });
  }
  it("bugungi holat va veb javob (confirmed — checked_in EMAS); boshqaning tasdig'i — 404", async () => {
    const mine = await mkConf(A.workerId);
    const other = await mkConf(A.worker2Id);
    const t = await api('get', '/attendance/today', A.workerId);
    expect(t.body.confirmations).toHaveLength(1);
    expect(t.body.confirmations[0]).toMatchObject({ confirmationId: String(mine._id), status: 'pending', canRespond: true });
    const r = await api('post', `/attendance/${mine._id}/respond`, A.workerId, { answer: 'confirm' });
    expect(r.body).toEqual({ ok: true, status: 'confirmed', already: false });
    expect((await api('post', `/attendance/${mine._id}/respond`, A.workerId, { answer: 'decline' })).body).toEqual({ ok: true, status: 'confirmed', already: true });
    expect((await api('post', `/attendance/${other._id}/respond`, A.workerId, { answer: 'confirm' })).status).toBe(404);
    expect((await AiAttendanceConfirmation.findById(other._id).lean() as any).status).toBe('pending');
    expect((await api('post', `/attendance/${mine._id}/respond`, A.workerId, { answer: 'checked_in' })).status).toBe(400);
    expect((await api('post', `/attendance/${mine._id}/respond`, B.workerId, { answer: 'confirm' })).status).toBe(404);
  });
  it("yakunlangan tasdiq — 409 finalized", async () => {
    const c = await mkConf(A.workerId);
    await AiAttendanceConfirmation.updateOne({ _id: c._id }, { $set: { status: 'absent', finalizedAt: new Date() } });
    const r = await api('post', `/attendance/${c._id}/respond`, A.workerId, { answer: 'confirm' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('finalized');
  });
});

describe('/pending-call', () => {
  it("faqat o'zining muddati o'tmagan in-app qo'ng'irog'i", async () => {
    expect((await api('get', '/pending-call', A.workerId)).body).toEqual({ call: null });
    const s = await AiCallSession.create({ companyId: A.companyId, employeeId: A.workerId, correlationId: newCorrelationId(), purpose: 'attendance', channel: 'inapp_call', status: 'ringing', isActive: true, ringingAt: new Date() });
    const r = await api('get', '/pending-call', A.workerId);
    expect(r.body.call).toMatchObject({ sessionId: String(s._id), purpose: 'attendance' });
    expect((await api('get', '/pending-call', A.worker2Id)).body).toEqual({ call: null });
    await AiCallSession.deleteMany({});
  });
});
