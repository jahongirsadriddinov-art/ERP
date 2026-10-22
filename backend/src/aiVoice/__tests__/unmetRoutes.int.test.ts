// GET /api/ai-voice/platform/unmet (owner 2026-10-22): "AI qila olmadi" yozuvlari — FAQAT dasturchi;
// eng yangisi birinchi, firma/foydalanuvchi nomi, limit va sabab filtri, 7 kunlik sabablar kesimi.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiUnmetRequest from '../../models/AiUnmetRequest';
import User from '../../models/User';
import { JWT_SECRET } from '../../middleware/auth';
import { mountAiVoiceRoutes } from '../bootstrap';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany;
let devId = '';
const app = express();
app.use(express.json());
mountAiVoiceRoutes(app);
const tok = (id: string) => `Bearer ${jwt.sign({ userId: id }, JWT_SECRET)}`;
const get = (path: string, id: string) => request(app).get(`/api/ai-voice/platform${path}`).set('Authorization', tok(id));

beforeAll(async () => {
  mongo = await startMongo();
  A = await seedCompany('Unmet');
  devId = String((await User.create({ firstName: 'Dev', phone: '+998900008377', role: 'dasturchi' } as any))._id);
  const base = { companyId: A.companyId, userId: A.workerId, channel: 'bot', aiReply: 'Qila olmayman' };
  await AiUnmetRequest.create({ ...base, userText: 'birinchi', reason: 'cant_reply', createdAt: new Date(Date.now() - 3000) } as any);
  await AiUnmetRequest.create({ ...base, userText: 'ikkinchi', reason: 'tool_error', toolName: 'createReminder', toolMessage: "O'tgan vaqt", createdAt: new Date(Date.now() - 2000) } as any);
  await AiUnmetRequest.create({ ...base, userText: 'uchinchi', reason: 'unknown_tool', toolName: 'callEmployee', createdAt: new Date(Date.now() - 1000) } as any);
}, 120_000);
afterAll(async () => { await stopMongo(mongo); });

describe('GET /platform/unmet', () => {
  it('faqat dasturchi', async () => {
    expect((await get('/unmet', A.ownerId)).status).toBe(403);
    expect((await get('/unmet', A.orinbosarId)).status).toBe(403);
    expect((await request(app).get('/api/ai-voice/platform/unmet')).status).toBe(401);
  });

  it("eng yangisi birinchi; nomlar; limit; sabab filtri; 7 kunlik kesim", async () => {
    const r = await get('/unmet?limit=2', devId);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.total).toBe(3);
    expect(r.body.items.map((x: any) => x.userText)).toEqual(['uchinchi', 'ikkinchi']);
    expect(r.body.items[0]).toMatchObject({ companyName: 'Unmet', userName: 'Unmet-ishchi', userRole: 'ishchi', channel: 'bot', reason: 'unknown_tool', toolName: 'callEmployee' });
    expect(r.body.byReason7d).toEqual({ cant_reply: 1, tool_error: 1, unknown_tool: 1 });
    const f = await get('/unmet?reason=tool_error&limit=999', devId);
    expect(f.body.items).toHaveLength(1);
    expect(f.body.items[0].toolMessage).toBe("O'tgan vaqt");
    const bad = await get('/unmet?reason=$where&limit=abc', devId);
    expect(bad.body.total).toBe(3);
  });
});
