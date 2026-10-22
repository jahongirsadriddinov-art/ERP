// Integratsion sinov (xavfsizlik audit 2026-10-22): POST /api/push/subscribe — endpoint faqat ma'lum Web Push
// xizmatlari (FCM, Mozilla, WNS, Apple) bo'lishi kerak. Aks holda server push yuborganda istalgan manzilga
// (ichki tarmoq, bulut metadata xizmati) POST so'rov jo'natardi (SSRF).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import { PushSubscription } from '../services/push';
import { optionalAuth, JWT_SECRET } from '../middleware/auth';
import pushRoutes from './push';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/push', optionalAuth, pushRoutes);
let uid = '';
const keys = { p256dh: 'BOr_p256dh_key', auth: 'auth_key' };
const sub = (endpoint: string) => request(app).post('/api/push/subscribe')
  .set('Authorization', `Bearer ${jwt.sign({ userId: uid }, JWT_SECRET)}`).send({ endpoint, keys });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  uid = String((await User.create({ firstName: 'A', phone: '+998906000001', role: 'ishchi', companyId: new mongoose.Types.ObjectId().toString() }))._id);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('push subscribe endpoint', () => {
  it("ichki/begona manzillar rad etiladi", async () => {
    for (const e of ['http://169.254.169.254/latest/meta-data', 'https://127.0.0.1/x', 'https://evil.example.com/push', 'https://fcm.googleapis.com.evil.com/x', 'javascript:alert(1)']) {
      expect((await sub(e)).status).toBe(400);
    }
    expect(await PushSubscription.countDocuments({})).toBe(0);
  });
  it("haqiqiy push xizmatlari qabul qilinadi", async () => {
    for (const e of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://web.push.apple.com/QK']) {
      expect((await sub(e)).status).toBe(200);
    }
  });
});
