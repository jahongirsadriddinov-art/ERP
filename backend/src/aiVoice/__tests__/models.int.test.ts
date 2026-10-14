// AI modellari: unique/partial indekslar (null tuzog'i — review B10), bitta faol qo'ng'iroq, attemptKey.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiJob from '../../models/AiJob';
import AiCallSession from '../../models/AiCallSession';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiActionAudit from '../../models/AiActionAudit';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiReminder from '../../models/AiReminder';
import AiUsageMetrics from '../../models/AiUsageMetrics';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiChannelConnection from '../../models/AiChannelConnection';
import AiConversation from '../../models/AiConversation';
import Notification from '../../models/Notification';
import { newCorrelationId } from '../lib/ids';
import { recordTextUsage, recordUsage } from '../usage';
import { startMongo, stopMongo } from './helpers';

let mongo: MongoMemoryServer;
beforeAll(async () => { mongo = await startMongo(); }, 120_000);
afterAll(async () => { await stopMongo(mongo); });

const dup = async (p: Promise<unknown>) => {
  try { await p; return false; } catch (e: any) { return e?.code === 11000; }
};

const session = (employeeId: string, extra: Record<string, unknown> = {}) => AiCallSession.create({
  companyId: 'c1', employeeId, correlationId: newCorrelationId(), purpose: 'attendance', channel: 'telegram_call', ...extra,
});

const audit = (extra: Record<string, unknown> = {}) => AiActionAudit.create({
  companyId: 'c1', actorUserId: 'u1', actorRole: 'ishchi', channel: 'web', correlationId: newCorrelationId(),
  tool: 't', kind: 'read', status: 'ok', expiresAt: new Date(Date.now() + 86_400_000), ...extra,
});

describe('null tuzog\'i: partial {$type:"string"} indekslar', () => {
  it('AiJob: ikki dedupeKey:null va ikki dedupeKeysiz ish ruxsat, bir xil satr — rad', async () => {
    await AiJob.create({ type: 'x', dedupeKey: null as any });
    await AiJob.create({ type: 'x', dedupeKey: null as any });
    await AiJob.create({ type: 'x' });
    await AiJob.create({ type: 'x' });
    await AiJob.create({ type: 'x', dedupeKey: 'k:1' });
    expect(await dup(AiJob.create({ type: 'x', dedupeKey: 'k:1' }))).toBe(true);
  });

  it('AiAttendanceConfirmation.buttonToken: null ikki marta OK, takroriy token — rad', async () => {
    const base = { companyId: 'c1', date: '2026-10-13', shiftId: 'main', scheduledAt: new Date(), correlationId: newCorrelationId() };
    await AiAttendanceConfirmation.create({ ...base, employeeId: 'e1', buttonToken: null as any });
    await AiAttendanceConfirmation.create({ ...base, employeeId: 'e2', buttonToken: null as any });
    await AiAttendanceConfirmation.create({ ...base, employeeId: 'e3', buttonToken: 'Tok0000001' });
    expect(await dup(AiAttendanceConfirmation.create({ ...base, employeeId: 'e4', buttonToken: 'Tok0000001' }))).toBe(true);
    // bir xodim + sana + smena — bitta tasdiq
    expect(await dup(AiAttendanceConfirmation.create({ ...base, employeeId: 'e1' }))).toBe(true);
  });

  it("AiActionAudit: pending.token va idempotencyKey null'lari to'qnashmaydi", async () => {
    await audit({ pending: { token: null } });
    await audit({ pending: { token: null } });
    await audit({ idempotencyKey: null });
    await audit({ idempotencyKey: null });
    await audit({ pending: { token: 'h1', expiresAt: new Date() } });
    expect(await dup(audit({ pending: { token: 'h1', expiresAt: new Date() } }))).toBe(true);
    await audit({ idempotencyKey: 'ik1' });
    expect(await dup(audit({ idempotencyKey: 'ik1' }))).toBe(true);
    await audit({ companyId: 'c2', idempotencyKey: 'ik1' }); // boshqa firma — mustaqil
  });

  it('AiEmployeeContact.telegram.tgUserId: bitta Telegram identifikatori ikki xodimga bog\'lanmaydi', async () => {
    await AiEmployeeContact.create({ companyId: 'c1', employeeId: 'a', telegram: { tgUserId: null as any } });
    await AiEmployeeContact.create({ companyId: 'c1', employeeId: 'b', telegram: { tgUserId: null as any } });
    await AiEmployeeContact.create({ companyId: 'c1', employeeId: 'c' });
    await AiEmployeeContact.create({ companyId: 'c1', employeeId: 'd', telegram: { tgUserId: '777' } });
    expect(await dup(AiEmployeeContact.create({ companyId: 'c2', employeeId: 'e', telegram: { tgUserId: '777' } }))).toBe(true);
    expect(await dup(AiEmployeeContact.create({ companyId: 'c1', employeeId: 'a' }))).toBe(true);
  });

  it('AiReminder.idempotencyKey: partial unique (firma+egasi bo\'yicha)', async () => {
    const r = { companyId: 'c1', ownerId: 'o', targetUserId: 'o', text: 'x', dueAt: new Date(), correlationId: newCorrelationId() };
    await AiReminder.create({ ...r, idempotencyKey: null as any });
    await AiReminder.create({ ...r, idempotencyKey: null as any });
    await AiReminder.create({ ...r, idempotencyKey: 'a' });
    expect(await dup(AiReminder.create({ ...r, idempotencyKey: 'a' }))).toBe(true);
    await AiReminder.create({ ...r, ownerId: 'o2', idempotencyKey: 'a' });
  });
});

describe('AiCallSession', () => {
  it('bir xodimga ikkinchi FAOL qo\'ng\'iroq rad etiladi; yakunlangach yangisi mumkin', async () => {
    const s1 = await session('emp1');
    expect(await dup(session('emp1', { channel: 'inapp_call', purpose: 'assistant' }))).toBe(true);
    await session('emp2'); // boshqa xodim — ruxsat
    await AiCallSession.updateOne({ _id: s1._id }, { $set: { isActive: false, status: 'completed' } });
    await session('emp1');
    // nofaol sessiyalar ko'p bo'lishi mumkin
    await AiCallSession.updateMany({ employeeId: 'emp1' }, { $set: { isActive: false } });
    await session('emp1');
    expect(await AiCallSession.countDocuments({ employeeId: 'emp1' })).toBe(3);
  });

  it('attemptKey unique (bir urinish ikki marta terilmaydi), attemptKeysiz sessiyalar to\'qnashmaydi', async () => {
    await session('emp10', { attemptKey: 'conf1:0:1' });
    expect(await dup(session('emp11', { attemptKey: 'conf1:0:1' }))).toBe(true);
    await session('emp12', { attemptKey: null });
    await session('emp13');
  });

  it('correlationId unique', async () => {
    const cid = newCorrelationId();
    await session('emp20', { correlationId: cid });
    expect(await dup(session('emp21', { correlationId: cid }))).toBe(true);
  });

  it('resumptionHandle standart holda o\'qilmaydi (select:false)', async () => {
    const s = await session('emp30', { resumptionHandle: 'secret-handle' });
    const r: any = await AiCallSession.findById(s._id).lean();
    expect(r.resumptionHandle).toBeUndefined();
  });
});

describe('boshqa modellar', () => {
  it('AiUsageMetrics: firma+kun+user+provider+model — unique', async () => {
    const row = { companyId: 'c1', day: '2026-10-13', userId: null, provider: 'gemini_live' as const, modelId: 'm' };
    await AiUsageMetrics.create(row);
    expect(await dup(AiUsageMetrics.create(row))).toBe(true);
    await AiUsageMetrics.create({ ...row, userId: 'u1' });
  });

  it('AiAssistantSettings: firma bo\'yicha bitta; timezone faqat Asia/Tashkent', async () => {
    await AiAssistantSettings.create({ companyId: 'cs1' });
    expect(await dup(AiAssistantSettings.create({ companyId: 'cs1' }))).toBe(true);
    await expect(AiAssistantSettings.create({ companyId: 'cs2', timezone: 'Europe/Moscow' as any })).rejects.toThrow();
  });

  it("AiChannelConnection: sessiya maydoni YO'Q, scope+firma+tur unique", async () => {
    expect(AiChannelConnection.schema.path('encryptedSession')).toBeUndefined();
    expect(AiChannelConnection.schema.path('activeCalls')).toBeUndefined();
    await AiChannelConnection.create({ scope: 'platform', companyId: null, type: 'telegram_user' });
    expect(await dup(AiChannelConnection.create({ scope: 'platform', companyId: null, type: 'telegram_user' }))).toBe(true);
  });

  it('AiJob: terminal holat uchun expiresAt TTL indeksi bor', async () => {
    const idx = await AiJob.collection.indexes();
    const ttl = idx.find((i: any) => i.key.expiresAt === 1);
    expect(ttl?.expireAfterSeconds).toBe(0);
    const dedupe = idx.find((i: any) => i.key.dedupeKey === 1);
    expect(dedupe?.unique).toBe(true);
    expect(dedupe?.partialFilterExpression).toEqual({ dedupeKey: { $type: 'string' } });
  });

  it("AiConversation yangi maydonlari va Notification 'ai' turi saqlanadi", async () => {
    const c: any = await AiConversation.create({ userId: 'u1', title: 't', source: 'voice_inapp', sessionId: 's1', correlationId: 'x' });
    expect(c.source).toBe('voice_inapp');
    await expect(AiConversation.create({ userId: 'u1', source: 'fax' as any })).rejects.toThrow();
    const old: any = await AiConversation.create({ userId: 'u2' });
    expect(old.source).toBeUndefined(); // eski yozuvlar — 'chat' deb talqin qilinadi
    const n: any = await Notification.create({ recipientId: 'u1', type: 'ai', title: 'AI', body: 'b' });
    expect(n.type).toBe('ai');
  });
});

describe('usage: provider maydoni (openrouter ham)', () => {
  it("recordTextUsage: OpenRouter usage.cost ishlatiladi; foydalanuvchi + firma jami qatorlari", async () => {
    const at = new Date('2026-10-13T19:30:00Z'); // Toshkentda allaqachon 14-oktabr
    await recordTextUsage({ companyId: 'cu1', userId: 'u1', provider: 'openrouter', model: 'a/model-1', at }, { tokensIn: 100, tokensOut: 50, costUsd: 0.002 });
    await recordTextUsage({ companyId: 'cu1', userId: 'u1', provider: 'openrouter', model: 'a/model-1', at }, { tokensIn: 10, tokensOut: 5, costUsd: 0.001 });
    const rows: any[] = await AiUsageMetrics.find({ companyId: 'cu1' }).sort({ userId: 1 }).lean();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ day: '2026-10-14', provider: 'openrouter', modelId: 'a/model-1', tokensIn: 110, tokensOut: 55, costUsdMicros: 3000 });
    expect(rows.map((r) => r.userId)).toEqual([null, 'u1']);
    // noma'lum provider — 'none' ga tushadi (enum buzilmaydi)
    await recordUsage({ companyId: 'cu2', provider: 'gpt' as any, model: 'm' }, { tokensIn: 1 });
    expect((await AiUsageMetrics.findOne({ companyId: 'cu2' }).lean() as any).provider).toBe('none');
    await expect(AiUsageMetrics.create({ companyId: 'cu3', day: '2026-10-14', provider: 'gpt' as any, modelId: 'm' })).rejects.toThrow();
  });
});
