// Integratsion sinov: /api/auth/users (POST/PUT/DELETE) va /api/users/:id DELETE — ega/direktor
// himoyasi, o'zini pasaytirmaslik/o'chirmaslik, lavozimlar ro'yxati, telefon bandligi, firma doirasi (P0).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn() } }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import AuditLog from '../models/AuditLog';
import { requireAuth, optionalAuth, JWT_SECRET } from '../middleware/auth';
import authRoutes from './auth';
import usersRoutes from './users';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/auth', optionalAuth, authRoutes);
app.use('/api/users', requireAuth, usersRoutes);

const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const put = (k: string, id: string, body: any) => request(app).put(`/api/auth/users/${id}`).set('Authorization', tok(k)).send(body);
const del = (k: string, id: string) => request(app).delete(`/api/auth/users/${id}`).set('Authorization', tok(k));
const delU = (k: string, id: string) => request(app).delete(`/api/users/${id}`).set('Authorization', tok(k));
const phoneOf = async (k: string) => (await User.findById(ids[k]).lean())!.phone;
const roleOf = async (k: string) => (await User.findById(ids[k]).lean())!.role;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const A = new mongoose.Types.ObjectId().toString();
  const B = new mongoose.Types.ObjectId().toString();
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('owner', { firstName: 'Ega', lastName: 'Bosh', phone: '+998900000001', role: 'direktor', isOwner: true, companyId: A });
  await mk('dir2', { firstName: 'Direktor2', phone: '+998900000002', role: 'direktor', companyId: A });
  await mk('orin', { firstName: 'Orinbosar', phone: '+998900000003', role: 'orinbosar', companyId: A });
  await mk('ish1', { firstName: 'Ishchi1', phone: '+998900000004', role: 'ishchi', companyId: A });
  await mk('ish2', { firstName: 'Ishchi2', phone: '+998900000005', role: 'ishchi', companyId: A });
  await mk('ish3', { firstName: 'Ishchi3', phone: '+998900000006', role: 'ishchi', companyId: A });
  await mk('other', { firstName: 'Begona', phone: '+998900000010', role: 'ishchi', companyId: B });
  await mk('dev', { firstName: 'Dev', phone: '+998900000099', role: 'dasturchi' });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('PUT /api/auth/users/:id', () => {
  it("o'rinbosar firma egasining telefonini o'zgartira olmaydi", async () => {
    const r = await put('orin', ids.owner, { phone: '+998909999999' });
    expect(r.status).toBe(403);
    expect(await phoneOf('owner')).toBe('+998900000001');
  });
  it("o'rinbosar direktorni pasaytira olmaydi", async () => {
    expect((await put('orin', ids.dir2, { role: 'ishchi' })).status).toBe(403);
    expect(await roleOf('dir2')).toBe('direktor');
  });
  it('xodimni direktor/dasturchi qilib bo\'lmaydi (dasturchidan boshqa)', async () => {
    expect((await put('orin', ids.ish1, { role: 'direktor' })).status).toBe(403);
    expect((await put('owner', ids.ish1, { role: 'dasturchi' })).status).toBe(403);
    expect(await roleOf('ish1')).toBe('ishchi');
  });
  it("o'z lavozimini o'zgartira olmaydi, lekin ismini (to'liq forma bilan) o'zgartira oladi", async () => {
    expect((await put('owner', ids.owner, { role: 'orinbosar' })).status).toBe(400);
    // App.tsx barcha maydonlarni yuboradi — o'zgarmagan rol/telefon to'siq bo'lmasligi kerak
    const r = await put('owner', ids.owner, { firstName: 'Ega2', lastName: 'Bosh', phone: '+998900000001', role: 'direktor' });
    expect(r.status).toBe(200);
    expect(await roleOf('owner')).toBe('direktor');
  });
  it("o'rinbosar oddiy xodimni (o'zgarmagan rol/telefon bilan) tahrirlay oladi", async () => {
    const r = await put('orin', ids.ish2, { firstName: 'Ishchi2b', lastName: '', phone: '+998900000005', role: 'ishchi', brigade: 'B1', projectIds: [] });
    expect(r.status).toBe(200);
    expect(r.body.brigade).toBe('B1');
  });
  it('band telefon raqamga o\'zgartirib bo\'lmaydi', async () => {
    expect((await put('orin', ids.ish1, { phone: '+998900000005' })).status).toBe(400);
    expect(await phoneOf('ish1')).toBe('+998900000004');
  });
  it('telefon o\'zgarishi audit jurnaliga yoziladi', async () => {
    expect((await put('orin', ids.ish1, { phone: '998 90 777 7777' })).status).toBe(200);
    expect(await phoneOf('ish1')).toBe('+998907777777');
    const log: any = await AuditLog.findOne({ entity: 'user', action: 'update', entityId: ids.ish1 }).lean();
    expect(log?.oldValue?.phone).toBe('+998900000004');
    expect(log?.newValue?.phone).toBe('+998907777777');
  });
  it('boshqa firma xodimi topilmaydi', async () => {
    expect((await put('orin', ids.other, { firstName: 'X' })).status).toBe(404);
  });
  it('dasturchi (DeveloperPanel) istalgan lavozimni belgilay oladi', async () => {
    expect((await put('dev', ids.other, { role: 'direktor' })).status).toBe(200);
    expect(await roleOf('other')).toBe('direktor');
  });
});

describe('POST /api/auth/users', () => {
  it("o'rinbosar dasturchi/direktor yarata olmaydi", async () => {
    const r1 = await request(app).post('/api/auth/users').set('Authorization', tok('orin')).send({ firstName: 'X', phone: '+998901010101', role: 'dasturchi' });
    const r2 = await request(app).post('/api/auth/users').set('Authorization', tok('orin')).send({ firstName: 'X', phone: '+998901010101', role: 'direktor' });
    expect(r1.status).toBe(403);
    expect(r2.status).toBe(403);
    expect(await User.exists({ phone: '+998901010101' })).toBeFalsy();
    const ok = await request(app).post('/api/auth/users').set('Authorization', tok('orin')).send({ firstName: 'X', phone: '+998901010101', role: 'prorab' });
    expect(ok.status).toBe(201);
  });
});

describe('DELETE /api/auth/users/:id', () => {
  it("o'rinbosar egani/direktorni o'chira olmaydi, o'zini ham", async () => {
    expect((await del('orin', ids.owner)).status).toBe(403);
    expect((await del('orin', ids.dir2)).status).toBe(403);
    expect((await del('orin', ids.orin)).status).toBe(400);
    expect((await del('owner', ids.owner)).status).toBe(400);
    expect(await User.countDocuments({ _id: { $in: [ids.owner, ids.dir2, ids.orin] } })).toBe(3);
  });
  it("oddiy xodimni o'chiradi va audit yozadi", async () => {
    expect((await del('orin', ids.ish3)).status).toBe(200);
    expect(await User.exists({ _id: ids.ish3 })).toBeFalsy();
    expect(await AuditLog.countDocuments({ entity: 'user', action: 'delete', entityId: ids.ish3 })).toBe(1);
  });
});

describe('DELETE /api/users/:id', () => {
  it("o'rinbosar egani/direktorni o'chira olmaydi; ega direktorni o'chira oladi", async () => {
    expect((await delU('orin', ids.owner)).status).toBe(403);
    expect((await delU('orin', ids.dir2)).status).toBe(403);
    expect(await User.exists({ _id: ids.dir2 })).toBeTruthy();
    expect((await delU('owner', ids.dir2)).status).toBe(200);
    expect(await User.exists({ _id: ids.dir2 })).toBeFalsy();
  });
});
