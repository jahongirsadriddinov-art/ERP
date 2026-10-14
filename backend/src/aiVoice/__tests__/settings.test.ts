// aiVoice/settings: standartlar, birlashtirish, validator (kod chegaralari, tools shifti, brain),
// ish jadvali (workStart, ISO workdays, skipDates/extraWorkDates, maxLateMin), kesh, optimistik versiya,
// isAiActive (env + tarif + firma holati + sozlama).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import Company from '../../models/Company';
import {
  __setSettingsCacheTtlForTests, applySchedulePatch, canEditSchedule, defaultSettings, defaultShift, deriveCallTime,
  getCompanyAiState, getSettings, invalidateSettings, isAiActive, mergeDefaults, saveSettings, updateSchedule,
  validateSettingsUpdate,
} from '../settings';
import { registerTool, unregisterTool } from '../tools/registry';
import type { AiToolDef } from '../tools/types';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

const OWNER = { role: 'direktor', isOwner: true };
const DIREKTOR = { role: 'direktor', isOwner: false };
const ORINBOSAR = { role: 'orinbosar', isOwner: false };

// Faqat test uchun "moliya" tool'i: kod shifti — faqat direktor/o'rinbosar
const financeProbe: AiToolDef = {
  name: 'p1FinanceProbe', description: { uz: 'test', ru: 'test' }, parameters: { type: 'object', properties: {} },
  kind: 'read', maxRoles: ['direktor', 'orinbosar'], defaultRoles: ['direktor'], purposes: ['assistant'],
  channels: ['web', 'bot', 'inapp_call', 'telegram_call'], behavior: 'BLOCKING', confirm: 'never',
  handler: async () => ({ status: 'ok', message: 'ok', retryable: false }),
};
const selfProbe: AiToolDef = { ...financeProbe, name: 'p1SelfProbe', maxRoles: ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'], defaultRoles: ['ishchi'] };

beforeAll(() => { registerTool(financeProbe); registerTool(selfProbe); });
afterAll(() => { unregisterTool(financeProbe.name); unregisterTool(selfProbe.name); });

describe('standartlar va mergeDefaults', () => {
  it('standartlar: bot xabari 1-qadam, Toshkent, Gemini→OpenRouter miya, recordAudio=false', () => {
    const d = defaultSettings('c1');
    expect(d.fallbackOrder[0]).toBe('bot_message');
    expect(d.fallbackOrder).toEqual(['bot_message', 'telegram_call', 'inapp_call', 'push', 'notify_manager']);
    expect(d.timezone).toBe('Asia/Tashkent');
    expect(d.brain).toEqual({ provider: 'gemini', fallback: 'openrouter', effort: 'low' });
    expect(d.privacy.recordAudio).toBe(false);
    const s = d.attendance.shifts[0];
    expect(s).toMatchObject({ workStart: '08:00', callTime: '08:00', workdays: [1, 2, 3, 4, 5, 6], maxLateMin: 60, skipDates: [], extraWorkDates: [] });
  });

  it("noto'g'ri turlar standartga qaytadi, timezone/recordAudio qulflangan", () => {
    const m = mergeDefaults('c1', {
      enabled: 'yes', timezone: 'Europe/Moscow', language: 'en', privacy: { recordAudio: true, transcriptRetentionDays: 7 },
      brain: { provider: 'gpt', fallback: 'none', effort: 'high', apiKey: 'x' }, calls: { quietHours: { from: '25:00', to: '07:00' } },
    });
    expect(m.enabled).toBe(false);
    expect(m.timezone).toBe('Asia/Tashkent');
    expect(m.language).toBe('uz');
    expect(m.privacy).toEqual({ recordAudio: false, transcriptRetentionDays: 7, auditRetentionDays: 365 });
    expect(m.brain).toEqual({ provider: 'gemini', fallback: 'none', effort: 'high' }); // apiKey tashlanadi
    expect(m.calls.quietHours).toEqual({ from: '21:00', to: '07:00' });
    expect(mergeDefaults('c1', null).companyId).toBe('c1');
  });

  it("eski yozuv: faqat callTime bo'lsa — u ish boshlanishi; callTime = workStart − callLeadMin", () => {
    const m = mergeDefaults('c1', { attendance: { shifts: [{ id: 'a', callTime: '07:30' }, { id: 'b', workStart: '09:00', callLeadMin: 20 }] } });
    expect(m.attendance.shifts[0]).toMatchObject({ workStart: '07:30', callTime: '07:30' });
    expect(m.attendance.shifts[1]).toMatchObject({ workStart: '09:00', callLeadMin: 20, callTime: '08:40' });
    expect(deriveCallTime('00:10', 30)).toBe('00:00');
  });
});

describe('validateSettingsUpdate', () => {
  const cur = () => defaultSettings('c1');
  const errs = (patch: unknown, editor = OWNER) => {
    const r = validateSettingsUpdate(patch, cur(), editor);
    return r.ok ? [] : r.errors;
  };

  it('timezone, recordAudio, noma\'lum maydon — rad', () => {
    expect(errs({ timezone: 'Europe/Moscow' }).join()).toMatch(/timezone/);
    expect(errs({ timezone: 'Asia/Tashkent' })).toEqual([]);
    expect(errs({ privacy: { recordAudio: true } }).join()).toMatch(/recordAudio/);
    expect(errs({ hacker: 1 }).join()).toMatch(/hacker/);
    expect(errs('x')).not.toEqual([]);
  });

  it('brain: faqat provider/fallback/effort; kalit yoki model saqlanmaydi', () => {
    const ok = validateSettingsUpdate({ brain: { provider: 'claude', fallback: 'none', effort: 'medium' } }, cur(), OWNER);
    expect(ok.ok && ok.value.brain).toEqual({ provider: 'claude', fallback: 'none', effort: 'medium' });
    expect(errs({ brain: { provider: 'openai' } }).join()).toMatch(/brain.provider/);
    expect(errs({ brain: { fallback: 'groq' } }).join()).toMatch(/brain.fallback/);
    expect(errs({ brain: { apiKey: 'sk-xxx' } }).join()).toMatch(/brain.apiKey/);
    expect(errs({ provider: { apiKey: 'k' } }).join()).toMatch(/provider.apiKey/);
  });

  it('ish jadvali: workStart, ISO workdays, skip/extra sanalar, maxLateMin', () => {
    const shift = (s: Record<string, unknown>) => ({ attendance: { shifts: [{ ...defaultShift(), ...s }] } });
    expect(errs(shift({ workStart: '7:00' })).join()).toMatch(/workStart/);
    expect(errs(shift({ workdays: [0, 1] })).join()).toMatch(/workdays/);
    expect(errs(shift({ workdays: [1, 1] })).join()).toMatch(/workdays/);
    expect(errs(shift({ workdays: [8] })).join()).toMatch(/workdays/);
    expect(errs(shift({ workdays: [] })).join()).toMatch(/workdays/);   // kamida bitta (bot/sayt/ilova bir xil)
    expect(errs(shift({ workdays: [7] }))).toEqual([]);              // yakshanba ham tanlanishi mumkin
    expect(errs(shift({ skipDates: ['2026-02-30'] })).join()).toMatch(/skipDates/);
    expect(errs(shift({ extraWorkDates: ['13.10.2026'] })).join()).toMatch(/extraWorkDates/);
    expect(errs(shift({ skipDates: ['2026-10-17'], extraWorkDates: ['2026-10-17'] })).join()).toMatch(/bir sana/);
    expect(errs(shift({ maxLateMin: 999 })).join()).toMatch(/maxLateMin/);
    expect(errs(shift({ absentCutoff: '07:00' })).join()).toMatch(/absentCutoff/);
    expect(errs(shift({ callLeadMin: 600 })).join()).toMatch(/callLeadMin/);
    const r = validateSettingsUpdate(shift({ workStart: '09:00', callLeadMin: 15, callTime: '03:00' }), cur(), OWNER);
    expect(r.ok && r.value.attendance.shifts[0].callTime).toBe('08:45'); // callTime mijozdan emas, hosila
  });

  it('fallbackOrder takrorsiz va ma\'lum kanallar', () => {
    expect(errs({ fallbackOrder: ['bot_message', 'bot_message'] }).join()).toMatch(/fallbackOrder/);
    expect(errs({ fallbackOrder: ['sms'] }).join()).toMatch(/fallbackOrder/);
    expect(errs({ fallbackOrder: ['bot_message', 'inapp_call', 'push', 'notify_manager'] })).toEqual([]);
  });

  it('tools shifti (B1): ishchiga moliya tool\'ini hech kim bera olmaydi', () => {
    expect(errs({ tools: { byRole: { ishchi: ['p1FinanceProbe'] } } }, ORINBOSAR).join()).toMatch(/kod chegarasi/);
    expect(errs({ tools: { byRole: { ishchi: ['p1FinanceProbe'] } } }, OWNER).join()).toMatch(/kod chegarasi/);
    expect(errs({ tools: { byRole: { ishchi: ['noSuchTool'] } } }).join()).toMatch(/noma'lum tool/);
    expect(errs({ tools: { byRole: { ishchi: ['p1SelfProbe'] } } }, ORINBOSAR)).toEqual([]);
    expect(errs({ tools: { byRole: { hacker: [] } } }).join()).toMatch(/lavozim/);
  });

  it("direktor/o'rinbosar qatorlarini faqat direktor yoki egasi o'zgartiradi", () => {
    expect(errs({ tools: { byRole: { orinbosar: ['p1FinanceProbe'] } } }, ORINBOSAR).join()).toMatch(/faqat direktor/);
    expect(errs({ tools: { byRole: { orinbosar: ['p1FinanceProbe'] } } }, DIREKTOR)).toEqual([]);
    expect(errs({ tools: { byRole: { direktor: [] } } }, ORINBOSAR).join()).toMatch(/faqat direktor/);
  });

  it("orinbosarCanEditSchedule: faqat direktor/egasi o'zgartiradi; o'chiq bo'lsa o'rinbosar jadvalga tegolmaydi", () => {
    expect(errs({ attendance: { orinbosarCanEditSchedule: false } }, ORINBOSAR).join()).toMatch(/orinbosarCanEditSchedule/);
    expect(errs({ attendance: { orinbosarCanEditSchedule: false } }, DIREKTOR)).toEqual([]);
    const locked = { ...cur(), attendance: { ...cur().attendance, orinbosarCanEditSchedule: false } };
    const r = validateSettingsUpdate({ attendance: { shifts: [{ ...defaultShift(), workStart: '09:00' }] } }, locked, ORINBOSAR);
    expect(r.ok).toBe(false);
    expect(canEditSchedule({ role: 'prorab', isOwner: false }, cur())).toBe(false);
    expect(canEditSchedule(ORINBOSAR, cur())).toBe(true);
  });
});

describe('applySchedulePatch', () => {
  it("sana faqat bitta ro'yxatda; 31 kundan eskilari tushadi; callTime qayta hisoblanadi", () => {
    const s = { ...defaultShift(), skipDates: ['2026-08-01', '2026-10-20'], extraWorkDates: ['2026-10-25'] };
    const n = applySchedulePatch(s, {
      workStart: '07:30', callLeadMin: 10, workdays: [6, 1, 1, 3] as any,
      addSkipDates: ['2026-10-25'], addExtraWorkDates: ['2026-10-20', '2026-11-01'], removeSkipDates: ['2099-01-01'],
    }, '2026-10-14');
    expect(n.workStart).toBe('07:30');
    expect(n.callTime).toBe('07:20');
    expect(n.workdays).toEqual([1, 3, 6]);
    expect(n.skipDates).toEqual(['2026-10-25']);             // 2026-08-01 eski — tushdi; 10-20 extra'ga o'tdi
    expect(n.extraWorkDates).toEqual(['2026-10-20', '2026-11-01']);
    expect(s.skipDates).toEqual(['2026-08-01', '2026-10-20']); // asl obyekt o'zgarmaydi
  });
});

describe('DB: kesh, versiya, jadval, isAiActive', () => {
  let mongo: MongoMemoryServer;
  let A: SeedCompany, N: SeedCompany;
  const savedEnv = process.env.AI_VOICE_ENABLED;

  beforeAll(async () => {
    mongo = await startMongo();
    A = await seedCompany('Alfa');
    N = await seedCompany('Nofeature', { feature: false });
  }, 120_000);
  afterAll(async () => {
    if (savedEnv === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = savedEnv;
    __setSettingsCacheTtlForTests(10_000);
    await stopMongo(mongo);
  });
  beforeEach(() => { invalidateSettings(); __setSettingsCacheTtlForTests(10_000); });

  it('getSettings ≤10 s keshlaydi; invalidateSettings darhol yangilaydi', async () => {
    const s1 = await getSettings(A.companyId);
    expect(s1.enabled).toBe(true);
    await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { enabled: false } });
    expect((await getSettings(A.companyId)).enabled).toBe(true);   // kesh
    invalidateSettings(A.companyId);
    expect((await getSettings(A.companyId)).enabled).toBe(false);
    await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { enabled: true } });
    invalidateSettings(A.companyId);
  });

  it("saveSettings: optimistik versiya — eski versiya bilan yozish conflict (409)", async () => {
    const cur = await getSettings(A.companyId);
    const v = validateSettingsUpdate({ voiceName: 'Puck' }, cur, OWNER);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const a = await saveSettings(A.companyId, v.value, cur.version, A.ownerId);
    expect(a.ok).toBe(true);
    const b = await saveSettings(A.companyId, v.value, cur.version, A.ownerId);
    expect(b).toMatchObject({ ok: false, conflict: true });
    const doc: any = await AiAssistantSettings.findOne({ companyId: A.companyId }).lean();
    expect(doc.voiceName).toBe('Puck');
    expect(doc.timezone).toBe('Asia/Tashkent');
    expect(doc.version).toBe(cur.version + 1);
  });

  it('saveSettings: yangi firma (versiya 0) — upsert', async () => {
    const cid = '64b7f0c2a1b2c3d4e5f60718';
    const v = validateSettingsUpdate({ enabled: true }, defaultSettings(cid), OWNER);
    const r = v.ok ? await saveSettings(cid, v.value, 0, 'u') : null;
    expect(r?.ok).toBe(true);
    expect((await getSettings(cid)).version).toBe(1);
  });

  it('updateSchedule: egasi o\'zgartiradi, prorab — forbidden, noma\'lum smena — not_found', async () => {
    const now = new Date('2026-10-14T05:00:00Z');
    const r = await updateSchedule(A.companyId, 'main', {
      workStart: '07:00', workdays: [1, 2, 3, 4, 5, 6, 7], addSkipDates: ['2026-10-20'], addExtraWorkDates: ['2026-10-26'],
    }, { userId: A.ownerId, ...OWNER }, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.shift).toMatchObject({ workStart: '07:00', callTime: '07:00', skipDates: ['2026-10-20'], extraWorkDates: ['2026-10-26'] });
    expect((await getSettings(A.companyId)).attendance.shifts[0].workStart).toBe('07:00');
    expect(await updateSchedule(A.companyId, 'main', { workStart: '06:00' }, { userId: A.prorabId, role: 'prorab', isOwner: false }, now))
      .toEqual({ ok: false, code: 'forbidden' });
    expect(await updateSchedule(A.companyId, 'nope', { workStart: '06:00' }, { userId: A.ownerId, ...OWNER }, now))
      .toEqual({ ok: false, code: 'not_found' });
    const bad = await updateSchedule(A.companyId, 'main', { addSkipDates: ['bugun'] }, { userId: A.ownerId, ...OWNER }, now);
    expect(bad).toMatchObject({ ok: false, code: 'invalid' });
    const bad2 = await updateSchedule(A.companyId, 'main', { workStart: '25:00' }, { userId: A.ownerId, ...OWNER }, now);
    expect(bad2).toMatchObject({ ok: false, code: 'invalid' });
  });

  it("updateSchedule: chaqiruvchi bergan rol/egalikka ishonilmaydi — DB'dan qayta o'qiladi; boshqa firma egasi — forbidden", async () => {
    const now = new Date('2026-10-14T05:00:00Z');
    // prorab o'zini "egasi" deb ko'rsatsa ham
    expect(await updateSchedule(A.companyId, 'main', { workStart: '05:00' }, { userId: A.prorabId, ...OWNER }, now))
      .toEqual({ ok: false, code: 'forbidden' });
    expect(await updateSchedule(A.companyId, 'main', { workStart: '05:00' }, { userId: N.ownerId, ...OWNER }, now))
      .toEqual({ ok: false, code: 'forbidden' });
    expect(await updateSchedule(A.companyId, 'main', { workStart: '05:00' }, { userId: 'nope', ...OWNER }, now))
      .toEqual({ ok: false, code: 'forbidden' });
    // haqiqiy direktor (egasi emas) — eski "prorab" taxmini bilan kelsa ham ruxsat (DB roli ustun)
    const User = (await import('../../models/User')).default;
    const dir: any = await User.create({ firstName: 'Dir', phone: '+998909999001', role: 'direktor', companyId: A.companyId } as any);
    const r = await updateSchedule(A.companyId, 'main', { callLeadMin: 10 }, { userId: String(dir._id), role: 'prorab', isOwner: false }, now);
    expect(r.ok).toBe(true);
  });

  it('updateSchedule: parallel tahrirlar — ikkalasi ham saqlanadi (versiya to\'qnashuvida qayta urinish)', async () => {
    const ed = { userId: A.ownerId, ...OWNER };
    const now = new Date('2026-10-14T05:00:00Z');
    const rs = await Promise.all([
      updateSchedule(A.companyId, 'main', { addSkipDates: ['2026-11-01'] }, ed, now),
      updateSchedule(A.companyId, 'main', { addSkipDates: ['2026-11-02'] }, ed, now),
    ]);
    expect(rs.every((r) => r.ok)).toBe(true);
    invalidateSettings(A.companyId);
    expect((await getSettings(A.companyId)).attendance.shifts[0].skipDates).toEqual(expect.arrayContaining(['2026-11-01', '2026-11-02']));
  });

  it('isAiActive: env + firma faol + tarifda ai_assistant + enabled (fail-closed)', async () => {
    process.env.AI_VOICE_ENABLED = '0';
    expect(await isAiActive(A.companyId)).toBe(false);
    process.env.AI_VOICE_ENABLED = '1';
    expect(await isAiActive(A.companyId)).toBe(true);
    expect(await isAiActive(N.companyId)).toBe(false);            // tarifda yo'q
    expect((await getCompanyAiState(N.companyId)).hasFeature).toBe(false);
    expect(await isAiActive('not-an-id')).toBe(false);
    expect(await isAiActive('64b7f0c2a1b2c3d4e5f60799')).toBe(false); // firma yo'q
    await Company.updateOne({ _id: A.companyId }, { $set: { status: 'SUSPENDED' } });
    invalidateSettings(A.companyId);
    expect(await isAiActive(A.companyId)).toBe(false);
    await Company.updateOne({ _id: A.companyId }, { $set: { status: 'ACTIVE' } });
    invalidateSettings(A.companyId);
    expect(await isAiActive(A.companyId)).toBe(true);
  });
});
