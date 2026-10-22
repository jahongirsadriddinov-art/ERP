// Integratsion sinov (xavfsizlik audit 2026-10-22): GET /api/equipment — GPS-treker tokeni (u bilan
// /api/public/telemetry/:token orqali login'siz motor-soat/joylashuv yoziladi) faqat rahbarga ko'rinadi.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Equipment from '../models/Equipment';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import equipmentRoutes from './equipment';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/equipment', requireAuth, equipmentRoutes);
const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const TOKEN = 'a'.repeat(36);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const A = new mongoose.Types.ObjectId().toString();
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('owner', { firstName: 'Ega', phone: '+998905000001', role: 'direktor', isOwner: true, companyId: A });
  await mk('ish', { firstName: 'Ishchi', phone: '+998905000002', role: 'ishchi', companyId: A });
  await Equipment.create({ name: 'Ekskavator', companyId: A, trackerToken: TOKEN } as any);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('GET /api/equipment', () => {
  it("ishchiga treker tokeni ko'rinmaydi, rahbarga ko'rinadi", async () => {
    const w = await request(app).get('/api/equipment').set('Authorization', tok('ish'));
    expect(w.status).toBe(200);
    expect(w.body[0].name).toBe('Ekskavator');
    expect(JSON.stringify(w.body)).not.toContain(TOKEN);
    const b = await request(app).get('/api/equipment').set('Authorization', tok('owner'));
    expect(b.body[0].trackerToken).toBe(TOKEN);
  });
});
