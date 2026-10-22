// Integratsion sinov (xavfsizlik audit 2026-10-22): POST /api/admin/backup/import — fayl ichidagi xodimlar
// ro'yxati bilan firma egasini o'chirib/almashtirib bo'lmaydi va hech kim o'ziga isOwner berolmaydi.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn(), kickUser: vi.fn() }));
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import backupRoutes from './backup';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api/admin', requireAuth, backupRoutes);

const ids: Record<string, string> = {};
let A = '';
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  A = new mongoose.Types.ObjectId().toString();
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('owner', { firstName: 'Ega', phone: '+998904000001', role: 'direktor', isOwner: true, companyId: A, telegramChatId: '111' });
  await mk('dir', { firstName: 'Direktor2', phone: '+998904000002', role: 'direktor', companyId: A });
  await mk('ish', { firstName: 'Ishchi', phone: '+998904000003', role: 'ishchi', companyId: A });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('backup import', () => {
  it("egasi bo'lmagan direktor egani almashtira/o'chira olmaydi, o'ziga isOwner berolmaydi", async () => {
    const data = {
      users: [
        // egani hujumchi telefoni bilan "qayta tiklash" (keyin OTP orqali ega hisobiga kirish)
        { _id: ids.owner, firstName: 'Ega', phone: '+998909999999', role: 'ishchi', isOwner: false },
        { _id: ids.dir, firstName: 'Direktor2', phone: '+998904000002', role: 'direktor', isOwner: true },
        { _id: ids.ish, firstName: 'Ishchi', phone: '+998904000003', role: 'ishchi' },
      ],
    };
    const r = await request(app).post('/api/admin/backup/import').set('Authorization', tok('dir')).send({ companyId: A, data, confirm: true });
    expect(r.status).toBe(200);
    const owner: any = await User.findById(ids.owner).lean();
    expect(owner).toMatchObject({ phone: '+998904000001', role: 'direktor', isOwner: true, telegramChatId: '111' });
    const dir: any = await User.findById(ids.dir).lean();
    expect(dir?.isOwner).toBeFalsy();
    expect(await User.countDocuments({ companyId: A, isOwner: true })).toBe(1);
  });
});
