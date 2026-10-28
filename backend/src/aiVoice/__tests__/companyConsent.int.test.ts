// Owner 2026-10-16: kompaniya darajasidagi rozilik (yagona yordamchi) va Telegram id'ni ERP bot bog'lanishidan olish.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import User from '../../models/User';
import { companyConsentOf, evaluateCallConsent, getCallConsent } from '../consent';
import { defaultSettings, invalidateSettings, mergeDefaults } from '../settings';
import { backfillTgLinks, botLinkedTgId, ensureContactTgUserId, findEmployeeByTgId, onBotLinked } from '../telegram/tgLink';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany;
let B: SeedCompany;

beforeAll(async () => {
  mongo = await startMongo();
  await AiEmployeeContact.init();
  A = await seedCompany('CcA');
  B = await seedCompany('CcB');
}, 120_000);

afterEach(async () => {
  await AiEmployeeContact.deleteMany({});
  await User.updateMany({}, { $unset: { telegramChatId: 1, telegramUserId: 1 } });
  await AiAssistantSettings.updateMany({}, { $unset: { 'calls.companyConsent': 1 } });
  invalidateSettings();
});

afterAll(async () => { await stopMongo(mongo); });

describe('samarali rozilik (sof qaror)', () => {
  it('kompaniya roziligi YOKI eski shaxsiy, minus opt-out; kiruvchida faqat optOut.all', () => {
    expect(evaluateCallConsent(true, null)).toEqual({ allowed: true, source: 'company' });
    expect(evaluateCallConsent(true, { telegram: { callConsent: 'revoked' } }).allowed).toBe(true);
    expect(evaluateCallConsent(false, null)).toEqual({ allowed: false, reason: 'no_consent' });
    expect(evaluateCallConsent(false, { telegram: { callConsent: 'requested' } }).reason).toBe('no_consent');
    expect(evaluateCallConsent(false, { telegram: { callConsent: 'granted' } })).toEqual({ allowed: true, source: 'personal' });
    expect(evaluateCallConsent(true, { optOut: { calls: true } })).toEqual({ allowed: false, reason: 'opt_out' });
    expect(evaluateCallConsent(true, { optOut: { all: true } }).reason).toBe('opt_out');
    expect(evaluateCallConsent(true, { optOut: { calls: true } }, { incoming: true }).allowed).toBe(true);
    expect(evaluateCallConsent(true, { optOut: { all: true } }, { incoming: true }).allowed).toBe(false);
    // Xodim o'zi qo'ng'iroq qilsa — firma roziligi shart emas (nomer terish = rozilik)
    expect(evaluateCallConsent(false, null, { incoming: true }).allowed).toBe(true);
    expect(evaluateCallConsent(false, { optOut: { calls: true } }, { incoming: true }).allowed).toBe(true);
    expect(evaluateCallConsent(false, { optOut: { all: true } }, { incoming: true }).reason).toBe('opt_out');
  });

  it('sozlama: standart true, eski hujjatda maydon yo\'q — true; faqat boolean', () => {
    expect(defaultSettings('x').calls.companyConsent).toBe(true);
    expect(mergeDefaults('x', { calls: {} }).calls.companyConsent).toBe(true);
    expect(mergeDefaults('x', { calls: { companyConsent: false } }).calls.companyConsent).toBe(false);
    expect(mergeDefaults('x', { calls: { companyConsent: 'no' } }).calls.companyConsent).toBe(true);
    expect(companyConsentOf(undefined)).toBe(true);
    expect(companyConsentOf({ calls: { companyConsent: false } })).toBe(false);
  });

  it('getCallConsent: firma sozlamasi va kontakt DB\'dan', async () => {
    expect(await getCallConsent(A.companyId, A.workerId)).toMatchObject({ allowed: true, source: 'company' });
    await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { 'calls.companyConsent': false } });
    invalidateSettings();
    expect(await getCallConsent(A.companyId, A.workerId)).toMatchObject({ allowed: false, reason: 'no_consent' });
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, telegram: { callConsent: 'granted' } } as any);
    expect(await getCallConsent(A.companyId, A.workerId)).toMatchObject({ allowed: true, source: 'personal' });
    // Boshqa firma ta'sirlanmaydi
    expect(await getCallConsent(B.companyId, B.workerId)).toMatchObject({ allowed: true, source: 'company' });
  });
});

describe("Telegram id — ERP bot bog'lanishidan (kod shart emas)", () => {
  it('botLinkedTgId: telegramUserId ustun; shaxsiy chat id; guruh (manfiy) va bo\'sh — yo\'q', () => {
    expect(botLinkedTgId({ telegramChatId: '12345' })).toBe('12345');
    expect(botLinkedTgId({ telegramChatId: '12345', telegramUserId: '777' })).toBe('777');
    expect(botLinkedTgId({ telegramChatId: '-100123' })).toBeUndefined();
    expect(botLinkedTgId({ telegramChatId: '' })).toBeUndefined();
    expect(botLinkedTgId(null)).toBeUndefined();
  });

  it('ensureContactTgUserId: backfill (resolveStatus unknown), bog\'lanish o\'zgarsa yangilanadi, bog\'lanmagan — undefined', async () => {
    expect(await ensureContactTgUserId(A.companyId, A.workerId)).toBeUndefined();
    await User.updateOne({ _id: A.workerId }, { $set: { telegramChatId: '9100001' } });
    expect(await ensureContactTgUserId(A.companyId, A.workerId)).toBe('9100001');
    let ct: any = await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean();
    expect(ct.telegram).toMatchObject({ tgUserId: '9100001', resolveStatus: 'unknown' });
    await AiEmployeeContact.updateOne({ employeeId: A.workerId }, { $set: { 'telegram.resolveStatus': 'resolved' } });
    expect(await ensureContactTgUserId(A.companyId, A.workerId)).toBe('9100001');
    ct = await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean();
    expect(ct.telegram.resolveStatus).toBe('resolved');                    // o'zgarmagan — qayta aniqlanmaydi
    await User.updateOne({ _id: A.workerId }, { $set: { telegramChatId: '9100002' } });
    expect(await ensureContactTgUserId(A.companyId, A.workerId)).toBe('9100002');
    ct = await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean();
    expect(ct.telegram).toMatchObject({ tgUserId: '9100002', resolveStatus: 'unknown' });
  });

  it("bitta Telegram id ↔ bitta xodim: amaldagi egasi bor — konflikt; eskirgan egasi — undan olinadi", async () => {
    await AiEmployeeContact.create({ companyId: B.companyId, employeeId: B.workerId, telegram: { tgUserId: '9200001' } } as any);
    await User.updateOne({ _id: B.workerId }, { $set: { telegramChatId: '9200001' } });
    await User.updateOne({ _id: A.workerId }, { $set: { telegramUserId: '9200001' } });
    expect(await ensureContactTgUserId(A.companyId, A.workerId)).toBeUndefined();
    expect((await AiEmployeeContact.findOne({ employeeId: B.workerId }).lean() as any).telegram.tgUserId).toBe('9200001');
    // B xodimining bot bog'lanishi o'zgardi — eski yozuv eskirgan
    await User.updateOne({ _id: B.workerId }, { $set: { telegramChatId: '9200999' } });
    expect(await ensureContactTgUserId(A.companyId, A.workerId)).toBe('9200001');
    expect((await AiEmployeeContact.findOne({ employeeId: B.workerId }).lean() as any).telegram.tgUserId).toBeUndefined();
  });

  it('onBotLinked (bot telefon ulashganda) darhol yozadi; dasturchi va firmasizlar e\'tiborsiz', async () => {
    await User.updateOne({ _id: A.prorabId }, { $set: { telegramChatId: '9300001' } });
    await onBotLinked(A.prorabId);
    expect((await AiEmployeeContact.findOne({ employeeId: A.prorabId }).lean() as any).telegram.tgUserId).toBe('9300001');
    const dev: any = await User.create({ firstName: 'DevCc', phone: '+998900071001', role: 'dasturchi', telegramChatId: '9300002' } as any);
    await onBotLinked(String(dev._id));
    expect(await AiEmployeeContact.countDocuments({ employeeId: String(dev._id) })).toBe(0);
    await onBotLinked('not-an-id');
  });

  it("backfillTgLinks: ERP botga bog'langan barcha xodimlar (kontakt yo'q bo'lsa ham)", async () => {
    await User.updateOne({ _id: A.worker2Id }, { $set: { telegramChatId: '9400001' } });
    await User.updateOne({ _id: B.prorabId }, { $set: { telegramChatId: '9400002' } });
    expect(await backfillTgLinks()).toBe(2);
    expect(await backfillTgLinks()).toBe(0);                                // idempotent
    expect((await AiEmployeeContact.findOne({ employeeId: B.prorabId }).lean() as any)).toMatchObject({ companyId: B.companyId, telegram: { tgUserId: '9400002' } });
  });

  it('findEmployeeByTgId: kontakt yo\'q — bot bog\'lanishidan topadi va backfill; eski kod-bog\'lanish faqat bot bog\'lanishi yo\'q bo\'lsa', async () => {
    await User.updateOne({ _id: A.workerId }, { $set: { telegramChatId: '9500001' } });
    expect(await findEmployeeByTgId('9500001')).toEqual({ companyId: A.companyId, employeeId: A.workerId });
    expect((await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean() as any).telegram.tgUserId).toBe('9500001');
    // Eski kod bilan bog'langan, botga bog'lanmagan xodim — qabul
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.worker2Id, telegram: { tgUserId: '9500002' } } as any);
    expect(await findEmployeeByTgId('9500002')).toEqual({ companyId: A.companyId, employeeId: A.worker2Id });
    // Xodim botga boshqa Telegram bilan bog'langan — eski id endi uniki emas
    await User.updateOne({ _id: A.worker2Id }, { $set: { telegramChatId: '9500003' } });
    expect(await findEmployeeByTgId('9500002')).toBeNull();
    expect(await findEmployeeByTgId('123')).toBeNull();
    expect(await findEmployeeByTgId('abc')).toBeNull();
  });
});
