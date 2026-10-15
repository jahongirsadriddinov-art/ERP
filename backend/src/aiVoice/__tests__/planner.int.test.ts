// Planner (P3): soxta soat; qayta ishga tushishda idempotent; maxLateMin'dan kech — faqat bot; absentCutoff'dan
// keyin hech qachon; skipDates / extraWorkDates / ISO hafta kunlari (egasi jadvali); run-now avtomatik rejadan
// keyin va 'dead' ishdan keyin ham ishlaydi (C5).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiJob from '../../models/AiJob';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import Attendance from '../../models/Attendance';
import User from '../../models/User';
import { __setSettingsCacheTtlForTests, defaultShift } from '../settings';
import { setSharedQueue } from '../queue/jobQueue';
import { planDecision, plannerTick, planShift, shiftVariants } from '../scheduler/planner';
import { runAttendancePlanNow } from '../scheduler/api';
import { JOBS, keys } from '../scheduler/jobTypes';
import { localDate, zonedToUtc } from '../lib/zonedTime';
import { todayInTashkent } from '../../utils/tz';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';
import { Clock, drain, enableAttendance, FakeChannels, mkQueue, resetChannels } from './schedulerFakes';

let mongo: MongoMemoryServer;
const ENV = process.env.AI_VOICE_ENABLED;
let A: SeedCompany;
const fc = new FakeChannels();

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  __setSettingsCacheTtlForTests(0);
  mongo = await startMongo();
  A = await seedCompany('PlanA');
}, 120_000);
afterAll(async () => {
  if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV;
  setSharedQueue(null);
  resetChannels();
  await stopMongo(mongo);
});
beforeEach(async () => {
  await AiAttendanceConfirmation.deleteMany({});
  await AiJob.deleteMany({});
  await Attendance.deleteMany({});
  resetChannels();
  fc.sent = [];
  fc.register(['bot_message', 'telegram_call', 'inapp_call', 'push', 'notify_manager']);
});
afterEach(() => setSharedQueue(null));

// 2026-10-14 — Chorshanba (ISO 3); 2026-10-18 — Yakshanba (ISO 7)
const WED = '2026-10-14';
const SUN = '2026-10-18';
const at = (date: string, hhmm: string) => zonedToUtc(date, hhmm);
const confCount = () => AiAttendanceConfirmation.countDocuments({ companyId: A.companyId });

describe('planDecision (sof)', () => {
  const sh = { ...defaultShift(), workStart: '08:00', callTime: '08:00', absentCutoff: '12:00', maxLateMin: 60 };
  it('callTime gacha — yo\'q; [callTime, +maxLateMin] — full; keyin — bot_only; absentCutoff\'dan — hech qachon', () => {
    expect(planDecision(sh, at(WED, '07:59'))).toMatchObject({ plan: false, reason: 'before_call' });
    expect(planDecision(sh, at(WED, '08:00'))).toMatchObject({ plan: true, mode: 'full', date: WED });
    expect(planDecision(sh, at(WED, '09:00'))).toMatchObject({ plan: true, mode: 'full' });
    expect(planDecision(sh, at(WED, '09:01'))).toMatchObject({ plan: true, mode: 'bot_only' });
    expect(planDecision(sh, at(WED, '12:00'))).toMatchObject({ plan: false, reason: 'after_cutoff' });
    expect(planDecision(sh, at(WED, '11:00'), { manual: true })).toMatchObject({ plan: true, mode: 'full' });
    expect(planDecision(sh, at(WED, '12:30'), { manual: true })).toMatchObject({ plan: false, reason: 'after_cutoff' });
  });
  it('ISO hafta kunlari, skipDates (ustun) va extraWorkDates', () => {
    expect(planDecision({ ...sh, workdays: [1, 2, 4, 5, 6] }, at(WED, '08:30'))).toMatchObject({ plan: false, reason: 'not_workday' });
    expect(planDecision({ ...sh, workdays: [7] }, at(SUN, '08:30'))).toMatchObject({ plan: true });
    expect(planDecision({ ...sh, skipDates: [WED] }, at(WED, '08:30'))).toMatchObject({ plan: false, reason: 'not_workday' });
    expect(planDecision({ ...sh, extraWorkDates: [SUN] }, at(SUN, '08:30'))).toMatchObject({ plan: true });
    expect(planDecision({ ...sh, skipDates: [SUN], extraWorkDates: [SUN] }, at(SUN, '08:30'))).toMatchObject({ plan: false });
  });
  it("sana Toshkent bo'yicha — todayInTashkent bilan bir xil (UTC 18:59/19:00 chegarasi)", () => {
    const night = { ...sh, workdays: [1, 2, 3, 4, 5, 6, 7] as any, callTime: '00:00', workStart: '00:00', absentCutoff: '23:59' };
    expect(planDecision(night, new Date('2026-10-14T18:59:00Z')).date).toBe('2026-10-14');
    expect(planDecision(night, new Date('2026-10-14T19:00:00Z')).date).toBe('2026-10-15');
    expect(localDate()).toBe(todayInTashkent());
  });
});

describe('plannerTick + planShift', () => {
  it('soat 08:00 — rol bo\'yicha tasdiqlar va 0-qadamlar; qayta ishga tushish — ikki marta emas', async () => {
    await enableAttendance(A.companyId, { workStart: '08:00' });
    const clock = new Clock(at(WED, '07:59'));
    let q = mkQueue(clock);
    await plannerTick(q, clock.now());
    await drain(q);
    expect(await confCount()).toBe(0);

    clock.set(at(WED, '08:00'));
    expect((await plannerTick(q, clock.now())).planned).toBe(1);
    await drain(q);
    clock.addSec(5);                                                     // 0-qadamlar 1 s oraliq bilan yoyilgan
    await drain(q);
    const confs: any[] = await AiAttendanceConfirmation.find({ companyId: A.companyId }).lean();
    // standart rollar: ishchi, prorab, brigadir — direktor/o'rinbosar emas
    expect(confs.map((c) => c.employeeId).sort()).toEqual([A.prorabId, A.workerId, A.worker2Id].sort());
    expect(confs.every((c) => c.planMode === 'full' && c.date === WED && /^[0-9A-Za-z]{10}$/.test(c.buttonToken))).toBe(true);
    expect(fc.of('bot_message')).toHaveLength(3);

    // "Qayta ishga tushish": yangi navbat (yangi instansiya), yana tick va to'g'ridan-to'g'ri planShift
    q = mkQueue(clock, 'test-B');
    clock.addMin(1);
    expect((await plannerTick(q, clock.now())).planned).toBe(0);         // dedupe att:plan:<c>:<d>:<s>
    const again = await planShift(q, { companyId: A.companyId, shiftId: 'main' }, clock.now());
    expect(again).toMatchObject({ created: 0, existing: 3 });
    await drain(q);
    expect(await confCount()).toBe(3);
    expect(await AiJob.countDocuments({ type: JOBS.step, 'payload.stepIndex': 0 })).toBe(3);
    expect(fc.of('bot_message')).toHaveLength(3);                     // hech kimga ikkinchi xabar yo'q
    expect(await AiJob.countDocuments({ type: JOBS.finalize, dedupeKey: keys.finalize(A.companyId, WED, 'main') })).toBe(1);
  });

  it("bugun check-in qilgan, bloklangan va opt-out(all) xodim rejalashtirilmaydi; objectIds filtri", async () => {
    await enableAttendance(A.companyId, { roles: ['ishchi'] });
    await Attendance.create({ userId: A.workerId, companyId: A.companyId, date: WED, checkIn: at(WED, '07:50').toISOString() });
    const clock = new Clock(at(WED, '08:05'));
    const q = mkQueue(clock);
    const r = await planShift(q, { companyId: A.companyId, shiftId: 'main' }, clock.now());
    expect(r.created).toBe(1);
    expect((await AiAttendanceConfirmation.findOne({ companyId: A.companyId }).lean() as any).employeeId).toBe(A.worker2Id);

    await AiAttendanceConfirmation.deleteMany({});
    await enableAttendance(A.companyId, { roles: ['ishchi'], objectIds: ['665f1c2e9b1e8a0000000abc'] });
    expect((await planShift(q, { companyId: A.companyId, shiftId: 'main' }, clock.now())).created).toBe(0);
  });

  it("catch-up: maxLateMin'dan kech — faqat bot_message (qo'ng'iroqsiz); absentCutoff'dan keyin — reja yo'q, finalize bor", async () => {
    await enableAttendance(A.companyId, { workStart: '08:00', maxLateMin: 60, roles: ['ishchi'] });
    const clock = new Clock(at(WED, '10:30'));                          // server 10:30 da tiklandi
    const q = mkQueue(clock);
    await plannerTick(q, clock.now());
    await drain(q);
    clock.addSec(5);
    await drain(q);
    const confs: any[] = await AiAttendanceConfirmation.find({ companyId: A.companyId }).lean();
    expect(confs).toHaveLength(2);
    expect(confs.every((c) => c.planMode === 'bot_only')).toBe(true);
    expect(fc.of('bot_message')).toHaveLength(2);
    // tugma kutilib (10 daqiqa) — keyin qo'ng'iroq EMAS: zanjir tugaydi
    clock.addMin(11);
    await drain(q);
    expect(fc.sent.filter((s) => s.channel === 'telegram_call' || s.channel === 'inapp_call')).toHaveLength(0);
    expect((await AiAttendanceConfirmation.find({ companyId: A.companyId }).lean()).every((c: any) => c.status === 'no_answer')).toBe(true);

    await AiAttendanceConfirmation.deleteMany({});
    await AiJob.deleteMany({});
    clock.set(at(WED, '12:00'));
    const t = await plannerTick(q, clock.now());
    expect(t).toEqual({ planned: 0, finalize: 1 });
    await drain(q);
    expect(await confCount()).toBe(0);
  });

  it('skipDates — bayram: hech narsa; extraWorkDates — dam olish kuni ishlanadi; ISO workdays', async () => {
    await enableAttendance(A.companyId, { skipDates: [WED] });
    const clock = new Clock(at(WED, '08:30'));
    const q = mkQueue(clock);
    expect(await plannerTick(q, clock.now())).toEqual({ planned: 0, finalize: 0 });

    clock.set(at(SUN, '08:30'));                                         // standart workdays 1..6 — Yakshanba dam
    expect((await plannerTick(q, clock.now())).planned).toBe(0);
    await enableAttendance(A.companyId, { extraWorkDates: [SUN] });
    expect((await plannerTick(q, clock.now())).planned).toBe(1);
    await drain(q);
    expect(await AiAttendanceConfirmation.countDocuments({ companyId: A.companyId, date: SUN })).toBe(3);

    await AiJob.deleteMany({});
    await enableAttendance(A.companyId, { workdays: [7] });              // faqat Yakshanba
    clock.set(at(WED, '08:30'));
    expect((await plannerTick(q, clock.now())).planned).toBe(0);
  });

  it("AI o'chiq (env yoki firma sozlamasi) — planner hech narsa qilmaydi", async () => {
    await enableAttendance(A.companyId, {}, { enabled: false });
    const clock = new Clock(at(WED, '08:30'));
    const q = mkQueue(clock);
    expect((await plannerTick(q, clock.now())).planned).toBe(0);
    await enableAttendance(A.companyId);
    process.env.AI_VOICE_ENABLED = 'false';
    try {
      expect((await plannerTick(q, clock.now())).planned).toBe(0);
      expect(await planShift(q, { companyId: A.companyId, shiftId: 'main' }, clock.now())).toMatchObject({ skipped: 'ai_inactive' });
    } finally { process.env.AI_VOICE_ENABLED = 'true'; }
  });
});

describe('run-now (C5)', () => {
  it("avtomatik rejadan keyin — yangi (manual) kalit, idempotent; keyin qo'shilgan xodim ham rejalashtiriladi", async () => {
    await enableAttendance(A.companyId, { roles: ['ishchi'] });
    const clock = new Clock(at(WED, '08:00'));
    const q = mkQueue(clock);
    setSharedQueue(q);
    await plannerTick(q, clock.now());
    await drain(q);
    expect(await confCount()).toBe(2);

    const late = await User.create({ firstName: 'Yangi', phone: '+998901999001', role: 'ishchi', companyId: A.companyId } as any);
    clock.addMin(5);
    const r = await runAttendancePlanNow({ companyId: A.companyId, shiftId: 'main', requestedBy: A.ownerId, now: clock.now() });
    expect(r).toMatchObject({ ok: true, duplicate: false });
    // Shu daqiqada takroriy bosish — o'sha ish
    expect(await runAttendancePlanNow({ companyId: A.companyId, shiftId: 'main', requestedBy: A.ownerId, now: clock.now() }))
      .toMatchObject({ ok: true, duplicate: true });
    await drain(q);
    expect(await confCount()).toBe(3);
    expect(await AiAttendanceConfirmation.countDocuments({ employeeId: String(late._id) })).toBe(1);
    await User.deleteOne({ _id: late._id });
  });

  it("avtomatik reja ishi 'dead' bo'lsa ham run-now ishlaydi", async () => {
    await enableAttendance(A.companyId, { roles: ['ishchi'] });
    const clock = new Clock(at(WED, '08:00'));
    const q = mkQueue(clock);
    setSharedQueue(q);
    await plannerTick(q, clock.now());
    // Reja ishi bajarilmasdan 'dead' bo'ldi (masalan DB xatolari)
    await AiJob.updateOne({ dedupeKey: keys.plan(A.companyId, WED, 'main') }, { $set: { status: 'dead', expiresAt: new Date(Date.now() + 86_400_000) } });
    clock.addMin(1);
    expect((await plannerTick(q, clock.now())).planned).toBe(0);         // avtomatik kalit band
    await drain(q);
    expect(await confCount()).toBe(0);
    const r = await runAttendancePlanNow({ companyId: A.companyId, shiftId: 'main', requestedBy: A.ownerId, now: clock.now() });
    expect(r).toMatchObject({ ok: true, duplicate: false });
    await drain(q);
    expect(await confCount()).toBe(2);
  });

  it("run-now: noma'lum smena, o'chiq AI, navbat yo'q", async () => {
    await enableAttendance(A.companyId);
    const clock = new Clock(at(WED, '08:00'));
    expect(await runAttendancePlanNow({ companyId: A.companyId, shiftId: 'main', requestedBy: A.ownerId, now: clock.now() }))
      .toEqual({ ok: false, code: 'queue_unavailable' });
    setSharedQueue(mkQueue(clock));
    expect(await runAttendancePlanNow({ companyId: A.companyId, shiftId: 'nope', requestedBy: A.ownerId })).toEqual({ ok: false, code: 'not_found' });
    await enableAttendance(A.companyId, {}, { 'attendance.enabled': false });
    expect(await runAttendancePlanNow({ companyId: A.companyId, shiftId: 'main', requestedBy: A.ownerId })).toEqual({ ok: false, code: 'disabled' });
  });
});

// ───────────── Owner 2026-10-15 (#5): xodimning shaxsiy ish jadvali ─────────────
describe('shaxsiy ish jadvali (planner)', () => {
  afterEach(async () => { await AiEmployeeContact.deleteMany({ companyId: A.companyId }); });
  const setOverride = (employeeId: string, scheduleOverride: Record<string, unknown>) =>
    AiEmployeeContact.updateOne({ companyId: A.companyId, employeeId }, { $set: { scheduleOverride }, $setOnInsert: { companyId: A.companyId, employeeId } }, { upsert: true });
  const conf = (employeeId: string) => AiAttendanceConfirmation.findOne({ companyId: A.companyId, employeeId }).lean() as Promise<any>;

  it("o'z vaqtida: firma 08:00, xodim 10:00 — boshqalar 08:00 da, u 10:00 da; yakunlash ham o'z vaqtida (14:00)", async () => {
    await enableAttendance(A.companyId, { workStart: '08:00', absentCutoff: '12:00', roles: ['ishchi'] }, { fallbackOrder: ['bot_message'] });
    await setOverride(A.workerId, { weekdays: [1, 2, 3, 4, 5, 6], workStart: '10:00' });
    const clock = new Clock(at(WED, '08:00'));
    const q = mkQueue(clock);
    expect((await plannerTick(q, clock.now())).planned).toBe(1);
    await drain(q);
    clock.addSec(5);
    await drain(q);
    expect((await AiAttendanceConfirmation.find({ companyId: A.companyId }).lean()).map((c: any) => c.employeeId)).toEqual([A.worker2Id]);
    expect(await conf(A.worker2Id)).toMatchObject({ workStart: '08:00', absentCutoff: '12:00' });

    clock.set(at(WED, '09:59'));
    expect((await plannerTick(q, clock.now())).planned).toBe(0);
    clock.set(at(WED, '10:00'));
    expect((await plannerTick(q, clock.now())).planned).toBe(1);
    expect(await AiJob.countDocuments({ dedupeKey: keys.planAt(A.companyId, WED, 'main', '10:00') })).toBe(1);
    await drain(q);
    clock.addSec(5);
    await drain(q);
    const w = await conf(A.workerId);
    expect(w).toMatchObject({ workStart: '10:00', absentCutoff: '14:00', planMode: 'full' });
    expect(new Date(w.scheduledAt).toISOString()).toBe(at(WED, '10:00').toISOString());
    // Xabarda xodimning o'z ish boshlanishi
    const msg = fc.of('bot_message').find((s) => s.ctx.employeeId === A.workerId);
    expect((msg?.req as any)?.text).toContain('10:00');
    expect(fc.of('bot_message').filter((s) => s.ctx.employeeId === A.workerId)).toHaveLength(1);

    // 12:00 — firma yakunlashi: faqat worker2; worker'ning vaqti (14:00) hali kelmagan
    clock.set(at(WED, '12:00'));
    await plannerTick(q, clock.now());
    await drain(q);
    expect((await conf(A.worker2Id)).finalizedAt).toBeTruthy();
    expect((await conf(A.workerId)).finalizedAt ?? null).toBeNull();
    clock.set(at(WED, '14:00'));
    await plannerTick(q, clock.now());
    await drain(q);
    const wf = await conf(A.workerId);
    expect(wf.finalizedAt).toBeTruthy();
    expect(wf.status).toBe('absent');
    expect(await AiJob.countDocuments({ type: JOBS.finalize, dedupeKey: keys.finalize(A.companyId, WED, 'main') })).toBe(1);
    expect(await AiJob.countDocuments({ type: JOBS.finalize, dedupeKey: keys.finalizeAt(A.companyId, WED, 'main', '14:00') })).toBe(1);
  });

  it("o'z ish kunlari: faqat Yakshanba ishlaydigan xodim — Chorshanba yo'q, Yakshanba o'z vaqtida; bayram (skipDates) hammaga", async () => {
    await enableAttendance(A.companyId, { workStart: '08:00', roles: ['ishchi'] }, { fallbackOrder: ['bot_message'] });
    await setOverride(A.workerId, { weekdays: [7], workStart: '09:00' });
    const clock = new Clock(at(WED, '08:00'));
    const q = mkQueue(clock);
    await plannerTick(q, clock.now());
    await drain(q);
    expect((await AiAttendanceConfirmation.find({ companyId: A.companyId }).lean()).map((c: any) => c.employeeId)).toEqual([A.worker2Id]);
    clock.set(at(WED, '09:00'));
    expect((await plannerTick(q, clock.now())).planned).toBe(0);         // Chorshanba — uning ish kuni emas

    clock.set(at(SUN, '08:30'));
    expect((await plannerTick(q, clock.now())).planned).toBe(0);         // firma dam oladi, u esa 09:00 da
    clock.set(at(SUN, '09:00'));
    expect((await plannerTick(q, clock.now())).planned).toBe(1);
    await drain(q);
    const sun: any[] = await AiAttendanceConfirmation.find({ companyId: A.companyId, date: SUN }).lean();
    expect(sun.map((c) => c.employeeId)).toEqual([A.workerId]);
    expect(sun[0]).toMatchObject({ workStart: '09:00' });

    await AiAttendanceConfirmation.deleteMany({});
    await AiJob.deleteMany({});
    await enableAttendance(A.companyId, { workStart: '08:00', roles: ['ishchi'], skipDates: [SUN] }, { fallbackOrder: ['bot_message'] });
    expect(await plannerTick(q, clock.now())).toEqual({ planned: 0, finalize: 0 });
    expect(await confCount()).toBe(0);
  });

  it("run-now (qo'lda): firma yakunlash vaqti o'tgan, lekin shaxsiy jadvalli xodimniki emas — faqat u rejalashtiriladi", async () => {
    await enableAttendance(A.companyId, { workStart: '08:00', absentCutoff: '12:00', roles: ['ishchi'] });
    await setOverride(A.workerId, { weekdays: [3], workStart: '11:00' });
    const clock = new Clock(at(WED, '13:00'));
    const q = mkQueue(clock);
    const r = await planShift(q, { companyId: A.companyId, shiftId: 'main', manual: true }, clock.now());
    expect(r).toMatchObject({ created: 1 });
    expect((await AiAttendanceConfirmation.find({ companyId: A.companyId }).lean()).map((c: any) => c.employeeId)).toEqual([A.workerId]);
    expect(await conf(A.workerId)).toMatchObject({ absentCutoff: '15:00' });
  });

  it('shiftVariants: shaxsiy jadval bo\'lmasa — faqat smena; bir xillari birlashtiriladi', () => {
    const sh = { ...defaultShift(), workStart: '08:00', callTime: '08:00', absentCutoff: '12:00' };
    expect(shiftVariants(sh, [])).toEqual([sh]);
    const v = shiftVariants(sh, [{ weekdays: [1, 2, 3, 4, 5, 6] }, { weekdays: [7], workStart: '09:00' }, { weekdays: [7], workStart: '09:00' }]);
    expect(v).toHaveLength(2);
    expect(v[1]).toMatchObject({ workdays: [7], callTime: '09:00', absentCutoff: '13:00' });
  });
});
