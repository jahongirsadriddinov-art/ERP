// Integratsion sinov: POST /api/ai/execute — xodimlar ustidagi amallar himoyasi (P0).
// Haqiqiy MongoDB (xotirada) + haqiqiy JWT/requireAuth; Telegram bot va socket soxtalashtirilgan.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(), sendPhoto: vi.fn(), sendDocument: vi.fn() } }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
vi.mock('../services/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import AuditLog from '../models/AuditLog';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import aiRoutes from './ai';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/ai', requireAuth, aiRoutes);

const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const exec = (k: string, action: any) => request(app).post('/api/ai/execute').set('Authorization', tok(k)).send({ action });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const A = new mongoose.Types.ObjectId().toString();
  const B = new mongoose.Types.ObjectId().toString();
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('owner', { firstName: 'Ega', phone: '+998900000001', role: 'direktor', isOwner: true, companyId: A });
  await mk('dir2', { firstName: 'Direktor2', phone: '+998900000002', role: 'direktor', companyId: A });
  await mk('orin', { firstName: 'Orinbosar', phone: '+998900000003', role: 'orinbosar', companyId: A });
  await mk('ish1', { firstName: 'Ishchi1', phone: '+998900000004', role: 'ishchi', companyId: A });
  await mk('ish2', { firstName: 'Ishchi2', phone: '+998900000005', role: 'ishchi', companyId: A });
  await mk('ish3', { firstName: 'Ishchi3', phone: '+998900000006', role: 'ishchi', companyId: A });
  await mk('orin2', { firstName: 'Orinbosar2', phone: '+998900000007', role: 'orinbosar', companyId: A });
  await mk('other', { firstName: 'Begona', phone: '+998900000010', role: 'ishchi', companyId: B });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('delete_user', () => {
  it("o'rinbosar firma egasini o'chira olmaydi", async () => {
    const r = await exec('orin', { type: 'delete_user', userId: ids.owner });
    expect(r.status).toBe(403);
    expect(await User.exists({ _id: ids.owner })).toBeTruthy();
  });
  it("o'rinbosar direktorni o'chira olmaydi", async () => {
    const r = await exec('orin', { type: 'delete_user', userId: ids.dir2 });
    expect(r.status).toBe(403);
    expect(await User.exists({ _id: ids.dir2 })).toBeTruthy();
  });
  it("o'zini o'chira olmaydi", async () => {
    const r = await exec('orin', { type: 'delete_user', userId: ids.orin });
    expect(r.status).toBe(400);
    expect(await User.exists({ _id: ids.orin })).toBeTruthy();
  });
  it("boshqa firma xodimi — topilmaydi", async () => {
    const r = await exec('orin', { type: 'delete_user', userId: ids.other });
    expect(r.status).toBe(404);
    expect(await User.exists({ _id: ids.other })).toBeTruthy();
  });
  it("oddiy xodimni o'chiradi va audit yozadi", async () => {
    const r = await exec('orin', { type: 'delete_user', userId: ids.ish3 });
    expect(r.status).toBe(200);
    expect(r.body.deletedId).toBe(ids.ish3);
    expect(await User.exists({ _id: ids.ish3 })).toBeFalsy();
    expect(await AuditLog.countDocuments({ entity: 'user', action: 'delete', entityId: ids.ish3, userId: ids.orin })).toBe(1);
  });
});

describe('add_user', () => {
  it('direktor/dasturchi lavozimi va noma\'lum lavozim rad etiladi', async () => {
    expect((await exec('orin', { type: 'add_user', firstName: 'X', phone: '+998901111111', role: 'direktor' })).status).toBe(403);
    expect((await exec('owner', { type: 'add_user', firstName: 'X', phone: '+998901111111', role: 'dasturchi' })).status).toBe(403);
    expect((await exec('orin', { type: 'add_user', firstName: 'X', phone: '+998901111111', role: 'boss' })).status).toBe(400);
    expect(await User.exists({ phone: '+998901111111' })).toBeFalsy();
  });
  it('band telefon raqam rad etiladi', async () => {
    const r = await exec('orin', { type: 'add_user', firstName: 'X', phone: '998 90 000 0004', role: 'ishchi' });
    expect(r.status).toBe(400);
  });
  it("yangi xodim qo'shiladi (shu firmaga) va audit yoziladi", async () => {
    const r = await exec('orin', { type: 'add_user', firstName: 'Yangi', phone: '+998901111112', role: 'prorab' });
    expect(r.status).toBe(200);
    const u: any = await User.findOne({ phone: '+998901111112' }).lean();
    expect(String(u.companyId)).toBe(String((await User.findById(ids.orin).lean())!.companyId));
    expect(await AuditLog.countDocuments({ entity: 'user', action: 'create', entityId: String(u._id) })).toBe(1);
  });
});

describe('update_user', () => {
  it("o'rinbosar firma egasining telefonini o'zgartira olmaydi (hisobni egallash)", async () => {
    const r = await exec('orin', { type: 'update_user', userId: ids.owner, changes: { phone: '+998909999999' } });
    expect(r.status).toBe(403);
    expect((await User.findById(ids.owner).lean())!.phone).toBe('+998900000001');
  });
  it("o'rinbosar direktorni pasaytira olmaydi", async () => {
    const r = await exec('orin', { type: 'update_user', userId: ids.dir2, changes: { role: 'ishchi' } });
    expect(r.status).toBe(403);
    expect((await User.findById(ids.dir2).lean())!.role).toBe('direktor');
  });
  it("o'z lavozimini o'zgartira olmaydi", async () => {
    const r = await exec('owner', { type: 'update_user', userId: ids.owner, changes: { role: 'ishchi' } });
    expect(r.status).toBe(400);
  });
  it('xodimni direktor/dasturchi qilib bo\'lmaydi', async () => {
    expect((await exec('orin', { type: 'update_user', userId: ids.ish1, changes: { role: 'direktor' } })).status).toBe(403);
    expect((await exec('owner', { type: 'update_user', userId: ids.ish1, changes: { role: 'dasturchi' } })).status).toBe(403);
    expect((await User.findById(ids.ish1).lean())!.role).toBe('ishchi');
  });
  it('band telefonga o\'zgartirib bo\'lmaydi', async () => {
    const r = await exec('orin', { type: 'update_user', userId: ids.ish1, changes: { phone: '+998900000005' } });
    expect(r.status).toBe(400);
    expect((await User.findById(ids.ish1).lean())!.phone).toBe('+998900000004');
  });
  it('ega direktorni o\'zgartira oladi; ruxsatli o\'zgarish audit bilan', async () => {
    const r = await exec('owner', { type: 'update_user', userId: ids.dir2, changes: { firstName: 'Dir', brigade: 'A' } });
    expect(r.status).toBe(200);
    const r2 = await exec('orin', { type: 'update_user', userId: ids.ish1, changes: { role: 'brigadir', phone: '+998901234567' } });
    expect(r2.status).toBe(200);
    const u = (await User.findById(ids.ish1).lean())!;
    expect(u.role).toBe('brigadir');
    expect(u.phone).toBe('+998901234567');
    const log: any = await AuditLog.findOne({ entity: 'user', action: 'update', entityId: ids.ish1 }).lean();
    expect(log?.oldValue?.phone).toBe('+998900000004');
  });
});

describe('rate limit', () => {
  it('/execute ham aiLimit bilan cheklangan', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await exec('orin2', { type: 'noma_lum' })).status;
    expect(last).toBe(429);
  }, 60_000);
});
