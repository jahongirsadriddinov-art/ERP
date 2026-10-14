// getAllowedFinancialReport (faqat rahbar, yig'indi, shaxsiy maoshsiz, firma izolyatsiyasi) va
// notifyManager (har doim tasdiq; faqat shu firma rahbari; tasdiqsiz bildirishnoma yo'q).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Transaction from '../../../../models/Transaction';
import Notification from '../../../../models/Notification';
import { localDate } from '../../../lib/zonedTime';
import { confirmPendingAction } from '../../executor';
import { periodRange } from '../getAllowedFinancialReport';
import { call, resetCaches, setupErp, teardownErp, type Env } from './erpHelpers';

let env: Env;
beforeAll(async () => {
  env = await setupErp();
  const { A, B } = env;
  const d = localDate();
  await Transaction.insertMany([
    { type: 'material', status: 'confirmed', projectId: A.objectId, companyId: A.companyId, amount: 1_000_000, date: d },
    { type: 'oylik', status: 'confirmed', toUserId: A.workerId, toUserName: 'Alfa-ishchi', companyId: A.companyId, amount: 2_000_000, date: d },
    { type: 'income', status: 'confirmed', companyId: A.companyId, amount: 5_000_000, date: d },
    { type: 'transfer', status: 'confirmed', companyId: A.companyId, amount: 999, date: d },
    { type: 'transport', status: 'pending', requiresAdminApproval: true, companyId: A.companyId, amount: 300_000, date: d },
    { type: 'material', status: 'confirmed', companyId: B.companyId, amount: 70_000_000, date: d },
  ] as any[]);
}, 120_000);
afterAll(async () => { await teardownErp(env); });
beforeEach(() => resetCaches());

describe('getAllowedFinancialReport', () => {
  it("ishchi va prorab — kod shifti bo'yicha rad", async () => {
    const { A } = env;
    expect((await call(A.workerId, A.companyId, 'getAllowedFinancialReport')).result.status).toBe('denied');
    expect((await call(A.prorabId, A.companyId, 'getAllowedFinancialReport')).result.status).toBe('denied');
  });

  it("o'rinbosar: yig'indilar to'g'ri, B firma va transfer kirmaydi, shaxs bo'yicha maosh yo'q", async () => {
    const { A } = env;
    const r = await call(A.orinbosarId, A.companyId, 'getAllowedFinancialReport', { period: 'this_month' });
    expect(r.result.status).toBe('ok');
    const d: any = r.result.data;
    expect(d.totals).toEqual({ expense: 3_000_000, income: 5_000_000, net: 2_000_000, transactions: 3 });
    expect(d.expenseByType).toEqual({ material: 1_000_000, oylik: 2_000_000 });
    expect(d.pendingApproval).toEqual({ count: 1, sum: 300_000 });
    expect(d.topObjectsBySpend).toHaveLength(1);
    const s = JSON.stringify(d);
    expect(s).not.toMatch(/Alfa-ishchi|toUserId|baseSalary|70000000/);
  });

  it('davr chegaralari', () => {
    expect(periodRange('last_month', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('last_month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('this_month', '2026-10-14')).toEqual({ from: '2026-10-01', to: '2026-10-14' });
    expect(periodRange('last_30_days', '2026-10-14')).toEqual({ from: '2026-09-15', to: '2026-10-14' });
  });
});

describe('notifyManager', () => {
  it("har doim tasdiq; tasdiqgacha bildirishnoma yo'q; keyin faqat shu firma prorabiga", async () => {
    const { A, B } = env;
    await Notification.deleteMany({});
    const r = await call(A.workerId, A.companyId, 'notifyManager', { message: 'Sement tugadi', urgency: 'high' });
    expect(r.result.status).toBe('needs_confirmation');
    expect(await Notification.countDocuments({})).toBe(0);
    const c = await confirmPendingAction({ pendingActionId: r.result.pendingActionId, actorUserId: A.workerId, companyId: A.companyId, channel: 'web', accept: true });
    expect(c.result.status).toBe('ok');
    const notes: any[] = await Notification.find({}).lean();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ recipientId: A.prorabId, companyId: A.companyId, type: 'ai' });
    expect(notes.some((n) => n.companyId === B.companyId)).toBe(false);
  });

  it('rad etilgan tasdiq — hech narsa yuborilmaydi; takroriy bosish — bajarilmaydi', async () => {
    const { A } = env;
    await Notification.deleteMany({});
    const r = await call(A.workerId, A.companyId, 'notifyManager', { message: 'Test' });
    const base = { pendingActionId: r.result.pendingActionId, actorUserId: A.workerId, companyId: A.companyId, channel: 'web' as const };
    expect((await confirmPendingAction({ ...base, accept: false })).result.status).toBe('ok');
    expect((await confirmPendingAction({ ...base, accept: true })).result.status).toBe('error');
    expect(await Notification.countDocuments({})).toBe(0);
  });
});
