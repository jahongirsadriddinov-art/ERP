// Integratsion sinov: PATCH/DELETE /api/messages/:id — kim tahrirlaydi/o'chiradi, firma doirasi va audit izi.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(), sendPhoto: vi.fn(), sendDocument: vi.fn(), sendVoice: vi.fn(), sendVideo: vi.fn(), sendLocation: vi.fn() } }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
vi.mock('../services/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
// Smena darvozasi (423) bu sinov mavzusi emas — hamma "smenada"
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Message from '../models/Message';
import AuditLog from '../models/AuditLog';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import messageRoutes from './messages';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/messages', requireAuth, messageRoutes);

const ids: Record<string, string> = {};
let A = '';
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const send = (k: string, to: string, text: string) => request(app).post('/api/messages').set('Authorization', tok(k)).send({ toUserId: ids[to], text });
const patch = (k: string, id: string, body: any) => request(app).patch(`/api/messages/${id}`).set('Authorization', tok(k)).send(body);
const del = (k: string, id: string) => request(app).delete(`/api/messages/${id}`).set('Authorization', tok(k));
const msgId = (r: any) => String(r.body.id || r.body._id);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  A = new mongoose.Types.ObjectId().toString();
  const B = new mongoose.Types.ObjectId().toString();
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('boss', { firstName: 'Boss', lastName: 'A', phone: '+998900000101', role: 'direktor', isOwner: true, companyId: A });
  await mk('orin', { firstName: 'Orin', phone: '+998900000102', role: 'orinbosar', companyId: A });
  await mk('prorab', { firstName: 'Prorab', phone: '+998900000103', role: 'prorab', companyId: A });
  await mk('ishchi', { firstName: 'Ishchi', phone: '+998900000104', role: 'ishchi', companyId: A });
  await mk('bossB', { firstName: 'BossB', phone: '+998900000105', role: 'direktor', isOwner: true, companyId: B });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('xabarni tahrirlash', () => {
  it("yozgan odam o'z xabarini tahrirlaydi — audit izi qoladi (eski/yangi matn)", async () => {
    const id = msgId(await send('prorab', 'ishchi', 'Beton keldi'));
    const r = await patch('prorab', id, { text: 'Beton keldi, 10 kub' });
    expect(r.status).toBe(200);
    expect(r.body.edited).toBe(true);
    const log: any = await AuditLog.findOne({ entity: 'message', entityId: id, action: 'update' }).lean();
    expect(log).toBeTruthy();
    expect(log.userId).toBe(ids.prorab);
    expect(log.companyId).toBe(A);
    expect(log.oldValue.text).toBe('Beton keldi');
    expect(log.newValue.text).toBe('Beton keldi, 10 kub');
  });
  it("boshqaning xabarini hech kim (rahbar ham) tahrirlay olmaydi", async () => {
    const id = msgId(await send('ishchi', 'prorab', 'Salom'));
    expect((await patch('prorab', id, { text: 'x' })).status).toBe(403);
    expect((await patch('boss', id, { text: 'x' })).status).toBe(403);
    expect((await patch('bossB', id, { text: 'x' })).status).toBe(404);
    expect((await Message.findById(id).lean() as any).text).toBe('Salom');
  });
  it("bo'sh matn rad etiladi; o'chirilgan xabar tahrirlanmaydi", async () => {
    const id = msgId(await send('ishchi', 'prorab', 'Matn'));
    expect((await patch('ishchi', id, { text: '   ' })).status).toBe(400);
    expect((await del('ishchi', id)).status).toBe(200);
    expect((await patch('ishchi', id, { text: 'yangi' })).status).toBe(400);
  });
});

describe("xabarni o'chirish", () => {
  it("o'z xabarini o'chiradi; oddiy xodim boshqanikini o'chira olmaydi", async () => {
    const id = msgId(await send('ishchi', 'prorab', 'Men keldim'));
    expect((await del('prorab', id)).status).toBe(403);
    expect((await Message.findById(id).lean() as any).deleted).toBeFalsy();
    expect((await del('ishchi', id)).status).toBe(200);
    expect((await Message.findById(id).lean() as any).deleted).toBe(true);
    expect(await AuditLog.countDocuments({ entity: 'message', entityId: id, action: 'delete', userId: ids.ishchi })).toBe(1);
  });
  it("direktor va o'rinbosar istalgan xabarni o'chiradi — audit 'boshqaning xabari' deb yoziladi", async () => {
    const id1 = msgId(await send('prorab', 'ishchi', 'Birinchi'));
    const id2 = msgId(await send('ishchi', 'prorab', 'Ikkinchi'));
    expect((await del('boss', id1)).status).toBe(200);
    expect((await del('orin', id2)).status).toBe(200);
    const log: any = await AuditLog.findOne({ entity: 'message', entityId: id1, action: 'delete' }).lean();
    expect(log.userId).toBe(ids.boss);
    expect(log.userName).toBe('Boss A');
    expect(log.description).toMatch(/Boshqa xodim/);
    expect(log.oldValue.text).toBe('Birinchi');
    expect(log.oldValue.fromUserId).toBe(ids.prorab);
  });
  it("boshqa firma direktori o'chira olmaydi (404) va audit yozilmaydi", async () => {
    const id = msgId(await send('prorab', 'ishchi', 'Ichki'));
    expect((await del('bossB', id)).status).toBe(404);
    expect(await AuditLog.countDocuments({ entityId: id })).toBe(0);
  });
});
