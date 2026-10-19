// Integratsion sinov: ishbay hisob (ixtiyoriy) → tasdiq → oylikka qo'shiladi; o'chiq firmada yozib bo'lmaydi.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn(), kickUser: vi.fn() }));
vi.mock('../services/push', () => ({ sendPushToUser: vi.fn(async () => undefined) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Company from '../models/Company';
import ObjectModel from '../models/Object';
import Attendance from '../models/Attendance';
import { todayInTashkent } from '../utils/tz';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import worklogsRoutes from './worklogs';
import payrollRoutes from './payroll';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/worklogs', requireAuth, worklogsRoutes);
app.use('/api/payroll', requireAuth, payrollRoutes);

const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const PERIOD = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const c = await Company.create({ branchId: 'BR-T-1', name: 'Alfa', phone: '+998900000001', features: { piecework: true } });
  const off = await Company.create({ branchId: 'BR-T-2', name: 'Beta', phone: '+998900000002' });
  const cid = String(c._id);
  const mk = async (k: string, role: string, companyId = cid, extra: any = {}) => {
    const u = await User.create({ firstName: k, phone: `+99890${Math.floor(1e6 + Math.random() * 8e6)}`, role, companyId, ...extra });
    ids[k] = String(u._id);
  };
  await mk('boss', 'direktor', cid, { isOwner: true });
  await mk('foreman', 'prorab');
  await mk('worker', 'ishchi', cid, { baseSalary: 0 });
  await mk('other', 'direktor', String(off._id));
  const o = await ObjectModel.create({ name: 'Olmazor', companyId: cid, foremanId: ids.foreman });
  // Prorab/ishchi faqat smenada ishlay oladi (ish darvozasi) — "Ishga keldim" bosilgan
  for (const k of ['foreman', 'worker']) await Attendance.create({ userId: ids[k], companyId: cid, date: todayInTashkent(), checkIn: new Date().toISOString(), status: 'present' });
  ids.obj = String(o._id);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('ishbay hisob', () => {
  let logId = '';
  it('foreman logs work (pending), worker cannot log', async () => {
    const body = { objectId: ids.obj, userId: ids.worker, workName: "G'isht terish", unit: 'm2', volume: 40, rate: 25000 };
    const r = await request(app).post('/api/worklogs').set('Authorization', tok('foreman')).send(body);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'pending', amount: 1_000_000 });
    logId = r.body.id;
    const w = await request(app).post('/api/worklogs').set('Authorization', tok('worker')).send(body);
    expect(w.status).toBe(403);
  });

  it('the foreman cannot approve own entry; the boss approves; worker sees only own', async () => {
    expect((await request(app).patch(`/api/worklogs/${logId}/approve`).set('Authorization', tok('foreman'))).status).toBe(403);
    const ok = await request(app).patch(`/api/worklogs/${logId}/approve`).set('Authorization', tok('boss'));
    expect(ok.body.status).toBe('approved');
    const mine = await request(app).get('/api/worklogs').set('Authorization', tok('worker'));
    expect(mine.body.items).toHaveLength(1);
  });

  it('approved piecework is added to payroll, bonuses survive recalculation', async () => {
    const c1 = await request(app).post('/api/payroll/calculate').set('Authorization', tok('boss')).send({ period: PERIOD });
    const rec = c1.body.records.find((x: any) => x.userId === ids.worker);
    expect(rec).toMatchObject({ pieceworkPay: 1_000_000, netPay: 1_000_000 });
    await request(app).patch(`/api/payroll/${rec.id}`).set('Authorization', tok('boss')).send({ bonuses: 200_000 });
    const c2 = await request(app).post('/api/payroll/calculate').set('Authorization', tok('boss')).send({ period: PERIOD });
    expect(c2.body.records.find((x: any) => x.userId === ids.worker).netPay).toBe(1_200_000);
  });

  it('companies without the feature cannot log', async () => {
    const r = await request(app).post('/api/worklogs').set('Authorization', tok('other'))
      .send({ objectId: ids.obj, userId: ids.worker, workName: 'X', unit: 'm2', volume: 1, rate: 1 });
    expect(r.status).toBe(403);
    expect((await request(app).get('/api/worklogs').set('Authorization', tok('other'))).body).toEqual({ enabled: false, items: [] });
  });
});
