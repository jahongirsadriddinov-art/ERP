// Eslatmalar (P3, review C2/C9): avval ish (dedupe rem:<id>:<nextFireAt>), keyin nextFireAt CAS; 6 soatdan
// kech bir martalik — missed; takroriy — keyingi kelajak vaqtiga (to'plab emas); opt-out; done/snooze idempotent.
// Shu faylda: retention.sweep va eski bot eslatmasi dedupe'i ham.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiReminder from '../../models/AiReminder';
import AiJob from '../../models/AiJob';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiCallEvent from '../../models/AiCallEvent';
import AiCallSession from '../../models/AiCallSession';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiConversation from '../../models/AiConversation';
import { __setSettingsCacheTtlForTests } from '../settings';
import { reminderTick, fireReminder, MISSED_AFTER_MS } from '../scheduler/reminders';
import { reminderAction } from '../scheduler/api';
import { JOBS, keys } from '../scheduler/jobTypes';
import { retentionSweep } from '../scheduler/retention';
import { claimLegacyReminderSlot, __resetLegacyReminderMemory } from '../scheduler/legacyReminderDedupe';
import { newCorrelationId } from '../lib/ids';
import { zonedParts, zonedToUtc } from '../lib/zonedTime';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';
import { Clock, drain, FakeChannels, mkQueue, resetChannels } from './schedulerFakes';

let mongo: MongoMemoryServer;
const ENV = process.env.AI_VOICE_ENABLED;
let A: SeedCompany, B: SeedCompany;
let fc: FakeChannels;
const T = (date: string, hhmm: string) => zonedToUtc(date, hhmm);

beforeAll(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  __setSettingsCacheTtlForTests(0);
  mongo = await startMongo();
  A = await seedCompany('XaRem');
  B = await seedCompany('YoRem');
}, 120_000);
afterAll(async () => {
  if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV;
  resetChannels();
  await stopMongo(mongo);
});
beforeEach(async () => {
  await AiReminder.deleteMany({});
  await AiJob.deleteMany({});
  await AiEmployeeContact.deleteMany({});
  resetChannels();
  fc = new FakeChannels();
  fc.register(['bot_message', 'push']);
});

async function mkReminder(over: Record<string, unknown> = {}) {
  const r = await AiReminder.create({
    companyId: A.companyId, ownerId: A.workerId, targetUserId: A.workerId, text: 'Beton quyish', dueAt: T('2026-10-14', '09:00'),
    nextFireAt: T('2026-10-14', '09:00'), recurrence: { freq: 'none' }, channels: [], correlationId: newCorrelationId(), ...over,
  });
  return String(r._id);
}
const rem = async (id: string): Promise<any> => AiReminder.findById(id).lean();

describe('reminder.tick / reminder.fire', () => {
  it("bir martalik: ish dedupe bilan, nextFireAt null; bot tugmalari ai:r:<id>:d|s; keyin 'done'", async () => {
    const id = await mkReminder();
    const clock = new Clock(T('2026-10-14', '09:00'));
    const q = mkQueue(clock);
    expect(await reminderTick(q, clock.now())).toEqual({ queued: 1, missed: 0, skipped: 0 });
    expect(await AiJob.countDocuments({ type: JOBS.reminderFire, dedupeKey: keys.reminderFire(id, T('2026-10-14', '09:00')) })).toBe(1);
    expect((await rem(id)).nextFireAt).toBeNull();
    await drain(q);
    const sent = fc.of('bot_message', A.workerId);
    expect(sent).toHaveLength(1);
    expect(sent[0].req).toMatchObject({ kind: 'reminder', text: 'Beton quyish' });
    expect(sent[0].req.buttons?.[0].map((b) => b.data)).toEqual([`ai:r:${id}:d`, `ai:r:${id}:s`]);
    expect(fc.of('push')).toHaveLength(0);                              // birinchi muvaffaqiyatli kanal yetarli
    expect(await rem(id)).toMatchObject({ status: 'done', fireCount: 1 });
    expect(await reminderTick(q, clock.now())).toEqual({ queued: 0, missed: 0, skipped: 0 });
  });

  it('qulash ish qo\'shilgandan keyin, CAS\'dan oldin — takroriy qo\'shish e\'tiborsiz (bir marta yuboriladi)', async () => {
    const id = await mkReminder();
    const clock = new Clock(T('2026-10-14', '09:01'));
    const q = mkQueue(clock);
    await q.enqueue({ type: JOBS.reminderFire, refId: id, dedupeKey: keys.reminderFire(id, T('2026-10-14', '09:00')) }); // "oldingi" urinish
    await reminderTick(q, clock.now());
    expect(await AiJob.countDocuments({ type: JOBS.reminderFire })).toBe(1);
    await drain(q);
    expect(fc.of('bot_message')).toHaveLength(1);
  });

  it("6 soatdan kech bir martalik — 'missed' (yuborilmaydi)", async () => {
    const id = await mkReminder();
    const clock = new Clock(new Date(T('2026-10-14', '09:00').getTime() + MISSED_AFTER_MS + 60_000));
    const q = mkQueue(clock);
    expect(await reminderTick(q, clock.now())).toMatchObject({ missed: 1, queued: 0 });
    await drain(q);
    expect(fc.sent).toHaveLength(0);
    expect(await rem(id)).toMatchObject({ status: 'missed', nextFireAt: null });
  });

  it('takroriy: 3 kunlik uzilishdan keyin to\'plab emas — keyingi kelajak vaqtiga o\'tadi', async () => {
    const id = await mkReminder({ recurrence: { freq: 'daily', interval: 1 } });
    const clock = new Clock(T('2026-10-17', '12:00'));
    const q = mkQueue(clock);
    expect(await reminderTick(q, clock.now())).toMatchObject({ skipped: 1, queued: 0 });
    await drain(q);
    expect(fc.sent).toHaveLength(0);
    const r = await rem(id);
    expect(r.status).toBe('active');
    expect(r.nextFireAt.toISOString()).toBe(T('2026-10-18', '09:00').toISOString());
  });

  it('takroriy (daily): yuboriladi va keyingi kunga (Toshkent vaqti) suriladi; count tugasa done', async () => {
    const id = await mkReminder({ recurrence: { freq: 'daily', interval: 1, count: 2 } });
    const clock = new Clock(T('2026-10-14', '09:00'));
    const q = mkQueue(clock);
    await reminderTick(q, clock.now());
    await drain(q);
    let r = await rem(id);
    expect(zonedParts(r.nextFireAt).date).toBe('2026-10-15');
    expect(zonedParts(r.nextFireAt).hhmm).toBe('09:00');
    expect(r).toMatchObject({ status: 'active', fireCount: 1 });
    clock.set(T('2026-10-15', '09:00'));
    await reminderTick(q, clock.now());
    await drain(q);
    r = await rem(id);
    expect(r).toMatchObject({ status: 'done', fireCount: 2, nextFireAt: null });
    expect(fc.of('bot_message')).toHaveLength(2);
  });

  it("opt-out (reminders) — yuborilmaydi; bot yo'q bo'lsa push", async () => {
    const id = await mkReminder();
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, optOut: { reminders: true } });
    expect(await fireReminder(id, new Date())).toBe('skipped');
    expect(fc.sent).toHaveLength(0);
    await AiEmployeeContact.deleteMany({});
    const id2 = await mkReminder();
    fc.behaviors.bot_message = { available: () => false };
    expect(await fireReminder(id2, new Date())).toBe('delivered');
    expect(fc.of('push', A.workerId)).toHaveLength(1);
  });
});

describe('reminderAction (bot ai:r / veb)', () => {
  it('done — idempotent; faqat maqsad foydalanuvchi; boshqa firma — topilmaydi', async () => {
    const id = await mkReminder({ nextFireAt: null });
    expect(await reminderAction({ companyId: A.companyId, userId: A.worker2Id, reminderId: id, action: 'done', via: 'bot' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await reminderAction({ companyId: B.companyId, userId: A.workerId, reminderId: id, action: 'done', via: 'bot' })).toEqual({ ok: false, code: 'not_found' });
    expect(await reminderAction({ companyId: A.companyId, userId: A.workerId, reminderId: id, action: 'done', via: 'bot' })).toMatchObject({ ok: true, status: 'done', already: false });
    expect(await reminderAction({ companyId: A.companyId, userId: A.workerId, reminderId: id, action: 'done', via: 'bot' })).toMatchObject({ ok: true, status: 'done', already: true });
  });
  it('snooze — +10 daqiqa; takroriy bosish no-op; yuborilgan (done) bir martalikni qayta faollashtiradi', async () => {
    const now = T('2026-10-14', '09:05');
    const id = await mkReminder({ nextFireAt: null, status: 'done' });
    const r1 = await reminderAction({ companyId: A.companyId, userId: A.workerId, reminderId: id, action: 'snooze', via: 'bot', at: now });
    expect(r1).toMatchObject({ ok: true, status: 'active', already: false });
    expect((r1 as any).nextFireAt.toISOString()).toBe(new Date(now.getTime() + 10 * 60_000).toISOString());
    const r2 = await reminderAction({ companyId: A.companyId, userId: A.workerId, reminderId: id, action: 'snooze', via: 'bot', at: new Date(now.getTime() + 5_000) });
    expect(r2).toMatchObject({ ok: true, already: true });
    expect((await rem(id)).nextFireAt.toISOString()).toBe(new Date(now.getTime() + 10 * 60_000).toISOString());
  });
});

describe('retention.sweep', () => {
  it("saqlash muddati o'tgan voqealar/sessiyalar/tasdiqlar o'chadi; faol sessiya va oddiy chat qoladi", async () => {
    const now = new Date('2026-10-14T00:00:00Z');
    const old = new Date(now.getTime() - 400 * 86_400_000);
    const mid = new Date(now.getTime() - 40 * 86_400_000);
    const sOld = await AiCallSession.create({ companyId: A.companyId, employeeId: 'e1', correlationId: newCorrelationId(), purpose: 'attendance', channel: 'inapp_call', isActive: false, status: 'completed', summary: 'x' });
    const sMid = await AiCallSession.create({ companyId: A.companyId, employeeId: 'e2', correlationId: newCorrelationId(), purpose: 'attendance', channel: 'inapp_call', isActive: false, status: 'completed', summary: 'y' });
    const sAct = await AiCallSession.create({ companyId: A.companyId, employeeId: 'e3', correlationId: newCorrelationId(), purpose: 'attendance', channel: 'inapp_call', isActive: true });
    await AiCallSession.collection.updateOne({ _id: sOld._id }, { $set: { createdAt: old } });
    await AiCallSession.collection.updateOne({ _id: sMid._id }, { $set: { createdAt: mid } });
    await AiCallSession.collection.updateOne({ _id: sAct._id }, { $set: { createdAt: old } });
    await AiCallEvent.create({ companyId: A.companyId, sessionId: String(sMid._id), correlationId: 'c', seq: 1, type: 'state', at: mid, expiresAt: new Date(now.getTime() + 86_400_000) });
    const conf = await AiAttendanceConfirmation.create({ companyId: A.companyId, employeeId: 'e1', date: '2025-01-01', shiftId: 'main', scheduledAt: old, correlationId: 'c' });
    await AiAttendanceConfirmation.collection.updateOne({ _id: conf._id }, { $set: { createdAt: old } });
    const cv = await AiConversation.create({ userId: 'e1', companyId: A.companyId, source: 'voice_inapp', title: 'v' });
    const chat = await AiConversation.create({ userId: 'e1', companyId: A.companyId, title: 'chat' });
    await AiConversation.collection.updateMany({ _id: { $in: [cv._id, chat._id] } }, { $set: { updatedAt: mid } });

    const st = await retentionSweep(now);
    // Suhbatlar endi bu yerda o'chirilmaydi — avval faylga arxivlanadi (archive/transcriptArchive, #3)
    expect(st).toMatchObject({ events: 1, sessions: 1, confirmations: 1, conversations: 0 });
    expect(await AiConversation.exists({ _id: cv._id })).toBeTruthy();
    expect(await AiCallSession.exists({ _id: sOld._id })).toBeNull();
    expect((await AiCallSession.findById(sMid._id).lean() as any).summary).toBeUndefined();   // 30 kundan eski transcript
    expect(await AiCallSession.exists({ _id: sAct._id })).toBeTruthy();                       // faol — tegilmaydi
    expect(await AiConversation.exists({ _id: chat._id })).toBeTruthy();                      // oddiy chat qoladi
  });
});

describe('eski bot eslatmasi dedupe (C8)', () => {
  it('ikki instansiya — slotni faqat bittasi oladi; boshqa slot — yana ruxsat', async () => {
    __resetLegacyReminderMemory();
    const [a, b] = await Promise.all([claimLegacyReminderSlot('in', '2026-10-14-7'), claimLegacyReminderSlot('in', '2026-10-14-7')]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await claimLegacyReminderSlot('in', '2026-10-14-8')).toBe(true);
    expect(await claimLegacyReminderSlot('out', '2026-10-14-7')).toBe(true);
    // navbat bu yozuvlarni hech qachon bajarmaydi
    expect(await AiJob.countDocuments({ type: 'legacy.reminder', status: { $ne: 'done' } })).toBe(0);
  });
});
