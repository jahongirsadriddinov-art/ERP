// Integratsion sinov (xavfsizlik audit 2026-10-22): POST /api/objects/:id/smeta — obyekt materiallarini
// O'CHIRIB qayta yozadi va byudjetni almashtiradi; faqat rahbar yoki o'sha obyekt prorabi bajara oladi.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));
vi.mock('../services/smetaParser', () => ({ parseSmeta: vi.fn(async () => [{ name: 'Soxta', unit: 'dona', quantity: 1, price: 999_999_999 }]) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Material from '../models/Material';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import objectRoutes from './objects';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/objects', requireAuth, objectRoutes);

const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
let objId = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const A = new mongoose.Types.ObjectId().toString();
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('owner', { firstName: 'Ega', phone: '+998902000001', role: 'direktor', isOwner: true, companyId: A });
  await mk('prorab', { firstName: 'Prorab', phone: '+998902000002', role: 'prorab', companyId: A });
  await mk('ish', { firstName: 'Ishchi', phone: '+998902000003', role: 'ishchi', companyId: A });
  objId = String((await ObjectModel.create({ name: 'Uy', budget: 1000, companyId: A, foremanId: ids.prorab } as any))._id);
  await Material.create({ objectId: objId, name: 'Sement', needed: 10, sent: 0, remaining: 10, unit: 'qop', companyId: A } as any);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

const upload = (k: string) => request(app).post(`/api/objects/${objId}/smeta`).set('Authorization', tok(k))
  .attach('smeta', Buffer.from('a,b\n1,2'), 'smeta.csv');

describe('POST /api/objects/:id/smeta', () => {
  it("oddiy ishchi — 403, materiallar va byudjet o'zgarmaydi", async () => {
    const r = await upload('ish');
    expect(r.status).toBe(403);
    const mats: any[] = await Material.find({ objectId: objId }).lean();
    expect(mats.map((m) => m.name)).toEqual(['Sement']);
    expect((await ObjectModel.findById(objId).lean() as any).budget).toBe(1000);
  });

  it("obyekt prorabi va rahbar yuklay oladi", async () => {
    const r = await upload('prorab');
    expect(r.status).toBe(200);
    expect(r.text).toContain('"done":true');
    expect((await upload('owner')).status).toBe(200);
  });
});
