// lib/managers.resolveManagers — faqat SHU firma (review D3, notifyAdmins xatosi takrorlanmasin);
// consent.ts — rozilik/opt-out faqat xodimning o'zi, ConsentLog manbasi bilan (review B9).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../../models/User';
import ObjectModel from '../../models/Object';
import Notification from '../../models/Notification';
import ConsentLog from '../../models/ConsentLog';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import { notifyManagersInApp, resolveManagers } from '../lib/managers';
import { setCallConsent, setOptOut } from '../consent';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany, B: SeedCompany;
beforeAll(async () => {
  mongo = await startMongo();
  await Promise.all([User.init(), Notification.init(), ConsentLog.init()]);
  A = await seedCompany('Alfa');
  B = await seedCompany('Beta');
}, 120_000);
afterAll(async () => { await stopMongo(mongo); });

describe('resolveManagers', () => {
  it("xodim obyektining prorabi (foreman) birinchi", async () => {
    const m = await resolveManagers(A.companyId, A.workerId);
    expect(m.map((x) => x.userId)).toEqual([A.prorabId]);
    expect(m[0].via).toBe('foreman');
  });

  it("obyektning prorabi boshqa firmadan bo'lsa — e'tiborsiz, firma rahbarlariga tushadi", async () => {
    await ObjectModel.updateOne({ _id: A.objectId }, { $set: { foremanId: B.prorabId } });
    const m = await resolveManagers(A.companyId, A.workerId);
    expect(m.every((x) => [A.ownerId, A.orinbosarId].includes(x.userId))).toBe(true);
    expect(m[0].userId).toBe(A.ownerId);   // egasi birinchi
    expect(m.map((x) => x.via)).toEqual(['boss', 'boss']);
    await ObjectModel.updateOne({ _id: A.objectId }, { $set: { foremanId: A.prorabId } });
  });

  it("boshqa firma xodimi yoki noto'g'ri ID — bo'sh; bloklangan rahbar va xodimning o'zi chiqariladi", async () => {
    expect(await resolveManagers(A.companyId, B.workerId)).toEqual([]);
    expect(await resolveManagers(A.companyId, 'x')).toEqual([]);
    await User.updateOne({ _id: A.orinbosarId }, { $set: { isBlocked: true } });
    const m = await resolveManagers(A.companyId, A.prorabId); // prorabning obyekti yo'q → rahbarlar
    expect(m.map((x) => x.userId)).toEqual([A.ownerId]);
    expect((await resolveManagers(A.companyId, A.ownerId)).map((x) => x.userId)).not.toContain(A.ownerId);
    await User.updateOne({ _id: A.orinbosarId }, { $set: { isBlocked: false } });
  });

  it("notifyManagersInApp — 'ai' turidagi bildirishnoma faqat shu firma rahbariga", async () => {
    const m = await notifyManagersInApp(A.companyId, A.workerId, { title: 'Davomat', body: 'Ishchi kelmadi' });
    expect(m).toHaveLength(1);
    const n: any[] = await Notification.find({ type: 'ai' }).lean();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ recipientId: A.prorabId, companyId: A.companyId });
  });
});

describe("consent: faqat xodimning o'zi", () => {
  it("admin boshqa xodim nomidan rozilik bera olmaydi", async () => {
    expect(await setCallConsent({ companyId: A.companyId, employeeId: A.workerId, actorUserId: A.ownerId, value: 'granted', source: 'me' }))
      .toEqual({ ok: false, code: 'not_self' });
    expect(await setOptOut({ companyId: A.companyId, employeeId: A.workerId, actorUserId: A.ownerId, source: 'me', calls: true }))
      .toEqual({ ok: false, code: 'not_self' });
    expect(await ConsentLog.countDocuments({ userId: A.workerId })).toBe(0);
  });

  it('bot tugmasi: rozilik + tgUserId bog\'lanadi, ConsentLog manbasi bilan', async () => {
    const r = await setCallConsent({ companyId: A.companyId, employeeId: A.workerId, actorUserId: A.workerId, value: 'granted', source: 'bot', tgUserId: '5550001' });
    expect(r).toEqual({ ok: true });
    const c: any = await AiEmployeeContact.findOne({ companyId: A.companyId, employeeId: A.workerId }).lean();
    expect(c.telegram).toMatchObject({ callConsent: 'granted', tgUserId: '5550001' });
    const log: any = await ConsentLog.findOne({ userId: A.workerId, consentType: 'ai_call' }).lean();
    expect(log).toMatchObject({ value: 'granted', source: 'bot', companyId: A.companyId, telegramUserId: '5550001' });
  });

  it("bitta Telegram identifikatori ikkinchi xodimga bog'lanmaydi", async () => {
    const r = await setCallConsent({ companyId: B.companyId, employeeId: B.workerId, actorUserId: B.workerId, value: 'granted', source: 'bot', tgUserId: '5550001' });
    expect(r).toEqual({ ok: false, code: 'tg_conflict' });
  });

  it("boshqa firmaning xodimi / noto'g'ri qiymat — rad", async () => {
    expect(await setCallConsent({ companyId: A.companyId, employeeId: B.workerId, actorUserId: B.workerId, value: 'granted', source: 'me' }))
      .toEqual({ ok: false, code: 'not_found' });
    expect(await setCallConsent({ companyId: A.companyId, employeeId: A.workerId, actorUserId: A.workerId, value: 'yes' as any, source: 'me' }))
      .toEqual({ ok: false, code: 'bad_request' });
    expect(await setOptOut({ companyId: A.companyId, employeeId: A.workerId, actorUserId: A.workerId, source: 'me' }))
      .toEqual({ ok: false, code: 'bad_request' });
  });

  it("opt-out va qaytarish — ikkalasi ham ConsentLog'da", async () => {
    expect(await setOptOut({ companyId: A.companyId, employeeId: A.workerId, actorUserId: A.workerId, source: 'me', calls: true })).toEqual({ ok: true });
    let c: any = await AiEmployeeContact.findOne({ companyId: A.companyId, employeeId: A.workerId }).lean();
    expect(c.optOut).toMatchObject({ calls: true, reminders: false, via: 'me' });
    await setOptOut({ companyId: A.companyId, employeeId: A.workerId, actorUserId: A.workerId, source: 'bot', calls: false });
    c = await AiEmployeeContact.findOne({ companyId: A.companyId, employeeId: A.workerId }).lean();
    expect(c.optOut.calls).toBe(false);
    const logs: any[] = await ConsentLog.find({ userId: A.workerId, consentType: 'ai_opt_out' }).sort({ createdAt: 1 }).lean();
    expect(logs.map((l) => l.value)).toEqual(['opt_out', 'opt_in']);
  });
});
