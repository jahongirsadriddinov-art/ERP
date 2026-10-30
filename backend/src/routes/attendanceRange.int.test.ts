// GET /api/attendance?all=1&from&to — "Hisobotlar" Excel'idagi Davomat varag'i uchun firma bo'yicha davr yozuvlari.
// Faqat rahbariyat; boshqa firma yozuvlari ko'rinmaydi; davr majburiy va cheklangan.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn(), kickUser: vi.fn() }));
vi.mock('../services/push', () => ({ sendPushToUser: vi.fn(async () => undefined) }));
vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn() }, keyboardForUser: vi.fn(), fmtWorkDuration: vi.fn(() => '') }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User, { type IUser } from '../models/User';
import Company from '../models/Company';
import Attendance from '../models/Attendance';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import attendanceRoutes from './attendance';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/attendance', requireAuth, attendanceRoutes);
const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const a = await Company.create({ branchId: 'BR-AR-1', name: 'Alfa', phone: '+998900000011' });
  const b = await Company.create({ branchId: 'BR-AR-2', name: 'Beta', phone: '+998900000012' });
  const mk = async (k: string, role: IUser['role'], companyId: string) => {
    const u = await User.create({ firstName: k, phone: `+99890${Math.floor(1e6 + Math.random() * 8e6)}`, role, companyId });
    ids[k] = String(u._id);
  };
  await mk('boss', 'direktor', String(a._id));
  await mk('w1', 'ishchi', String(a._id));
  await mk('w2', 'ishchi', String(a._id));
  await mk('other', 'ishchi', String(b._id));
  await Attendance.create([
    { userId: ids.w1, companyId: String(a._id), date: '2026-10-20', checkIn: '2026-10-20T03:00:00Z', checkOut: '2026-10-20T12:00:00Z', workHours: 9, status: 'present' },
    { userId: ids.w2, companyId: String(a._id), date: '2026-10-21', checkIn: '2026-10-21T04:00:00Z', status: 'late' },
    { userId: ids.w1, companyId: String(a._id), date: '2026-09-01', checkIn: '2026-09-01T03:00:00Z', status: 'present' },
    { userId: ids.other, companyId: String(b._id), date: '2026-10-20', checkIn: '2026-10-20T03:00:00Z', status: 'present' },
  ]);
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

describe('GET /api/attendance?all=1', () => {
  it('boss gets every employee of own company in the period only', async () => {
    const r = await request(app).get('/api/attendance?all=1&from=2026-10-01&to=2026-10-22').set('Authorization', tok('boss'));
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => [x.userId, x.date, x.status])).toEqual([[ids.w2, '2026-10-21', 'late'], [ids.w1, '2026-10-20', 'present']]);
    expect(r.body[1]).toMatchObject({ workHours: 9, checkOut: '2026-10-20T12:00:00Z' });
  });
  it('workers are refused; period is required and bounded', async () => {
    expect((await request(app).get('/api/attendance?all=1&from=2026-10-01&to=2026-10-22').set('Authorization', tok('w1'))).status).toBe(403);
    expect((await request(app).get('/api/attendance?all=1').set('Authorization', tok('boss'))).status).toBe(400);
    expect((await request(app).get('/api/attendance?all=1&from=2024-01-01&to=2026-10-22').set('Authorization', tok('boss'))).status).toBe(400);
  });
  it('without all=1 the old behaviour (own records) is kept', async () => {
    const r = await request(app).get('/api/attendance').set('Authorization', tok('w1'));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
  });
});
