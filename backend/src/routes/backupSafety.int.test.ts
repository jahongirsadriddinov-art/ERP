// Integratsion sinov: firma eksporti (barcha bo'limlar, maxfiy maydonlarsiz, ixtiyoriy parol bilan) va
// "Xavfli zona" — ikki bosqichli tozalash (token + kutish + firma nomi), cheklov va oldindan nusxa.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyAdmins: vi.fn(async () => undefined), notifyDeveloper: vi.fn(async () => undefined) }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn(), kickUser: vi.fn() }));
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));
vi.mock('../middleware/requireFeature', () => ({ requireFeature: () => (_req: any, _res: any, next: any) => next() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Company from '../models/Company';
import Transaction from '../models/Transaction';
import Equipment from '../models/Equipment';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import { CompanySnapshot } from '../services/companySnapshot';
import backupRoutes, { decryptExport } from './backup';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api/admin', requireAuth, backupRoutes);

const ids: Record<string, string> = {};
let cid = '';
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;

beforeAll(async () => {
  process.env.RESET_COOLDOWN_MS = '0';
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const c: any = await Company.create({ name: 'Gamma Qurilish', branchId: 'G1', phone: '+998905000009' } as any);
  cid = String(c._id);
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('owner', { firstName: 'Ega', phone: '+998905000001', role: 'direktor', isOwner: true, companyId: cid, passwordHash: 'XESH' });
  await mk('orin', { firstName: 'Orin', phone: '+998905000002', role: 'orinbosar', companyId: cid });
  await mk('ish', { firstName: 'Ishchi', phone: '+998905000003', role: 'ishchi', companyId: cid });
  await Transaction.create({ type: 'material', amount: 5000, description: 'Qum', companyId: cid, status: 'confirmed', date: '2026-10-01', createdById: ids.ish } as any);
  await Equipment.create({ name: 'Kran', companyId: cid } as any).catch(() => undefined);
}, 120_000);

afterAll(async () => {
  delete process.env.RESET_COOLDOWN_MS;
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('firma eksporti', () => {
  it("barcha bo'limlar, maxfiy maydonlarsiz; o'rinbosarga ruxsat yo'q", async () => {
    const r = await request(app).get('/api/admin/backup').set('Authorization', tok('owner'));
    expect(r.status).toBe(200);
    expect(r.body.format).toBe('qurilish-erp-company-backup');
    for (const k of ['users', 'objects', 'transactions', 'materials', 'attendance', 'messages', 'groups', 'equipment', 'safety', 'documents', 'payroll', 'media', 'signedDocs', 'announcements', 'dailyReports', 'worklogs', 'equipmentLogs', 'subscriptions', 'auditLogs']) {
      expect(Array.isArray(r.body.data[k])).toBe(true);
    }
    expect(JSON.stringify(r.body)).not.toContain('XESH');
    expect(r.body.counts.transactions).toBe(1);
    expect((await request(app).get('/api/admin/backup').set('Authorization', tok('orin'))).status).toBe(403);
  });

  it('parol bilan: fayl shifrlangan, importda faqat to\'g\'ri parol bilan ochiladi', async () => {
    expect((await request(app).post('/api/admin/backup/export').set('Authorization', tok('owner')).send({ password: '123' })).status).toBe(400);
    const r = await request(app).post('/api/admin/backup/export').set('Authorization', tok('owner')).send({ password: 'maxfiy-parol-1' });
    expect(r.status).toBe(200);
    expect(r.body.format).toBe('qurilish-erp-encrypted-backup');
    expect(JSON.stringify(r.body)).not.toContain('Qum');
    expect(JSON.parse(decryptExport(r.body, 'maxfiy-parol-1')).companyId).toBe(cid);

    const bad = await request(app).post('/api/admin/backup/import').set('Authorization', tok('owner')).send({ encrypted: r.body, password: 'xato-parol', confirm: true });
    expect(bad.status).toBe(400);
    await Transaction.deleteMany({ companyId: cid });
    const ok = await request(app).post('/api/admin/backup/import').set('Authorization', tok('owner')).send({ encrypted: r.body, password: 'maxfiy-parol-1', confirm: true });
    expect(ok.status).toBe(200);
    expect(await Transaction.countDocuments({ companyId: cid })).toBe(1);
  }, 60_000);
});

describe('Xavfli zona — ikki bosqichli tozalash', () => {
  it('tokensiz rad etiladi; token + firma nomi bilan — avval nusxa, keyin o\'chirish', async () => {
    const noTok = await request(app).post('/api/admin/reset').set('Authorization', tok('owner')).send({ scopes: ['expenses'], confirmText: 'Gamma Qurilish' });
    expect(noTok.status).toBe(400);
    expect(await Transaction.countDocuments({ companyId: cid })).toBe(1);

    // kutish oynasi: token darhol ishlamaydi (tasodifan ikki marta bosishdan himoya)
    process.env.RESET_COOLDOWN_MS = '60000';
    const early = await request(app).post('/api/admin/reset/prepare').set('Authorization', tok('owner')).send({ scopes: ['expenses'] });
    expect(early.body.waitMs).toBe(60000);
    expect((await request(app).post('/api/admin/reset').set('Authorization', tok('owner')).send({ scopes: ['expenses'], confirmText: 'Gamma Qurilish', token: early.body.token })).status).toBe(425);
    process.env.RESET_COOLDOWN_MS = '0';

    const prep = await request(app).post('/api/admin/reset/prepare').set('Authorization', tok('owner')).send({ scopes: ['expenses'] });
    expect(prep.status).toBe(200);
    expect(prep.body.counts.expenses).toBe(1);
    // boshqa bo'lim uchun token yaramaydi
    expect((await request(app).post('/api/admin/reset').set('Authorization', tok('owner')).send({ scopes: ['chat'], confirmText: 'Gamma Qurilish', token: prep.body.token })).status).toBe(400);
    expect((await request(app).post('/api/admin/reset').set('Authorization', tok('owner')).send({ scopes: ['expenses'], confirmText: 'xato', token: prep.body.token })).status).toBe(400);
    const done = await request(app).post('/api/admin/reset').set('Authorization', tok('owner')).send({ scopes: ['expenses'], confirmText: 'gamma qurilish', token: prep.body.token });
    expect(done.status).toBe(200);
    expect(await Transaction.countDocuments({ companyId: cid })).toBe(0);
    expect(await CompanySnapshot.countDocuments({ companyId: cid, reason: 'pre_reset' })).toBe(1);
    // token bir martalik
    expect((await request(app).post('/api/admin/reset').set('Authorization', tok('owner')).send({ scopes: ['expenses'], confirmText: 'Gamma Qurilish', token: prep.body.token })).status).toBe(400);
  }, 60_000);

  it("butun firmani tozalash — o'rinbosarga yo'q; soatiga 3 martadan ko'p emas", async () => {
    expect((await request(app).post('/api/admin/reset/prepare').set('Authorization', tok('orin')).send({ scopes: 'all' })).status).toBe(403);
    const run = async () => {
      const p = await request(app).post('/api/admin/reset/prepare').set('Authorization', tok('owner')).send({ scopes: ['chat'] });
      return request(app).post('/api/admin/reset').set('Authorization', tok('owner')).send({ scopes: ['chat'], confirmText: 'Gamma Qurilish', token: p.body.token });
    };
    expect((await run()).status).toBe(200);
    expect((await run()).status).toBe(200);
    expect((await run()).status).toBe(429); // 1-testdagi bilan birga 3 ta
  }, 60_000);
});
