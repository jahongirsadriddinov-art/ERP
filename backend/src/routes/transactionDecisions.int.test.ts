// Integratsion sinov: PATCH /api/transactions/:id/{confirm,approve,reject} — mantiq services/transactionActions.ts'ga
// ko'chirilgandan keyin ham xatti-harakat AYNAN avvalgidek (status kodlari, xato matnlari, approverId qoidasi).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
vi.mock('../services/email', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('../services/push', () => ({ sendPushToUser: vi.fn(async () => undefined) }));
// Smena darvozasi (423) bu sinov mavzusi emas — hamma "smenada"
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Transaction from '../models/Transaction';
import Material from '../models/Material';
import AuditLog from '../models/AuditLog';
import { requireAuth, JWT_SECRET } from '../middleware/auth';
import txRoutes from './transactions';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/transactions', requireAuth, txRoutes);

const ids: Record<string, string> = {};
let A = '';
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const patch = (k: string, id: string, action: string, body: any = {}) =>
  request(app).patch(`/api/transactions/${id}/${action}`).set('Authorization', tok(k)).send(body);
const mkTx = async (d: any) => String(((await Transaction.create({ status: 'pending', date: '2026-10-16', amount: 100_000, companyId: A, ...d } as any)) as any)._id);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  A = new mongoose.Types.ObjectId().toString();
  const B = new mongoose.Types.ObjectId().toString();
  const mk = async (k: string, d: any) => { ids[k] = String((await User.create(d))._id); };
  await mk('owner', { firstName: 'Ega', phone: '+998901000001', role: 'direktor', isOwner: true, companyId: A });
  await mk('orin', { firstName: 'Orin', phone: '+998901000002', role: 'orinbosar', companyId: A });
  await mk('prorab', { firstName: 'Prorab', phone: '+998901000003', role: 'prorab', companyId: A });
  await mk('ish', { firstName: 'Ishchi', phone: '+998901000004', role: 'ishchi', companyId: A });
  await mk('other', { firstName: 'Begona', phone: '+998901000005', role: 'direktor', companyId: B });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('approve', () => {
  it("tanlangan tasdiqlovchi bo'lmagan admin — 403, yozuv o'zgarmaydi; tanlangani — 200 + tarix + audit", async () => {
    const id = await mkTx({ type: 'transport', requiresAdminApproval: true, approverId: ids.owner, createdById: ids.ish, description: 'Yuk mashinasi' });
    const r1 = await patch('orin', id, 'approve');
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe('Bu chiqimni faqat tanlangan tasdiqlovchi tasdiqlay oladi');
    expect((await Transaction.findById(id).lean() as any).status).toBe('pending');
    const r2 = await patch('owner', id, 'approve', { note: 'ok' });
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe('confirmed');
    expect(r2.body.id).toBe(id);
    const tx: any = await Transaction.findById(id).lean();
    expect(tx.approvalHistory).toHaveLength(1);
    expect(tx.approvalHistory[0]).toMatchObject({ userId: ids.owner, action: 'approved', note: 'ok' });
    expect(tx.confirmedById).toBe(ids.owner);
    expect(await AuditLog.countDocuments({ entity: 'transaction', entityId: id, action: 'approve' })).toBe(1);
    // ikkinchi marta — 409
    const r3 = await patch('owner', id, 'approve');
    expect(r3.status).toBe(409);
  });

  it("ishchi — 403; admin tasdig'i talab qilinmasa — 400; boshqa firma — 404", async () => {
    const id = await mkTx({ type: 'material', requiresAdminApproval: true });
    expect((await patch('ish', id, 'approve')).status).toBe(403);
    const plain = await mkTx({ type: 'material' });
    expect((await patch('owner', plain, 'approve')).status).toBe(400);
    expect((await patch('other', id, 'approve')).status).toBe(404);
  });
});

describe('confirm', () => {
  it("faqat qabul qiluvchi; transfer tasdig'ida material va bog'liq chiqim (shu firma bilan)", async () => {
    const obj = new mongoose.Types.ObjectId();
    await Material.create({ objectId: obj, name: 'Sement', needed: 100, sent: 0, remaining: 100, unit: 'qop', price: 50_000, companyId: A } as any);
    const id = await mkTx({ type: 'transfer', fromUserId: ids.owner, toUserId: ids.prorab, projectId: String(obj), materialName: 'Sement', quantity: 10, unit: 'qop' });
    const r1 = await patch('owner', id, 'confirm');
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe('Faqat qabul qiluvchi tasdiqlashi mumkin');
    const r2 = await patch('prorab', id, 'confirm', { defect: '2 qop yirtiq' });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ status: 'confirmed', defect: '2 qop yirtiq', confirmedById: ids.prorab });
    const mat: any = await Material.findOne({ objectId: obj }).lean();
    expect([mat.sent, mat.remaining]).toEqual([10, 90]);
    const exp: any = await Transaction.findOne({ sourceTransferId: id }).lean();
    expect(exp).toMatchObject({ type: 'material', status: 'confirmed', amount: 500_000, companyId: A });
    expect((await patch('prorab', id, 'confirm')).status).toBe(409);
  });
});

describe('reject', () => {
  it("qabul qiluvchi yoki admin; approverId tanlangan bo'lsa — faqat o'sha admin; tarixga sabab", async () => {
    const id = await mkTx({ type: 'boshqa', requiresAdminApproval: true, approverId: ids.owner });
    const r1 = await patch('orin', id, 'reject', { note: 'yo\'q' });
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe('Bu chiqimni faqat tanlangan tasdiqlovchi rad eta oladi');
    expect((await patch('ish', id, 'reject')).status).toBe(403);
    const r2 = await patch('owner', id, 'reject', { note: 'Qimmat' });
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe('rejected');
    const tx: any = await Transaction.findById(id).lean();
    expect(tx.approvalHistory[0]).toMatchObject({ action: 'rejected', note: 'Qimmat' });
    const recv = await mkTx({ type: 'transfer', fromUserId: ids.owner, toUserId: ids.ish, materialName: 'Qum', quantity: 1, unit: 'kub' });
    expect((await patch('ish', recv, 'reject')).status).toBe(200);
  });
});

describe("tahrirlash (owner 2026-10-22): o'zi qo'shganini — o'zi, hammasini — direktor/o'rinbosar", () => {
  const edit = (k: string, id: string, body: any) => request(app).patch(`/api/transactions/${id}`).set('Authorization', tok(k)).send(body);
  it("muallif o'z kutilayotgan chiqimini o'zgartiradi; boshqasi — 403; tasdiqlanganini faqat rahbar; boshqa firma — 404", async () => {
    const id = await mkTx({ type: 'material', createdById: ids.ish, description: 'Sement' });
    const r1 = await edit('ish', id, { amount: 150_000, description: 'Sement 3 qop', type: 'transport', date: '2026-10-20' });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ amount: 150_000, description: 'Sement 3 qop', type: 'transport', date: '2026-10-20' });
    expect((await edit('prorab', id, { amount: 1 })).status).toBe(403);
    expect((await edit('ish', id, { type: 'income' })).status).toBe(400);
    expect((await edit('ish', id, { amount: -5 })).status).toBe(400);
    await Transaction.updateOne({ _id: id }, { $set: { status: 'confirmed' } });
    expect((await edit('ish', id, { amount: 2 })).status).toBe(409);
    const r2 = await edit('orin', id, { amount: 160_000 });
    expect(r2.status).toBe(200);
    expect(r2.body.amount).toBe(160_000);
    expect(await AuditLog.countDocuments({ entity: 'transaction', entityId: id, action: 'update' })).toBe(2);
    expect((await edit('other', id, { amount: 3 })).status).toBe(404);
  });
});

describe("kirim (owner 2026-10-22): faqat direktor/o'rinbosar kiritadi; direktor hammasini, o'rinbosar o'zinikini ko'radi", () => {
  const list = (k: string) => request(app).get('/api/transactions').set('Authorization', tok(k));
  const add = (k: string, body: any) => request(app).post('/api/transactions').set('Authorization', tok(k)).send(body);
  it('kiritish va ko\'rish qoidalari', async () => {
    expect((await add('prorab', { type: 'income', amount: 5_000_000, description: 'Avans' })).status).toBe(403);
    const r1 = await add('orin', { type: 'income', amount: 7_000_000, description: "Mijozdan to'lov" });
    expect(r1.status).toBeLessThan(300);
    await mkTx({ type: 'income', amount: 9_000_000, createdById: ids.owner, description: 'Direktor kirimi' });
    const own = (await list('owner')).body.filter((t: any) => t.type === 'income').map((t: any) => t.description).sort();
    expect(own).toEqual(['Direktor kirimi', "Mijozdan to'lov"]);
    const orin = (await list('orin')).body.filter((t: any) => t.type === 'income').map((t: any) => t.description);
    expect(orin).toEqual(["Mijozdan to'lov"]);
    expect((await list('prorab')).body.some((t: any) => t.type === 'income')).toBe(false);
  });
});
