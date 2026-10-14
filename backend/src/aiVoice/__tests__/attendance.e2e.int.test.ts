// To'liq ertalab (P3 e2e): ikki firma, soxta bot/qo'ng'iroq kanallari, HAQIQIY push va rahbar kanallari.
// 08:00 bot xabari → tugma / rad etish → javobsizlarga Telegram qo'ng'iroq (2 urinish) → in-app yo'q → push →
// rahbar → check-in reconcile → 12:00 finalize (absent) + yig'ma. Rahbar FAQAT o'z firmasi haqida xabar oladi.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiCallSession from '../../models/AiCallSession';
import Attendance from '../../models/Attendance';
import Notification from '../../models/Notification';
import User from '../../models/User';
import { __setSettingsCacheTtlForTests } from '../settings';
import { setSharedQueue } from '../queue/jobQueue';
import { finishSession } from '../sessions';
import { registerChannel } from '../channels/registry';
import { pushChannel } from '../channels/pushChannel';
import { managerChannel } from '../channels/managerChannel';
import { plannerTick } from '../scheduler/planner';
import { reconcileCheckIns } from '../scheduler/reconciler';
import { respondAttendance } from '../scheduler/api';
import { zonedToUtc } from '../lib/zonedTime';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';
import { Clock, drain, enableAttendance, fakeCallAttempt, FakeChannels, mkQueue, resetChannels } from './schedulerFakes';

let mongo: MongoMemoryServer;
const ENV = process.env.AI_VOICE_ENABLED;
let A: SeedCompany, B: SeedCompany;
const WED = '2026-10-14';
const at = (hhmm: string) => zonedToUtc(WED, hhmm);

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  __setSettingsCacheTtlForTests(0);
  mongo = await startMongo();
  A = await seedCompany('Alfa');
  B = await seedCompany('Beta');
}, 120_000);
afterAll(async () => {
  if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV;
  setSharedQueue(null);
  resetChannels();
  await stopMongo(mongo);
});

const statusOf = async (employeeId: string) => ((await AiAttendanceConfirmation.findOne({ employeeId, date: WED }).lean()) as any)?.status;

describe('attendance e2e — to\'liq ertalab', () => {
  it('ikki firma: tasdiq, rad etish, javobsizlik, check-in, finalize; rahbar faqat o\'z firmasi', async () => {
    for (const c of [A, B]) await enableAttendance(c.companyId, { roles: ['ishchi'], workStart: '08:00', absentCutoff: '12:00', buttonWaitMin: 10 });
    const clock = new Clock(at('08:00'));
    resetChannels();
    const fc = new FakeChannels();
    fc.register(['bot_message', 'telegram_call', 'inapp_call']);
    fc.behaviors.telegram_call = { attempt: fakeCallAttempt(fc, 'telegram_call', clock.now) };
    fc.behaviors.inapp_call = { available: () => false };
    registerChannel(pushChannel);                                       // haqiqiy: createNotification
    registerChannel(managerChannel);                                    // haqiqiy: lib/managers (shu firma)
    const q = mkQueue(clock);
    setSharedQueue(q);

    const tokenOf = async (employeeId: string) => ((await AiAttendanceConfirmation.findOne({ employeeId }).lean()) as any).buttonToken;
    const step = async () => {
      await drain(q);
      // Hech kim qo'ng'iroqqa javob bermaydi
      for (const s of await AiCallSession.find({ isActive: true }).lean()) await finishSession(String((s as any)._id), 'no_answer', 'timeout');
      await drain(q);
    };

    await plannerTick(q, clock.now());
    await drain(q);
    clock.addSec(3);
    await step();
    expect(fc.of('bot_message').map((s) => s.ctx.employeeId).sort()).toEqual([A.workerId, A.worker2Id, B.workerId, B.worker2Id].sort());

    // A.ishchi tasdiqlaydi, B.ishchi rad etadi (→ B rahbariga darhol xabar)
    expect(await respondAttendance({ companyId: A.companyId, employeeId: A.workerId, buttonToken: await tokenOf(A.workerId), answer: 'confirm', via: 'bot' }))
      .toMatchObject({ ok: true, status: 'confirmed' });
    expect(await respondAttendance({ companyId: B.companyId, employeeId: B.workerId, buttonToken: await tokenOf(B.workerId), answer: 'decline', via: 'bot' }))
      .toMatchObject({ ok: true, status: 'declined' });
    // Boshqa firmaning tokeni bilan — topilmaydi
    expect(await respondAttendance({ companyId: A.companyId, employeeId: A.worker2Id, buttonToken: await tokenOf(B.worker2Id), answer: 'confirm', via: 'bot' }))
      .toEqual({ ok: false, code: 'not_found' });
    await step();

    for (let m = 0; m < 45; m++) {
      clock.addMin(1);
      await step();
      if (m === 30) {
        await Attendance.create({ userId: A.workerId, companyId: A.companyId, date: WED, checkIn: clock.now().toISOString() });
        await reconcileCheckIns(clock.now(), {}, q);
      }
    }
    expect(await statusOf(A.workerId)).toBe('checked_in');
    expect(await statusOf(B.workerId)).toBe('declined');
    expect(await statusOf(A.worker2Id)).toBe('no_answer');
    expect(await statusOf(B.worker2Id)).toBe('no_answer');
    // Qo'ng'iroqlar faqat javob bermaganlarga, kanal bo'yicha 2 urinish
    const dialsTo = (id: string) => fc.of('telegram_call', id).length;
    expect([dialsTo(A.workerId), dialsTo(B.workerId), dialsTo(A.worker2Id), dialsTo(B.worker2Id)]).toEqual([0, 0, 2, 2]);
    // Push — createNotification orqali (bitta qator, shift turi)
    expect(await Notification.countDocuments({ recipientId: A.worker2Id, type: 'shift' })).toBe(1);

    clock.set(at('12:01'));
    await step();
    expect(await statusOf(A.worker2Id)).toBe('absent');
    expect(await statusOf(B.worker2Id)).toBe('absent');
    expect(await statusOf(B.workerId)).toBe('declined');
    expect(await statusOf(A.workerId)).toBe('checked_in');
    const all: any[] = await AiAttendanceConfirmation.find({}).lean();
    expect(all.every((c) => c.finalizedAt)).toBe(true);

    // Rahbar xabarlari: faqat SHU firma xodimlari haqida
    const mgrNotes: any[] = await Notification.find({ type: 'ai' }).lean();
    expect(mgrNotes.length).toBeGreaterThan(0);
    for (const n of mgrNotes) {
      const recipient: any = await User.findById(n.recipientId).select('companyId').lean();
      expect(String(recipient.companyId)).toBe(String(n.companyId));
      const other = String(n.companyId) === A.companyId ? 'Beta' : 'Alfa';
      expect(`${n.title} ${n.body}`).not.toContain(other);
    }
    expect(mgrNotes.some((n) => n.recipientId === A.prorabId && /Alfa-ishchi2/.test(n.body))).toBe(true);
    expect(mgrNotes.some((n) => n.recipientId === B.prorabId && /Beta-ishchi\b/.test(n.body))).toBe(true);   // rad etish
    // Yig'ma: A rahbariga — faqat A.ishchi2 (kelmadi)
    const sumA = mgrNotes.filter((n) => n.recipientId === A.prorabId && /Davomat yakuni/.test(n.title));
    expect(sumA).toHaveLength(1);
    expect(sumA[0].body).toContain('Alfa-ishchi2');
    expect(sumA[0].body).not.toMatch(/Alfa-ishchi(?!2)/);
    // Bot orqali rahbarga ketgan xabarlar ham o'z firmasida
    for (const s of fc.of('bot_message').filter((x) => x.req.kind === 'manager_alert')) {
      const u: any = await User.findById(s.ctx.employeeId).select('companyId').lean();
      expect(String(u.companyId)).toBe(s.ctx.companyId);
    }

    // Kech check-in (yakunlangandan keyin) — 'absent' ustidan checked_in (C6)
    clock.set(at('12:40'));
    await Attendance.create({ userId: B.worker2Id, companyId: B.companyId, date: WED, checkIn: clock.now().toISOString() });
    expect(await reconcileCheckIns(clock.now(), {}, q)).toBe(1);
    expect(await statusOf(B.worker2Id)).toBe('checked_in');
  }, 60_000);
});
