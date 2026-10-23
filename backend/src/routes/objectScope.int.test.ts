// Integratsion sinov: OBYEKT DOIRASI matritsasi (owner 2026-10-23).
// Direktor, o'rinbosar va firma egasidan boshqa har bir rol (prorab, brigadir, ishchi) faqat o'ziga biriktirilgan
// obyekt(lar)da ishlaydi: biriktirilgan obyekt — ruxsat; boshqa obyekt — 404/403 yoki ro'yxatda ko'rinmaydi.
// Biriktirish = User.projectIds yoki Object.foremanId.
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
import Equipment from '../models/Equipment';
import CompanyDocument from '../models/CompanyDocument';
import SafetyIncident from '../models/SafetyIncident';
import DailyReport from '../models/DailyReport';
import WorkLog from '../models/WorkLog';
import { requireAuth, blockDeveloper, JWT_SECRET } from '../middleware/auth';
import { getBackendUrl } from '../utils/backendUrl';
import { assignedObjectIdsFor, objectQueryForUser } from '../middleware/objectScope';
import { visibleObjectIds } from '../aiVoice/tools/erp/common';
import objectRoutes from './objects';
import txRoutes from './transactions';
import materialRoutes from './materials';
import documentsRoutes from './documents';
import equipmentRoutes from './equipment';
import safetyRoutes from './safety';
import worklogsRoutes from './worklogs';
import dailyReportsRoutes from './dailyReports';
import signDocsRoutes from './signDocs';
import searchRoutes from './search';
import qrRoutes from './qr';

let mongo: MongoMemoryServer;
const app = express();
app.use(express.json());
app.use('/api/objects', requireAuth, blockDeveloper, objectRoutes);
app.use('/api/transactions', requireAuth, blockDeveloper, txRoutes);
app.use('/api/materials', requireAuth, blockDeveloper, materialRoutes);
app.use('/api/documents', requireAuth, blockDeveloper, documentsRoutes);
app.use('/api/equipment', requireAuth, blockDeveloper, equipmentRoutes);
app.use('/api/safety', requireAuth, blockDeveloper, safetyRoutes);
app.use('/api/worklogs', requireAuth, blockDeveloper, worklogsRoutes);
app.use('/api/daily-reports', requireAuth, blockDeveloper, dailyReportsRoutes);
app.use('/api/sign-docs', requireAuth, blockDeveloper, signDocsRoutes);
app.use('/api/search', requireAuth, searchRoutes);
app.use('/api/qr', requireAuth, qrRoutes);

const ids: Record<string, string> = {};
let A = '';
let MINE = '', OTHER = '';
let matMine = '', matOther = '', eqMine = '', eqOther = '';
const tok = (k: string) => `Bearer ${jwt.sign({ userId: ids[k] }, JWT_SECRET)}`;
const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', k: string, path: string, body?: any) => {
  const r = (request(app) as any)[method](path).set('Authorization', tok(k));
  return body !== undefined ? r.send(body) : r;
};
const get = (k: string, p: string) => call('get', k, p);
const post = (k: string, p: string, b: any = {}) => call('post', k, p, b);
const OWN = (name: string) => `${getBackendUrl()}/uploads/${name}`;

const WORKERS = ['prorab', 'brig', 'ish'] as const;   // biriktirilgan: MINE (prorab — foremanId, qolganlar — projectIds)
const BOSSES = ['owner', 'orin'] as const;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const ca: any = await Company.create({ branchId: 'OS-1', name: 'Doira Qurilish', phone: '+998901119001', features: { piecework: true } } as any);
  A = String(ca._id);
  await Subscription.create({ companyId: A, selectedPlan: 'custom', customFeatures: ['ai_assistant', 'qr_tools'], status: 'active' } as any);
  let n = 0;
  const mk = async (k: string, role: string, extra: any = {}) => {
    ids[k] = String((await User.create({ firstName: k, phone: `+99890300${String(++n).padStart(4, '0')}`, role, companyId: A, ...extra } as any))._id);
  };
  await mk('owner', 'direktor', { isOwner: true });
  await mk('orin', 'orinbosar');
  await mk('prorab', 'prorab');
  await mk('brig', 'brigadir');
  await mk('ish', 'ishchi');
  await mk('lonely', 'ishchi'); // hech qaysi obyektga biriktirilmagan
  MINE = String(((await ObjectModel.create({ name: 'Mening obyektim', companyId: A, foremanId: ids.prorab } as any)) as any)._id);
  OTHER = String(((await ObjectModel.create({ name: 'Begona obyekt', companyId: A, foremanId: ids.orin } as any)) as any)._id);
  await User.updateMany({ _id: { $in: [ids.brig, ids.ish] } }, { $set: { projectIds: [MINE] } });
  matMine = String(((await Material.create({ objectId: MINE, name: 'Sement', needed: 100, sent: 0, remaining: 100, unit: 'qop', companyId: A } as any)) as any)._id);
  matOther = String(((await Material.create({ objectId: OTHER, name: 'Sement', needed: 100, sent: 0, remaining: 100, unit: 'qop', companyId: A } as any)) as any)._id);
  eqMine = String(((await Equipment.create({ name: 'Kran A', objectId: MINE, companyId: A } as any)) as any)._id);
  eqOther = String(((await Equipment.create({ name: 'Kran B', objectId: OTHER, companyId: A } as any)) as any)._id);
  // Rahbar kiritgan, begona obyektga tegishli yozuvlar — ishchilarga ko'rinmasligi kerak
  const by = { userId: ids.owner, name: 'owner', role: 'direktor' };
  await CompanyDocument.create({ companyId: A, objectId: OTHER, title: 'Begona hujjat', fileUrl: OWN('x.pdf'), uploadedBy: by } as any);
  await CompanyDocument.create({ companyId: A, objectId: MINE, title: 'Mening hujjatim', fileUrl: OWN('y.pdf'), uploadedBy: by } as any);
  await SafetyIncident.create({ companyId: A, objectId: OTHER, title: 'Begona hodisa', reportedBy: by } as any);
  await SafetyIncident.create({ companyId: A, objectId: MINE, title: 'Mening hodisam', reportedBy: by } as any);
  await DailyReport.create({ companyId: A, objectId: OTHER, objectName: 'Begona', userId: ids.orin, userName: 'orin', date: '2026-10-20', summary: 'Begona hisobot', source: 'app' } as any);
  await WorkLog.create({ companyId: A, objectId: OTHER, userId: ids.orin, userName: 'orin', workName: 'Begona ish', unit: 'm2', volume: 1, rate: 1, amount: 1, date: '2026-10-20', status: 'pending', createdBy: by } as any);
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('biriktirish modeli', () => {
  it("assignedObjectIdsFor: rahbar — cheklovsiz (null); prorab — foremanId; brigadir/ishchi — projectIds; biriktirilmagan — bo'sh", async () => {
    const u = async (k: string) => User.findById(ids[k]).lean();
    expect(await assignedObjectIdsFor(await u('owner') as any)).toBeNull();
    expect(await assignedObjectIdsFor(await u('orin') as any)).toBeNull();
    for (const k of WORKERS) expect(await assignedObjectIdsFor(await u(k) as any)).toEqual([MINE]);
    expect(await assignedObjectIdsFor(await u('lonely') as any)).toEqual([]);
    // Boshqa firma obyekti projectIds'da bo'lsa ham hisobga olinmaydi
    const foreign: any = await ObjectModel.create({ name: 'Boshqa firma', companyId: new mongoose.Types.ObjectId().toString() } as any);
    expect(await assignedObjectIdsFor({ ...(await u('ish') as any), projectIds: [MINE, String(foreign._id)] })).toEqual([MINE]);
  });

  it("bot so'rovi (objectQueryForUser): ishchi faqat o'z obyektini topadi; rahbar — hammasini", async () => {
    const names = async (k: string, extra: any = {}) => (await ObjectModel.find(await objectQueryForUser(await User.findById(ids[k]).lean(), extra)).lean()).map((o: any) => o.name).sort();
    expect(await names('ish')).toEqual(['Mening obyektim']);
    expect(await names('ish', { _id: OTHER })).toEqual([]);
    expect(await names('prorab', { _id: MINE })).toEqual(['Mening obyektim']);
    expect(await names('owner')).toEqual(['Begona obyekt', 'Mening obyektim']);
    expect(await names('lonely')).toEqual([]);
  });

  it("AI tool'lari (visibleObjectIds) — sayt va bot bilan bir xil doira", async () => {
    const ctx = (k: string, role: string, isOwner = false) => ({ userId: ids[k], role, companyId: A, isOwner, lang: 'uz' }) as any;
    expect(await visibleObjectIds(ctx('owner', 'direktor', true))).toBeNull();
    expect(await visibleObjectIds(ctx('orin', 'orinbosar'))).toBeNull();
    expect(await visibleObjectIds(ctx('prorab', 'prorab'))).toEqual([MINE]);
    expect(await visibleObjectIds(ctx('brig', 'brigadir'))).toEqual([MINE]);
    expect(await visibleObjectIds(ctx('ish', 'ishchi'))).toEqual([MINE]);
    expect(await visibleObjectIds(ctx('lonely', 'ishchi'))).toEqual([]);
  });
});

describe("rol × obyekt matritsasi (o'z obyekti — ruxsat, boshqa obyekt — yo'q)", () => {
  it("obyektlar ro'yxati, rasm/video, QR, qidiruv", async () => {
    for (const k of WORKERS) {
      expect((await get(k, '/api/objects')).body.map((o: any) => String(o._id))).toEqual([MINE]);
      expect((await get(k, `/api/objects/${MINE}/media`)).status).toBe(200);
      expect((await get(k, `/api/objects/${OTHER}/media`)).status).toBe(404);
      expect((await post(k, `/api/objects/${MINE}/media`, { url: OWN(`${k}.jpg`), type: 'image' })).status).toBe(201);
      expect((await post(k, `/api/objects/${OTHER}/media`, { url: OWN(`${k}.jpg`), type: 'image' })).status).toBe(404);
      expect((await get(k, `/api/qr/object/${MINE}`)).status).toBe(200);
      expect((await get(k, `/api/qr/object/${OTHER}`)).status).toBe(404);
      expect((await get(k, `/api/qr/material/${matOther}`)).status).toBe(404);
      const found = (await get(k, '/api/search?q=obyekt&types=objects')).body.results.objects.map((o: any) => o.name);
      expect(found).toEqual(['Mening obyektim']);
    }
    expect((await get('lonely', '/api/objects')).body).toEqual([]);
    for (const k of BOSSES) {
      expect((await get(k, '/api/objects')).body.map((o: any) => String(o._id)).sort()).toEqual([MINE, OTHER].sort());
      expect((await get(k, `/api/objects/${OTHER}/media`)).status).toBe(200);
      expect((await get(k, `/api/qr/object/${OTHER}`)).status).toBe(200);
    }
  });

  it('plan-fakt — prorab/brigadir faqat o\'z obyekti; rahbar — hammasi', async () => {
    for (const k of ['prorab', 'brig']) {
      expect((await get(k, '/api/objects/plan-fact')).body.map((p: any) => String(p.objectId ?? p.id ?? p._id))).not.toContain(OTHER);
      expect((await get(k, `/api/objects/${OTHER}/plan-fact`)).status).toBe(404);
      expect((await get(k, `/api/objects/${MINE}/plan-fact`)).status).toBe(200);
    }
    expect((await get('orin', `/api/objects/${OTHER}/plan-fact`)).status).toBe(200);
  });

  it("materiallar: ko'rish va yuborish faqat o'z obyektida", async () => {
    for (const k of WORKERS) {
      expect((await get(k, `/api/materials/object/${MINE}`)).body.map((m: any) => m.name)).toEqual(['Sement']);
      expect((await get(k, `/api/materials/object/${OTHER}`)).status).toBe(404);
      expect((await post(k, '/api/materials/send', { materialId: matOther, amount: 1, receiverId: ids.owner })).status).toBe(403);
    }
    expect((await post('prorab', '/api/materials/send', { materialId: matMine, amount: 1, receiverId: ids.ish })).status).toBe(200);
    expect((await get('orin', `/api/materials/object/${OTHER}`)).body).toHaveLength(1);
    expect((await post('orin', '/api/materials/send', { materialId: matOther, amount: 1, receiverId: ids.ish })).status).toBe(200);
  });

  it('chiqim, kirim, yukxat: obyekt — faqat biriktirilgani yoki obyektsiz', async () => {
    for (const k of WORKERS) {
      const exp = (projectId?: string) => post(k, '/api/transactions', { type: 'material', amount: 10_000, description: `${k} chiqim`, approverId: ids.owner, ...(projectId ? { projectId } : {}) });
      expect((await exp(MINE)).status).toBe(201);
      expect((await exp()).status).toBe(201);
      expect((await exp(OTHER)).status).toBe(403);
      const inc = (projectId?: string) => post(k, '/api/transactions', { type: 'income', amount: 10_000, description: `${k} kirim`, ...(projectId ? { projectId } : {}) });
      expect((await inc(MINE)).status).toBe(201);
      expect((await inc(OTHER)).status).toBe(403);
      const tr = (projectId: string) => post(k, '/api/transactions', { type: 'transfer', materialName: 'Qum', quantity: 1, unit: 'kub', toUserId: ids.owner, projectId });
      expect((await tr(MINE)).status).toBe(201);
      expect((await tr(OTHER)).status).toBe(403);
    }
    expect((await post('orin', '/api/transactions', { type: 'material', amount: 10_000, description: 'rahbar', projectId: OTHER })).status).toBe(201);
    expect((await post('orin', '/api/transactions', { type: 'income', amount: 10_000, description: 'rahbar kirim', projectId: OTHER })).status).toBe(201);
  });

  it("kunlik hisobot: yozish faqat o'z obyektiga; boshqa obyekt hisobotlari ko'rinmaydi", async () => {
    for (const k of WORKERS) {
      expect((await post(k, '/api/daily-reports', { report: { summary: `${k} hisoboti`, workDone: ['Devor'] }, objectId: MINE })).status).toBe(201);
      expect((await post(k, '/api/daily-reports', { report: { summary: 'X', workDone: ['X'] }, objectId: OTHER })).status).toBe(403);
      const seen = (await get(k, '/api/daily-reports')).body.map((r: any) => r.summary);
      expect(seen).not.toContain('Begona hisobot');
      expect((await get(k, `/api/daily-reports?objectId=${OTHER}`)).body).toEqual([]);
    }
    expect((await get('orin', '/api/daily-reports')).body.map((r: any) => r.summary)).toContain('Begona hisobot');
  });

  it("ishbay: prorab/brigadir faqat o'z obyektiga kiritadi va o'shaning yozuvlarini ko'radi", async () => {
    for (const k of ['prorab', 'brig']) {
      expect((await post(k, '/api/worklogs', { objectId: MINE, userId: ids.ish, workName: "G'isht terish", unit: 'm2', volume: 2, rate: 1000 })).status).toBe(201);
      expect((await post(k, '/api/worklogs', { objectId: OTHER, userId: ids.ish, workName: "G'isht terish", unit: 'm2', volume: 2, rate: 1000 })).status).toBe(403);
      const items = (await get(k, '/api/worklogs')).body.items;
      expect(items.every((x: any) => x.objectId === MINE)).toBe(true);
      expect((await get(k, `/api/worklogs?objectId=${OTHER}`)).body.items).toEqual([]);
    }
    expect((await get('orin', '/api/worklogs')).body.items.map((x: any) => x.workName)).toContain('Begona ish');
  });

  it("hujjatlar, xavfsizlik, texnika: o'z obyekti — ha, boshqa obyekt — yo'q", async () => {
    for (const k of WORKERS) {
      expect((await post(k, '/api/documents', { title: `${k} hujjat`, fileUrl: OWN('d.pdf'), objectId: MINE })).status).toBe(201);
      expect((await post(k, '/api/documents', { title: 'X', fileUrl: OWN('d.pdf'), objectId: OTHER })).status).toBe(403);
      const docs = (await get(k, '/api/documents')).body.map((d: any) => d.title);
      expect(docs).toContain('Mening hujjatim');
      expect(docs).not.toContain('Begona hujjat');
      expect((await get(k, `/api/documents?objectId=${OTHER}`)).body).toEqual([]);

      expect((await post(k, '/api/safety', { title: `${k} hodisa`, objectId: MINE })).status).toBe(201);
      expect((await post(k, '/api/safety', { title: 'X', objectId: OTHER })).status).toBe(403);
      const inc = (await get(k, '/api/safety')).body.map((d: any) => d.title);
      expect(inc).toContain('Mening hodisam');
      expect(inc).not.toContain('Begona hodisa');

      expect((await get(k, '/api/equipment')).body.map((e: any) => e.name)).toEqual(['Kran A']);
      expect((await get(k, `/api/equipment/${eqMine}/logs`)).status).toBe(200);
      expect((await get(k, `/api/equipment/${eqOther}/logs`)).status).toBe(404);
    }
    expect((await post('prorab', `/api/equipment/${eqMine}/logs`, { hours: 3 })).status).toBe(201);
    expect((await post('prorab', `/api/equipment/${eqOther}/logs`, { hours: 3 })).status).toBe(403);
    expect((await get('orin', '/api/documents')).body.map((d: any) => d.title)).toContain('Begona hujjat');
    expect((await get('orin', '/api/equipment')).body).toHaveLength(2);
  });

  it("elektron hujjat: prorab faqat o'z obyekti bo'yicha tuzadi", async () => {
    expect((await post('prorab', '/api/sign-docs', { type: 'akt', data: { a: 1 }, projectId: MINE })).status).toBe(201);
    expect((await post('prorab', '/api/sign-docs', { type: 'akt', data: { a: 1 }, projectId: OTHER })).status).toBe(403);
    expect((await post('orin', '/api/sign-docs', { type: 'akt', data: { a: 1 }, projectId: OTHER })).status).toBe(201);
  });
});
