// Integratsion sinov: POST /api/messages/read-all — faqat o'ziga kelgan DM va o'z guruhlari, firma doirasida.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const emitToUser = vi.fn();
vi.mock('../services/socket', () => ({ emitToUser: (...a: any[]) => emitToUser(...a), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Group from '../models/Group';
import Message from '../models/Message';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import readAllRoutes from './messagesReadAll';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/messages/read-all', requireAuth, readAllRoutes);

const ids: Record<string, string> = {};
let A = '', B = '', gMine = '', gOther = '', gForeign = '';
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const now = () => new Date().toISOString();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  A = new mongoose.Types.ObjectId().toString();
  B = new mongoose.Types.ObjectId().toString();
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('boss', { firstName: 'Boss', phone: '+998900000011', role: 'direktor', isOwner: true, companyId: A });
  await mk('prorab', { firstName: 'Prorab', phone: '+998900000012', role: 'prorab', companyId: A });
  await mk('ishchi', { firstName: 'Ishchi', phone: '+998900000013', role: 'ishchi', companyId: A });
  await mk('bossB', { firstName: 'BossB', phone: '+998900000014', role: 'direktor', isOwner: true, companyId: B });
  gMine = String((await Group.create({ name: 'Mine', memberIds: [ids.boss, ids.prorab], createdBy: ids.boss, companyId: A }))._id);
  gOther = String((await Group.create({ name: 'Other', memberIds: [ids.prorab, ids.ishchi], createdBy: ids.prorab, companyId: A }))._id);
  gForeign = String((await Group.create({ name: 'Foreign', memberIds: [ids.boss, ids.bossB], createdBy: ids.bossB, companyId: B }))._id);
  await Message.insertMany([
    { fromUserId: ids.prorab, toUserId: ids.boss, text: 'dm1', timestamp: now(), read: false, companyId: A },
    { fromUserId: ids.ishchi, toUserId: ids.boss, text: 'dm2', timestamp: now(), read: false, companyId: A },
    { fromUserId: ids.boss, toUserId: ids.prorab, text: 'mine-out', timestamp: now(), read: false, companyId: A },
    { fromUserId: ids.ishchi, toUserId: ids.prorab, text: 'not-mine', timestamp: now(), read: false, companyId: A },
    { fromUserId: ids.bossB, toUserId: ids.boss, text: 'foreign-dm', timestamp: now(), read: false, companyId: B },
    { fromUserId: ids.prorab, groupId: gMine, text: 'g1', timestamp: now(), read: false, companyId: A },
    { fromUserId: ids.boss, groupId: gMine, text: 'g-own', timestamp: now(), read: false, companyId: A },
    { fromUserId: ids.ishchi, groupId: gOther, text: 'g-other', timestamp: now(), read: false, companyId: A },
    { fromUserId: ids.bossB, groupId: gForeign, text: 'g-foreign', timestamp: now(), read: false, companyId: B },
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

const readOf = async (text: string) => ((await Message.findOne({ text }).lean()) as any).read;

describe('POST /api/messages/read-all', () => {
  it('autentifikatsiyasiz — 401', async () => {
    expect((await request(app).post('/api/messages/read-all')).status).toBe(401);
  });

  it("faqat o'ziga kelgan DM va o'z guruhidagi boshqalar xabari o'qildi bo'ladi", async () => {
    const r = await request(app).post('/api/messages/read-all').set('Authorization', tok('boss'));
    expect(r.status).toBe(200);
    expect(r.body.dm).toBe(2);
    expect(r.body.groups).toBe(1);
    expect(await readOf('dm1')).toBe(true);
    expect(await readOf('dm2')).toBe(true);
    expect(await readOf('g1')).toBe(true);
    // tegilmasligi kerak bo'lganlar
    expect(await readOf('mine-out')).toBe(false);
    expect(await readOf('not-mine')).toBe(false);
    expect(await readOf('g-own')).toBe(false);
    expect(await readOf('g-other')).toBe(false);
    // boshqa firma — scoped() tufayli tegilmaydi
    expect(await readOf('foreign-dm')).toBe(false);
    expect(await readOf('g-foreign')).toBe(false);
  });

  it("yuboruvchilarga va o'ziga read-receipt yuboriladi", async () => {
    const calls = emitToUser.mock.calls.filter(c => c[1] === 'message:read');
    const targets = calls.map(c => c[0]).sort();
    expect(targets).toEqual([ids.boss, ids.boss, ids.ishchi, ids.prorab].sort());
    expect(calls.every(c => c[2].toUserId === ids.boss)).toBe(true);
  });

  it("qayta chaqirilsa — hech narsa o'zgarmaydi", async () => {
    const r = await request(app).post('/api/messages/read-all').set('Authorization', tok('boss'));
    expect(r.status).toBe(200);
    expect(r.body.dm).toBe(0);
    expect(r.body.groups).toBe(0);
  });
});
