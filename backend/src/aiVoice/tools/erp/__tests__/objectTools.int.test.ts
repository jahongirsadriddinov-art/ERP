// getProjectSummary, getInventoryBalance, getAttendanceSummary: rol doirasi (rahbar / prorab / ishchi),
// moliya faqat rahbarga, Material — ombor EMAS izohi, kod shifti sozlama eskalatsiyasiga qarshi,
// boshqa firma ID'lari, telefon hech qachon.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import ObjectModel from '../../../../models/Object';
import Material from '../../../../models/Material';
import Transaction from '../../../../models/Transaction';
import Attendance from '../../../../models/Attendance';
import AiAssistantSettings from '../../../../models/AiAssistantSettings';
import { localDate } from '../../../lib/zonedTime';
import { call, resetCaches, setupErp, teardownErp, type Env } from './erpHelpers';

let env: Env;
let obj2 = '';
beforeAll(async () => {
  env = await setupErp();
  const { A, B } = env;
  obj2 = String(((await ObjectModel.create({ name: 'Alfa ikkinchi', companyId: A.companyId, budget: 9_000_000 } as any)) as any)._id);
  await ObjectModel.updateOne({ _id: A.objectId }, { $set: { budget: 10_000_000, location: 'Jondor' } });
  await Material.insertMany([
    { objectId: A.objectId, companyId: A.companyId, name: 'Sement M400', needed: 100, sent: 40, remaining: 60, unit: 'qop', price: 65_000 },
    { objectId: obj2, companyId: A.companyId, name: "G'isht", needed: 5000, sent: 5000, remaining: 0, unit: 'dona', price: 1_200 },
    { objectId: B.objectId, companyId: B.companyId, name: 'Beta armatura', needed: 10, sent: 0, remaining: 10, unit: 't' },
  ] as any[]);
  await Transaction.insertMany([
    { type: 'material', status: 'confirmed', projectId: A.objectId, companyId: A.companyId, amount: 1_000_000, date: localDate() },
    { type: 'income', status: 'confirmed', projectId: A.objectId, companyId: A.companyId, amount: 3_000_000, date: localDate() },
    { type: 'material', status: 'confirmed', projectId: B.objectId, companyId: B.companyId, amount: 7_000_000, date: localDate() },
  ] as any[]);
  await Attendance.create({ userId: A.workerId, companyId: A.companyId, date: localDate(), checkIn: new Date().toISOString(), status: 'late' } as any);
}, 120_000);
afterAll(async () => { await teardownErp(env); });
beforeEach(() => resetCaches());

describe('getProjectSummary', () => {
  it("rahbar: moliya bilan (faqat o'z firmasi tranzaksiyalari)", async () => {
    const { A } = env;
    const r = await call(A.ownerId, A.companyId, 'getProjectSummary', { objectId: A.objectId });
    expect(r.result.status).toBe('ok');
    const d: any = r.result.data;
    expect(d.financeIncluded).toBe(true);
    expect(d.finance.spentTotal).toBe(1_000_000);
    expect(d.finance.incomeTotal).toBe(3_000_000);
    expect(d.finance.budgetUsedPercent).toBe(10);
    expect(d.workersAssigned).toBe(2);
    expect(d.presentToday).toBe(1);
    expect(d.materialRequirements).toEqual({ items: 1, notFullySent: 1 });
    expect(d.name).toHaveProperty('untrusted_text');
  });

  it("prorab: o'z obyekti — moliyasiz; begona obyekt — rad", async () => {
    const { A } = env;
    const r = await call(A.prorabId, A.companyId, 'getProjectSummary', { objectId: A.objectId }, { role: 'prorab' });
    expect(r.result.status).toBe('ok');
    expect((r.result.data as any).finance).toBeUndefined();
    expect((r.result.data as any).financeIncluded).toBe(false);
    expect((await call(A.prorabId, A.companyId, 'getProjectSummary', { objectId: obj2 })).result.status).toBe('denied');
  });

  it("ishchi: ro'yxatda faqat biriktirilgan obyekt; boshqa firma ID — not_found", async () => {
    const { A, B } = env;
    const list: any = (await call(A.workerId, A.companyId, 'getProjectSummary')).result.data;
    expect(list.objects).toHaveLength(1);
    expect(list.financeIncluded).toBe(false);
    expect(JSON.stringify(list)).not.toMatch(/budget|spent/);
    expect((await call(A.workerId, A.companyId, 'getProjectSummary', { objectId: obj2 })).result.status).toBe('denied');
    expect((await call(A.ownerId, A.companyId, 'getProjectSummary', { objectId: B.objectId })).result.status).toBe('not_found');
  });

  it("nom bo'yicha qidiruv faqat ko'rinadigan obyektlar ichida", async () => {
    const { A } = env;
    const boss: any = (await call(A.ownerId, A.companyId, 'getProjectSummary', { name: 'alfa' })).result.data;
    expect(boss.candidates).toHaveLength(2);
    const w = await call(A.workerId, A.companyId, 'getProjectSummary', { name: 'ikkinchi' });
    expect(w.result.status).toBe('not_found');
  });
});

describe('getInventoryBalance (Material = talablar, ombor emas)', () => {
  it("prorab: o'z obyekti talablari, narxsiz, ombor emasligi izohi", async () => {
    const { A } = env;
    const r = await call(A.prorabId, A.companyId, 'getInventoryBalance', {}, { role: 'prorab' });
    expect(r.result.status).toBe('ok');
    const d: any = r.result.data;
    expect(d.note).toMatch(/ombor qoldig'i EMAS/);
    expect(r.result.message).toMatch(/ombor qoldig'i emas/);
    expect(d.requirements).toHaveLength(1);
    expect(d.requirements[0]).toMatchObject({ needed: 100, sent: 40, stillNeeded: 60 });
    expect(d.requirements[0].unitPrice).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/Beta armatura/);
  });

  it('rahbar: barcha obyektlar, narx bilan; material nomi bo\'yicha filtr', async () => {
    const { A } = env;
    const d: any = (await call(A.ownerId, A.companyId, 'getInventoryBalance', { material: 'sement' })).result.data;
    expect(d.requirements).toHaveLength(1);
    expect(d.requirements[0].unitPrice).toBe(65_000);
    const all: any = (await call(A.ownerId, A.companyId, 'getInventoryBalance')).result.data;
    expect(all.requirements).toHaveLength(2);
  });

  it("ishchi — kod shifti tufayli rad, hatto sozlamada (validatorni chetlab) berilgan bo'lsa ham", async () => {
    const { A } = env;
    await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { 'tools.byRole': { ishchi: ['getInventoryBalance', 'getMyTasks'] } } });
    resetCaches();
    const r = await call(A.workerId, A.companyId, 'getInventoryBalance');
    expect(r.result.status).toBe('denied');
    await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { 'tools.byRole': {} } });
  });
});

describe('getAttendanceSummary', () => {
  it("ishchi: faqat o'zi (objectId e'tiborsiz)", async () => {
    const { A } = env;
    const d: any = (await call(A.workerId, A.companyId, 'getAttendanceSummary', { objectId: A.objectId })).result.data;
    expect(d.scope).toBe('self');
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].state).toBe('WORKING');
    expect(d.rows[0].late).toBe(true);
  });

  it("rahbar: butun firma, telefon yo'q; boshqa firma xodimlari kirmaydi", async () => {
    const { A } = env;
    const r = await call(A.ownerId, A.companyId, 'getAttendanceSummary');
    const d: any = r.result.data;
    expect(d.scope).toBe('company');
    expect(d.counts.eligible).toBe(3);        // prorab + 2 ishchi
    expect(d.counts.present).toBe(1);
    expect(d.counts.late).toBe(1);
    expect(JSON.stringify(d)).not.toMatch(/\+998|phone|Beta/);
  });

  it('prorab: obyekt doirasi; kelajak sanasi — xato', async () => {
    const { A } = env;
    const d: any = (await call(A.prorabId, A.companyId, 'getAttendanceSummary')).result.data;
    expect(d.scope).toBe('objects');
    expect(d.counts.eligible).toBe(2);
    expect((await call(A.prorabId, A.companyId, 'getAttendanceSummary', { date: '2099-01-01' })).result.status).toBe('error');
  });
});
