// /api/ai-voice/platform (owner 2026-10-15, #2): FAQAT dasturchi — firmalar (AI yoqish, miya, provayder,
// limitlar), sarf/xarajat, firmalararo audit. Firma admini bu yo'llarga kira olmaydi; firma bo'limlarini
// (jadval, tools, ...) dasturchi bu yerdan o'zgartirmaydi. Kalit qiymatlari hech qachon qaytmaydi.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiActionAudit from '../../models/AiActionAudit';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import User from '../../models/User';
import { JWT_SECRET } from '../../middleware/auth';
import { mountAiVoiceRoutes } from '../bootstrap';
import { getSettingsFresh, invalidateSettings } from '../settings';
import { recordUsage } from '../usage';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany, B: SeedCompany;
let devId = '';
const app = express();
app.use(express.json());
mountAiVoiceRoutes(app);

const tok = (id: string) => `Bearer ${jwt.sign({ userId: id }, JWT_SECRET)}`;
const P = '/api/ai-voice/platform';
const get = (path: string, id: string) => request(app).get(`${P}${path}`).set('Authorization', tok(id));
const patch = (path: string, id: string, body: unknown) => request(app).patch(`${P}${path}`).set('Authorization', tok(id)).send(body as object);
const SECRET = 'sk-or-TEST-SECRET-platform-0009';
const savedKey = process.env.OPENROUTER_API_KEY;

beforeAll(async () => {
  mongo = await startMongo();
  A = await seedCompany('PlA');
  B = await seedCompany('PlB');
  devId = String((await User.create({ firstName: 'Dev', phone: '+998900008299', role: 'dasturchi' } as any))._id);
}, 120_000);
afterAll(async () => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
  await stopMongo(mongo);
});
afterEach(() => invalidateSettings());

describe('kirish', () => {
  it("faqat dasturchi: firma egasi/direktor/o'rinbosar — 403; tokensiz — 401", async () => {
    for (const path of ['/overview', '/companies', `/companies/${A.companyId}`, '/usage', `/usage/${A.companyId}`, '/audit', '/archives']) {
      expect((await get(path, A.ownerId)).status, path).toBe(403);
      expect((await get(path, A.orinbosarId)).status, path).toBe(403);
      expect((await get(path, devId)).status, path).toBe(200);
    }
    expect((await request(app).get(`${P}/companies`)).status).toBe(401);
    expect((await patch(`/companies/${A.companyId}`, A.ownerId, { version: 0, patch: { limits: { monthlyBudgetUsd: 1 } } })).status).toBe(403);
    const r = await get('/companies', devId);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});

describe('firmalar: AI yoqish, miya, provayder, limitlar', () => {
  it("ro'yxat va tafsilot: to'liq sozlama (brain/provider/limits), kalitlar emas — faqat 'sozlanganmi'", async () => {
    process.env.OPENROUTER_API_KEY = SECRET;
    const list = await get('/companies?q=PlA', devId);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ companyId: A.companyId, name: 'PlA', aiEnabled: true, planHasFeature: true });
    const d = await get(`/companies/${A.companyId}`, devId);
    expect(d.status).toBe(200);
    expect(d.body.settings.brain).toEqual({ provider: 'gemini', fallback: 'openrouter', effort: 'low' });
    expect(d.body.settings.limits.monthlyBudgetUsd).toBe(20);
    expect(d.body.providers.openrouter).toBe(true);
    expect(JSON.stringify(d.body)).not.toContain('TEST-SECRET');
    expect((await get('/companies/665f1c2e9b1e8a0000000abc', devId)).status).toBe(404);
    expect((await get('/companies/xyz', devId)).status).toBe(404);
    delete process.env.OPENROUTER_API_KEY;
  });

  it("PATCH: miya/limit/provayder/enabled o'zgaradi (validatsiya bilan), firma bo'limlari — 400, versiya — 409", async () => {
    const d = (await get(`/companies/${A.companyId}`, devId)).body;
    const v = d.settings.version;
    const ok = await patch(`/companies/${A.companyId}`, devId, {
      version: v, patch: { brain: { provider: 'claude', fallback: 'none', effort: 'medium' }, limits: { monthlyBudgetUsd: 35, hardStop: false }, provider: { primary: 'gemini_cascade' } },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.brain).toEqual({ provider: 'claude', fallback: 'none', effort: 'medium' });
    expect(ok.body.settings.limits).toMatchObject({ monthlyBudgetUsd: 35, hardStop: false });
    expect(ok.body.settings.provider.primary).toBe('gemini_cascade');
    expect((await getSettingsFresh(A.companyId)).limits.monthlyBudgetUsd).toBe(35);
    const doc: any = await AiAssistantSettings.findOne({ companyId: A.companyId }).lean();
    expect(doc.updatedBy).toBe(devId);
    // B firmasi o'zgarmagan
    expect((await getSettingsFresh(B.companyId)).limits.monthlyBudgetUsd).toBe(20);

    const v2 = ok.body.settings.version;
    expect((await patch(`/companies/${A.companyId}`, devId, { version: v2, patch: { brain: { provider: 'openai' } } })).status).toBe(400);
    expect((await patch(`/companies/${A.companyId}`, devId, { version: v2, patch: { limits: { monthlyBudgetUsd: -1 } } })).status).toBe(400);
    expect((await patch(`/companies/${A.companyId}`, devId, { version: v2, patch: { brain: { apiKey: 'x' } } })).status).toBe(400);
    const sched = await patch(`/companies/${A.companyId}`, devId, { version: v2, patch: { attendance: { enabled: true } } });
    expect(sched.status).toBe(400);
    expect(sched.body.errors.join()).toMatch(/attendance/);
    expect((await patch(`/companies/${A.companyId}`, devId, { patch: {} })).status).toBe(400);
    const stale = await patch(`/companies/${A.companyId}`, devId, { version: v, patch: { enabled: false } });
    expect(stale.status).toBe(409);
    expect(stale.body.current.settings.version).toBe(v2);

    const off = await patch(`/companies/${A.companyId}`, devId, { version: v2, patch: { enabled: false } });
    expect(off.status).toBe(200);
    expect((await get('/companies?q=PlA', devId)).body.items[0].aiEnabled).toBe(false);
    // Firma admini ham yangi qiymatni ko'radi, lekin miya/limitlarsiz
    const adm = await request(app).get('/api/ai-voice/admin/settings').set('Authorization', tok(A.ownerId));
    expect(adm.body.settings.enabled).toBe(false);
    expect(adm.body.settings.limits).toBeUndefined();
  });
});

describe('sarf va audit', () => {
  it("sarf: firmalar kesimida va bitta firma (kunlik/provayder, oylik byudjet)", async () => {
    await recordUsage({ companyId: A.companyId, userId: null, provider: 'gemini', model: 'x' }, { tokensIn: 1000, tokensOut: 500, costUsdMicros: 1500 });
    await recordUsage({ companyId: A.companyId, userId: null, provider: 'openrouter', model: 'x' }, { tokensIn: 10, costUsdMicros: 500 });
    await recordUsage({ companyId: B.companyId, userId: null, provider: 'gemini', model: 'x' }, { costUsdMicros: 99_000 });
    const all = await get('/usage', devId);
    expect(all.status).toBe(200);
    const a = all.body.companies.find((c: any) => c.companyId === A.companyId);
    const b = all.body.companies.find((c: any) => c.companyId === B.companyId);
    expect(a).toMatchObject({ name: 'PlA', costUsdMicros: 2000 });
    expect(b).toMatchObject({ name: 'PlB', costUsdMicros: 99_000 });
    expect(all.body.totals.costUsdMicros).toBeGreaterThanOrEqual(101_000);
    const one = await get(`/usage/${A.companyId}`, devId);
    expect(one.body.totals.costUsdMicros).toBe(2000);
    expect(one.body.byProvider).toMatchObject({ gemini: 1500, openrouter: 500 });
    expect(one.body.days).toHaveLength(1);
    expect(one.body.month.costUsdMicros).toBe(2000);
    expect(typeof one.body.month.budgetUsd).toBe('number');
    const list = await get('/companies', devId);
    expect(list.body.items.find((c: any) => c.companyId === B.companyId).monthCostUsdMicros).toBe(99_000);
  });

  it('audit: barcha firmalar, companyId filtri, argumentlarsiz', async () => {
    const base = { actorRole: 'ishchi', channel: 'web', correlationId: 'c', kind: 'read', status: 'ok', expiresAt: new Date(Date.now() + 86_400_000) };
    await AiActionAudit.create({ ...base, companyId: A.companyId, actorUserId: A.workerId, tool: 'pa1' } as any);
    await AiActionAudit.create({ ...base, companyId: B.companyId, actorUserId: B.workerId, tool: 'pb1' } as any);
    const all = await get('/audit', devId);
    expect(all.body.items.map((i: any) => i.tool).sort()).toEqual(['pa1', 'pb1']);
    expect(all.body.items.find((i: any) => i.tool === 'pb1')).toMatchObject({ companyName: 'PlB', actorName: expect.stringMatching(/ishchi/) });
    const onlyA = await get(`/audit?companyId=${A.companyId}`, devId);
    expect(onlyA.body.items.map((i: any) => i.tool)).toEqual(['pa1']);
    expect(JSON.stringify(all.body)).not.toMatch(/"args"|pending/);
  });

  it("umumiy holat: yoqilgan firmalar, oy xarajati, arxivlar; mos kelmagan yo'l keyingi routerga o'tadi", async () => {
    const o = await get('/overview', devId);
    expect(o.status).toBe(200);
    expect(o.body).toMatchObject({ archives: { keepInDbDays: 7 }, queue: { running: false } });
    expect(typeof o.body.enabledCompanies).toBe('number');
    // P6 platformRoutes javob beradi (bu router emas) — 404/501 bo'lishi mumkin, lekin 200 emas
    expect((await get('/no-such-platform-path', devId)).status).not.toBe(200);
  });
});
