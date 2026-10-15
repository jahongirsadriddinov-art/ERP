// /api/ai-voice/me/chat (P7, supertest): chatdagi AI kontakti — matn TextAgent'ga (soxta), tarix kunlik
// AiConversation'da, faqat o'ziniki; AI o'chiq / smena yopiq / dasturchi rad etiladi; tasdiq executor orqali.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../../models/User';
import AiConversation from '../../models/AiConversation';
import AiRateCounter from '../../models/AiRateCounter';
import { JWT_SECRET, requireAuth, blockDeveloper } from '../../middleware/auth';
import chatRoutes from '../routes/chatRoutes';
import { setTextAgentFactory } from '../brain/textAgent';
import { ErpTextAgent } from '../brain/agent';
import type { TextAgentInput, TextAgentOutput } from '../contracts';
import { __setSettingsCacheTtlForTests } from '../settings';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
const ENV = process.env.AI_VOICE_ENABLED;
let A: SeedCompany, B: SeedCompany;
let devId = '';
const calls: TextAgentInput[] = [];
let nextOut: Partial<TextAgentOutput> = {};

const app = express();
app.use(express.json());
app.use('/api/ai-voice/me/chat', requireAuth, blockDeveloper, chatRoutes);

const tok = (userId: string) => `Bearer ${jwt.sign({ userId }, JWT_SECRET)}`;
const api = (method: 'get' | 'post', path: string, userId: string, body?: unknown) => {
  const r = request(app)[method](`/api/ai-voice/me/chat${path}`).set('Authorization', tok(userId));
  return body !== undefined ? r.send(body as object) : r;
};

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  __setSettingsCacheTtlForTests(0);
  mongo = await startMongo();
  A = await seedCompany('AChat');
  B = await seedCompany('BChat');
  devId = String((await User.create({ firstName: 'Dev', phone: '+998909990011', role: 'dasturchi' } as any))._id);
  setTextAgentFactory(() => ({
    async run(input: TextAgentInput): Promise<TextAgentOutput> {
      calls.push(input);
      return {
        text: `javob: ${input.userText}`, toolCalls: [], pendingActions: [],
        usage: { model: 'fake', tokensIn: 1, tokensOut: 1, provider: 'none' }, ...nextOut,
      };
    },
  }));
}, 120_000);
afterAll(async () => {
  setTextAgentFactory(() => new ErpTextAgent());
  if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV;
  await stopMongo(mongo);
});
beforeEach(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  calls.length = 0;
  nextOut = {};
  await AiConversation.deleteMany({});
  await AiRateCounter.deleteMany({});
});

describe('AI chat kontakti', () => {
  it('tokensiz 401, dasturchi 403', async () => {
    expect((await request(app).get('/api/ai-voice/me/chat')).status).toBe(401);
    expect((await api('get', '/', devId)).status).toBe(403);
  });

  it("savol → javob, tarix saqlanadi va faqat o'ziga ko'rinadi", async () => {
    const r = await api('post', '/message', A.ownerId, { text: '  Bugun kim keldi?  ', lang: 'uz' });
    expect(r.status).toBe(200);
    expect(r.body.reply).toBe('javob: Bugun kim keldi?');
    expect(calls[0].ctx).toMatchObject({ channel: 'web', purpose: 'assistant', userId: A.ownerId, companyId: A.companyId, role: 'direktor', isOwner: true });
    expect(calls[0].history).toEqual([]);

    await api('post', '/message', A.ownerId, { text: 'Rahmat' });
    // Ikkinchi savolda oldingi suhbat modelga beriladi
    expect(calls[1].history).toEqual([{ role: 'user', text: 'Bugun kim keldi?' }, { role: 'assistant', text: 'javob: Bugun kim keldi?' }]);

    const h = await api('get', '/', A.ownerId);
    expect(h.status).toBe(200);
    expect(h.body.aiActive).toBe(true);
    expect(h.body.items.map((i: any) => [i.role, i.text])).toEqual([
      ['user', 'Bugun kim keldi?'], ['assistant', 'javob: Bugun kim keldi?'], ['user', 'Rahmat'], ['assistant', 'javob: Rahmat'],
    ]);
    // Kunlik bitta hujjat
    expect(await AiConversation.countDocuments({ userId: A.ownerId, source: 'chat' })).toBe(1);

    const other = await api('get', '/', A.workerId);
    expect(other.body.items).toEqual([]);
    const otherCo = await api('get', '/', B.ownerId);
    expect(otherCo.body.items).toEqual([]);
  });

  it("ovozli qo'ng'iroq transkripti tarixda 'call' yozuvi bo'ladi", async () => {
    await AiConversation.create({ userId: A.ownerId, companyId: A.companyId, source: 'voice_inapp', title: 'v', messages: [{ role: 'user', content: 'salom' }, { role: 'assistant', content: 'assalomu alaykum' }] });
    const h = await api('get', '/', A.ownerId);
    expect(h.body.items).toHaveLength(1);
    expect(h.body.items[0]).toMatchObject({ kind: 'call', lines: [{ role: 'user', text: 'salom' }, { role: 'assistant', text: 'assalomu alaykum' }] });
  });

  it("bo'sh matn 400, AI o'chiq 403 ai_disabled (model chaqirilmaydi)", async () => {
    expect((await api('post', '/message', A.ownerId, { text: '   ' })).status).toBe(400);
    process.env.AI_VOICE_ENABLED = 'false';
    const r = await api('post', '/message', A.ownerId, { text: 'salom' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('ai_disabled');
    expect(calls).toHaveLength(0);
    const h = await api('get', '/', A.ownerId);
    expect(h.status).toBe(200);
    expect(h.body.aiActive).toBe(false);
  });

  it('smenasi yopiq ishchi: 403 off_shift (423 emas)', async () => {
    const r = await api('post', '/message', A.workerId, { text: 'salom' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('off_shift');
    expect((await api('get', '/', A.workerId)).status).toBe(200);
  });

  it("tasdiq kerak bo'lgan amal UI kartasi sifatida qaytadi; noto'g'ri tasdiq 400, begona id — xato holati", async () => {
    nextOut = { pendingActions: [
      { pendingActionId: '65a000000000000000000001', summary: 'Xarajat qo\'shish', expiresAt: new Date(Date.now() + 60_000).toISOString(), confirmVia: 'ui', tool: 'add_expense' },
      { pendingActionId: '65a000000000000000000002', token: 'x', summary: 'bot', expiresAt: new Date().toISOString(), confirmVia: 'bot', tool: 'x' },
    ] };
    const r = await api('post', '/message', A.ownerId, { text: 'xarajat qo\'sh' });
    expect(r.body.pendingActions).toEqual([{ pendingActionId: '65a000000000000000000001', summary: "Xarajat qo'shish", expiresAt: expect.any(String), tool: 'add_expense' }]);
    expect((await api('post', '/confirm', A.ownerId, { pendingActionId: 'abc', accept: true })).status).toBe(400);
    expect((await api('post', '/confirm', A.ownerId, { pendingActionId: '65a000000000000000000001' })).status).toBe(400);
    const c = await api('post', '/confirm', A.ownerId, { pendingActionId: '65a000000000000000000001', accept: true });
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('error');   // bunday kutilayotgan amal yo'q
  });

  it('chastota cheklovi: 429', async () => {
    const limit = 20; // standart botMsgsPer10Min
    for (let i = 0; i < limit; i++) expect((await api('post', '/message', A.orinbosarId, { text: `s${i}` })).status).toBe(200);
    const r = await api('post', '/message', A.orinbosarId, { text: 'yana' });
    expect(r.status).toBe(429);
    expect(calls).toHaveLength(limit);
  });
});
