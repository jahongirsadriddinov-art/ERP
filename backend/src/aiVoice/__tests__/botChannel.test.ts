// Bot kanali (P4): soxta bot obyekti bilan — sendToUser messageId qaytaradi, 403 → kontakt bloklangan
// (keyingi kanalga), 429 retry_after → retryAt, callback_data ≤64 bayt, boshqa firmaga yuborilmaydi.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../../models/User';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import { botChannel, buttonsValid, classifyTelegramError, sendToUser } from '../channels/botChannel';
import { registerBotInstance } from '../bot/botHooks';
import {
  CALLBACK_DATA_MAX_BYTES, AI_MODE_EXIT_DATA, attendanceKeyboard, callbackFits, confirmKeyboard, consentData, reminderKeyboard,
} from '../bot/guard';
import { TIME_PRESETS } from '../bot/scheduleMenu';
import type { ChannelCtx } from '../contracts';
import { newConfirmToken, newButtonToken, randomBase62 } from '../lib/ids';
import { invalidateSettings } from '../settings';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

const tgErr = (code: number, description: string, retryAfter?: number) => Object.assign(new Error(`ETELEGRAM: ${code} ${description}`), {
  code: 'ETELEGRAM',
  response: { statusCode: code, body: { ok: false, error_code: code, description, ...(retryAfter ? { parameters: { retry_after: retryAfter } } : {}) } },
});

function fakeBot() {
  let n = 100;
  return {
    sendMessage: vi.fn(async (_c: any, _t: string, _o?: any) => ({ message_id: ++n })),
    answerCallbackQuery: vi.fn(async () => true),
    editMessageText: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async () => true),
  };
}

describe('callback_data ≤64 bayt', () => {
  it("barcha AI tugmalari eng uzun token bilan ham sig'adi", () => {
    const all = [
      ...attendanceKeyboard(randomBase62(32), 'uz').flat(),
      ...reminderKeyboard('665f1c2e9b1e8a0012345678', 'ru').flat(),
      ...confirmKeyboard(randomBase62(40), 'uz-cyrl').flat(),
    ].map((b) => b.callback_data);
    all.push(consentData(randomBase62(32), 'y'), AI_MODE_EXIT_DATA, 'ai:s:K:r:20261231', 'ai:s:E:r:20271231', 'ai:s:A:1');
    for (const t of TIME_PRESETS) all.push(`ai:s:T:${t.replace(':', '')}`);
    for (const d of all) {
      expect(callbackFits(d)).toBe(true);
      expect(Buffer.byteLength(d, 'utf8')).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
    }
    // Standart tokenlar bilan ham
    expect(attendanceKeyboard(newButtonToken(), 'uz')[0][0].callback_data).toMatch(/^ai:a:[A-Za-z0-9]{10}:c$/);
    expect(confirmKeyboard(newConfirmToken(), 'uz')[0][1].callback_data).toMatch(/^ai:x:[A-Za-z0-9]{22}:n$/);
  });
  it("bayt bo'yicha o'lchanadi (ko'p baytli belgilar) va 64 dan oshsa rad", () => {
    expect(callbackFits('ai:a:' + 'a'.repeat(59))).toBe(true);
    expect(callbackFits('ai:a:' + 'a'.repeat(60))).toBe(false);
    expect(callbackFits('ai:a:' + 'ш'.repeat(30))).toBe(false);   // 5 + 60 bayt
    expect(buttonsValid([[{ text: 'x', callback_data: 'ai:a:' + 'a'.repeat(60) }]])).toBe(false);
    expect(buttonsValid([[{ text: 'x', url: 'https://t.me/x' }]])).toBe(true);
    expect(buttonsValid([[{ text: 'x', url: 'javascript:alert(1)' }]])).toBe(false);
  });
});

describe('classifyTelegramError', () => {
  it('ETELEGRAM javobidan kod va retry_after', () => {
    expect(classifyTelegramError(tgErr(403, 'Forbidden: bot was blocked by the user'))).toMatchObject({ status: 403 });
    expect(classifyTelegramError(tgErr(429, 'Too Many Requests: retry after 17', 17))).toMatchObject({ status: 429, retryAfterSec: 17 });
    expect(classifyTelegramError(new Error('ETELEGRAM: 429 Too Many Requests: retry after 9'))).toMatchObject({ status: 429, retryAfterSec: 9 });
    expect(classifyTelegramError(new Error('EFATAL: socket hang up')).status).toBeUndefined();
  });
});

describe('botChannel (Mongo)', () => {
  let mongo: MongoMemoryServer;
  let A: SeedCompany, B: SeedCompany;
  let bot: ReturnType<typeof fakeBot>;
  const ENV = process.env.AI_VOICE_ENABLED;
  const now = new Date('2026-10-14T03:00:00Z');
  const ctx = (s: SeedCompany, employeeId: string, extra: Partial<ChannelCtx> = {}): ChannelCtx => ({
    companyId: s.companyId, employeeId, correlationId: 'c1', purpose: 'attendance', lang: 'uz', now, attemptNo: 1, ...extra,
  });

  beforeAll(async () => {
    mongo = await startMongo();
    A = await seedCompany('BcA');
    B = await seedCompany('BcB');
    await User.updateOne({ _id: A.workerId }, { $set: { telegramChatId: '5001', language: 'ru' } });
    await User.updateOne({ _id: A.worker2Id }, { $set: { telegramChatId: '5002' } });
    await User.updateOne({ _id: B.workerId }, { $set: { telegramChatId: '6001' } });
  }, 120_000);
  afterAll(async () => { await stopMongo(mongo); });
  beforeEach(async () => {
    process.env.AI_VOICE_ENABLED = 'true';
    invalidateSettings();
    bot = fakeBot();
    registerBotInstance(bot);
    await AiEmployeeContact.deleteMany({});
  });
  afterEach(() => { if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV; });

  it('sendToUser — messageId qaytaradi; tugmalar inline_keyboard sifatida', async () => {
    const r = await sendToUser(A.workerId, 'salom', { buttons: [[{ text: 'ok', callback_data: 'ai:a:abcdefghij:c' }]] });
    expect(r).toEqual({ ok: true, messageId: '101' });
    expect(bot.sendMessage).toHaveBeenCalledWith('5001', 'salom', expect.objectContaining({ reply_markup: { inline_keyboard: [[{ text: 'ok', callback_data: 'ai:a:abcdefghij:c' }]] } }));
  });

  it('sendToUser — boshqa firma companyId bilan yuborilmaydi; uzun callback_data yuborilmaydi', async () => {
    expect(await sendToUser(B.workerId, 'x', { companyId: A.companyId })).toMatchObject({ ok: false, code: 'no_user' });
    expect(await sendToUser(A.workerId, 'x', { buttons: [[{ text: 'x', callback_data: 'ai:a:' + 'z'.repeat(70) }]] })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('attendance urinishi: token tugmalari, xodim tili (ru), messageId', async () => {
    const r = await botChannel.attempt(ctx(A, A.workerId), { kind: 'attendance', buttonToken: 'Tok0000001' });
    expect(r).toMatchObject({ outcome: 'delivered', messageId: '101' });
    const [chatId, text, opts] = bot.sendMessage.mock.calls[0];
    expect(chatId).toBe('5001');
    expect(text).toContain('Доброе утро');
    const datas = opts.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data);
    expect(datas).toEqual(['ai:a:Tok0000001:c', 'ai:a:Tok0000001:l', 'ai:a:Tok0000001:d']);
    // Token yo'q — yuborilmaydi
    expect(await botChannel.attempt(ctx(A, A.workerId), { kind: 'attendance' })).toMatchObject({ outcome: 'failed', retryable: false, errorCode: 'missing_button_token' });
  });

  it('403 → kontakt bloklangan, unavailable; 24 soat ichida isAvailable=false; keyingi muvaffaqiyat belgini tozalaydi', async () => {
    bot.sendMessage.mockRejectedValueOnce(tgErr(403, 'Forbidden: bot was blocked by the user'));
    const r = await botChannel.attempt(ctx(A, A.worker2Id), { kind: 'test', text: 'salom' });
    expect(r).toMatchObject({ outcome: 'unavailable', retryable: false, errorCode: 'bot_blocked' });
    const ct: any = await AiEmployeeContact.findOne({ companyId: A.companyId, employeeId: A.worker2Id }).lean();
    expect(ct.botBlockedAt).toBeInstanceOf(Date);
    const at = new Date(ct.botBlockedAt.getTime() + 3600_000);
    expect(await botChannel.isAvailable(ctx(A, A.worker2Id, { now: at }))).toEqual({ ok: false, reason: 'bot_blocked' });
    expect((await botChannel.isAvailable(ctx(A, A.worker2Id, { now: new Date(at.getTime() + 24 * 3600_000) }))).ok).toBe(true);
    expect((await sendToUser(A.worker2Id, 'qaytdingizmi')).ok).toBe(true);
    const ct2: any = await AiEmployeeContact.findOne({ companyId: A.companyId, employeeId: A.worker2Id }).lean();
    expect(ct2.botBlockedAt).toBeUndefined();
  });

  it('429 retry_after → failed + retryable + retryAt = now + retry_after', async () => {
    bot.sendMessage.mockRejectedValueOnce(tgErr(429, 'Too Many Requests: retry after 17', 17));
    const r = await botChannel.attempt(ctx(A, A.workerId), { kind: 'attendance', buttonToken: 'Tok0000002' });
    expect(r.outcome).toBe('failed');
    expect(r.retryable).toBe(true);
    expect(r.errorCode).toBe('rate_limited');
    expect(r.retryAt?.getTime()).toBe(now.getTime() + 17_000);
  });

  it("tarmoq xatosi — qayta urinish mumkin; 400 chat not found — unavailable", async () => {
    bot.sendMessage.mockRejectedValueOnce(new Error('EFATAL: socket hang up'));
    expect(await botChannel.attempt(ctx(A, A.workerId), { kind: 'test', text: 'x' })).toMatchObject({ outcome: 'failed', retryable: true });
    bot.sendMessage.mockRejectedValueOnce(tgErr(400, 'Bad Request: chat not found'));
    expect(await botChannel.attempt(ctx(A, A.workerId), { kind: 'test', text: 'x' })).toMatchObject({ outcome: 'unavailable', errorCode: 'chat_not_found' });
  });

  it("boshqa firma xodimi, Telegram'siz xodim, AI o'chiq — unavailable (yuborilmaydi)", async () => {
    expect((await botChannel.attempt(ctx(A, B.workerId), { kind: 'test', text: 'x' })).outcome).toBe('unavailable');
    expect(await botChannel.isAvailable(ctx(A, A.prorabId))).toEqual({ ok: false, reason: 'no_chat' });
    process.env.AI_VOICE_ENABLED = '';
    expect(await botChannel.isAvailable(ctx(A, A.workerId))).toEqual({ ok: false, reason: 'disabled' });
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it("eslatma: ai:r tugmalari reminderId bilan; opt-out (eslatmalar) — unavailable", async () => {
    const rid = '665f1c2e9b1e8a0012345678';
    const r = await botChannel.attempt(ctx(A, A.workerId, { purpose: 'reminder', reminderId: rid }), { kind: 'reminder', text: 'Sement buyurtma' });
    expect(r.outcome).toBe('delivered');
    const opts = bot.sendMessage.mock.calls[0][2];
    expect(opts.reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data)).toEqual([`ai:r:${rid}:d`, `ai:r:${rid}:s`]);
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.workerId, optOut: { reminders: true } } as any);
    expect(await botChannel.isAvailable(ctx(A, A.workerId, { purpose: 'reminder' }))).toEqual({ ok: false, reason: 'opt_out' });
  });
});
