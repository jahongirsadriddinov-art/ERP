// Integratsion sinov: POST /api/messages — guruhga yozishda a'zolik va firma tekshiruvi, DM firma doirasi (P0).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(), sendPhoto: vi.fn(), sendDocument: vi.fn(), sendVoice: vi.fn(), sendVideo: vi.fn(), sendLocation: vi.fn() } }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
vi.mock('../services/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Group from '../models/Group';
import Message from '../models/Message';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import messageRoutes from './messages';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/messages', requireAuth, messageRoutes);

const ids: Record<string, string> = {};
let A = '', B = '', gA = '', gSupport = '', gCrossInjected = '', gNoCompany = '';
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const post = (k: string, body: any) => request(app).post('/api/messages').set('Authorization', tok(k)).send(body);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  A = new mongoose.Types.ObjectId().toString();
  B = new mongoose.Types.ObjectId().toString();
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('bossA', { firstName: 'BossA', phone: '+998900000001', role: 'direktor', isOwner: true, companyId: A });
  await mk('orinA', { firstName: 'OrinA', phone: '+998900000002', role: 'orinbosar', companyId: A });
  await mk('bossB', { firstName: 'BossB', phone: '+998900000003', role: 'direktor', isOwner: true, companyId: B });
  await mk('dev', { firstName: 'Dev', phone: '+998900000099', role: 'dasturchi' });
  gA = String((await Group.create({ name: 'A guruh', memberIds: [ids.bossA], createdBy: ids.bossA, companyId: A }))._id);
  gSupport = String((await Group.create({ name: 'Dasturchi', memberIds: [ids.bossA], createdBy: ids.bossA, companyId: A, devSupport: true }))._id);
  // groups.ts orqali begona firma xodimi a'zo qilib qo'yilgan holat — baribir firma mos emas
  gCrossInjected = String((await Group.create({ name: 'A aralash', memberIds: [ids.bossA, ids.bossB], createdBy: ids.bossA, companyId: A }))._id);
  // Firmasiz (dasturchi yaratgan / eski) guruh — a'zolar avvalgidek yoza olishi kerak (regressiya himoyasi)
  gNoCompany = String((await Group.create({ name: 'Eski', memberIds: [ids.bossA], createdBy: ids.dev }))._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('guruhga yozish', () => {
  it("a'zo bo'lmagan xodim (shu firmadan ham) yozolmaydi", async () => {
    const r = await post('orinA', { groupId: gA, text: 'salom' });
    expect(r.status).toBe(403);
    expect(await Message.countDocuments({ groupId: gA })).toBe(0);
  });
  it("boshqa firma xodimi a'zo qilib qo'yilgan bo'lsa ham yozolmaydi va begona companyId muhrlanmaydi", async () => {
    const r = await post('bossB', { groupId: gCrossInjected, text: 'spam' });
    expect(r.status).toBe(403);
    expect(await Message.countDocuments({ groupId: gCrossInjected })).toBe(0);
  });
  it("mavjud bo'lmagan guruh — rad", async () => {
    expect((await post('bossA', { groupId: new mongoose.Types.ObjectId().toString(), text: 'x' })).status).toBe(403);
  });
  it("a'zo yoza oladi, xabar guruh firmasi bilan muhrlanadi", async () => {
    const r = await post('bossA', { groupId: gA, text: 'salom' });
    expect(r.status).toBe(201);
    const m: any = await Message.findOne({ groupId: gA }).lean();
    expect(String(m.companyId)).toBe(A);
  });
  it("dasturchi dev-support guruhiga (a'zo bo'lmasa ham) yoza oladi, oddiy guruhga — yo'q", async () => {
    const r = await post('dev', { groupId: gSupport, text: 'yordam' });
    expect(r.status).toBe(201);
    const m: any = await Message.findOne({ groupId: gSupport }).lean();
    expect(String(m.companyId)).toBe(A);
    expect((await post('dev', { groupId: gA, text: 'x' })).status).toBe(403);
  });
  it("firmasiz guruh: a'zo yoza oladi (o'z firmasi bilan muhrlanadi), a'zo bo'lmagan — yo'q", async () => {
    const r = await post('bossA', { groupId: gNoCompany, text: 'salom' });
    expect(r.status).toBe(201);
    const m: any = await Message.findOne({ groupId: gNoCompany }).lean();
    expect(String(m.companyId)).toBe(A);
    expect((await post('bossB', { groupId: gNoCompany, text: 'x' })).status).toBe(403);
  });
});

describe('shaxsiy xabar (DM)', () => {
  it('boshqa firma xodimiga yozib bo\'lmaydi', async () => {
    expect((await post('bossB', { toUserId: ids.orinA, text: 'spam' })).status).toBe(404);
    expect(await Message.countDocuments({ toUserId: ids.orinA })).toBe(0);
  });
  it('shu firma xodimiga va dasturchiga yozish mumkin', async () => {
    expect((await post('bossA', { toUserId: ids.orinA, text: 'salom' })).status).toBe(201);
    expect((await post('bossB', { toUserId: ids.dev, text: 'yordam' })).status).toBe(201);
  });
});
