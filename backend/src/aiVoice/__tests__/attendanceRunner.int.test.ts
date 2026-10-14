// Voqealarga asoslangan attendance qadamlari (P3, review C1/C4/C6): kanallar FAQAT registry orqali (soxta);
// dispatch va natija orasida qulash — qayta TERILMAYDI; osilgan sessiya sweep qilinsa oqim davom etadi;
// busy-requeue chegarasi 5; qadam oldi Attendance va opt-out tekshiruvi; kanal tartibi (unavailable o'tkaziladi).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiCallSession from '../../models/AiCallSession';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiJob from '../../models/AiJob';
import Attendance from '../../models/Attendance';
import { __setSettingsCacheTtlForTests } from '../settings';
import { setSharedQueue } from '../queue/jobQueue';
import { sweepStaleSessions } from '../queue/sessionSweep';
import { finishSession } from '../sessions';
import { planShift } from '../scheduler/planner';
import { recordVoiceAnswer, respondAttendance } from '../scheduler/api';
import { JOBS } from '../scheduler/jobTypes';
import { zonedToUtc } from '../lib/zonedTime';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';
import { Clock, drain, enableAttendance, fakeCallAttempt, FakeChannels, mkQueue, resetChannels } from './schedulerFakes';

let mongo: MongoMemoryServer;
const ENV = process.env.AI_VOICE_ENABLED;
let A: SeedCompany;
let fc: FakeChannels;
const WED = '2026-10-14';
const at = (hhmm: string) => zonedToUtc(WED, hhmm);

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  __setSettingsCacheTtlForTests(0);
  mongo = await startMongo();
  A = await seedCompany('RunA');
}, 120_000);
afterAll(async () => {
  if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV;
  setSharedQueue(null);
  resetChannels();
  await stopMongo(mongo);
});
beforeEach(async () => {
  for (const m of [AiAttendanceConfirmation, AiCallSession, AiJob, Attendance, AiEmployeeContact] as any[]) await m.deleteMany({});
  resetChannels();
  fc = new FakeChannels();
  fc.register(['bot_message', 'telegram_call', 'inapp_call', 'push', 'notify_manager']);
  await enableAttendance(A.companyId, { roles: ['ishchi'], workStart: '08:00', buttonWaitMin: 10 });
});
afterEach(() => setSharedQueue(null));

/** Bitta xodim (worker) uchun reja: 08:00, birinchi qadam (bot) bajariladi. */
async function planOne(clock: Clock, q: ReturnType<typeof mkQueue>) {
  await planShift(q, { companyId: A.companyId, shiftId: 'main' }, clock.now());
  await AiAttendanceConfirmation.deleteMany({ employeeId: A.worker2Id });
  await AiJob.deleteMany({ employeeId: A.worker2Id });
  clock.addSec(2);                                                      // 0-qadamlar 1 s oraliq bilan yoyilgan
  await drain(q);
  return String(((await AiAttendanceConfirmation.findOne({ employeeId: A.workerId }).lean()) as any)._id);
}
const conf = async (id: string): Promise<any> => AiAttendanceConfirmation.findById(id).lean();

describe('attendanceRunner', () => {
  it("bot → tugma kutish → Telegram qo'ng'irog'i (attemptKey bilan sessiya), natija voqea bilan keladi", async () => {
    const clock = new Clock(at('08:00'));
    const q = mkQueue(clock);
    fc.behaviors.telegram_call = { attempt: fakeCallAttempt(fc, 'telegram_call', clock.now) };
    const id = await planOne(clock, q);
    expect(fc.of('bot_message', A.workerId)).toHaveLength(1);
    const botReq = fc.of('bot_message')[0].req;
    const c0 = await conf(id);
    expect(botReq.buttons?.[0].map((b) => b.data)).toEqual([`ai:a:${c0.buttonToken}:c`, `ai:a:${c0.buttonToken}:l`, `ai:a:${c0.buttonToken}:d`]);
    expect(botReq.buttons?.[0].every((b) => Buffer.byteLength(b.data) <= 64)).toBe(true);

    clock.addMin(9);
    await drain(q);
    expect(fc.dials).toBe(0);                                          // buttonWaitMin hali o'tmagan
    clock.addMin(1);
    await drain(q);
    expect(fc.dials).toBe(1);
    const s: any = await AiCallSession.findOne({ employeeId: A.workerId }).lean();
    expect(s.attemptKey).toBe(`${id}:1:1`);
    expect((await conf(id)).attempts[1]).toMatchObject({ channel: 'telegram_call', outcome: 'awaiting', sessionId: String(s._id) });
    expect(await AiJob.countDocuments({ type: JOBS.callTimeout, refId: id })).toBe(1);

    // Ovozli javob "kelaman" — holat pending qoladi; qo'ng'iroq tugaydi → tugmalar yuboriladi, zanjir to'xtaydi
    expect(await recordVoiceAnswer({ companyId: A.companyId, employeeId: A.workerId, confirmationId: id, answer: 'coming' })).toEqual({ ok: true, changed: true });
    expect((await conf(id)).status).toBe('pending');
    await finishSession(String(s._id), 'completed', 'hangup');
    await drain(q);
    const c = await conf(id);
    expect(c.attempts[1].outcome).toBe('answered');
    expect(c.status).toBe('pending');
    expect(c.nextActionAt).toBeNull();
    expect(fc.of('bot_message', A.workerId)).toHaveLength(2);           // qo'ng'iroqdan keyin tugmalar
    expect(fc.of('bot_message', A.workerId)[1].req.buttons?.[0][0].data).toBe(`ai:a:${c.buttonToken}:c`);
    clock.addMin(30);
    await drain(q);
    expect(fc.sent.filter((x) => x.channel !== 'bot_message')).toHaveLength(1);   // faqat bitta qo'ng'iroq
    // Tugma — confirmed (checked_in EMAS)
    expect(await respondAttendance({ companyId: A.companyId, employeeId: A.workerId, buttonToken: c.buttonToken, answer: 'confirm', via: 'bot' }))
      .toEqual({ ok: true, status: 'confirmed', already: false });
    expect(await respondAttendance({ companyId: A.companyId, employeeId: A.workerId, buttonToken: c.buttonToken, answer: 'decline', via: 'bot' }))
      .toEqual({ ok: true, status: 'confirmed', already: true });
  });

  it("qulash dispatch va natija orasida — qayta TERILMAYDI, tiklangach natija bilan davom etadi", async () => {
    const clock = new Clock(at('08:00'));
    const qA = mkQueue(clock, 'inst-A');
    fc.behaviors.telegram_call = { attempt: fakeCallAttempt(fc, 'telegram_call', clock.now, { hang: true }) };
    const id = await planOne(clock, qA);
    clock.addMin(10);
    void qA.runOnce();                                                  // qo'ng'iroq yuboriladi va ish "osilib qoladi"
    await vi.waitFor(() => expect(fc.dials).toBe(1));
    const leased: any = await AiJob.findOne({ type: JOBS.step, refId: id, status: 'leased' }).lean();
    expect(leased).toBeTruthy();
    expect((await conf(id)).attempts[1].outcome).toBe('dispatching');

    // Instansiya "o'ldi": lease muddati o'tadi, boshqa instansiya ishni qayta oladi
    clock.addSec(90);
    fc.behaviors.telegram_call = { attempt: fakeCallAttempt(fc, 'telegram_call', clock.now) };
    const qB = mkQueue(clock, 'inst-B');
    await qB.sweepExpired();
    await drain(qB);
    expect(fc.dials).toBe(1);                                           // qayta terilmadi
    const sess: any[] = await AiCallSession.find({ employeeId: A.workerId }).lean();
    expect(sess).toHaveLength(1);
    expect((await conf(id)).attempts[1]).toMatchObject({ outcome: 'awaiting', sessionId: String(sess[0]._id) });

    // Natija keladi (javob yo'q) → backoff (3 daqiqa) bilan YANGI urinish (attemptNo 2, yangi attemptKey)
    await finishSession(String(sess[0]._id), 'no_answer', 'timeout');
    await drain(qB);
    expect((await conf(id)).attempts[1].outcome).toBe('no_answer');
    clock.addMin(3);
    await drain(qB);
    expect(fc.dials).toBe(2);
    expect((await AiCallSession.findOne({ isActive: true }).lean() as any).attemptKey).toBe(`${id}:2:2`);
  });

  it("osilgan sessiya sweep qilinadi (interrupted) → oqim davom etadi", async () => {
    const clock = new Clock(at('08:00'));
    const q = mkQueue(clock);
    fc.behaviors.telegram_call = { attempt: fakeCallAttempt(fc, 'telegram_call', clock.now) };
    const id = await planOne(clock, q);
    clock.addMin(10);
    await drain(q);
    expect(fc.dials).toBe(1);
    // Sessiya hech qachon yangilanmadi (jarayon qulagan) — sweep 'interrupted' qiladi
    const s: any = await AiCallSession.findOne({ isActive: true }).lean();
    await AiCallSession.collection.updateOne({ _id: s._id }, { $set: { updatedAt: new Date(Date.now() - 3600_000) } });
    const ended = await sweepStaleSessions(new Date());
    expect(ended).toHaveLength(1);
    await drain(q);
    expect((await conf(id)).attempts[1]).toMatchObject({ outcome: 'failed', sessionId: String(s._id) });
    clock.addMin(3);
    await drain(q);
    expect(fc.dials).toBe(2);                                           // xodim endi "band" emas — oqim davom etdi
  });

  it("call.timeout: natija kelmasa ring+maxDuration+30 s dan keyin zanjir davom etadi", async () => {
    const clock = new Clock(at('08:00'));
    const q = mkQueue(clock);
    fc.behaviors.telegram_call = { attempt: fakeCallAttempt(fc, 'telegram_call', clock.now) };
    fc.behaviors.inapp_call = { available: () => false };
    await enableAttendance(A.companyId, { roles: ['ishchi'] }, { 'calls.maxAttemptsPerChannel': 1 });
    const id = await planOne(clock, q);
    clock.addMin(10);
    await drain(q);
    clock.addSec(45 + 120 + 31);
    await drain(q);
    const c = await conf(id);
    expect(c.attempts[1]).toMatchObject({ channel: 'telegram_call', outcome: 'no_answer', errorCode: 'timeout' });
    // inapp unavailable — o'tkazib yuboriladi, push yetkaziladi
    expect(c.attempts.slice(2).map((a: any) => [a.channel, a.outcome])).toEqual([['inapp_call', 'unavailable'], ['push', 'delivered']]);
  });

  it('busy-requeue chegarasi 5 — keyin keyingi kanal', async () => {
    const clock = new Clock(at('08:00'));
    const q = mkQueue(clock);
    fc.behaviors.telegram_call = { attempt: async () => ({ outcome: 'busy', retryable: true }) };
    const id = await planOne(clock, q);
    clock.addMin(10);
    for (let i = 0; i < 8; i++) { await drain(q); clock.addSec(61); }
    const c = await conf(id);
    expect(fc.of('telegram_call')).toHaveLength(6);                    // 1 + 5 qayta navbat
    expect(c.busyRequeues).toBe(5);
    expect(c.attempts.find((a: any) => a.channel === 'inapp_call')).toBeTruthy();
  });

  it("qadam oldi tekshiruvi: check-in qilgan xodimga qo'ng'iroq qilinmaydi (C6); opt-out(all) — to'xtaydi", async () => {
    const clock = new Clock(at('08:00'));
    const q = mkQueue(clock);
    fc.behaviors.telegram_call = { attempt: fakeCallAttempt(fc, 'telegram_call', clock.now) };
    const id = await planOne(clock, q);
    await Attendance.create({ userId: A.workerId, companyId: A.companyId, date: WED, checkIn: at('08:05').toISOString() });
    clock.addMin(10);
    await drain(q);
    expect(fc.dials).toBe(0);
    expect(await conf(id)).toMatchObject({ status: 'checked_in' });
    expect((await conf(id)).checkInAt.toISOString()).toBe(at('08:05').toISOString());

    // opt-out: boshqa xodim
    await AiAttendanceConfirmation.deleteMany({});
    await AiJob.deleteMany({});
    await Attendance.deleteMany({});
    const id2 = await planOne(clock, q);
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, optOut: { all: true } });
    clock.addMin(10);
    await drain(q);
    expect(fc.dials).toBe(0);
    const c2 = await conf(id2);
    expect(c2.status).toBe('pending');
    expect(c2.attempts.at(-1)).toMatchObject({ outcome: 'skipped', errorCode: 'opt_out' });
  });

  it("xodim kanal tartibi va opt-out(calls) — qo'ng'iroqlar o'tkaziladi; to'liq zanjir oxirida no_answer + rahbar", async () => {
    const clock = new Clock(at('08:00'));
    const q = mkQueue(clock);
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, channelPrefs: { order: ['push', 'bot_message'], disabled: [] }, optOut: { calls: true } });
    const id = await planOne(clock, q);
    expect(fc.of('push', A.workerId)).toHaveLength(1);
    clock.addMin(10); await drain(q);
    clock.addMin(10); await drain(q);
    const c = await conf(id);
    expect(c.attempts.map((a: any) => a.channel)).toEqual(['push', 'bot_message', 'notify_manager']);
    expect(fc.of('telegram_call')).toHaveLength(0);
    expect(c.status).toBe('no_answer');
    expect(c.managerNotifiedAt).toBeTruthy();
    expect(await AiJob.countDocuments({ type: JOBS.manager })).toBe(0);  // rahbar zanjirda xabardor — takror yo'q
  });

  it("shaxsiy jim soatlar (/me) — qo'ng'iroq kanallari o'tkaziladi, bot/push qoladi", async () => {
    const clock = new Clock(at('08:00'));
    const q = mkQueue(clock);
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, quietHours: { from: '22:00', to: '09:00' } });
    const id = await planOne(clock, q);
    clock.addMin(10); await drain(q);
    clock.addMin(10); await drain(q);
    const c = await conf(id);
    expect(c.attempts.map((a: any) => a.channel)).toEqual(['bot_message', 'push', 'notify_manager']);
    expect(fc.of('telegram_call')).toHaveLength(0);
    expect(fc.of('inapp_call')).toHaveLength(0);
  });

  it("absentCutoff'dan keyin qadam hech narsa qilmaydi; tugma bosilgach qolgan qadamlar bekor", async () => {
    const clock = new Clock(at('08:00'));
    const q = mkQueue(clock);
    setSharedQueue(q);
    const id = await planOne(clock, q);
    const c = await conf(id);
    expect(await respondAttendance({ companyId: A.companyId, employeeId: A.workerId, confirmationId: id, answer: 'late', via: 'web' }))
      .toEqual({ ok: true, status: 'late', already: false });
    expect(await AiJob.countDocuments({ type: JOBS.step, refId: id, status: 'queued' })).toBe(0);
    // boshqa xodim/firma nomidan javob — topilmaydi
    expect(await respondAttendance({ companyId: A.companyId, employeeId: A.worker2Id, buttonToken: c.buttonToken, answer: 'confirm', via: 'bot' }))
      .toEqual({ ok: false, code: 'not_found' });
    clock.set(at('12:30'));
    await drain(q);
    // Xodimga boshqa hech narsa yuborilmadi; finalize: 'late' (kelmagan) → absent, rahbarga yig'ma
    expect(fc.sent.filter((x) => x.channel !== 'bot_message' && x.ctx.employeeId === A.workerId)).toHaveLength(0);
    expect((await conf(id)).status).toBe('absent');
  });
});
