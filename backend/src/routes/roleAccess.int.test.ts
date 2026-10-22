// Integratsion sinov: ROL × RESURS kirish matritsasi (owner 2026-10-22).
// Qoidalar: har kim O'ZI qo'shganini tahrirlaydi/o'chiradi; direktor va o'rinbosar — firmadagi HAMMASINI;
// tasdiqlangan chiqim — faqat rahbar; kirim — faqat rahbar kiritadi (direktor hammasini, o'rinbosar o'zinikini ko'radi);
// boshqa firma ma'lumoti — hech kimga (404/bo'sh ro'yxat); ishchi rahbar yo'llariga kira olmaydi; dasturchi yo'llari faqat dasturchiga.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../services/bot', () => ({
  bot: { sendMessage: vi.fn(async () => undefined), sendPhoto: vi.fn(), sendDocument: vi.fn(), sendVoice: vi.fn(), sendVideo: vi.fn(), sendLocation: vi.fn() },
  notifyAdmins: vi.fn(async () => undefined), keyboardForUser: vi.fn(async () => ({})), fmtWorkDuration: vi.fn(() => ''),
}));
vi.mock('../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), emitToCompanyBosses: vi.fn(), broadcast: vi.fn(), kickUser: vi.fn(), leaveGroupRoom: vi.fn() }));
vi.mock('../services/email', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('../services/push', () => ({ sendPushToUser: vi.fn(async () => undefined) }));
vi.mock('../services/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock('../services/photoAnalysis', () => ({ analyzeMedia: vi.fn(async () => null) }));
vi.mock('../services/smetaParser', () => ({ parseSmeta: vi.fn(async () => []) }));
// Smena darvozasi (423) bu sinov mavzusi emas — hamma "smenada"
vi.mock('../middleware/workGate', async (orig) => ({ ...(await orig<any>()), isOnShift: vi.fn(async () => true) }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../models/User';
import Company from '../models/Company';
import Subscription from '../models/Subscription';
import ObjectModel from '../models/Object';
import Material from '../models/Material';
import Transaction from '../models/Transaction';
import Notification from '../models/Notification';
import Message from '../models/Message';
import AuditLog from '../models/AuditLog';
import { requireAuth, blockDeveloper, JWT_SECRET } from '../middleware/auth';
import { getBackendUrl } from '../utils/backendUrl';
import objectRoutes from './objects';
import txRoutes from './transactions';
import materialRoutes from './materials';
import usersRoutes from './users';
import documentsRoutes from './documents';
import equipmentRoutes from './equipment';
import safetyRoutes from './safety';
import payrollRoutes from './payroll';
import worklogsRoutes from './worklogs';
import dailyReportsRoutes from './dailyReports';
import attendanceRoutes from './attendance';
import gpsRoutes from './gps';
import messageRoutes from './messages';
import groupRoutes from './groups';
import notificationRoutes from './notifications';
import companySelfRoutes from './company';
import companyRoutes from './companies';
import signDocsRoutes from './signDocs';
import { mountAiVoiceRoutes } from '../aiVoice/bootstrap';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
// index.ts bilan AYNAN bir xil o'rnatish (blockDeveloper qayerda bo'lsa — shu yerda ham)
app.use('/api/objects', requireAuth, blockDeveloper, objectRoutes);
app.use('/api/users', requireAuth, usersRoutes);
app.use('/api/transactions', requireAuth, blockDeveloper, txRoutes);
app.use('/api/messages', requireAuth, messageRoutes);
app.use('/api/groups', requireAuth, groupRoutes);
app.use('/api/materials', requireAuth, blockDeveloper, materialRoutes);
app.use('/api/companies', requireAuth, companyRoutes);
app.use('/api/company', requireAuth, companySelfRoutes);
mountAiVoiceRoutes(app);
app.use('/api/attendance', requireAuth, blockDeveloper, attendanceRoutes);
app.use('/api/gps', requireAuth, blockDeveloper, gpsRoutes);
app.use('/api/notifications', requireAuth, notificationRoutes);
app.use('/api/equipment', requireAuth, blockDeveloper, equipmentRoutes);
app.use('/api/safety', requireAuth, blockDeveloper, safetyRoutes);
app.use('/api/documents', requireAuth, blockDeveloper, documentsRoutes);
app.use('/api/payroll', requireAuth, blockDeveloper, payrollRoutes);
app.use('/api/worklogs', requireAuth, blockDeveloper, worklogsRoutes);
app.use('/api/daily-reports', requireAuth, blockDeveloper, dailyReportsRoutes);
app.use('/api/sign-docs', requireAuth, blockDeveloper, signDocsRoutes);

// Foydalanuvchilar: A firmasi — ega (direktor), o'rinbosar, prorab, prorab2, brigadir, ishchi, ishchi2; B firmasi — direktor, ishchi; dasturchi.
const ids: Record<string, string> = {};
let A = '', B = '';
let objA = '', objA2 = '', objB = '';
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', k: string, path: string, body?: any) => {
  const r = (request(app) as any)[method](path).set('Authorization', tok(k));
  return body !== undefined ? r.send(body) : r;
};
const get = (k: string, p: string) => call('get', k, p);
const post = (k: string, p: string, b: any = {}) => call('post', k, p, b);
const patch = (k: string, p: string, b: any = {}) => call('patch', k, p, b);
const put = (k: string, p: string, b: any = {}) => call('put', k, p, b);
const del = (k: string, p: string) => call('delete', k, p);
const status = async (r: Promise<any> | any) => (await r).status;
const OWN = (name: string) => `${getBackendUrl()}/uploads/${name}`;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const ca: any = await Company.create({ branchId: 'RA-1', name: 'Alfa Qurilish', phone: '+998901110001', features: { piecework: true } } as any);
  const cb: any = await Company.create({ branchId: 'RA-2', name: 'Beta Qurilish', phone: '+998901110002', features: { piecework: true } } as any);
  A = String(ca._id); B = String(cb._id);
  for (const cid of [A, B]) {
    await Subscription.create({ companyId: cid, selectedPlan: 'custom', customFeatures: ['ai_assistant', 'gps_tracking', 'audit_log'], status: 'active' } as any);
  }
  let n = 0;
  const mk = async (k: string, role: string, companyId?: string, extra: any = {}) => {
    ids[k] = String((await User.create({ firstName: k, phone: `+99890200${String(++n).padStart(4, '0')}`, role, companyId, baseSalary: 3_000_000, ...extra } as any))._id);
  };
  await mk('owner', 'direktor', A, { isOwner: true });
  await mk('orin', 'orinbosar', A);
  await mk('prorab', 'prorab', A);
  await mk('prorab2', 'prorab', A);
  await mk('brig', 'brigadir', A);
  await mk('ish', 'ishchi', A);
  await mk('ish2', 'ishchi', A);
  await mk('bossB', 'direktor', B, { isOwner: true });
  await mk('ishB', 'ishchi', B);
  await mk('dev', 'dasturchi');
  objA = String(((await ObjectModel.create({ name: 'Alfa uy', companyId: A, foremanId: ids.prorab } as any)) as any)._id);
  objA2 = String(((await ObjectModel.create({ name: 'Alfa ombor', companyId: A, foremanId: ids.brig } as any)) as any)._id);
  objB = String(((await ObjectModel.create({ name: 'Beta uy', companyId: B } as any)) as any)._id);
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

// ───────────────────────────── Obyektlar ─────────────────────────────
describe('obyektlar', () => {
  it("yaratish/tahrirlash/holat/o'chirish — faqat direktor/o'rinbosar; boshqa firma — 404; dasturchi — 403", async () => {
    for (const k of ['prorab', 'brig', 'ish']) expect(await status(post(k, '/api/objects', { name: 'Yangi' }))).toBe(403);
    expect(await status(post('dev', '/api/objects', { name: 'Yangi' }))).toBe(403);
    const r = await post('orin', '/api/objects', { name: "O'rinbosar obyekti" });
    expect(r.status).toBe(201);
    const id = String(r.body._id);
    expect(await status(patch('ish', `/api/objects/${id}`, { name: 'Buzish' }))).toBe(403);
    expect(await status(patch('prorab', `/api/objects/${id}/status`, { status: 'completed' }))).toBe(403);
    expect(await status(patch('bossB', `/api/objects/${id}`, { name: 'Begona' }))).toBe(404);
    expect(await status(patch('owner', `/api/objects/${id}`, { name: 'Ega tahriri' }))).toBe(200);
    expect(await status(del('ish', `/api/objects/${id}`))).toBe(403);
    expect(await status(del('bossB', `/api/objects/${id}`))).toBe(404);
    expect(await status(del('orin', `/api/objects/${id}`))).toBe(200);
    await vi.waitFor(async () => expect(await AuditLog.countDocuments({ entity: 'object', entityId: id })).toBe(3));
  });

  it("ro'yxat — hamma o'z firmasinikini ko'radi, boshqa firmaniki ko'rinmaydi", async () => {
    const names = (r: any) => r.body.map((o: any) => o.name);
    expect(names(await get('ish', '/api/objects'))).toEqual(expect.arrayContaining(['Alfa uy', 'Alfa ombor']));
    expect(names(await get('ish', '/api/objects'))).not.toContain('Beta uy');
    expect(names(await get('bossB', '/api/objects'))).toEqual(['Beta uy']);
    expect(await status(get('dev', '/api/objects'))).toBe(403);
  });

  it("smeta yuklash (butun material ro'yxatini almashtiradi) — rahbar yoki obyekt prorabi; ishchi/boshqa prorab — 403", async () => {
    const up = (k: string, id: string) => request(app).post(`/api/objects/${id}/smeta`).set('Authorization', tok(k)).attach('smeta', Buffer.from('a;b'), 'smeta.csv');
    expect((await up('ish', objA)).status).toBe(403);
    expect((await up('prorab2', objA)).status).toBe(403);
    expect((await up('bossB', objA)).status).toBe(404);
    const ok = await up('prorab', objA);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/event-stream/);
    expect((await up('orin', objA)).status).toBe(200);
  });

  it("plan-fakt — rahbar va prorab; ishchi — 403", async () => {
    expect(await status(get('ish', '/api/objects/plan-fact'))).toBe(403);
    expect(await status(get('prorab', '/api/objects/plan-fact'))).toBe(200);
    expect(await status(get('owner', '/api/objects/plan-fact'))).toBe(200);
  });

  it("rasm/video: istalgan xodim qo'shadi; o'zinikini o'zi, hammasini rahbar tahrirlaydi/o'chiradi", async () => {
    const r = await post('ish', `/api/objects/${objA}/media`, { url: OWN('a.jpg'), type: 'image', caption: 'Devor' });
    expect(r.status).toBe(201);
    const mid = String(r.body.id);
    expect(await status(post('ishB', `/api/objects/${objA}/media`, { url: OWN('b.jpg'), type: 'image' }))).toBe(404);
    expect(await status(patch('ish2', `/api/objects/${objA}/media/${mid}`, { caption: 'x' }))).toBe(403);
    expect(await status(del('ish2', `/api/objects/${objA}/media/${mid}`))).toBe(403);
    expect(await status(patch('ish', `/api/objects/${objA}/media/${mid}`, { caption: 'Devor 2' }))).toBe(200);
    expect(await status(del('bossB', `/api/objects/${objA}/media/${mid}`))).toBe(404);
    expect(await status(del('orin', `/api/objects/${objA}/media/${mid}`))).toBe(200);
    expect(await status(post('ish', `/api/objects/${objA}/client-link`))).toBe(403);
  });
});

// ───────────────────────────── Moliya ─────────────────────────────
describe('tranzaksiyalar', () => {
  it("chiqim: muallif o'zinikini tahrirlaydi/o'chiradi, boshqa ishchi — 403, rahbar — hammasini; tasdiqlangan — faqat rahbar", async () => {
    const r = await post('ish', '/api/transactions', { type: 'material', amount: 120_000, description: 'Mix', approverId: ids.owner });
    expect(r.status).toBe(201);
    const id = String(r.body._id);
    expect(await status(patch('ish2', `/api/transactions/${id}`, { amount: 1 }))).toBe(403);
    expect(await status(del('ish2', `/api/transactions/${id}`))).toBe(403);
    expect(await status(del('prorab', `/api/transactions/${id}`))).toBe(403);
    expect(await status(patch('ish', `/api/transactions/${id}`, { amount: 130_000 }))).toBe(200);
    expect(await status(patch('bossB', `/api/transactions/${id}`, { amount: 1 }))).toBe(404);
    expect(await status(del('bossB', `/api/transactions/${id}`))).toBe(404);
    await Transaction.updateOne({ _id: id }, { $set: { status: 'confirmed' } });
    expect(await status(patch('ish', `/api/transactions/${id}`, { amount: 2 }))).toBe(409);
    expect(await status(del('ish', `/api/transactions/${id}`))).toBe(409);
    expect(await status(patch('orin', `/api/transactions/${id}`, { amount: 140_000 }))).toBe(200);
    expect(await status(del('owner', `/api/transactions/${id}`))).toBe(200);
  });

  it("yukxat: yuboruvchi o'zi qo'shganini tahrirlaydi/o'chiradi; qabul qiluvchi — tahrirlay olmaydi", async () => {
    const r = await post('prorab', '/api/transactions', { type: 'transfer', materialName: 'Sement', quantity: 10, unit: 'qop', toUserId: ids.ish, projectId: objA });
    expect(r.status).toBe(201);
    const id = String(r.body._id);
    expect(r.body.createdById).toBe(ids.prorab);
    expect(await status(patch('ish', `/api/transactions/${id}`, { quantity: 99 }))).toBe(403);
    expect(await status(del('ish', `/api/transactions/${id}`))).toBe(403);
    const e = await patch('prorab', `/api/transactions/${id}`, { quantity: 12 });
    expect(e.status).toBe(200);
    expect(e.body.quantity).toBe(12);
    expect(await status(del('prorab', `/api/transactions/${id}`))).toBe(200);
    // Eski yukxat (createdById yo'q) — yuboruvchi (fromUserId) egasi hisoblanadi
    const old: any = await Transaction.create({ type: 'transfer', status: 'pending', date: '2026-10-20', companyId: A, fromUserId: ids.brig, toUserId: ids.ish, materialName: 'Qum', quantity: 2, unit: 'kub' } as any);
    expect(await status(patch('brig', `/api/transactions/${old._id}`, { quantity: 3 }))).toBe(200);
    expect(await status(del('ish', `/api/transactions/${old._id}`))).toBe(403);
    expect(await status(del('brig', `/api/transactions/${old._id}`))).toBe(200);
  });

  it("kirim: faqat rahbar kiritadi; o'rinbosar direktor kirimini ko'rmaydi va o'zgartira/o'chira olmaydi", async () => {
    for (const k of ['prorab', 'brig', 'ish']) expect(await status(post(k, '/api/transactions', { type: 'income', amount: 1_000_000 }))).toBe(403);
    const dirInc = await post('owner', '/api/transactions', { type: 'income', amount: 9_000_000, description: 'Direktor kirimi' });
    expect(dirInc.status).toBe(201);
    const orinInc = await post('orin', '/api/transactions', { type: 'income', amount: 4_000_000, description: "O'rinbosar kirimi" });
    expect(orinInc.status).toBe(201);
    const incomes = async (k: string) => (await get(k, '/api/transactions')).body.filter((t: any) => t.type === 'income').map((t: any) => t.description).sort();
    expect(await incomes('owner')).toEqual(['Direktor kirimi', "O'rinbosar kirimi"]);
    expect(await incomes('orin')).toEqual(["O'rinbosar kirimi"]);
    for (const k of ['prorab', 'brig', 'ish', 'bossB']) expect(await incomes(k)).toEqual([]);
    expect(await status(patch('orin', `/api/transactions/${dirInc.body._id}`, { amount: 1 }))).toBe(403);
    expect(await status(del('orin', `/api/transactions/${dirInc.body._id}`))).toBe(403);
    expect(await status(patch('orin', `/api/transactions/${orinInc.body._id}`, { amount: 4_500_000 }))).toBe(200);
    expect(await status(patch('owner', `/api/transactions/${orinInc.body._id}`, { amount: 5_000_000 }))).toBe(200);
    expect(await status(del('bossB', `/api/transactions/${dirInc.body._id}`))).toBe(404);
  });

  it("ro'yxat: ishchi faqat o'ziga tegishlisini, rahbar firmaning hammasini ko'radi; boshqa firma — ko'rinmaydi; dasturchi — 403", async () => {
    const mine = await post('ish2', '/api/transactions', { type: 'transport', amount: 50_000, description: 'Ish2 taksi', approverId: ids.orin });
    expect(mine.status).toBe(201);
    const desc = async (k: string) => (await get(k, '/api/transactions')).body.map((t: any) => t.description);
    expect(await desc('ish2')).toContain('Ish2 taksi');
    expect(await desc('ish')).not.toContain('Ish2 taksi');
    expect(await desc('orin')).toContain('Ish2 taksi');
    expect(await desc('bossB')).not.toContain('Ish2 taksi');
    expect(await status(get('dev', '/api/transactions'))).toBe(403);
    // tasdiqlash — faqat tanlangan rahbar; ishchi — 403
    expect(await status(patch('ish', `/api/transactions/${mine.body._id}/approve`))).toBe(403);
    expect(await status(patch('orin', `/api/transactions/${mine.body._id}/approve`))).toBe(200);
  });
});

// ───────────────────────────── Materiallar ─────────────────────────────
describe('materiallar', () => {
  it("ko'rish — firma ichida; tahrirlash — faqat rahbar; boshqa firma — 404/bo'sh", async () => {
    await Material.create({ objectId: objA2, name: 'Armatura', needed: 100, sent: 0, remaining: 100, unit: 'kg', price: 9000, companyId: A } as any);
    expect((await get('ish', `/api/materials/object/${objA2}`)).body.map((m: any) => m.name)).toEqual(['Armatura']);
    expect((await get('bossB', `/api/materials/object/${objA2}`)).body).toEqual([]);
    expect(await status(get('dev', `/api/materials/object/${objA2}`))).toBe(403);
    for (const k of ['prorab', 'brig', 'ish']) expect(await status(patch(k, `/api/materials/object/${objA2}/by-name`, { currentName: 'Armatura', needed: 1 }))).toBe(403);
    expect(await status(patch('bossB', `/api/materials/object/${objA2}/by-name`, { currentName: 'Armatura', needed: 1 }))).toBe(404);
    expect(await status(patch('orin', `/api/materials/object/${objA2}/by-name`, { currentName: 'Armatura', needed: 120 }))).toBe(200);
    const mat: any = await Material.findOne({ objectId: objA2 }).lean();
    expect(await status(post('bossB', '/api/materials/send', { materialId: String(mat._id), amount: 1, receiverId: ids.bossB }))).toBe(404);
    expect(await status(post('prorab', '/api/materials/send', { materialId: String(mat._id), amount: 1, receiverId: ids.ishB }))).toBe(400);
    expect(await status(post('prorab', '/api/materials/send', { materialId: String(mat._id), amount: 1, receiverId: ids.ish }))).toBe(200);
  });
});

// ───────────────────────────── Xodimlar ─────────────────────────────
describe('xodimlar', () => {
  it("ro'yxat — faqat o'z firmasi; dasturchi — hamma", async () => {
    const list = async (k: string) => (await get(k, '/api/users')).body.map((u: any) => String(u.id));
    expect(await list('ish')).toContain(ids.owner);
    expect(await list('ish')).not.toContain(ids.bossB);
    expect(await list('bossB')).not.toContain(ids.ish);
    expect(await list('dev')).toEqual(expect.arrayContaining([ids.ish, ids.ishB]));
  });

  it("profil: o'zini — o'zi, boshqani — rahbar; bloklash/o'chirish — rahbar (egani emas); boshqa firma — 404", async () => {
    expect(await status(put('ish', `/api/users/${ids.ish}`, { lastName: 'Aliyev' }))).toBe(200);
    expect(await status(put('ish', `/api/users/${ids.ish2}`, { lastName: 'X' }))).toBe(403);
    expect(await status(put('prorab', `/api/users/${ids.ish}`, { lastName: 'X' }))).toBe(403);
    expect(await status(put('orin', `/api/users/${ids.ish}`, { lastName: 'Valiyev' }))).toBe(200);
    expect(await status(put('bossB', `/api/users/${ids.ish}`, { lastName: 'X' }))).toBe(404);
    expect(await status(patch('ish', `/api/users/${ids.ish2}/block`))).toBe(403);
    expect(await status(patch('prorab', `/api/users/${ids.ish2}/block`))).toBe(403);
    expect(await status(patch('orin', `/api/users/${ids.owner}/block`))).toBe(403);
    expect(await status(patch('bossB', `/api/users/${ids.ish2}/block`))).toBe(404);
    expect(await status(patch('orin', `/api/users/${ids.ish2}/block`))).toBe(200);
    expect(await status(patch('orin', `/api/users/${ids.ish2}/unblock`))).toBe(200);
    expect(await status(del('prorab', `/api/users/${ids.ish2}`))).toBe(403);
    expect(await status(del('orin', `/api/users/${ids.owner}`))).toBe(403);
    expect(await status(del('bossB', `/api/users/${ids.ish2}`))).toBe(404);
    // dasturchi faqat firmasiz (eski) hisoblarni o'chiradi — firma xodimini emas
    expect(await status(del('dev', `/api/users/${ids.ish2}`))).toBe(404);
  });
});

// ───────────────────────────── Hujjatlar ─────────────────────────────
describe('hujjatlar', () => {
  it("yuklagan — o'zinikini tahrirlaydi/o'chiradi; imzo — rahbar; imzolangandan keyin tahrir — rahbar; boshqa firma — ko'rinmaydi", async () => {
    const r = await post('ish', '/api/documents', { title: 'Nakladnoy 1', fileUrl: OWN('n1.pdf'), category: 'invoice' });
    expect(r.status).toBe(201);
    const id = String(r.body.id);
    expect(await status(patch('ish2', `/api/documents/${id}`, { title: 'X' }))).toBe(403);
    expect(await status(del('ish2', `/api/documents/${id}`))).toBe(403);
    expect(await status(patch('ish', `/api/documents/${id}`, { title: 'Nakladnoy 1a' }))).toBe(200);
    expect(await status(patch('ish', `/api/documents/${id}`, { objectId: objB }))).toBe(400);
    expect(await status(post('prorab', `/api/documents/${id}/sign`))).toBe(403);
    expect(await status(patch('ish', `/api/documents/${id}/expiry`, { expiresAt: '2027-01-01' }))).toBe(403);
    expect(await status(post('orin', `/api/documents/${id}/sign`))).toBe(200);
    expect(await status(patch('ish', `/api/documents/${id}`, { title: 'Imzodan keyin' }))).toBe(409);
    expect(await status(patch('owner', `/api/documents/${id}`, { title: 'Rahbar tahriri' }))).toBe(200);
    expect((await get('bossB', '/api/documents')).body).toEqual([]);
    expect(await status(patch('bossB', `/api/documents/${id}`, { title: 'X' }))).toBe(404);
    expect(await status(del('bossB', `/api/documents/${id}`))).toBe(404);
    expect(await status(del('orin', `/api/documents/${id}`))).toBe(200);
    await vi.waitFor(async () => expect(await AuditLog.countDocuments({ entity: 'document', entityId: id, action: 'delete' })).toBe(1));
  });
});

// ───────────────────────────── Texnika ─────────────────────────────
describe('texnika', () => {
  it("jihoz — rahbar qo'shadi/o'zgartiradi/o'chiradi; jurnal — kiritgan o'zinikini, rahbar hammasini", async () => {
    expect(await status(post('prorab', '/api/equipment', { name: 'Kran' }))).toBe(403);
    const r = await post('orin', '/api/equipment', { name: 'Kran' });
    expect(r.status).toBe(201);
    const id = String(r.body.id);
    expect((await get('ish', '/api/equipment')).body.map((e: any) => e.name)).toContain('Kran');
    expect((await get('bossB', '/api/equipment')).body).toEqual([]);
    expect(await status(patch('ish', `/api/equipment/${id}`, { name: 'X' }))).toBe(403);
    expect(await status(post('ish', `/api/equipment/${id}/logs`, { hours: 5 }))).toBe(403);
    const log = await post('prorab', `/api/equipment/${id}/logs`, { hours: 6, fuel: 20 });
    expect(log.status).toBe(201);
    const lid = String(log.body.id);
    expect(await status(patch('brig', `/api/equipment/${id}/logs/${lid}`, { hours: 1 }))).toBe(403);
    expect(await status(del('brig', `/api/equipment/${id}/logs/${lid}`))).toBe(403);
    const e = await patch('prorab', `/api/equipment/${id}/logs/${lid}`, { hours: 7 });
    expect(e.status).toBe(200);
    expect(e.body.hours).toBe(7);
    expect(await status(patch('bossB', `/api/equipment/${id}/logs/${lid}`, { hours: 1 }))).toBe(404);
    expect(await status(del('orin', `/api/equipment/${id}/logs/${lid}`))).toBe(200);
    expect(await status(post('prorab', `/api/equipment/${id}/tracker-token`))).toBe(403);
    expect(await status(del('ish', `/api/equipment/${id}`))).toBe(403);
    expect(await status(del('bossB', `/api/equipment/${id}`))).toBe(404);
    expect(await status(del('owner', `/api/equipment/${id}`))).toBe(200);
    await vi.waitFor(async () => expect(await AuditLog.countDocuments({ entity: 'equipment', entityId: id })).toBe(2));
  });
});

// ───────────────────────────── Xavfsizlik ─────────────────────────────
describe('xavfsizlik hodisalari', () => {
  it("istalgan xodim qayd etadi; o'zinikini tahrirlaydi/o'chiradi; holat — rahbar; hal qilingandan keyin — faqat rahbar", async () => {
    const r = await post('ish', '/api/safety', { title: 'Narvon singan', severity: 'low' });
    expect(r.status).toBe(201);
    const id = String(r.body.id);
    expect(await status(patch('ish2', `/api/safety/${id}`, { title: 'X' }))).toBe(403);
    expect(await status(del('ish2', `/api/safety/${id}`))).toBe(403);
    expect(await status(patch('ish', `/api/safety/${id}`, { title: 'Narvon singan (2-qavat)', severity: 'medium' }))).toBe(200);
    expect(await status(patch('ish', `/api/safety/${id}/status`, { status: 'resolved' }))).toBe(403);
    expect(await status(patch('prorab', `/api/safety/${id}/status`, { status: 'resolved' }))).toBe(403);
    expect(await status(patch('bossB', `/api/safety/${id}/status`, { status: 'resolved' }))).toBe(404);
    expect(await status(patch('orin', `/api/safety/${id}/status`, { status: 'resolved' }))).toBe(200);
    expect(await status(patch('ish', `/api/safety/${id}`, { title: 'Keyin' }))).toBe(409);
    expect(await status(del('ish', `/api/safety/${id}`))).toBe(409);
    expect((await get('bossB', '/api/safety')).body).toEqual([]);
    expect(await status(del('bossB', `/api/safety/${id}`))).toBe(404);
    expect(await status(del('owner', `/api/safety/${id}`))).toBe(200);
  });
});

// ───────────────────────────── Oylik ─────────────────────────────
describe('oylik', () => {
  it("hisoblash/ro'yxat/tahrir — rahbar; xodim — faqat o'zinikini; boshqa firma — 404", async () => {
    const period = '2026-10';
    for (const k of ['prorab', 'brig', 'ish']) {
      expect(await status(post(k, '/api/payroll/calculate', { period }))).toBe(403);
      expect(await status(get(k, `/api/payroll?period=${period}`))).toBe(403);
    }
    const calc = await post('owner', '/api/payroll/calculate', { period });
    expect(calc.status).toBe(200);
    expect(calc.body.records.every((r: any) => r.companyId === A)).toBe(true);
    const ishRec = calc.body.records.find((r: any) => r.userId === ids.ish);
    expect(await status(patch('ish', `/api/payroll/${ishRec.id}`, { bonuses: 9_000_000 }))).toBe(403);
    expect(await status(patch('bossB', `/api/payroll/${ishRec.id}`, { bonuses: 1 }))).toBe(404);
    expect(await status(patch('orin', `/api/payroll/${ishRec.id}`, { bonuses: 100_000 }))).toBe(200);
    const mine = await get('ish', '/api/payroll/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.map((r: any) => r.userId)).toEqual([ids.ish]);
    expect((await get('bossB', `/api/payroll?period=${period}`)).body).toEqual([]);
  });
});

// ───────────────────────────── Ishbay ─────────────────────────────
describe('ishbay', () => {
  it("kiritish — rahbar/prorab/brigadir; tahrir — kiritgan (kutilayotganda) yoki rahbar; tasdiq — obyekt prorabi/rahbar", async () => {
    expect(await status(post('ish', '/api/worklogs', { objectId: objA2, userId: ids.ish, workName: "G'isht", unit: 'm2', volume: 10, rate: 50_000 }))).toBe(403);
    const r = await post('prorab', '/api/worklogs', { objectId: objA2, userId: ids.ish, workName: "G'isht terish", unit: 'm2', volume: 10, rate: 50_000 });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending');
    const id = String(r.body.id);
    expect((await get('ish', '/api/worklogs')).body.items.map((x: any) => x.id)).toContain(id);
    expect((await get('ish2', '/api/worklogs')).body.items).toEqual([]);
    expect(await status(patch('brig', `/api/worklogs/${id}`, { volume: 99 }))).toBe(403);
    const e = await patch('prorab', `/api/worklogs/${id}`, { volume: 12 });
    expect(e.status).toBe(200);
    expect(e.body.amount).toBe(600_000);
    expect(await status(patch('prorab', `/api/worklogs/${id}/approve`))).toBe(403); // o'zi kiritganini o'zi tasdiqlamaydi (obyekt prorabi ham emas)
    expect(await status(patch('brig', `/api/worklogs/${id}/approve`))).toBe(200); // obyekt prorabi (foremanId)
    expect(await status(patch('prorab', `/api/worklogs/${id}`, { volume: 13 }))).toBe(409);
    expect(await status(del('prorab', `/api/worklogs/${id}`))).toBe(403);
    expect(await status(patch('bossB', `/api/worklogs/${id}`, { volume: 1 }))).toBe(404);
    expect(await status(patch('orin', `/api/worklogs/${id}`, { volume: 11 }))).toBe(200);
    expect(await status(del('owner', `/api/worklogs/${id}`))).toBe(200);
    await vi.waitFor(async () => expect(await AuditLog.countDocuments({ entity: 'worklog', entityId: id })).toBe(3));
  });
});

// ───────────────────────────── Kunlik hisobot ─────────────────────────────
describe('kunlik hisobotlar', () => {
  it("yozgan — o'zinikini tahrirlaydi/o'chiradi; rahbar — hammasini; ishchi faqat o'zinikini ko'radi", async () => {
    const r = await post('ish', '/api/daily-reports', { report: { summary: 'Devor 2-qavatgacha', workDone: ['Devor'] }, objectId: objA });
    expect(r.status).toBe(201);
    const id = String(r.body.id);
    expect((await get('ish2', '/api/daily-reports')).body).toEqual([]);
    expect((await get('ish', '/api/daily-reports')).body.map((x: any) => x.id)).toEqual([id]);
    expect((await get('prorab', '/api/daily-reports')).body.map((x: any) => x.id)).toContain(id); // o'z obyekti
    expect((await get('bossB', '/api/daily-reports')).body).toEqual([]);
    expect(await status(patch('ish2', `/api/daily-reports/${id}`, { report: { summary: 'X' } }))).toBe(403);
    expect(await status(del('ish2', `/api/daily-reports/${id}`))).toBe(403);
    expect(await status(del('prorab', `/api/daily-reports/${id}`))).toBe(403);
    const e = await patch('ish', `/api/daily-reports/${id}`, { report: { summary: 'Devor 3-qavatgacha' } });
    expect(e.status).toBe(200);
    expect(e.body.summary).toBe('Devor 3-qavatgacha');
    expect(await status(patch('ish', `/api/daily-reports/${id}`, { objectId: objB }))).toBe(404);
    expect(await status(patch('bossB', `/api/daily-reports/${id}`, { report: { summary: 'X' } }))).toBe(404);
    expect(await status(del('orin', `/api/daily-reports/${id}`))).toBe(200);
  });
});

// ───────────────────────────── Davomat va GPS ─────────────────────────────
describe('davomat va GPS', () => {
  it("davomat ro'yxati/boshqaning tarixi — rahbar; o'zini — o'zi; boshqa firma — bo'sh; dasturchi — 403", async () => {
    expect(await status(get('ish', '/api/attendance/list'))).toBe(403);
    expect(await status(get('prorab', '/api/attendance/list'))).toBe(403);
    const list = await get('orin', '/api/attendance/list');
    expect(list.status).toBe(200);
    expect(list.body.map((x: any) => x.userId)).toContain(ids.ish);
    expect(list.body.map((x: any) => x.userId)).not.toContain(ids.ishB);
    expect(await status(get('ish', `/api/attendance?userId=${ids.ish2}`))).toBe(403);
    expect(await status(get('ish', `/api/attendance/stats?userId=${ids.ish2}`))).toBe(403);
    expect(await status(get('ish', '/api/attendance'))).toBe(200);
    expect(await status(get('owner', `/api/attendance?userId=${ids.ish}`))).toBe(200);
    expect((await get('bossB', `/api/attendance/stats?userId=${ids.ish}`)).body.records).toEqual([]);
    expect(await status(get('dev', '/api/attendance/list'))).toBe(403);
  });

  it("GPS: har kim o'zinikini yozadi; jonli xarita va boshqaning izi — rahbar; boshqa firma — bo'sh", async () => {
    expect(await status(post('ish', '/api/gps', { lat: 41.3, lng: 69.2 }))).toBe(200);
    expect(await status(post('ishB', '/api/gps', { lat: 40.1, lng: 65.3 }))).toBe(200);
    expect(await status(get('ish', '/api/gps/latest'))).toBe(403);
    expect(await status(get('prorab', '/api/gps/latest'))).toBe(403);
    const latest = await get('orin', '/api/gps/latest');
    expect(latest.status).toBe(200);
    expect(latest.body.map((p: any) => p.userId)).toEqual([ids.ish]);
    expect(await status(get('ish2', `/api/gps/user/${ids.ish}`))).toBe(403);
    expect((await get('ish', `/api/gps/user/${ids.ish}`)).body).toHaveLength(1);
    expect((await get('bossB', `/api/gps/user/${ids.ish}`)).body).toEqual([]);
    expect(await status(get('dev', '/api/gps/latest'))).toBe(403);
  });
});

// ───────────────────────────── Chat ─────────────────────────────
describe('xabarlar va guruhlar', () => {
  it("xabar: boshqa firmaga DM — 404; matnni faqat muallif tahrirlaydi; o'chirish — muallif yoki o'z firmasi rahbari; dasturchi — begona firmani o'zgartirmaydi", async () => {
    expect(await status(post('ish', '/api/messages', { toUserId: ids.ishB, text: 'Salom' }))).toBe(404);
    const m = await post('ish', '/api/messages', { toUserId: ids.ish2, text: 'Salom' });
    expect(m.status).toBe(201);
    const id = String(m.body.id ?? m.body._id);
    expect(await status(patch('orin', `/api/messages/${id}`, { text: 'Rahbar tuzatdi' }))).toBe(403);
    expect(await status(patch('ish', `/api/messages/${id}`, { text: 'Salom!' }))).toBe(200);
    expect(await status(del('ish2', `/api/messages/${id}`))).toBe(403);
    expect(await status(del('bossB', `/api/messages/${id}`))).toBe(404);
    expect(await status(del('dev', `/api/messages/${id}`))).toBe(403);
    expect(await status(patch('dev', `/api/messages/${id}`, { pinned: true }))).toBe(403);
    expect((await Message.findById(id).lean() as any).deleted).toBeFalsy();
    expect(await status(del('orin', `/api/messages/${id}`))).toBe(200);
    expect((await get('bossB', '/api/messages')).body).toEqual([]);
  });

  it("guruh: begona firma a'zosi qo'shilmaydi; a'zo bo'lmagan oddiy xodim o'zgartira olmaydi; rahbar — firmadagi istalgan guruhni", async () => {
    const g = await post('ish', '/api/groups', { name: 'Brigada', memberIds: [ids.ish2, ids.ishB] });
    expect(g.status).toBe(201);
    const gid = String(g.body.id ?? g.body._id);
    expect((g.body.memberIds || []).map(String)).not.toContain(ids.ishB);
    expect(await status(patch('prorab', `/api/groups/${gid}`, { name: 'X' }))).toBe(403);
    expect(await status(patch('bossB', `/api/groups/${gid}`, { name: 'X' }))).toBe(404);
    expect(await status(patch('orin', `/api/groups/${gid}`, { name: 'Brigada 1' }))).toBe(200);
    expect(await status(del('ish2', `/api/groups/${gid}`))).toBe(403);
    expect(await status(del('prorab', `/api/groups/${gid}`))).toBe(403);
    expect(await status(del('dev', `/api/groups/${gid}`))).toBe(403);
    expect(await status(del('owner', `/api/groups/${gid}`))).toBe(200);
  });
});

// ───────────────────────────── Bildirishnomalar ─────────────────────────────
describe('bildirishnomalar', () => {
  it("faqat qabul qiluvchiniki: boshqasi o'qiy/o'qildi qila/o'chira olmaydi", async () => {
    const n: any = await Notification.create({ recipientId: ids.ish, companyId: A, type: 'message', title: 'Sinov', body: 'Matn' } as any);
    expect((await get('ish2', '/api/notifications')).body.notifications).toEqual([]);
    expect(await status(patch('ish2', `/api/notifications/${n._id}/read`))).toBe(404);
    expect(await status(patch('owner', `/api/notifications/${n._id}/read`))).toBe(404);
    await del('ish2', `/api/notifications/${n._id}`);
    expect(await Notification.exists({ _id: n._id })).toBeTruthy();
    expect((await get('ish', '/api/notifications')).body.notifications).toHaveLength(1);
    expect(await status(patch('ish', `/api/notifications/${n._id}/read`))).toBe(200);
  });
});

// ───────────────────────────── Firma sozlamalari ─────────────────────────────
describe('firma sozlamalari', () => {
  it("ko'rish — hamma; o'zgartirish — rahbar va faqat o'z firmasi", async () => {
    expect((await get('ish', '/api/company/me')).body.name).toBe('Alfa Qurilish');
    expect(await status(patch('ish', '/api/company/me', { name: 'Buzildi' }))).toBe(403);
    expect(await status(patch('prorab', '/api/company/features', { piecework: false }))).toBe(403);
    expect(await status(patch('orin', '/api/company/me', { name: 'Alfa Qurilish MChJ' }))).toBe(200);
    expect(await status(patch('bossB', '/api/company/me', { name: 'Beta MChJ' }))).toBe(200);
    expect((await get('ish', '/api/company/me')).body.name).toBe('Alfa Qurilish MChJ');
  });
});

// ───────────────────────────── Elektron hujjatlar ─────────────────────────────
describe('elektron hujjatlar (imzo)', () => {
  it("tuzish — rahbar/prorab; prorab faqat o'zinikini tahrirlaydi/o'chiradi; rahbar — hammasini", async () => {
    expect(await status(post('ish', '/api/sign-docs', { type: 'akt', data: {} }))).toBe(403);
    expect(await status(post('brig', '/api/sign-docs', { type: 'akt', data: {} }))).toBe(403);
    const r = await post('prorab', '/api/sign-docs', { type: 'akt', data: { note: '1' } });
    expect(r.status).toBe(201);
    const id = String(r.body.id);
    expect(await status(put('prorab2', `/api/sign-docs/${id}`, { data: { note: 'x' } }))).toBe(403);
    expect(await status(del('prorab2', `/api/sign-docs/${id}`))).toBe(403);
    expect(await status(put('prorab', `/api/sign-docs/${id}`, { data: { note: '2' } }))).toBe(200);
    expect(await status(put('orin', `/api/sign-docs/${id}`, { data: { note: '3' } }))).toBe(200);
    expect(await status(put('bossB', `/api/sign-docs/${id}`, { data: {} }))).toBe(404);
    expect(await status(del('prorab', `/api/sign-docs/${id}`))).toBe(200);
    const r2 = await post('prorab', '/api/sign-docs', { type: 'akt', data: {} });
    expect(await status(del('owner', `/api/sign-docs/${r2.body.id}`))).toBe(200);
  });
});

// ───────────────────────────── AI va dasturchi ─────────────────────────────
describe('AI sozlamalari va dasturchi yo\'llari', () => {
  it("AI admin — ega/direktor/o'rinbosar; prorab/ishchi/dasturchi — 403; platforma — faqat dasturchi", async () => {
    expect(await status(get('owner', '/api/ai-voice/admin/settings'))).toBe(200);
    expect(await status(get('orin', '/api/ai-voice/admin/settings'))).toBe(200);
    for (const k of ['prorab', 'brig', 'ish', 'dev']) expect(await status(get(k, '/api/ai-voice/admin/settings'))).toBe(403);
    for (const k of ['owner', 'orin', 'ish']) expect(await status(get(k, '/api/ai-voice/platform/overview'))).toBe(403);
    expect(await status(get('dev', '/api/ai-voice/platform/overview'))).toBe(200);
  });

  it("firmalar boshqaruvi (/api/companies) — faqat dasturchi", async () => {
    for (const k of ['owner', 'orin', 'ish']) expect(await status(get(k, '/api/companies'))).toBe(403);
    const r = await get('dev', '/api/companies');
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThanOrEqual(2);
  });
});
