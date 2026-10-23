// /api/ai-voice/platform/office (owner 2026-10-22, "AI ofis"): faqat dasturchi; agentlar ro'yxati shakli —
// AI Telegram akkauntlari (faol qo'ng'iroq → band), rollar (faol qo'ng'iroq / oxirgi 2 daqiqadagi suhbat), dasturchi
// paneli va dasturchi bot; 5 s kesh.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiCallSession from '../../models/AiCallSession';
import AiConversation from '../../models/AiConversation';
import AiTgAccount from '../../models/AiTgAccount';
import User from '../../models/User';
import { JWT_SECRET } from '../../middleware/auth';
import { mountAiVoiceRoutes } from '../bootstrap';
import { __resetOfficeCacheForTests, officeSnapshot } from '../office';
import { __resetAgentsForTests } from '../agents/service';
import AgentProfile from '../../models/AgentProfile';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany;
let devId: string;
const saved = process.env.AI_VOICE_ENABLED;

const app = express();
app.use(express.json());
mountAiVoiceRoutes(app);

const tok = (id: string) => `Bearer ${jwt.sign({ userId: id }, JWT_SECRET)}`;
const getOffice = (id: string) => request(app).get('/api/ai-voice/platform/office').set('Authorization', tok(id));
let seq = 0;
const session = (employeeId: string, extra: Record<string, unknown> = {}) => AiCallSession.create({
  companyId: A.companyId, employeeId, correlationId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  purpose: 'assistant', channel: 'inapp_call', status: 'connected', isActive: true, answeredAt: new Date(), ...extra,
} as any);

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  mongo = await startMongo();
  A = await seedCompany('Ofis');
  devId = String((await User.create({ firstName: 'Dev', phone: '+998900001234', role: 'dasturchi' } as any))._id);
}, 120_000);

beforeEach(async () => {
  __resetOfficeCacheForTests();
  __resetAgentsForTests();
  await AgentProfile.deleteMany({});
  await AiCallSession.deleteMany({});
  await AiConversation.deleteMany({});
  await AiTgAccount.deleteMany({});
});

afterAll(async () => {
  if (saved === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = saved;
  await stopMongo(mongo);
});

describe('GET /api/ai-voice/platform/office', () => {
  it('faqat dasturchi: firma egasi 403, tokensiz 401', async () => {
    expect((await getOffice(A.ownerId)).status).toBe(403);
    expect((await request(app).get('/api/ai-voice/platform/office')).status).toBe(401);
  });

  it("bo'sh ofis: rollar + dasturchi agentlari, hammasi bo'sh (idle)", async () => {
    const r = await getOffice(devId);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(typeof r.body.generatedAt).toBe('string');
    const ids = r.body.agents.map((a: any) => a.id);
    expect(ids[0]).toBe('manager');
    for (const k of ['backend', 'frontend', 'feature', 'smm', 'marketing', 'reporter', 'billing', 'windows', 'tgworker', 'role-direktor', 'role-ishchi', 'devpanel', 'devbot']) expect(ids).toContain(k);
    expect(ids.length).toBeGreaterThanOrEqual(30);
    for (const a of r.body.agents) {
      expect(a).toMatchObject({ busy: false, activity: 'idle' });
      expect(['tg', 'role', 'code', 'content']).toContain(a.kind);
      expect(typeof a.team).toBe('string');
      expect(a.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(typeof a.name).toBe('string');
      expect(a.since).toBeUndefined();
    }
  });

  it("qo'ng'iroq va suhbatlar: TG akkaunt band (call), rol call > chat, dasturchi bot chat; eski suhbat hisoblanmaydi", async () => {
    const jasur: any = await AiTgAccount.create({ label: 'Jasur', status: 'connected' });
    await AiTgAccount.create({ label: 'Sarvar', status: 'connected' });
    const answeredAt = new Date(Date.now() - 30_000);
    await session(A.workerId, { channel: 'telegram_call', tgAccountId: String(jasur._id), answeredAt });
    await AiConversation.create({ userId: A.workerId, companyId: A.companyId, title: 'x', source: 'chat', messages: [] });
    await AiConversation.create({ userId: A.prorabId, companyId: A.companyId, title: 'x', source: 'bot', messages: [] });
    await AiConversation.create({ userId: devId, title: 'x', source: 'bot', messages: [] });
    const old: any = await AiConversation.create({ userId: A.orinbosarId, companyId: A.companyId, title: 'x', source: 'chat', messages: [] });
    await AiConversation.collection.updateOne({ _id: old._id }, { $set: { updatedAt: new Date(Date.now() - 10 * 60_000) } });

    const r = await getOffice(devId);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.agents.map((a: any) => [a.id, a]));
    expect(by[`tg:${jasur._id}`]).toMatchObject({ name: 'Jasur', kind: 'tg', busy: true, activity: 'call', status: 'connected', since: answeredAt.toISOString() });
    expect(r.body.agents.find((a: any) => a.name === 'Sarvar')).toMatchObject({ busy: false, activity: 'idle' });
    expect(by['role-ishchi']).toMatchObject({ kind: 'role', role: 'ishchi', busy: true, activity: 'call' });
    expect(by['role-prorab']).toMatchObject({ busy: true, activity: 'chat' });
    expect(by['role-orinbosar']).toMatchObject({ busy: false, activity: 'idle' });
    expect(by['devbot']).toMatchObject({ kind: 'code', busy: true, activity: 'chat' });
    expect(by['devpanel']).toMatchObject({ busy: false, activity: 'idle' });
  });

  it('5 s kesh: yangi sessiya darhol ko\'rinmaydi, kesh tozalangach ko\'rinadi', async () => {
    const t0 = Date.now();
    expect((await officeSnapshot(t0)).agents.find((a) => a.id === 'role-direktor')?.busy).toBe(false);
    await session(A.ownerId);
    expect((await officeSnapshot(t0 + 1_000)).agents.find((a) => a.id === 'role-direktor')?.busy).toBe(false);
    expect((await officeSnapshot(t0 + 6_000)).agents.find((a) => a.id === 'role-direktor')).toMatchObject({ busy: true, activity: 'call' });
  });
});
