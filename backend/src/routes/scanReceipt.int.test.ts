// POST /api/transactions/scan-receipt — AI muddati o'tsa yoki xizmat xato bersa ham tez, tushunarli 422
// ("qo'lda to'ldiring", manual: true) — 5xx/osilib qolish emas (error tracker: "API javob bermadi (tarmoq)").
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
vi.mock('../services/push', () => ({ sendPushToUser: vi.fn(async () => undefined) }));
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));
const rx = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../services/botExpense', async (orig) => ({ ...(await orig<any>()), receiptToExpense: rx.fn }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import txRoutes, { SCAN_RECEIPT_DEADLINE_MS } from './transactions';
import { GEMINI_TIMEOUT } from '../services/gemini';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api/transactions', requireAuth, txRoutes);
let tok = '';
const img = 'A'.repeat(2000);
const scan = () => request(app).post('/api/transactions/scan-receipt').set('Authorization', tok).send({ image: img, mimeType: 'image/jpeg' });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const u = await User.create({ firstName: 'Orin', phone: '+998901000002', role: 'orinbosar', companyId: new mongoose.Types.ObjectId().toString() } as any);
  tok = `Bearer ${jwt.sign({ userId: String(u._id) }, JWT_SECRET)}`;
}, 120_000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

describe('scan-receipt', () => {
  it('uses a deadline well under proxy timeouts', () => {
    expect(SCAN_RECEIPT_DEADLINE_MS).toBeGreaterThan(5_000);
    expect(SCAN_RECEIPT_DEADLINE_MS).toBeLessThanOrEqual(45_000);
  });

  it('passes the deadline to the AI and returns the parsed receipt', async () => {
    rx.fn.mockResolvedValueOnce({ amount: 150000, description: 'Sement', category: 'material' });
    const r = await scan();
    expect(r.status).toBe(200);
    expect(r.body.amount).toBe(150000);
    expect(rx.fn.mock.calls[0][4]).toEqual({ deadlineMs: SCAN_RECEIPT_DEADLINE_MS });
  });

  it('AI timeout → 422 manual (not 5xx)', async () => {
    rx.fn.mockRejectedValueOnce(new Error(GEMINI_TIMEOUT));
    const r = await scan();
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ manual: true, timeout: true });
  });

  it('AI failure → 422 manual; unreadable → 422 manual', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rx.fn.mockRejectedValueOnce(new Error('503 overloaded'));
    expect((await scan()).body.manual).toBe(true);
    rx.fn.mockResolvedValueOnce(null);
    const r = await scan();
    expect(r.status).toBe(422);
    expect(r.body.manual).toBe(true);
  });
});
