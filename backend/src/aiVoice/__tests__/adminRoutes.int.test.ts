// /api/ai-voice/admin (P8): RBAC (ega/direktor/o'rinbosar; prorab 403; dasturchi bloklangan), tarif darvozasi
// fail-closed, optimistik versiya (409), kalitlar hech qachon javobda yo'q, tools matritsasi kod chegarasi (400),
// xodim PATCH rozilik/opt-out maydonlarini rad etadi, ish jadvali validatsiyasi, sinov xabari faqat o'ziga.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../../models/User';
import Attendance from '../../models/Attendance';
import { todayInTashkent } from '../../utils/tz';
import AiActionAudit from '../../models/AiActionAudit';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import { JWT_SECRET } from '../../middleware/auth';
import { mountAiVoiceRoutes } from '../bootstrap';
import { registerBotInstance } from '../bot/botHooks';
import { invalidateSettings } from '../settings';
import { registerTool, unregisterTool } from '../tools/registry';
import type { AiToolDef } from '../tools/types';
import { recordUsage } from '../usage';
import { JobQueue, setSharedQueue } from '../queue/jobQueue';
import AiJob from '../../models/AiJob';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany, B: SeedCompany, NF: SeedCompany;
let devId = '';
const app = express();
app.use(express.json());
mountAiVoiceRoutes(app);

const tok = (id: string) => `Bearer ${jwt.sign({ userId: id }, JWT_SECRET)}`;
const get = (path: string, id: string) => request(app).get(`/api/ai-voice/admin${path}`).set('Authorization', tok(id));
const put = (path: string, id: string, body: unknown) => request(app).put(`/api/ai-voice/admin${path}`).set('Authorization', tok(id)).send(body as object);
const patch = (path: string, id: string, body: unknown) => request(app).patch(`/api/ai-voice/admin${path}`).set('Authorization', tok(id)).send(body as object);
const post = (path: string, id: string, body: unknown = {}) => request(app).post(`/api/ai-voice/admin${path}`).set('Authorization', tok(id)).send(body as object);

const SECRETS = {
  GEMINI_API_KEY: 'AIzaSy-TEST-SECRET-gemini-0001',
  OPENROUTER_API_KEY: 'sk-or-TEST-SECRET-openrouter-0002',
  ANTHROPIC_API_KEY: 'sk-ant-TEST-SECRET-claude-0003',
  TELEGRAM_BOT_TOKEN: '123456:TEST-SECRET-bot-token-0004',
};
const savedEnv: Record<string, string | undefined> = {};
for (const k of [...Object.keys(SECRETS), 'GEMINI_API_KEYS', 'AI_VOICE_ENABLED']) savedEnv[k] = process.env[k];
const restoreEnv = () => { for (const [k, v] of Object.entries(savedEnv)) if (v === undefined) delete process.env[k]; else process.env[k] = v; };

// Kod chegarasi: faqat direktor/o'rinbosar (ishchiga berib bo'lmaydi)
const financeTool: AiToolDef = {
  name: 'p8Finance', description: { uz: 'moliya', ru: 'финансы' }, parameters: { type: 'object', properties: {} },
  kind: 'read', maxRoles: ['direktor', 'orinbosar'], defaultRoles: ['direktor'], purposes: ['assistant'], channels: ['web', 'bot'],
  behavior: 'BLOCKING', confirm: 'never', handler: async () => ({ status: 'ok', message: 'ok', retryable: false }),
};
const tasksTool: AiToolDef = { ...financeTool, name: 'p8Tasks', maxRoles: ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'], defaultRoles: ['ishchi'] };

beforeAll(async () => {
  mongo = await startMongo();
  A = await seedCompany('P8A');
  B = await seedCompany('P8B');
  NF = await seedCompany('P8NF', { feature: false });
  devId = String((await User.create({ firstName: 'Dev', phone: '+998900008099', role: 'dasturchi' } as any))._id);
  registerTool(financeTool);
  registerTool(tasksTool);
}, 120_000);
afterAll(async () => {
  unregisterTool(financeTool.name);
  unregisterTool(tasksTool.name);
  restoreEnv();
  await stopMongo(mongo);
});
afterEach(() => { restoreEnv(); invalidateSettings(); });

const fresh = async (id: string) => (await get('/settings', id)).body;

describe('kirish nazorati', () => {
  it("o'rinbosar va egasi — ruxsat; smenadagi prorab 403, smenasi yopiq ishchi 423; dasturchi bloklangan", async () => {
    // prorab smenada (workGate o'tkazadi) — lekin admin emas
    await Attendance.create({ userId: A.prorabId, companyId: A.companyId, date: todayInTashkent(), checkIn: new Date().toISOString() } as any);
    expect((await get('/settings', A.orinbosarId)).status).toBe(200);
    expect((await get('/settings', A.ownerId)).status).toBe(200);
    expect((await get('/settings', A.prorabId)).status).toBe(403);
    expect((await put('/settings', A.prorabId, { version: 0, patch: { enabled: true } })).status).toBe(403);
    expect((await get('/settings', A.workerId)).status).toBe(423);
    expect((await get('/settings', devId)).status).toBe(403);
  });

  it("tarif darvozasi fail-closed: tarifda ai_assistant yo'q yoki firma topilmasa — 403", async () => {
    const r = await get('/settings', NF.ownerId);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('feature');
    const orphan = String((await User.create({ firstName: 'Yetim', phone: '+998900008098', role: 'direktor', isOwner: true, companyId: '665f1c2e9b1e8a00000000ee' } as any))._id);
    expect((await get('/settings', orphan)).status).toBe(403);
    expect((await get('/employees', orphan)).status).toBe(403);
  });

  it("no-store sarlavhasi; firma A admini faqat o'z firmasini ko'radi", async () => {
    const r = await get('/settings', A.ownerId);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.settings.companyId).toBe(A.companyId);
    expect(r.body.settings.timezone).toBe('Asia/Tashkent');
    expect(r.body.editor).toEqual({ canEditSchedule: true, canEditBossRows: true, canDownloadArchives: true });
    const o = await get('/settings', A.orinbosarId);
    expect(o.body.editor.canEditBossRows).toBe(false);
    expect(o.body.editor.canDownloadArchives).toBe(false);
  });
});

describe('sozlamalar PUT', () => {
  it("versiya mos kelmasa 409 va joriy holat qaytadi", async () => {
    const v0 = (await fresh(B.ownerId)).settings.version;
    const ok = await put('/settings', B.ownerId, { version: v0, patch: { language: 'ru' } });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.version).toBe(v0 + 1);
    expect(ok.body.settings.language).toBe('ru');
    const stale = await put('/settings', B.orinbosarId, { version: v0, patch: { language: 'uz' } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('version_conflict');
    expect(stale.body.current.settings.version).toBe(v0 + 1);
    expect(stale.body.current.settings.language).toBe('ru');
  });

  it("noto'g'ri tana — 400; timezone faqat Asia/Tashkent", async () => {
    expect((await put('/settings', B.ownerId, { patch: {} })).status).toBe(400);
    const s = await fresh(B.ownerId);
    const r = await put('/settings', B.ownerId, { version: s.settings.version, patch: { timezone: 'Europe/Moscow' } });
    expect(r.status).toBe(400);
    expect(r.body.errors.join(' ')).toMatch(/timezone/);
  });

  it("kalitlar HECH QACHON javobda yo'q; AI miyasi/limitlar firma ko'rinishida yo'q (owner 2026-10-15)", async () => {
    Object.assign(process.env, SECRETS);
    delete process.env.GEMINI_API_KEYS;
    const r = await get('/settings', A.ownerId);
    expect(r.body.providers).toBeUndefined();
    expect(r.body.settings.brain).toBeUndefined();
    expect(r.body.settings.provider).toBeUndefined();
    expect(r.body.settings.limits).toBeUndefined();
    const ch = await get('/channels/status', A.ownerId);
    const s = await fresh(A.ownerId);
    const bad = await put('/settings', A.ownerId, { version: s.settings.version, patch: { brain: { provider: 'gemini', apiKey: 'x' } } });
    expect(bad.status).toBe(403);
    for (const body of [JSON.stringify(r.body), JSON.stringify(ch.body), JSON.stringify(bad.body)]) {
      for (const v of Object.values(SECRETS)) expect(body).not.toContain(v);
      expect(body).not.toContain('TEST-SECRET');
    }
    for (const k of Object.keys(SECRETS)) delete process.env[k];
  });

  it("brain/provider/limits'ni firma admini o'zgartira olmaydi — 403 developer_only, bazada o'zgarmaydi", async () => {
    const s = await fresh(A.ownerId);
    const before: any = await AiAssistantSettings.findOne({ companyId: A.companyId }).lean();
    for (const patch of [
      { brain: { provider: 'claude', fallback: 'none', effort: 'medium' } },
      { provider: { primary: 'gemini_cascade' } },
      { limits: { monthlyBudgetUsd: 999 } },
      { language: 'ru', limits: { hardStop: false } },
    ]) {
      const r = await put('/settings', A.ownerId, { version: s.settings.version, patch });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('developer_only');
    }
    const after: any = await AiAssistantSettings.findOne({ companyId: A.companyId }).lean();
    expect(after.version).toBe(before.version);
    expect(after.language ?? null).toBe(before.language ?? null);
  });

  it("fallbackOrder: takrorsiz va ma'lum kanallar", async () => {
    const s = await fresh(A.ownerId);
    const v = s.settings.version;
    expect((await put('/settings', A.ownerId, { version: v, patch: { fallbackOrder: ['bot_message', 'bot_message'] } })).status).toBe(400);
    expect((await put('/settings', A.ownerId, { version: v, patch: { fallbackOrder: ['bot_message', 'sms'] } })).status).toBe(400);
    expect((await put('/settings', A.ownerId, { version: v, patch: { fallbackOrder: [] } })).status).toBe(400);
    const ok = await put('/settings', A.ownerId, { version: v, patch: { fallbackOrder: ['bot_message', 'push', 'notify_manager'] } });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.fallbackOrder).toEqual(['bot_message', 'push', 'notify_manager']);
  });

});

describe('tools matritsasi (kod chegarasi)', () => {
  it("ishchiga moliya tool'ini berish — 400 (eskalatsiya)", async () => {
    const s = await fresh(A.orinbosarId);
    const r = await put('/settings', A.orinbosarId, { version: s.settings.version, patch: { tools: { byRole: { ishchi: ['p8Tasks', 'p8Finance'] } } } });
    expect(r.status).toBe(400);
    expect(r.body.errors.join(' ')).toMatch(/kod chegarasi/);
    const r2 = await put('/settings', A.ownerId, { version: s.settings.version, patch: { tools: { byRole: { ishchi: ['noSuchTool'] } } } });
    expect(r2.status).toBe(400);
  });

  it("direktor/o'rinbosar qatorlarini faqat direktor yoki egasi o'zgartiradi", async () => {
    let s = await fresh(A.orinbosarId);
    const byOrin = await put('/settings', A.orinbosarId, { version: s.settings.version, patch: { tools: { byRole: { orinbosar: ['p8Finance', 'p8Tasks'] } } } });
    expect(byOrin.status).toBe(400);
    const prorabRow = await put('/settings', A.orinbosarId, { version: s.settings.version, patch: { tools: { byRole: { prorab: ['p8Tasks'] } } } });
    expect(prorabRow.status).toBe(200);
    s = await fresh(A.ownerId);
    const byOwner = await put('/settings', A.ownerId, { version: s.settings.version, patch: { tools: { byRole: { orinbosar: ['p8Finance', 'p8Tasks'] } } } });
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.settings.tools.byRole.orinbosar).toEqual(['p8Finance', 'p8Tasks']);
  });

  it("GET /tools — katalog (maxRoles bilan)", async () => {
    const r = await get('/tools', A.orinbosarId);
    expect(r.status).toBe(200);
    const fin = r.body.tools.find((t: any) => t.name === 'p8Finance');
    expect(fin.maxRoles).toEqual(['direktor', 'orinbosar']);
  });
});

describe('ish jadvali', () => {
  const shiftOf = (b: any) => b.settings.attendance.shifts[0];

  it("noto'g'ri qiymatlar — 400 (HH:mm, ISO hafta kuni, sana, ikkala ro'yxatda bir sana)", async () => {
    const s = await fresh(A.ownerId);
    const sh = shiftOf(s);
    const v = s.settings.version;
    const bad = async (p: Record<string, unknown>) => (await put('/settings', A.ownerId, { version: v, patch: { attendance: { shifts: [{ ...sh, ...p }] } } })).status;
    expect(await bad({ workStart: '25:00' })).toBe(400);
    expect(await bad({ workStart: '8:00' })).toBe(400);
    expect(await bad({ workdays: [0, 1] })).toBe(400);
    expect(await bad({ workdays: [1, 1] })).toBe(400);
    expect(await bad({ skipDates: ['2026-13-01'] })).toBe(400);
    expect(await bad({ skipDates: ['2026-10-20'], extraWorkDates: ['2026-10-20'] })).toBe(400);
    expect(await bad({ maxLateMin: 999 })).toBe(400);
    expect(await bad({ absentCutoff: '07:00' })).toBe(400);
  });

  it("to'g'ri jadval saqlanadi; callTime serverda hosil qilinadi", async () => {
    const s = await fresh(A.ownerId);
    const sh = shiftOf(s);
    const r = await put('/settings', A.ownerId, {
      version: s.settings.version,
      patch: { attendance: { shifts: [{ ...sh, workStart: '07:30', callLeadMin: 15, callTime: '00:00', workdays: [1, 2, 3, 4, 5], skipDates: ['2027-03-21'], extraWorkDates: ['2027-03-27'], maxLateMin: 45 }] } },
    });
    expect(r.status).toBe(200);
    const saved = shiftOf(r.body);
    expect(saved).toMatchObject({ workStart: '07:30', callLeadMin: 15, callTime: '07:15', workdays: [1, 2, 3, 4, 5], skipDates: ['2027-03-21'], extraWorkDates: ['2027-03-27'], maxLateMin: 45 });
  });

  it('PATCH /schedule — sana qo\'shish/olib tashlash, bir sana faqat bitta ro\'yxatda', async () => {
    const s = await fresh(A.ownerId);
    const id = shiftOf(s).id;
    const r = await patch('/schedule', A.ownerId, { shiftId: id, patch: { addSkipDates: ['2027-01-01'], addExtraWorkDates: ['2027-03-21'], workStart: '08:15' } });
    expect(r.status).toBe(200);
    const sh = shiftOf(r.body);
    expect(sh.skipDates).toContain('2027-01-01');
    expect(sh.skipDates).not.toContain('2027-03-21');
    expect(sh.extraWorkDates).toContain('2027-03-21');
    expect(sh.workStart).toBe('08:15');
    expect((await patch('/schedule', A.ownerId, { shiftId: id, patch: { workStart: '8' } })).status).toBe(400);
    expect((await patch('/schedule', A.ownerId, { shiftId: id, patch: { foo: 1 } })).status).toBe(400);
    expect((await patch('/schedule', A.ownerId, { shiftId: 'nope', patch: { workStart: '09:00' } })).status).toBe(404);
  });

  it("orinbosarCanEditSchedule o'chirilsa — o'rinbosar jadvalni o'zgartira olmaydi va bayroqni qaytara olmaydi", async () => {
    let s = await fresh(A.ownerId);
    const off = await put('/settings', A.ownerId, { version: s.settings.version, patch: { attendance: { orinbosarCanEditSchedule: false } } });
    expect(off.status).toBe(200);
    s = await fresh(A.orinbosarId);
    expect(s.editor.canEditSchedule).toBe(false);
    const sh = shiftOf(s);
    expect((await put('/settings', A.orinbosarId, { version: s.settings.version, patch: { attendance: { shifts: [{ ...sh, workStart: '09:00' }] } } })).status).toBe(400);
    expect((await put('/settings', A.orinbosarId, { version: s.settings.version, patch: { attendance: { orinbosarCanEditSchedule: true } } })).status).toBe(400);
    expect((await patch('/schedule', A.orinbosarId, { shiftId: sh.id, patch: { workStart: '09:00' } })).status).toBe(403);
    // boshqa bo'limlarni o'zgartira oladi
    expect((await put('/settings', A.orinbosarId, { version: s.settings.version, patch: { voiceName: 'Puck' } })).status).toBe(200);
    s = await fresh(A.ownerId);
    expect((await put('/settings', A.ownerId, { version: s.settings.version, patch: { attendance: { orinbosarCanEditSchedule: true } } })).status).toBe(200);
  });
});

describe('xodimlar', () => {
  it("ro'yxat: telefon raqamlarisiz, rozilik/opt-out holati bilan; boshqa firma xodimlari yo'q", async () => {
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, telegram: { callConsent: 'granted', resolveStatus: 'resolved', tgUserId: '777001' }, optOut: { calls: true } });
    const r = await get('/employees', A.orinbosarId);
    expect(r.status).toBe(200);
    const raw = JSON.stringify(r.body);
    expect(raw).not.toMatch(/\+998/);
    expect(raw).not.toContain('phone');
    expect(raw).not.toContain('777001');
    const ids = r.body.employees.map((e: any) => e.userId);
    expect(ids).toContain(A.workerId);
    expect(ids).not.toContain(B.workerId);
    const w = r.body.employees.find((e: any) => e.userId === A.workerId);
    expect(w).toMatchObject({ callConsent: 'granted', telegramLinked: true, optOut: { calls: true, reminders: false, all: false } });
    const q = await get('/employees?q=ishchi2', A.ownerId);
    expect(q.body.employees.map((e: any) => e.userId)).toEqual([A.worker2Id]);
  });

  it('PATCH: rozilik/opt-out maydonlari RAD etiladi (B9), kanal sozlamasi saqlanadi', async () => {
    for (const body of [{ callConsent: 'granted' }, { optOut: { calls: false } }, { telegram: { callConsent: 'granted' } }, { channelOrder: ['push'], optOut: { all: false } }]) {
      const r = await patch(`/employees/${A.workerId}`, A.ownerId, body);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('forbidden_fields');
    }
    const c: any = await AiEmployeeContact.findOne({ companyId: A.companyId, employeeId: A.workerId }).lean();
    expect(c.telegram.callConsent).toBe('granted');
    expect(c.optOut.calls).toBe(true);
    const ok = await patch(`/employees/${A.workerId}`, A.orinbosarId, { channelOrder: ['inapp_call', 'bot_message'], disabledChannels: ['telegram_call'] });
    expect(ok.status).toBe(200);
    expect(ok.body.employee).toMatchObject({ channelOrder: ['inapp_call', 'bot_message'], disabledChannels: ['telegram_call'], callConsent: 'granted' });
    expect((await patch(`/employees/${A.workerId}`, A.ownerId, { channelOrder: ['push', 'push'] })).status).toBe(400);
    const reset = await patch(`/employees/${A.workerId}`, A.ownerId, { channelOrder: null });
    expect(reset.body.employee.channelOrder).toBeUndefined();
  });

  it("boshqa firma xodimi — 404; o'rinbosar egasining sozlamasini o'zgartira olmaydi", async () => {
    expect((await patch(`/employees/${B.workerId}`, A.ownerId, { disabledChannels: [] })).status).toBe(404);
    expect((await patch(`/employees/${A.ownerId}`, A.orinbosarId, { disabledChannels: ['push'] })).status).toBe(403);
    expect((await patch(`/employees/${A.orinbosarId}`, A.ownerId, { disabledChannels: ['push'] })).status).toBe(200);
  });

  it("shaxsiy ish jadvali (#5): firma jadvali qoidalari bilan tekshiriladi, ro'yxatda ko'rinadi, null — o'chiriladi", async () => {
    const list0 = await get('/employees', A.ownerId);
    expect(list0.body.employees.find((e: any) => e.userId === A.worker2Id).scheduleOverride).toBeNull();
    const bad = [
      { weekdays: [] }, { weekdays: [8] }, { weekdays: [1, 1] }, { weekdays: [1], workStart: '25:00' },
      { weekdays: [1], extra: 1 }, { weekdays: [1, 2], workStart: '23:30' }, 'x',
    ];
    for (const scheduleOverride of bad) {
      const r = await patch(`/employees/${A.worker2Id}`, A.ownerId, { scheduleOverride });
      expect(r.status, JSON.stringify(scheduleOverride)).toBe(400);
    }
    const ok = await patch(`/employees/${A.worker2Id}`, A.orinbosarId, { scheduleOverride: { weekdays: [5, 1, 3], workStart: '10:00' } });
    expect(ok.status).toBe(200);
    expect(ok.body.employee.scheduleOverride).toEqual({ weekdays: [1, 3, 5], workStart: '10:00' });
    const c: any = await AiEmployeeContact.findOne({ companyId: A.companyId, employeeId: A.worker2Id }).lean();
    expect(c.scheduleOverride).toMatchObject({ weekdays: [1, 3, 5], workStart: '10:00', updatedBy: A.orinbosarId });
    const list = await get('/employees', A.ownerId);
    expect(list.body.employees.find((e: any) => e.userId === A.worker2Id).scheduleOverride).toEqual({ weekdays: [1, 3, 5], workStart: '10:00' });
    // workStart ixtiyoriy — firma vaqti qoladi
    const days = await patch(`/employees/${A.worker2Id}`, A.ownerId, { scheduleOverride: { weekdays: [6, 7] } });
    expect(days.body.employee.scheduleOverride).toEqual({ weekdays: [6, 7] });
    // boshqa firma xodimi — 404 (to'g'ri qiymat bilan ham)
    expect((await patch(`/employees/${B.workerId}`, A.ownerId, { scheduleOverride: { weekdays: [1] } })).status).toBe(404);
    const off = await patch(`/employees/${A.worker2Id}`, A.ownerId, { scheduleOverride: null });
    expect(off.status).toBe(200);
    expect(off.body.employee.scheduleOverride).toBeNull();
    expect(((await AiEmployeeContact.findOne({ companyId: A.companyId, employeeId: A.worker2Id }).lean()) as any).scheduleOverride).toBeUndefined();
  });

  it("shaxsiy jadval: o'rinbosarga jadval yopiq bo'lsa — 403", async () => {
    let s = await fresh(A.ownerId);
    expect((await put('/settings', A.ownerId, { version: s.settings.version, patch: { attendance: { orinbosarCanEditSchedule: false } } })).status).toBe(200);
    expect((await patch(`/employees/${A.worker2Id}`, A.orinbosarId, { scheduleOverride: { weekdays: [1] } })).status).toBe(403);
    s = await fresh(A.ownerId);
    expect((await put('/settings', A.ownerId, { version: s.settings.version, patch: { attendance: { orinbosarCanEditSchedule: true } } })).status).toBe(200);
  });

  it("transkript arxivlari: faqat egasi/direktor; o'rinbosar 403", async () => {
    expect((await get('/archives', A.ownerId)).status).toBe(200);
    expect((await get('/archives', A.orinbosarId)).status).toBe(403);
    expect((await get('/archives/665f1c2e9b1e8a0000000abc/download', A.ownerId)).status).toBe(404);
  });
});

describe('run-now / sinov / audit / sarf', () => {
  it("run-now: AI o'chiq bo'lsa 409; noma'lum smena 404; qo'lda dedupe kaliti bilan navbatga", async () => {
    delete process.env.AI_VOICE_ENABLED;
    const s = await fresh(A.ownerId);
    const id = s.settings.attendance.shifts[0].id;
    expect((await post('/attendance/run-now', A.ownerId, { shiftId: id })).status).toBe(409);
    expect((await post('/attendance/run-now', A.ownerId, { shiftId: 'nope' })).status).toBe(404);
    expect((await post('/attendance/run-now', A.ownerId, {})).status).toBe(400);
    process.env.AI_VOICE_ENABLED = 'true';
    // Davomat bo'limi o'chiq — rejalashtirilmaydi
    const off = await post('/attendance/run-now', A.ownerId, { shiftId: id });
    expect(off.status).toBe(409);
    expect(off.body.error).toBe('disabled');
    const on = await put('/settings', A.ownerId, { version: s.settings.version, patch: { attendance: { enabled: true } } });
    expect(on.status).toBe(200);
    // Navbat yo'q — 503
    setSharedQueue(null);
    expect((await post('/attendance/run-now', A.ownerId, { shiftId: id })).status).toBe(503);
    const q = new JobQueue({ instanceId: 'p8-test', log: () => undefined });
    setSharedQueue(q);
    try {
      const r1 = await post('/attendance/run-now', A.ownerId, { shiftId: id });
      expect(r1.status).toBe(200);
      expect(r1.body).toMatchObject({ ok: true, duplicate: false });
      const job: any = await AiJob.findById(r1.body.jobId).lean();
      expect(job.dedupeKey).toMatch(new RegExp(`^att:plan:${A.companyId}:.*:manual:`));
      // Shu daqiqada qayta bosish — yangi ish yaratilmaydi
      const r2 = await post('/attendance/run-now', A.ownerId, { shiftId: id });
      expect(r2.status).toBe(200);
      expect(await AiJob.countDocuments({ dedupeKey: job.dedupeKey })).toBe(1);
    } finally {
      setSharedQueue(null);
      const cur = await fresh(A.ownerId);
      await put('/settings', A.ownerId, { version: cur.settings.version, patch: { attendance: { enabled: false } } });
    }
  });

  it("sinov xabari faqat chaqiruvchining o'ziga yuboriladi", async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    registerBotInstance({ sendMessage, answerCallbackQuery: vi.fn() } as any);
    delete process.env.AI_VOICE_ENABLED;
    expect((await post('/test', A.ownerId)).status).toBe(409);
    process.env.AI_VOICE_ENABLED = 'true';
    expect((await post('/test', A.ownerId, { userId: A.workerId })).status).toBe(403);
    expect((await post('/test', A.ownerId)).body.error).toBe('telegram_not_linked');
    await User.updateOne({ _id: A.ownerId }, { $set: { telegramChatId: '555123' } });
    await User.updateOne({ _id: A.workerId }, { $set: { telegramChatId: '555999' } });
    const r = await post('/test', A.ownerId, { channel: 'bot_message' });
    expect(r.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect((sendMessage.mock.calls[0] as unknown[])[0]).toBe('555123');
    registerBotInstance(null as any);
  });

  it("audit: sahifalangan, faqat o'z firmasi, pending/argumentlarsiz", async () => {
    const base = { actorUserId: A.workerId, actorRole: 'ishchi', channel: 'bot', correlationId: 'c', kind: 'read' as const, expiresAt: new Date(Date.now() + 86_400_000) };
    for (let i = 0; i < 5; i++) await AiActionAudit.create({ ...base, companyId: A.companyId, tool: `t${i}`, status: i === 4 ? 'denied' : 'ok', argsRedacted: { x: 'SECRETARG' } });
    await AiActionAudit.create({ ...base, companyId: A.companyId, tool: 'pend', status: 'needs_confirmation', pending: { token: 'HASHED-TOKEN', expiresAt: new Date(), args: { a: 1 } } });
    await AiActionAudit.create({ ...base, companyId: B.companyId, tool: 'other', status: 'ok' });
    const p1 = await get('/audit?limit=4&page=1', A.orinbosarId);
    expect(p1.status).toBe(200);
    expect(p1.body.total).toBe(6);
    expect(p1.body.items).toHaveLength(4);
    const p2 = await get('/audit?limit=4&page=2', A.orinbosarId);
    expect(p2.body.items).toHaveLength(2);
    const all = JSON.stringify([p1.body, p2.body]);
    expect(all).not.toContain('HASHED-TOKEN');
    expect(all).not.toContain('SECRETARG');
    expect(all).not.toContain('"other"');
    const denied = await get('/audit?status=denied', A.ownerId);
    expect(denied.body.items.map((x: any) => x.tool)).toEqual(['t4']);
    expect(denied.body.items[0].actorName).toMatch(/ishchi/);
  });

  it("sarf va xarajat firma adminiga yopiq — dasturchi paneliga ko'chirilgan (403)", async () => {
    await recordUsage({ companyId: A.companyId, userId: null, provider: 'openrouter', model: 'x' }, { tokensIn: 10, costUsdMicros: 500 });
    const r = await get('/usage', A.ownerId);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('developer_only');
  });
});

describe('sozlamalar hujjati', () => {
  it("PUT bazaga yozadi va updatedBy qo'yadi (kalitlar emas)", async () => {
    const s = await fresh(A.ownerId);
    await put('/settings', A.ownerId, { version: s.settings.version, patch: { enabled: false } });
    const doc: any = await AiAssistantSettings.findOne({ companyId: A.companyId }).lean();
    expect(doc.enabled).toBe(false);
    expect(doc.updatedBy).toBe(A.ownerId);
    expect(JSON.stringify(doc)).not.toMatch(/apiKey|API_KEY/);
  });
});
