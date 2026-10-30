// Owner 2026-10-30: dasturchi panelida "Yangilash" bosilganda HTTP 500 chiqdi
// ("Yangilashda xatolik"). Sabab: PLAN_CONFIG bazadagi FAOL tariflardan
// quriladi va 'bepul' kaliti bo'lmasa `planInfo` undefined bo'lib,
// `planInfo.days` TypeError berardi — catch esa xatoni log ham qilmasdi.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyDeveloper: vi.fn(async () => undefined), notifyDeveloperWithButtons: vi.fn(async () => undefined) }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Subscription from '../models/Subscription';
import { PLAN_CONFIG } from '../config/plans';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import subsRoutes from './subscriptions';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/admin/subscriptions', requireAuth, subsRoutes);

let devToken = '';
let subId = '';
const COMPANY = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const dev: any = await User.create({ firstName: 'Dev', phone: '+998905200001', role: 'dasturchi' });
  devToken = `Bearer ${jwt.sign({ userId: String(dev._id) }, JWT_SECRET)}`;
}, 180_000);

afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

beforeEach(async () => {
  await Subscription.deleteMany({});
  const s: any = await Subscription.create({
    companyId: COMPANY, status: 'expired', selectedPlan: 'premium1',
    currentPeriodEnd: new Date('2026-10-29'),
  });
  subId = String(s._id);
  for (const k of Object.keys(PLAN_CONFIG)) delete PLAN_CONFIG[k];
});

describe('POST /:id/renew', () => {
  it("faol tarif bilan uzaytiradi", async () => {
    PLAN_CONFIG.premium1 = { label: '1 oylik — Premium', days: 30, amount: 900_000 } as any;
    const r = await request(app).post(`/api/admin/subscriptions/${subId}/renew`)
      .set('Authorization', devToken).send({ selectedPlan: 'premium1' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const s: any = await Subscription.findById(subId).lean();
    expect(s.status).toBe('active');
  });

  it("tarif FAOL ro'yxatda bo'lmasa — 500 emas, tushunarli 400", async () => {
    // 'bepul' ham yo'q (bazadan o'chirilgan) — avval aynan shu holat 500 berardi
    const r = await request(app).post(`/api/admin/subscriptions/${subId}/renew`)
      .set('Authorization', devToken).send({ selectedPlan: 'yoq_tarif' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('Tarif topilmadi');
    const s: any = await Subscription.findById(subId).lean();
    expect(s.status).toBe('expired');     // holat o'zgarmagan
  });

  it("obuna topilmasa — 404", async () => {
    const r = await request(app).post(`/api/admin/subscriptions/${new mongoose.Types.ObjectId()}/renew`)
      .set('Authorization', devToken).send({ selectedPlan: 'premium1' });
    expect(r.status).toBe(404);
  });
});
