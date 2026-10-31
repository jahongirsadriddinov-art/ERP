// Widget uchun ixcham xulosa (owner 2026-10-31). Asosiy qoida: PUL faqat
// rahbarga — widget boshqa odamning telefonida ham ko'rinib turadi.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyDeveloper: vi.fn(async () => undefined) }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Company from '../models/Company';
import Transaction from '../models/Transaction';
import Attendance from '../models/Attendance';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import widgetRoutes from './widget';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/widget', requireAuth, widgetRoutes);

const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
let A = '';
const today = new Date().toISOString().split('T')[0];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const c: any = await Company.create({ branchId: 'BR-W-1', name: 'Alfa', phone: '+998900000070' });
  A = String(c._id);
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('dir', { firstName: 'Dir', phone: '+998905300001', role: 'direktor', isOwner: true, companyId: A });
  await mk('ish', { firstName: 'Ish', phone: '+998905300002', role: 'ishchi', companyId: A });
}, 180_000);

afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });

beforeEach(async () => {
  await Transaction.deleteMany({});
  await Attendance.deleteMany({});
});

describe('GET /api/widget/summary', () => {
  it("rahbarga bugungi chiqim ko'rinadi", async () => {
    await Transaction.create({ type: 'material', status: 'confirmed', amount: 500_000, date: today, companyId: A });
    await Transaction.create({ type: 'material', status: 'confirmed', amount: 300_000, date: today, companyId: A });
    const r = await request(app).get('/api/widget/summary').set('Authorization', tok('dir'));
    expect(r.status).toBe(200);
    expect(r.body.todayExpense).toBe(800_000);
    expect(r.body.company).toBe('Alfa');
  });

  it("ishchiga PUL umuman berilmaydi", async () => {
    await Transaction.create({ type: 'material', status: 'confirmed', amount: 500_000, date: today, companyId: A });
    const r = await request(app).get('/api/widget/summary').set('Authorization', tok('ish'));
    expect(r.status).toBe(200);
    expect(r.body.todayExpense).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain('500000');
  });

  it("ko'chirma va kirim chiqim deb hisoblanmaydi", async () => {
    await Transaction.create({ type: 'transfer', status: 'confirmed', amount: 900_000, date: today, companyId: A });
    await Transaction.create({ type: 'income', status: 'confirmed', amount: 900_000, date: today, companyId: A });
    await Transaction.create({ type: 'material', status: 'confirmed', amount: 100_000, date: today, companyId: A });
    const r = await request(app).get('/api/widget/summary').set('Authorization', tok('dir'));
    expect(r.body.todayExpense).toBe(100_000);
  });

  it("kechagi chiqim bugungi raqamga qo'shilmaydi", async () => {
    const yd = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
    await Transaction.create({ type: 'material', status: 'confirmed', amount: 700_000, date: yd, companyId: A });
    const r = await request(app).get('/api/widget/summary').set('Authorization', tok('dir'));
    expect(r.body.todayExpense).toBe(0);
  });

  it('davomat va tasdiq kutayotganlar sanaladi', async () => {
    await Attendance.create({ userId: ids.ish, companyId: A, date: today, status: 'present' });
    await Transaction.create({ type: 'transfer', status: 'pending', amount: 1, date: today, companyId: A });
    const r = await request(app).get('/api/widget/summary').set('Authorization', tok('ish'));
    expect(r.body.attendance).toBe(1);
    expect(r.body.pending).toBe(1);
  });

  it('tokensiz 401', async () => {
    expect((await request(app).get('/api/widget/summary')).status).toBe(401);
  });
});
