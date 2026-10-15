// /api/ai-voice/me/chat/groups (supertest): guruhdagi AI — a'zolik, qo'shish/chiqarish huquqi, faqat mention/reply'da
// javob, so'ragan odam huquqi bilan (ctx), ERP ma'lumoti ishlatilsa javob guruhga EMAS — shaxsiy chatga.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import Group from '../../models/Group';
import Message from '../../models/Message';
import AiConversation from '../../models/AiConversation';
import AiRateCounter from '../../models/AiRateCounter';
import AiGroupAssistant from '../../models/AiGroupAssistant';
import { JWT_SECRET, requireAuth, blockDeveloper } from '../../middleware/auth';
import chatRoutes from '../routes/chatRoutes';
import { AI_SENDER_ID, __setFindMsgWaitForTests, isAiMention, stripAiMention } from '../routes/groupChatRoutes';
import { setTextAgentFactory } from '../brain/textAgent';
import { ErpTextAgent } from '../brain/agent';
import type { TextAgentInput, TextAgentOutput } from '../contracts';
import { __setSettingsCacheTtlForTests } from '../settings';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
const ENV = process.env.AI_VOICE_ENABLED;
let A: SeedCompany, B: SeedCompany;
let groupId = '';
const calls: TextAgentInput[] = [];
let nextOut: Partial<TextAgentOutput> = {};

const app = express();
app.use(express.json());
app.use('/api/ai-voice/me/chat', requireAuth, blockDeveloper, chatRoutes);

const tok = (userId: string) => `Bearer ${jwt.sign({ userId }, JWT_SECRET)}`;
const api = (method: 'get' | 'post' | 'put', path: string, userId: string, body?: unknown) => {
  const r = request(app)[method](`/api/ai-voice/me/chat/groups${path}`).set('Authorization', tok(userId));
  return body !== undefined ? r.send(body as object) : r;
};
const say = (from: string, text: string, extra: Record<string, unknown> = {}) =>
  Message.create({ fromUserId: from, toUserId: '', groupId, text, timestamp: new Date().toISOString(), companyId: A.companyId, ...extra } as any);

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  __setSettingsCacheTtlForTests(0);
  __setFindMsgWaitForTests(1, 0);
  mongo = await startMongo();
  A = await seedCompany('AGrp');
  B = await seedCompany('BGrp');
  setTextAgentFactory(() => ({
    async run(input: TextAgentInput): Promise<TextAgentOutput> {
      calls.push(input);
      return { text: 'umumiy javob', toolCalls: [], pendingActions: [], usage: { model: 'fake', tokensIn: 1, tokensOut: 1, provider: 'none' }, ...nextOut };
    },
  }));
}, 120_000);
afterAll(async () => {
  setTextAgentFactory(() => new ErpTextAgent());
  __setFindMsgWaitForTests(12, 500);
  if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV;
  await stopMongo(mongo);
});
beforeEach(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  calls.length = 0;
  nextOut = {};
  await Promise.all([Group.deleteMany({}), Message.deleteMany({}), AiConversation.deleteMany({}), AiRateCounter.deleteMany({}), AiGroupAssistant.deleteMany({})]);
  const g: any = await Group.create({ name: 'Obyekt 1', memberIds: [A.ownerId, A.orinbosarId, A.workerId], adminIds: [], createdBy: A.workerId, companyId: A.companyId } as any);
  groupId = String(g._id);
});

describe('mention aniqlash', () => {
  it('@AI, "AI," va "AI yordamchi:" — ha; oddiy so\'z ichidagi "ai" — yo\'q', () => {
    for (const t of ['@AI bugun kim keldi?', 'AI, salom', 'ai: qalaysan', 'AI yordamchi, yordam ber', 'salom @ai nima gap', 'ИИ, привет']) expect(isAiMention(t)).toBe(true);
    for (const t of ['aiyam keldi', 'mail@ai.uz', 'Kaif', 'AI haqida gaplashdik']) expect(isAiMention(t)).toBe(false);
    expect(stripAiMention('@AI bugun kim keldi?')).toBe('bugun kim keldi?');
    expect(stripAiMention('AI, salom')).toBe('salom');
  });
});

describe('guruhdagi AI', () => {
  it("a'zo bo'lmagan / boshqa firma — 404; a'zo qo'shadi, ro'yxatda ko'rinadi, guruhga xabar tushadi", async () => {
    expect((await api('get', `/${groupId}`, A.prorabId)).status).toBe(404);
    expect((await api('put', `/${groupId}`, B.ownerId, { enabled: true })).status).toBe(404);
    const g0 = await api('get', `/${groupId}`, A.orinbosarId);
    expect(g0.body).toMatchObject({ enabled: false, canManage: false, aiActive: true });

    const r = await api('put', `/${groupId}`, A.orinbosarId, { enabled: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: true, canManage: true });
    expect((await api('get', '/', A.ownerId)).body.groups).toEqual([groupId]);
    const ann = await Message.find({ groupId, fromUserId: AI_SENDER_ID }).lean();
    expect(ann).toHaveLength(1);
    expect(ann[0].companyId).toBe(A.companyId);
  });

  it("chiqarish: qo'shmagan oddiy a'zo — 403; guruh yaratuvchisi — ruxsat", async () => {
    await api('put', `/${groupId}`, A.orinbosarId, { enabled: true });
    expect((await api('put', `/${groupId}`, A.ownerId, { enabled: 'x' })).status).toBe(400);
    await AiGroupAssistant.updateOne({ groupId }, { addedBy: A.ownerId });
    expect((await api('put', `/${groupId}`, A.orinbosarId, { enabled: false })).status).toBe(403);
    const r = await api('put', `/${groupId}`, A.workerId, { enabled: false });
    expect(r.status).toBe(200);
    expect(r.body.enabled).toBe(false);
  });

  it("AI qo'shilmagan — 409; mention yo'q — 400; AI o'chiq — 403", async () => {
    await say(A.ownerId, '@AI salom');
    expect((await api('post', `/${groupId}/ask`, A.ownerId, { text: '@AI salom' })).status).toBe(409);
    await api('put', `/${groupId}`, A.ownerId, { enabled: true });
    await say(A.ownerId, 'oddiy xabar');
    expect((await api('post', `/${groupId}/ask`, A.ownerId, { text: 'oddiy xabar' })).body.error).toBe('no_mention');
    process.env.AI_VOICE_ENABLED = 'false';
    expect((await api('post', `/${groupId}/ask`, A.ownerId, { text: '@AI salom' })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("umumiy savol: so'ragan odam huquqi bilan, javob guruhga reply sifatida; ikkinchi marta — 409", async () => {
    await api('put', `/${groupId}`, A.ownerId, { enabled: true });
    await say(A.workerId, 'Beton qachon keladi?');
    const q = await say(A.orinbosarId, 'AI, 10 kub beton uchun qancha sement kerak?');
    const r = await api('post', `/${groupId}/ask`, A.orinbosarId, { text: 'AI, 10 kub beton uchun qancha sement kerak?', lang: 'uz' });
    expect(r.status).toBe(200);
    expect(r.body.delivered).toBe('group');
    expect(calls[0].ctx).toMatchObject({ userId: A.orinbosarId, companyId: A.companyId, role: 'orinbosar', channel: 'web' });
    expect(calls[0].userText).toMatch(/GURUH/);
    expect(calls[0].userText.endsWith('10 kub beton uchun qancha sement kerak?')).toBe(true);
    expect(calls[0].history.some((h) => h.role === 'user' && h.text.endsWith('Beton qachon keladi?'))).toBe(true);
    const ai = await Message.findById(r.body.messageId).lean();
    expect(ai).toMatchObject({ fromUserId: AI_SENDER_ID, groupId, text: 'umumiy javob', replyToId: String(q._id) });
    // audit: so'ragan odam nomidan yozildi
    expect(await AiConversation.countDocuments({ userId: A.orinbosarId, sessionId: { $regex: `^aigroup:${groupId}:` } })).toBe(1);
    expect((await api('post', `/${groupId}/ask`, A.orinbosarId, { text: 'AI, 10 kub beton uchun qancha sement kerak?' })).status).toBe(409);
  });

  it("ERP ma'lumoti ishlatilsa: javob guruhga CHIQMAYDI, shaxsiy chatga boradi", async () => {
    await api('put', `/${groupId}`, A.ownerId, { enabled: true });
    nextOut = { text: "Alining oyligi 5 000 000 so'm", toolCalls: [{ name: 'getEmployeeProfile', status: 'ok', message: 'ok' }] };
    await say(A.ownerId, '@AI Alining oyligi qancha?');
    const r = await api('post', `/${groupId}/ask`, A.ownerId, { text: '@AI Alining oyligi qancha?' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ delivered: 'private', reply: "Alining oyligi 5 000 000 so'm" });
    const groupAi = await Message.find({ groupId, fromUserId: AI_SENDER_ID }).lean();
    expect(groupAi.some((x) => /5 000 000/.test(String(x.text)))).toBe(false);
    const priv: any = await AiConversation.findOne({ userId: A.ownerId, sessionId: { $regex: '^aichat:' } }).lean();
    expect(priv.messages.map((x: any) => x.content).join('\n')).toMatch(/5 000 000/);
  });

  it("AI xabariga reply — mention'siz ham javob; savol xabari topilmasa — 404", async () => {
    await api('put', `/${groupId}`, A.ownerId, { enabled: true });
    const ai = await say(AI_SENDER_ID, 'oldingi javob');
    await say(A.ownerId, 'yana tushuntir', { replyToId: String(ai._id) });
    const r = await api('post', `/${groupId}/ask`, A.ownerId, { text: 'yana tushuntir', replyToId: String(ai._id) });
    expect(r.status).toBe(200);
    expect((await api('post', `/${groupId}/ask`, A.ownerId, { text: '@AI yuborilmagan savol' })).body.error).toBe('message_not_found');
  });
});
