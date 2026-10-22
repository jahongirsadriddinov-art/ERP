// Excel eksportlari (owner 2026-10-22: "tartibsiz"): 1C tranzaksiyalari va eski /report — haqiqiy .xlsx,
// o'zbekcha sarlavhalar, ID o'rniga nomlar, sana — sana, summa — son, JAMI qatori. SheetJS bilan o'qib tekshiriladi.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn(), kickUser: vi.fn() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Company from '../models/Company';
import ObjectModel from '../models/Object';
import Transaction from '../models/Transaction';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import export1cRoutes from './export1c';

let mongo: MongoMemoryServer;
const app = express();
app.use('/api/export1c', requireAuth, export1cRoutes);
const ids: Record<string, string> = {};
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const binary = (r: request.Request) => r.buffer(true).parse((res, cb) => {
  const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const c = await Company.create({ branchId: 'BR-XL-1', name: 'Jondor Iris Stroy', phone: '+998900000021' });
  const cid = String(c._id);
  const boss = await User.create({ firstName: 'Ali', lastName: 'Valiyev', phone: '+998900000022', role: 'direktor', companyId: cid, isOwner: true });
  const w = await User.create({ firstName: 'Sardor', phone: '+998900000023', role: 'ishchi', companyId: cid });
  ids.boss = String(boss._id);
  const o = await ObjectModel.create({ name: 'Chilonzor 5-uy', companyId: cid, foremanId: ids.boss, budget: 10_000_000 });
  await Transaction.create([
    { type: 'oylik', amount: 3_000_000, description: 'Oktabr oyligi', date: '2026-10-15', status: 'confirmed', projectId: String(o._id), toUserId: String(w._id), createdById: ids.boss, confirmedById: ids.boss, companyId: cid },
    { type: 'material', amount: 1_500_000, description: 'Sement', date: '2026-10-10', status: 'pending', projectId: String(o._id), createdById: ids.boss, companyId: cid },
  ]);
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

describe('Excel exports', () => {
  it('/transactions: readable names, real dates and numbers, totals', async () => {
    const r = await binary(request(app).get('/api/export1c/transactions').set('Authorization', tok('boss')));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    const wb = XLSX.read(r.body, { type: 'buffer', cellNF: true });
    expect(wb.SheetNames).toEqual(['Tranzaksiyalar']);
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets.Tranzaksiyalar, { header: 1, raw: true, blankrows: false });
    expect(rows[0][0]).toBe('1C uchun tranzaksiyalar');
    expect(rows[1][0]).toContain('Jondor Iris Stroy');
    const header = rows.find(x => x[0] === '№')!;
    expect(header).toEqual(['№', 'Sana', 'Hujjat', 'Turi', 'Tavsif / material', 'Obyekt', 'Kimdan / kiritgan', 'Kimga', 'Miqdor', "O'lchov", "Summa (so'm)", 'Asl valyuta', 'Holati', 'Tasdiqlagan']);
    const first = rows[rows.indexOf(header) + 1];
    expect(first[1]).toBeInstanceOf(Date); // haqiqiy sana (dd.mm.yyyy), matn emas
    expect(first.slice(2, 6)).toEqual(['Chiqim', 'Material', 'Sement', 'Chilonzor 5-uy']);
    expect(first[6]).toBe('Ali Valiyev');
    expect(first[12]).toBe('Kutilmoqda');
    const second = rows[rows.indexOf(header) + 2];
    expect(second[7]).toBe('Sardor');
    expect(second[12]).toBe('Tasdiqlangan');
    const total = rows.find(x => x[0] === 'JAMI')!;
    expect(total[10]).toBe(4_500_000);
    const ws = wb.Sheets.Tranzaksiyalar;
    expect(ws['!autofilter']?.ref).toBe('A4:N6');
    expect(ws.K5.z).toBe('#,##0');
    expect(ws.B5).toMatchObject({ t: 'n', v: 46305, z: 'dd.mm.yyyy' }); // 2026-10-10
  });

  it('/report: confirmed expenses, by type and budget sheets', async () => {
    const r = await binary(request(app).get('/api/export1c/report?from=2026-10-01&to=2026-10-31').set('Authorization', tok('boss')));
    expect(r.status).toBe(200);
    const wb = XLSX.read(r.body, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Chiqimlar', "Turlar bo'yicha", 'Byudjet']);
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets.Chiqimlar, { header: 1, raw: true, blankrows: false });
    expect(rows.find(x => x[0] === 'JAMI')![7]).toBe(3_000_000);
    const budget = XLSX.utils.sheet_to_json<any[]>(wb.Sheets.Byudjet, { header: 1, raw: true, blankrows: false });
    expect(budget.find(x => x[0] === 'Chilonzor 5-uy')).toEqual(['Chilonzor 5-uy', 10_000_000, 3_000_000, 7_000_000, 0.3]);
  });
});
