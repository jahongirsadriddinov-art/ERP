// Bot ilgaklari ulanishi (P1): stub ilgaklar bilan mavjud bot xatti-harakati o'zgarmaydi —
// confirm_checkin, confirm_<txId> catch-all, /ai rejimidan tashqaridagi chiqim (ovoz) oqimi va
// ertalabki eslatma. bot.ts tokensiz import qilib bo'lmaydi (modul darajasida bot yaratadi), shu sabab
// sof guard/dispatch funksiyalari va bot.ts'dagi chaqiruv joylari (manba tartibi) tekshiriladi.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import {
  WORKER_OFFSHIFT_CALLBACK_RE, isAiCallbackData, isAiCommand, dispatchAiCallback, dispatchAiMessage,
  aiSuppressedMorningUserIds, registerBotInstance, getBotInstance, aiBotCommandOf, AI_BOT_COMMANDS,
} from '../bot/botHooks';
import { newCorrelationId } from '../lib/ids';
import { invalidateSettings } from '../settings';
import { startMongo, stopMongo } from './helpers';

const ENV = process.env.AI_VOICE_ENABLED;
const setAi = (on: boolean) => { process.env.AI_VOICE_ENABLED = on ? 'true' : ''; };
afterEach(() => { if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV; });

describe('smena darvozasi regex (callback_query)', () => {
  it("mavjud ruxsatlar saqlangan: confirm_checkin, cancel_checkin, lang_, setlang", () => {
    for (const d of ['confirm_checkin', 'cancel_checkin', 'lang_ru', 'setlang']) expect(WORKER_OFFSHIFT_CALLBACK_RE.test(d)).toBe(true);
  });
  it("ai:a:, ai:o:, ai:r: smenadan tashqarida ham bosiladi; ai:x: — yo'q", () => {
    for (const d of ['ai:a:tok:c', 'ai:o:tok:y', 'ai:r:id:d']) expect(WORKER_OFFSHIFT_CALLBACK_RE.test(d)).toBe(true);
    expect(WORKER_OFFSHIFT_CALLBACK_RE.test('ai:x:tok')).toBe(false);
  });
  it("boshqa tugmalar avvalgidek bloklanadi (confirm_<txId>, confirm_checkout, chiqim)", () => {
    for (const d of ['confirm_665f1c2e9b1e8a0012345678', 'reject_665f1c2e9b1e8a0012345678', 'confirm_checkout', 'expcfm_abc', 'subcheck']) {
      expect(WORKER_OFFSHIFT_CALLBACK_RE.test(d)).toBe(false);
    }
  });
});

describe('isAiCallbackData / isAiCommand', () => {
  it('faqat "ai:" prefiksi', () => {
    expect(isAiCallbackData('ai:a:x')).toBe(true);
    for (const d of ['confirm_checkin', 'confirm_ai:a', 'AI:a', '', undefined, 5]) expect(isAiCallbackData(d)).toBe(false);
  });
  it('/ai buyrug\'i', () => {
    for (const t of ['/ai', '/ai@qurilish_erp_bot', '/ai bugun nima ish bor', '/AI']) expect(isAiCommand(t)).toBe(true);
    for (const t of ['/aim', '/start', 'ai', ' /ai', '/res', undefined]) expect(isAiCommand(t)).toBe(false);
  });
});

describe('dispatchAiCallback', () => {
  it("ai: bo'lmagan ma'lumot — false, javob berilmaydi (confirm_checkin va confirm_<txId> o'z joyiga boradi)", async () => {
    setAi(true);
    for (const data of ['confirm_checkin', 'confirm_665f1c2e9b1e8a0012345678', 'reject_665f1c2e9b1e8a0012345678', 'subcheck', 'expcfm_1']) {
      const answer = vi.fn().mockResolvedValue(true);
      expect(await dispatchAiCallback({ id: 'q1', data, message: { chat: { id: 1, type: 'private' } } }, null, 'uz', answer)).toBe(false);
      expect(answer).not.toHaveBeenCalled();
    }
  });
  it("ai:* — AI o'chiq bo'lsa ham ushlanadi (catch-all'ga tushmaydi) va faqat javob beriladi", async () => {
    setAi(false);
    const answer = vi.fn().mockResolvedValue(true);
    expect(await dispatchAiCallback({ id: 'q2', data: 'ai:a:tok:c' }, { _id: 'u1' }, 'uz', answer)).toBe(true);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith('q2');
  });
  it('ai:* — AI yoqilgan, stub ilgak false → baribir javob beriladi, xato chiqmaydi', async () => {
    setAi(true);
    const answer = vi.fn().mockRejectedValue(new Error('query is too old'));
    expect(await dispatchAiCallback({ id: 'q3', data: 'ai:x:tok' }, { _id: 'u1' }, 'uz', answer)).toBe(true);
    expect(answer).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchAiMessage', () => {
  const voiceMsg = { chat: { id: 77, type: 'private' }, voice: { file_id: 'f1' } };
  const gate = (pending: boolean) => ({ hasOtherPendingState: pending, clearOtherStates: vi.fn(), loadUser: vi.fn().mockResolvedValue({ _id: 'u', language: 'uz' }) });

  it("AI o'chiq: hech narsa ushlanmaydi, foydalanuvchi ham yuklanmaydi (/ai ham)", async () => {
    setAi(false);
    for (const msg of [voiceMsg, { chat: { id: 77, type: 'private' }, text: '/ai' }, { chat: { id: 77, type: 'private' }, text: '125000 sement' }]) {
      const g = gate(false);
      expect(await dispatchAiMessage(msg, g)).toBe(false);
      expect(g.loadUser).not.toHaveBeenCalled();
      expect(g.clearOtherStates).not.toHaveBeenCalled();
    }
  });
  it("AI yoqilgan, /ai rejimidan tashqarida: chiqim ovozli xabari ushlanmaydi (kutilayotgan chiqim kiritish bilan ham)", async () => {
    setAi(true);
    for (const pending of [true, false]) {
      const g = gate(pending);
      expect(await dispatchAiMessage(voiceMsg, g)).toBe(false);
      expect(g.loadUser).not.toHaveBeenCalled();
      expect(g.clearOtherStates).not.toHaveBeenCalled();
    }
  });
  it("guruh chatlari hech qachon ushlanmaydi", async () => {
    setAi(true);
    const g = gate(false);
    expect(await dispatchAiMessage({ chat: { id: -100, type: 'supergroup' }, text: '/ai' }, g)).toBe(false);
    expect(g.loadUser).not.toHaveBeenCalled();
  });
  it("/ai (stub ilgak) — foydalanuvchi yuklanadi, lekin xabar mavjud oqimga qaytadi; holatlar tozalanmaydi", async () => {
    setAi(true);
    const g = gate(true);
    expect(await dispatchAiMessage({ chat: { id: 77, type: 'private' }, text: '/ai' }, g)).toBe(false);
    expect(g.loadUser).toHaveBeenCalledTimes(1);
    expect(g.clearOtherStates).not.toHaveBeenCalled();
  });
  it("/jadval (egasi ish jadvali menyusi) ilgakka command:'schedule' bilan yetadi; boshqa slash-buyruqlar — yo'q", async () => {
    setAi(true);
    const g = gate(false);
    await dispatchAiMessage({ chat: { id: 77, type: 'private' }, text: '/jadval@QurilishBot' }, g);
    expect(g.loadUser).toHaveBeenCalledTimes(1);
    const g2 = gate(false);
    expect(await dispatchAiMessage({ chat: { id: 77, type: 'private' }, text: '/start' }, g2)).toBe(false);
    expect(g2.loadUser).not.toHaveBeenCalled();
    expect(aiBotCommandOf('/jadval')).toBe('schedule');
    expect(aiBotCommandOf('/AI salom')).toBe('ai');
    expect(aiBotCommandOf('/aix')).toBeNull();
    expect(aiBotCommandOf('jadval')).toBeNull();
  });
  it('loadUser xatosi bot oqimini buzmaydi', async () => {
    setAi(true);
    const g = { ...gate(false), loadUser: vi.fn().mockRejectedValue(new Error('db')) };
    expect(await dispatchAiMessage({ chat: { id: 77, type: 'private' }, text: '/ai' }, g)).toBe(false);
  });
});

describe('registerBotInstance', () => {
  it('DI orqali bot obyektini saqlaydi', () => {
    const fake = { sendMessage: vi.fn(), answerCallbackQuery: vi.fn() };
    registerBotInstance(fake);
    expect(getBotInstance()).toBe(fake);
  });
});

describe('aiSuppressedMorningUserIds (ertalabki eslatma, review C8)', () => {
  let mongo: MongoMemoryServer;
  const TODAY = '2026-10-14';
  const A = '665f1c2e9b1e8a00000000a1';  // sozlama: yoqilgan, suppress=true
  const B = '665f1c2e9b1e8a00000000b1';  // suppress=false
  const C = '665f1c2e9b1e8a00000000c1';  // AI firmada o'chiq
  beforeAll(async () => { mongo = await startMongo(); }, 120_000);
  afterAll(async () => { await stopMongo(mongo); });
  beforeEach(async () => {
    invalidateSettings();
    await AiAttendanceConfirmation.deleteMany({});
    await AiAssistantSettings.deleteMany({});
    await AiAssistantSettings.create([
      { companyId: A, enabled: true, attendance: { enabled: true, suppressLegacyMorningReminder: true } },
      { companyId: B, enabled: true, attendance: { enabled: true, suppressLegacyMorningReminder: false } },
      { companyId: C, enabled: false, attendance: { enabled: true, suppressLegacyMorningReminder: true } },
    ] as any[]);
    const conf = (companyId: string, employeeId: string, date = TODAY) => ({
      companyId, employeeId, date, shiftId: 'main', scheduledAt: new Date(), correlationId: newCorrelationId(),
    });
    await AiAttendanceConfirmation.create([
      conf(A, 'wA1'), conf(A, 'wA2', '2026-10-13'), conf(B, 'wB1'), conf(C, 'wC1'),
    ] as any[]);
  });

  it("AI o'chiq — bo'sh to'plam va DB so'rovi yo'q (eslatma avvalgidek hammaga)", async () => {
    setAi(false);
    const spy = vi.spyOn(AiAttendanceConfirmation, 'find');
    const s = await aiSuppressedMorningUserIds(['wA1', 'wB1', 'wC1', 'w0'], TODAY);
    expect(s.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
  it("faqat bugungi tasdiq so'rovi bor va firmasi suppress qilgan xodimlar o'tkazib yuboriladi (bitta $in so'rov)", async () => {
    setAi(true);
    const spy = vi.spyOn(AiAttendanceConfirmation, 'find');
    const s = await aiSuppressedMorningUserIds(['wA1', 'wA2', 'wB1', 'wC1', 'w0'], TODAY);
    expect([...s]).toEqual(['wA1']);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("DB xatosi — bo'sh to'plam (AI buzilsa hech kim eslatmasiz qolmaydi)", async () => {
    setAi(true);
    const spy = vi.spyOn(AiAttendanceConfirmation, 'find').mockImplementation(() => { throw new Error('db down'); });
    expect((await aiSuppressedMorningUserIds(['wA1'], TODAY)).size).toBe(0);
  });
});

// bot.ts'ni import qilib bo'lmaydi — ilgaklar to'g'ri joyda chaqirilishini manba tartibi bilan tekshiramiz.
describe("bot.ts ulanish joylari", () => {
  const src = fs.readFileSync(path.join(__dirname, '../../services/bot.ts'), 'utf8');
  const section = (start: string, end: string) => {
    const i = src.indexOf(start);
    const j = src.indexOf(end, i + start.length);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    return src.slice(i, j);
  };

  it('callback: smena regexi botHooks konstantasi; ai:* obuna darvozasidan keyin, subcheck va confirm_ catch-all\'dan oldin', () => {
    const cb = section("bot.on('callback_query'", "\nexport async function notifyUser");
    expect(cb).toContain('!WORKER_OFFSHIFT_CALLBACK_RE.test(data)');
    const gateIdx = cb.indexOf('enforceSubscriptionGate(chatId, query.from.id, lang)');
    const aiIdx = cb.indexOf('dispatchAiCallback(query, user, lang');
    const subIdx = cb.indexOf("if (data === 'subcheck')");
    const catchAllIdx = cb.indexOf("if (data.startsWith('confirm_') || data.startsWith('reject_'))");
    const checkinIdx = cb.indexOf("if (data === 'confirm_checkin' || data === 'confirm_checkout')");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(aiIdx).toBeGreaterThan(gateIdx);
    expect(subIdx).toBeGreaterThan(aiIdx);
    expect(checkinIdx).toBeGreaterThan(aiIdx);
    expect(catchAllIdx).toBeGreaterThan(aiIdx);
  });

  it("message: AI ilgagi smena darvozasidan keyin, chat/chiqim oqimlaridan oldin; boshqa holat tekshiriladi", () => {
    const m = section("bot.on('message'", "// ─── Inline button handler");
    const shiftIdx = m.indexOf("tb(wLang, 'shiftClosedMsg')");
    const aiIdx = m.indexOf('dispatchAiMessage(msg');
    const chatIdx = m.indexOf('const activeChat = chatSessions.get(chatId)');
    expect(shiftIdx).toBeGreaterThan(-1);
    expect(aiIdx).toBeGreaterThan(shiftIdx);
    expect(chatIdx).toBeGreaterThan(aiIdx);
    expect(m).toContain('hasOtherPendingState: hasPendingChatState(chatId)');
    const pending = section('function hasPendingChatState', '\n}\n');
    for (const k of ['chatSessions', 'pendingCheckinLocation', 'pendingBroadcastChoice', 'pendingLabelEdit', 'pendingExpenseEntry', 'isInRegistration']) {
      expect(pending).toContain(k);
    }
  });

  it("/res AI rejimini ham tozalaydi; /ai buyrug'i faqat AI yoqilganda menyuda", () => {
    expect(section('async function resetChatState', '\n}\n')).toContain('aiBotResetChat(chatId)');
    expect(section('bot.setMyCommands([', ']).catch')).toContain('aiConfig.enabled ? AI_BOT_COMMANDS.map(');
    expect(AI_BOT_COMMANDS.map((c) => c.command)).toEqual(['ai', 'jadval']);
  });

  it('ertalabki eslatma bitta batched filtrni ishlatadi; bot DI orqali beriladi', () => {
    const mr = section('async function sendMorningReminders', '\nasync function sendEveningReminders');
    expect(mr).toContain('aiSuppressedMorningUserIds(workerIds, today)');
    expect(mr.indexOf('aiSuppressedMorningUserIds')).toBeLessThan(mr.indexOf('for (const w of workers)'));
    expect(src).toMatch(/\nregisterBotInstance\(bot\);/);
  });
});
