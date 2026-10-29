// Eslatma tool'lari: o'ziga — tasdiqsiz; boshqaga — faqat rahbar, faqat shu firma, HAR DOIM tugma
// tasdig'i; boshqa odamning eslatmasini o'zgartirish/bekor qilish ham tasdiq talab qiladi; Toshkent vaqti;
// takrorlanish (weekly) birinchi mos kun; idempotentlik; izolyatsiya.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import AiReminder from '../../../../models/AiReminder';
import { addDays, isoWeekdayOf, localDate, zonedParts, zonedToUtc } from '../../../lib/zonedTime';
import { confirmPendingAction, executeTool } from '../../executor';
import { firstFutureOccurrence, normalizeRecurrence } from '../recurrence';
import { call, ctxFor, resetCaches, setupErp, teardownErp, type Env } from './erpHelpers';

let env: Env;
const tomorrow = () => addDays(localDate(), 1);
beforeAll(async () => { env = await setupErp(); }, 120_000);
afterAll(async () => { await teardownErp(env); });
beforeEach(async () => { resetCaches(); await AiReminder.deleteMany({}); });

describe('createReminder', () => {
  it("o'ziga: darhol yaratiladi (Toshkent vaqti); bir sessiyada takror — ikkinchi yozuv yo'q", async () => {
    const { A } = env;
    const ctx = ctxFor(A.workerId, A.companyId);
    const args = { text: 'Sement buyurtma qilish', date: tomorrow(), time: '09:30' };
    const r = await executeTool(ctx, 'createReminder', args);
    expect(r.result.status).toBe('ok');
    const docs: any[] = await AiReminder.find({ companyId: A.companyId }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].targetUserId).toBe(A.workerId);
    expect(docs[0].ownerId).toBe(A.workerId);
    expect(new Date(docs[0].nextFireAt).toISOString()).toBe(zonedToUtc(tomorrow(), '09:30').toISOString());
    expect(docs[0].createdVia).toBe('ui');
    const again = await executeTool({ ...ctx, correlationId: ctx.correlationId }, 'createReminder', args);
    expect(again.result.status).toBe('ok');
    expect(await AiReminder.countDocuments({ companyId: A.companyId })).toBe(1);
  });

  it("o'tgan vaqt — xato; weekly — birinchi mos hafta kuni", async () => {
    const { A } = env;
    expect((await call(A.workerId, A.companyId, 'createReminder', { text: 'x', date: addDays(localDate(), -1), time: '09:00' })).result.status).toBe('error');
    const start = tomorrow();
    const wd = isoWeekdayOf(addDays(start, 2));
    const r = await call(A.workerId, A.companyId, 'createReminder', { text: 'Hisobot', date: start, time: '18:00', recurrence: 'weekly', weekdays: [wd] });
    expect(r.result.status).toBe('ok');
    const doc: any = await AiReminder.findOne({ companyId: A.companyId }).lean();
    expect(zonedParts(new Date(doc.nextFireAt)).date).toBe(addDays(start, 2));
    expect(doc.recurrence.freq).toBe('weekly');
    expect(doc.recurrence.byWeekday).toEqual([wd]);
  });

  it('ishchi boshqa xodimga: tasdiq talab qilinadi, tasdiqlansa ham handler rad etadi — yozuv yo\'q', async () => {
    const { A } = env;
    const ctx = ctxFor(A.workerId, A.companyId);
    const r = await executeTool(ctx, 'createReminder', { text: 'x', date: tomorrow(), time: '10:00', targetUserId: A.worker2Id });
    expect(r.result.status).toBe('needs_confirmation');
    expect(await AiReminder.countDocuments({})).toBe(0);
    const c = await confirmPendingAction({ pendingActionId: r.result.pendingActionId, actorUserId: A.workerId, companyId: A.companyId, channel: 'web', accept: true });
    expect(c.result.status).toBe('denied');
    expect(await AiReminder.countDocuments({})).toBe(0);
  });

  it("rahbar boshqa xodimga: avval tasdiq, keyin yaratiladi; boshqa firma xodimiga — not_found", async () => {
    const { A, B } = env;
    const r = await call(A.ownerId, A.companyId, 'createReminder', { text: 'Kaska kiying', date: tomorrow(), time: '07:45', targetUserId: A.workerId });
    expect(r.result.status).toBe('needs_confirmation');
    expect(r.pending?.summary).toMatch(/boshqa xodim/);
    // Tasdiqlovchi NIMA va KIMGA ekanini ko'radi (matn + xodim ismi)
    expect(r.pending?.summary).toContain('Kaska kiying');
    expect(r.pending?.summary).toMatch(/→ .*-ishchi/);
    expect(await AiReminder.countDocuments({})).toBe(0);
    const c = await confirmPendingAction({ pendingActionId: r.result.pendingActionId, actorUserId: A.ownerId, companyId: A.companyId, channel: 'web', accept: true });
    expect(c.result.status).toBe('ok');
    const doc: any = await AiReminder.findOne({}).lean();
    expect(doc).toMatchObject({ ownerId: A.ownerId, targetUserId: A.workerId, companyId: A.companyId });
    expect((await call(A.ownerId, A.companyId, 'createReminder', { text: 'x', date: tomorrow(), time: '10:00', targetUserId: B.workerId })).result.status).toBe('not_found');
  });

  it('bot kanalida tasdiq bot tugmasi (token) orqali', async () => {
    const { A } = env;
    const r = await call(A.ownerId, A.companyId, 'createReminder', { text: 'x', date: tomorrow(), time: '10:00', targetUserId: A.workerId }, { channel: 'telegram_call' });
    expect(r.result.status).toBe('needs_confirmation');
    expect(r.pending?.confirmVia).toBe('bot');
    expect(r.pending?.token).toBeTruthy();
  });
});

describe('updateReminder / cancelReminder / listReminders', () => {
  async function seedRem(owner: string, target: string, companyId: string) {
    return String(((await AiReminder.create({
      companyId, ownerId: owner, targetUserId: target, text: 'Eslatma', dueAt: zonedToUtc(tomorrow(), '09:00'),
      nextFireAt: zonedToUtc(tomorrow(), '09:00'), status: 'active', correlationId: 'c',
    } as any)) as any)._id);
  }

  it("o'zinikini o'zgartiradi va bekor qiladi; boshqa ishchi — rad", async () => {
    const { A } = env;
    const id = await seedRem(A.workerId, A.workerId, A.companyId);
    const u = await call(A.workerId, A.companyId, 'updateReminder', { reminderId: id, time: '11:15' });
    expect(u.result.status).toBe('ok');
    const doc: any = await AiReminder.findById(id).lean();
    expect(zonedParts(new Date(doc.nextFireAt)).hhmm).toBe('11:15');
    expect((await call(A.worker2Id, A.companyId, 'cancelReminder', { reminderId: id })).result.status).toBe('denied');
    expect((await call(A.workerId, A.companyId, 'cancelReminder', { reminderId: id })).result.status).toBe('ok');
    expect(((await AiReminder.findById(id).lean()) as any).status).toBe('cancelled');
    expect((await call(A.workerId, A.companyId, 'cancelReminder', { reminderId: id })).result.status).toBe('error');
  });

  it("rahbar xodim eslatmasini: targetUserId'siz — xato (ID ko'rsatiladi), bilan — tasdiq kerak", async () => {
    const { A } = env;
    const id = await seedRem(A.ownerId, A.workerId, A.companyId);
    const no = await call(A.ownerId, A.companyId, 'cancelReminder', { reminderId: id });
    expect(no.result.status).toBe('error');
    expect(no.result.message).toContain(A.workerId);
    const yes = await call(A.ownerId, A.companyId, 'cancelReminder', { reminderId: id, targetUserId: A.workerId });
    expect(yes.result.status).toBe('needs_confirmation');
    expect(((await AiReminder.findById(id).lean()) as any).status).toBe('active');
  });

  it('boshqa firma eslatmasi — not_found', async () => {
    const { A, B } = env;
    const id = await seedRem(B.workerId, B.workerId, B.companyId);
    expect((await call(A.ownerId, A.companyId, 'updateReminder', { reminderId: id, text: 'hack' })).result.status).toBe('not_found');
  });

  it("listReminders: ishchi — o'ziniki, company scope — rad; rahbar — butun firma, matn untrusted", async () => {
    const { A, B } = env;
    await seedRem(A.workerId, A.workerId, A.companyId);
    await seedRem(A.ownerId, A.worker2Id, A.companyId);
    await seedRem(B.workerId, B.workerId, B.companyId);
    const mine: any = (await call(A.workerId, A.companyId, 'listReminders')).result.data;
    expect(mine.reminders).toHaveLength(1);
    expect(mine.reminders[0].text).toHaveProperty('untrusted_text');
    expect((await call(A.workerId, A.companyId, 'listReminders', { scope: 'company' })).result.status).toBe('denied');
    const all: any = (await call(A.ownerId, A.companyId, 'listReminders', { scope: 'company' })).result.data;
    expect(all.reminders).toHaveLength(2);
  });
});

describe('recurrence (mahalliy yordamchi)', () => {
  it("weekdays = Du–Sha; o'tgan vaqt keyingi kunga suriladi (takroriy ham, bir martalik ham)", () => {
    const today = localDate();
    expect(normalizeRecurrence('weekdays', undefined, today).byWeekday).toEqual([1, 2, 3, 4, 5, 6]);
    const now = zonedToUtc(today, '12:00');
    const daily = firstFutureOccurrence(today, '08:00', normalizeRecurrence('daily', undefined, today), now);
    expect(zonedParts(daily!).date).toBe(addDays(today, 1));
    // Owner 2026-10-29: kechqurun "soat 8 da eslat" deyilsa model BUGUNGI sanani yuboradi va
    // eslatma "vaqt o'tgan" deb rad etilardi. Odam buni "ertaga 8 da" deb tushunadi.
    const once = firstFutureOccurrence(today, '08:00', normalizeRecurrence('none', undefined, today), now);
    expect(zonedParts(once!).date).toBe(addDays(today, 1));
  });

  it("aniq O'TGAN sana berilsa — baribir null (niyat noaniq emas)", () => {
    const today = localDate();
    const now = zonedToUtc(today, '12:00');
    const yesterday = addDays(today, -1);
    expect(firstFutureOccurrence(yesterday, '08:00', normalizeRecurrence('none', undefined, yesterday), now)).toBeNull();
  });
});
