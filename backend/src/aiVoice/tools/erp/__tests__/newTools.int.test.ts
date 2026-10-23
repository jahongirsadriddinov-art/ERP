// Owner 2026-10-16 tool'lari: listExpenses, getObjectDetails, listEmployees (telefon/maoshsiz),
// getTodayOverview, listPendingApprovals / approveTransaction / rejectTransaction (route qoidalari, faqat
// aniq buyruq bilan — explicitUserDecision), requestCallback (kanal tekshiruvi, aniq sabab, navbat).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../../../services/bot', () => ({ bot: { sendMessage: vi.fn(async () => undefined) }, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('../../../../services/socket', () => ({ emitToUser: vi.fn(), emitToGroup: vi.fn(), emitToCompany: vi.fn(), broadcast: vi.fn() }));
vi.mock('../../../../services/email', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('../../../../services/push', () => ({ sendPushToUser: vi.fn(async () => undefined) }));
const consentMock = vi.hoisted(() => ({ sendConsentRequest: vi.fn(async () => ({ ok: true, messageId: '1' })) }));
vi.mock('../../../bot/consentFlow', () => consentMock);

import Transaction from '../../../../models/Transaction';
import Attendance from '../../../../models/Attendance';
import Material from '../../../../models/Material';
import AuditLog from '../../../../models/AuditLog';
import AiActionAudit from '../../../../models/AiActionAudit';
import AiJob from '../../../../models/AiJob';
import type { ChannelAdapter, ChannelName } from '../../../contracts';
import { clearChannels, registerChannel } from '../../../channels/registry';
import { localDate, zonedParts } from '../../../lib/zonedTime';
import { JobQueue, setSharedQueue } from '../../../queue/jobQueue';
import { executeTool } from '../../executor';
import { CALLBACK_JOB, callbackOrder, parseWhen, runCallback } from '../requestCallback';
import { call, ctxFor, resetCaches, setupErp, teardownErp, type Env } from './erpHelpers';

let env: Env;
const d = localDate();

beforeAll(async () => {
  env = await setupErp();
  const { A, B } = env;
  await Transaction.insertMany([
    { type: 'material', status: 'confirmed', projectId: A.objectId, companyId: A.companyId, amount: 1_000_000, date: d, createdById: A.workerId, description: 'Sement' },
    { type: 'transport', status: 'confirmed', projectId: A.objectId, companyId: A.companyId, amount: 200_000, date: d, createdById: A.prorabId },
    { type: 'oylik', status: 'confirmed', toUserId: A.workerId, companyId: A.companyId, amount: 3_000_000, date: d },
    { type: 'income', status: 'confirmed', companyId: A.companyId, amount: 5_000_000, date: d },
    { type: 'material', status: 'confirmed', companyId: B.companyId, amount: 70_000_000, date: d },
  ] as any[]);
  await Material.create({ objectId: A.objectId, companyId: A.companyId, name: 'Armatura', unit: 'tonna', needed: 5, sent: 3, remaining: 2 } as any);
  await Attendance.create({ userId: A.workerId, companyId: A.companyId, date: d, checkIn: new Date().toISOString(), status: 'present' } as any);
}, 120_000);
afterAll(async () => { setSharedQueue(null); clearChannels(); await teardownErp(env); });
beforeEach(() => resetCaches());

describe('listExpenses', () => {
  it("rahbar — butun firma (maoshsiz, B firmasiz); ishchi — faqat o'zi kiritgani", async () => {
    const { A } = env;
    const boss: any = (await call(A.ownerId, A.companyId, 'listExpenses', { period: 'today' })).result;
    expect(boss.status).toBe('ok');
    expect(boss.data.scope).toBe('company');
    expect(boss.data.total).toEqual({ count: 2, sumExcludingRejected: 1_200_000 });
    expect(JSON.stringify(boss.data)).not.toContain('3000000');
    const w: any = (await call(A.workerId, A.companyId, 'listExpenses', { period: 'today' })).result;
    expect(w.data.scope).toBe('own');
    expect(w.data.total.count).toBe(1);
  });
  it("obyekt nomi kirillda / xato eshitilgan bo'lsa ham topiladi (fuzzy), boshqa firmaniki — yo'q", async () => {
    const { A } = env;
    const r: any = (await call(A.ownerId, A.companyId, 'listExpenses', { period: 'today', objectName: 'Альфа' })).result;
    expect(r.status).toBe('ok');
    expect(r.data.total.count).toBe(2);
    expect((await call(A.ownerId, A.companyId, 'listExpenses', { period: 'today', objectName: 'Beta' })).result.status).toBe('not_found');
  });
});

describe('getObjectDetails', () => {
  it("ishchi o'z obyektini ko'radi (moliyasiz); materiallar va kim kelgani", async () => {
    const { A } = env;
    const r: any = (await call(A.workerId, A.companyId, 'getObjectDetails', { objectId: A.objectId })).result;
    expect(r.status).toBe('ok');
    expect(r.data.financeIncluded).toBe(false);
    expect(r.data.finance).toBeUndefined();
    expect(r.data.materials.items[0]).toMatchObject({ needed: 5, sent: 3, remaining: 2 });
    expect(r.data.workers.presentToday).toBe(1);
  });
  it("rahbarga byudjet/sarf; boshqa firma obyekti — topilmaydi", async () => {
    const { A, B } = env;
    const r: any = (await call(A.ownerId, A.companyId, 'getObjectDetails', { name: 'Alfa' })).result;
    expect(r.data.finance.spent).toBe(1_200_000);
    expect((await call(A.ownerId, A.companyId, 'getObjectDetails', { objectId: B.objectId })).result.status).toBe('not_found');
  });
});

describe('listEmployees', () => {
  it("prorab — o'z obyekti xodimlari; telefon/maosh yo'q; ishchi — rad", async () => {
    const { A } = env;
    const r: any = (await call(A.prorabId, A.companyId, 'listEmployees', {})).result;
    expect(r.status).toBe('ok');
    expect(r.data.total).toBe(2);
    expect(r.data.todayCounts.present).toBe(1);
    const s = JSON.stringify(r.data);
    expect(s).not.toMatch(/\+998|phone|salary|telegram/i);
    expect((await call(A.workerId, A.companyId, 'listEmployees', {})).result.status).toBe('denied');
  });
});

describe('getTodayOverview', () => {
  it('faqat rahbar; bugungi kirim/chiqim va davomat', async () => {
    const { A } = env;
    const r: any = (await call(A.ownerId, A.companyId, 'getTodayOverview')).result;
    expect(r.status).toBe('ok');
    expect(r.data.today.income.sum).toBe(5_000_000);
    expect(r.data.attendance.checkedIn).toBe(1);
    expect((await call(A.prorabId, A.companyId, 'getTodayOverview')).result.status).toBe('denied');
  });
});

describe('tasdiqlash qarorlari', () => {
  const mk = async (x: any) => String(((await Transaction.create({ status: 'pending', date: d, amount: 2_000_000, ...x } as any)) as any)._id);
  const decide = (uid: string, cid: string, name: string, args: any, explicit = true) =>
    executeTool(ctxFor(uid, cid), name, args, { explicitUserDecision: explicit });

  it("listPendingApprovals — faqat men qaror qila oladiganlar; boshqa tasdiqlovchinikini sanaydi", async () => {
    const { A } = env;
    const mine = await mk({ type: 'transport', companyId: A.companyId, requiresAdminApproval: true, approverId: A.ownerId, createdById: A.workerId, description: 'Kran' });
    const other = await mk({ type: 'transport', companyId: A.companyId, requiresAdminApproval: true, approverId: A.orinbosarId, createdById: A.workerId });
    const r: any = (await call(A.ownerId, A.companyId, 'listPendingApprovals')).result;
    const ids = r.data.items.map((i: any) => i.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(other);
    expect(r.data.awaitingOtherApprover).toBeGreaterThanOrEqual(1);
    await Transaction.deleteMany({ _id: { $in: [mine, other] } });
  });

  it("aniq buyruqsiz (masalan, Live ovoz) — bajarilmaydi", async () => {
    const { A } = env;
    const id = await mk({ type: 'transport', companyId: A.companyId, requiresAdminApproval: true, approverId: A.ownerId, createdById: A.workerId });
    const r = await decide(A.ownerId, A.companyId, 'approveTransaction', { transactionId: id }, false);
    expect(r.result.status).toBe('error');
    expect(((await Transaction.findById(id).lean()) as any).status).toBe('pending');
  });

  it("tanlangan tasdiqlovchi — tasdiqlaydi (tarix + AuditLog + AiActionAudit); boshqa admin — rad; qayta — 'allaqachon'", async () => {
    const { A } = env;
    const id = await mk({ type: 'transport', companyId: A.companyId, requiresAdminApproval: true, approverId: A.ownerId, createdById: A.workerId, description: 'Kran' });
    expect((await decide(A.orinbosarId, A.companyId, 'approveTransaction', { transactionId: id })).result.status).toBe('denied');
    const r = await decide(A.ownerId, A.companyId, 'approveTransaction', { transactionId: id, note: 'ok' });
    expect(r.result.status).toBe('ok');
    const tx: any = await Transaction.findById(id).lean();
    expect(tx.status).toBe('confirmed');
    expect(tx.approvalHistory.at(-1)).toMatchObject({ action: 'approved', userId: A.ownerId });
    expect(await AuditLog.countDocuments({ entityId: id, action: 'approve' })).toBeGreaterThanOrEqual(1);
    expect(await AiActionAudit.countDocuments({ companyId: A.companyId, tool: 'approveTransaction', status: 'ok' })).toBe(1);
    expect((await decide(A.ownerId, A.companyId, 'approveTransaction', { transactionId: id })).result.status).toBe('error');
  });

  it("ishchi admin chiqimini tasdiqlay olmaydi; qabul qiluvchi o'ziga kelganini qabul qiladi", async () => {
    const { A } = env;
    const exp = await mk({ type: 'transport', companyId: A.companyId, requiresAdminApproval: true, createdById: A.prorabId });
    expect((await decide(A.workerId, A.companyId, 'approveTransaction', { transactionId: exp })).result.status).toBe('denied');
    const rcv = await mk({ type: 'expense', companyId: A.companyId, toUserId: A.workerId, fromUserId: A.prorabId, description: 'Avans' });
    expect((await decide(A.workerId, A.companyId, 'approveTransaction', { transactionId: rcv })).result.status).toBe('ok');
    expect(((await Transaction.findById(rcv).lean()) as any).confirmedById).toBe(A.workerId);
  });

  it('rad etish — sabab majburiy, tarixga yoziladi; boshqa firma yozuvi — topilmaydi', async () => {
    const { A, B } = env;
    const id = await mk({ type: 'transport', companyId: A.companyId, requiresAdminApproval: true, approverId: A.ownerId, createdById: A.workerId });
    expect((await decide(A.ownerId, A.companyId, 'rejectTransaction', { transactionId: id })).result.status).toBe('error');
    expect((await decide(A.ownerId, A.companyId, 'rejectTransaction', { transactionId: id, reason: 'Qimmat' })).result.status).toBe('ok');
    const tx: any = await Transaction.findById(id).lean();
    expect(tx.status).toBe('rejected');
    expect(tx.approvalHistory.at(-1)).toMatchObject({ action: 'rejected', note: 'Qimmat' });
    const bId = await mk({ type: 'transport', companyId: B.companyId, requiresAdminApproval: true });
    expect((await decide(A.ownerId, A.companyId, 'approveTransaction', { transactionId: bId })).result.status).toBe('not_found');
  });
});

describe('requestCallback', () => {
  const avail: Partial<Record<ChannelName, string | true>> = {};
  const attempts: string[] = [];
  const fake = (name: ChannelName): ChannelAdapter => ({
    name,
    async isAvailable() { const a = avail[name]; return a === true ? { ok: true } : { ok: false, reason: a || 'offline' }; },
    async attempt() { attempts.push(name); return avail[name] === true ? { outcome: 'answered', sessionId: 's1' } as any : { outcome: 'unavailable', errorCode: 'x' } as any; },
  });
  let q: JobQueue;
  beforeAll(() => {
    clearChannels();
    for (const n of ['inapp_call', 'telegram_call', 'bot_message'] as ChannelName[]) registerChannel(fake(n));
    q = new JobQueue({ log: () => undefined });
    setSharedQueue(q);
  });
  beforeEach(async () => { await AiJob.deleteMany({}); attempts.length = 0; consentMock.sendConsentRequest.mockClear(); });

  it('kanal tartibi va vaqt (zonasiz ISO va "HH:MM" — Toshkent)', () => {
    expect(callbackOrder(undefined, 'bot')[0]).toBe('telegram_call');
    expect(callbackOrder(undefined, 'web')[0]).toBe('inapp_call');
    expect(callbackOrder('telegram', 'web')[0]).toBe('telegram_call');
    const now = new Date('2026-10-16T05:00:00Z');                      // 10:00 Toshkent
    expect(parseWhen('2026-10-16T15:30', now)!.toISOString()).toBe('2026-10-16T10:30:00.000Z');
    expect(parseWhen('15:30', now)!.toISOString()).toBe('2026-10-16T10:30:00.000Z');
    expect(parseWhen('09:00', now)!.toISOString()).toBe('2026-10-17T04:00:00.000Z');   // o'tib ketgan — ertaga
    expect(parseWhen('2026-10-16T10:30:00Z', now)!.toISOString()).toBe('2026-10-16T10:30:00.000Z');
    expect(parseWhen('ertaga', now)).toBeNull();
  });

  it("botdan 'Telegramdan 1 minutdan keyin qo'ng'iroq qil' — Telegram mavjud: navbatga, 'qilaman' deydi", async () => {
    const { A } = env;
    avail.telegram_call = true; avail.inapp_call = 'offline';
    const r: any = (await call(A.workerId, A.companyId, 'requestCallback', { channel: 'telegram', delayMinutes: 1 }, { channel: 'bot' })).result;
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/Telegram orqali qo'ng'iroq qilaman/);
    expect(r.message).not.toMatch(/qila olmayman/);
    const job: any = await AiJob.findOne({ type: CALLBACK_JOB }).lean();
    expect(job.employeeId).toBe(A.workerId);
    expect(job.payload.order[0]).toBe('telegram_call');
    expect(new Date(job.runAt).getTime() - Date.now()).toBeGreaterThan(50_000);
  });

  it("Telegram roziligi yo'q, ilova ochiq — ilova orqali qo'ng'iroq, sababini aytadi", async () => {
    const { A } = env;
    avail.telegram_call = 'no_consent'; avail.inapp_call = true;
    const r: any = (await call(A.workerId, A.companyId, 'requestCallback', { channel: 'telegram' }, { channel: 'web' })).result;
    expect(r.status).toBe('ok');
    expect(r.data.channel).toBe('inapp_call');
    expect(r.message).toMatch(/ilova ichida/);
    // Owner 2026-10-16: rozilikni rahbariyat beradi — xodimdan rozilik so'ralmaydi
    expect(r.message).toMatch(/rahbariyat tomonidan o'chirilgan/);
    expect(r.message).not.toMatch(/rozilik|kod/);
    expect(consentMock.sendConsentRequest).not.toHaveBeenCalled();
  });

  it("Telegram ERP botga ulanmagan — botda telefon ulashishni aytadi (bog'lash kodi emas)", async () => {
    const { A } = env;
    avail.telegram_call = 'not_bound'; avail.inapp_call = 'offline';
    const r: any = (await call(A.workerId, A.companyId, 'requestCallback', { channel: 'telegram' }, { channel: 'bot' })).result;
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/ERP botiga telefon raqamingizni ulashing/);
    expect(r.message).not.toMatch(/bog'lash kod/);
  });

  it("hech qaysi kanal yo'q — navbatga qo'ymaydi, ANIQ nima kerakligini aytadi (rozilik so'ralmaydi)", async () => {
    const { A } = env;
    avail.telegram_call = 'no_consent'; avail.inapp_call = 'offline';
    const r: any = (await call(A.workerId, A.companyId, 'requestCallback', {}, { channel: 'bot' })).result;
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/AI qo'ng'iroqlari rahbariyat tomonidan o'chirilgan/);
    expect(r.message).toMatch(/ilovani oching/);
    expect(r.message).not.toMatch(/qila olmayman|rozilik/);
    expect(await AiJob.countDocuments({ type: CALLBACK_JOB })).toBe(0);
    expect(consentMock.sendConsentRequest).not.toHaveBeenCalled();
  });

  it("ish bajarilishi: mavjud kanal orqali qo'ng'iroq; hech biri bo'lmasa — botga sababi", async () => {
    const { A } = env;
    avail.telegram_call = true; avail.inapp_call = 'offline';
    const base = { companyId: A.companyId, employeeId: A.workerId, correlationId: 'c1', lang: 'uz' as const, attemptNo: 1, maxAttempts: 2 };
    expect(await runCallback({ ...base, order: ['inapp_call', 'telegram_call'] }, new Date())).toBe('calling');
    expect(attempts).toEqual(['telegram_call']);
    avail.telegram_call = 'not_bound';
    expect(await runCallback({ ...base, order: ['telegram_call', 'inapp_call'], attemptNo: 2 }, new Date())).toBe('unreachable');
    expect(attempts.at(-1)).toBe('bot_message');
  });

  it("qo'ng'iroq ichida ham ishlaydi (owner 2026-10-18) — kamida 45 s keyin (joriy qo'ng'iroq tugasin)", async () => {
    const { A } = env;
    const r: any = (await call(A.workerId, A.companyId, 'requestCallback', { delayMinutes: 0 }, { channel: 'inapp_call' })).result;
    expect(r.status).not.toBe('denied');
    if (r.status === 'ok') expect(new Date(r.data.scheduledAt).getTime() - Date.now()).toBeGreaterThan(40_000);
    expect(zonedParts(new Date()).date).toBe(d);
  });
});
