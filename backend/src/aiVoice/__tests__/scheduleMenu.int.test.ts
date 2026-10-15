// Ish jadvali bot menyusi (owner decision 2026-10-13): egasi vaqt / hafta kunlari / sanalarni o'rnatadi va
// AI'ni yoqadi; ishchi va boshqa firma o'zgartira olmaydi; noto'g'ri sanalar rad; saqlangan sozlama
// sayt (settings.updateSchedule) saqlaganiga AYNAN teng; har saqlash audit yozuvi.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../../models/User';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiActionAudit from '../../models/AiActionAudit';
import AuditLog from '../../models/AuditLog';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import { dispatchAiCallback, dispatchAiMessage, registerBotInstance, aiBotInAiMode, aiBotResetChat } from '../bot/botHooks';
import { __scheduleDrafts, draftPatch, parseUserDates, parseUserTime } from '../bot/scheduleMenu';
import { getSettingsFresh, invalidateSettings, updateSchedule, __setSettingsCacheTtlForTests } from '../settings';
import { addDays, localDate } from '../lib/zonedTime';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany, B: SeedCompany, N: SeedCompany;
const ENV = process.env.AI_VOICE_ENABLED;
const CHAT: Record<string, number> = {};

function fakeBot() {
  let n = 100;
  return {
    sendMessage: vi.fn(async (_c: any, _t: string, _o?: any) => ({ message_id: ++n })),
    answerCallbackQuery: vi.fn(async (_id: string, _o?: any) => true),
    editMessageText: vi.fn(async (_t: string, _o?: any) => true),
    editMessageReplyMarkup: vi.fn(async () => true),
  };
}
let bot: ReturnType<typeof fakeBot>;

const lastMenu = () => {
  const edits = bot.editMessageText.mock.calls.map((c, i) => ({ at: bot.editMessageText.mock.invocationCallOrder[i], text: String(c[0]), kb: c[1]?.reply_markup?.inline_keyboard }));
  const sends = bot.sendMessage.mock.calls.map((c, i) => ({ at: bot.sendMessage.mock.invocationCallOrder[i], text: String(c[1]), kb: c[2]?.reply_markup?.inline_keyboard }));
  return [...sends, ...edits].filter((m) => m.kb?.length).sort((x, y) => x.at - y.at).at(-1);
};
const datas = (kb: any[][] | undefined) => (kb || []).flat().map((b: any) => b.callback_data);
const alerts = () => bot.answerCallbackQuery.mock.calls.map((c) => String(c[1]?.text || ''));

let qn = 0;
async function press(userId: string, data: string) {
  const user: any = await User.findById(userId).lean();
  const chatId = CHAT[userId];
  const q = { id: `s${++qn}`, data, from: { id: chatId }, message: { message_id: 42, text: 'menyu', chat: { id: chatId, type: 'private' } } };
  return dispatchAiCallback(q, user, user?.language, vi.fn(async () => true));
}
async function say(userId: string, text: string, pending = false) {
  const chatId = CHAT[userId];
  return dispatchAiMessage({ chat: { id: chatId, type: 'private' }, from: { id: chatId }, text }, {
    hasOtherPendingState: pending, clearOtherStates: vi.fn(), loadUser: () => User.findById(userId).lean(),
  });
}
const shiftOf = async (s: SeedCompany) => (await getSettingsFresh(s.companyId)).attendance.shifts[0];
const strip = (sh: any) => JSON.parse(JSON.stringify(sh));

beforeAll(async () => {
  mongo = await startMongo();
  A = await seedCompany('ScA');
  B = await seedCompany('ScB');
  N = await seedCompany('ScN', { feature: false });
  let chat = 9100;
  for (const s of [A, B, N]) {
    for (const id of [s.ownerId, s.orinbosarId, s.prorabId, s.workerId]) {
      CHAT[id] = ++chat;
      await User.updateOne({ _id: id }, { $set: { telegramChatId: String(chat) } });
    }
  }
  __setSettingsCacheTtlForTests(0);
}, 120_000);
afterAll(async () => { __setSettingsCacheTtlForTests(10_000); await stopMongo(mongo); });
beforeEach(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  bot = fakeBot();
  registerBotInstance(bot);
  __scheduleDrafts().clear();
  await AiActionAudit.deleteMany({});
  for (const s of [A, B]) {
    await AiAssistantSettings.deleteMany({ companyId: s.companyId });
    await AiAssistantSettings.create({ companyId: s.companyId, enabled: true });
  }
  invalidateSettings();
});
afterEach(() => { if (ENV === undefined) delete process.env.AI_VOICE_ENABLED; else process.env.AI_VOICE_ENABLED = ENV; });

describe('kiritishni tahlil qilish', () => {
  const today = '2026-10-14';
  it('vaqt: HH:MM / H:MM / HH.MM; noto\'g\'ri rad', () => {
    expect(parseUserTime('7:45')).toBe('07:45');
    expect(parseUserTime(' 08.30 ')).toBe('08:30');
    for (const b of ['24:00', '7:5', '0745', 'abc', '', '12:60']) expect(parseUserTime(b)).toBeNull();
  });
  it("sana: DD.MM (o'tgan bo'lsa keyingi yil), DD.MM.YYYY; mavjud bo'lmagan / o'tgan / 2 yildan uzoq rad", () => {
    expect(parseUserDates('25.12, 03.01.2027 1/5', today)).toEqual({ ok: ['2026-12-25', '2027-01-03', '2027-05-01'], bad: [] });
    expect(parseUserDates('14.10', today).ok).toEqual(['2026-10-14']);
    expect(parseUserDates('13.10', today).ok).toEqual(['2027-10-13']);
    const r = parseUserDates('31.02.2027 32.13 abc 01.01.2020 01.01.2030 13.10.2026', today);
    expect(r.ok).toEqual([]);
    expect(r.bad).toEqual(['31.02.2027', '32.13', 'abc', '01.01.2020', '01.01.2030', '13.10.2026']);
  });
  it("draftPatch faqat o'zgarganlarni beradi", () => {
    const o = { workStart: '08:00', workdays: [1, 2, 3, 4, 5, 6], skip: ['2026-12-31'], extra: [], enabled: true };
    expect(draftPatch(o, { ...o })).toEqual({});
    expect(draftPatch(o, { ...o, workStart: '07:30', workdays: [1, 2, 3, 4, 5], skip: ['2027-01-01'], extra: ['2026-12-31'] })).toEqual({
      workStart: '07:30', workdays: [1, 2, 3, 4, 5], addSkipDates: ['2027-01-01'], removeSkipDates: ['2026-12-31'], addExtraWorkDates: ['2026-12-31'],
    });
  });
});

describe('/jadval — egasi', () => {
  it("vaqt, hafta kunlari, skip/extra sanalar, AI o'chirish → saqlanadi; sayt saqlagani bilan bir xil; audit", async () => {
    expect(await say(A.ownerId, '/jadval')).toBe(true);
    const menu = lastMenu()!;
    expect(menu.text).toContain('Ish jadvali');
    expect(datas(menu.kb)).toEqual(expect.arrayContaining(['ai:s:t', 'ai:s:w', 'ai:s:k', 'ai:s:e', 'ai:s:A:0', 'ai:s:S', 'ai:s:X']));

    await press(A.ownerId, 'ai:s:t');
    expect(datas(lastMenu()!.kb)).toEqual(expect.arrayContaining(['ai:s:T:0700', 'ai:s:T:0730', 'ai:s:T:1000', 'ai:s:c']));
    await press(A.ownerId, 'ai:s:T:0730');
    await press(A.ownerId, 'ai:s:w');
    await press(A.ownerId, 'ai:s:W:6');      // Shanba o'chadi
    await press(A.ownerId, 'ai:s:W:7');      // Yakshanba yoqiladi
    await press(A.ownerId, 'ai:s:k');
    await press(A.ownerId, 'ai:s:K:a');
    expect(aiBotInAiMode(CHAT[A.ownerId])).toBe(true);           // matn kutilmoqda — bot.ts xabarni ilgakka beradi
    const today = localDate();
    const d1 = addDays(today, 10), d2 = addDays(today, 20), d3 = addDays(today, 30);
    const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    expect(await say(A.ownerId, `${dm(d1)}, ${dm(d2)}`)).toBe(true);
    expect(datas(lastMenu()!.kb)).toEqual(expect.arrayContaining([`ai:s:K:r:${d1.replace(/-/g, '')}`, `ai:s:K:r:${d2.replace(/-/g, '')}`]));
    await press(A.ownerId, `ai:s:K:r:${d2.replace(/-/g, '')}`);
    await press(A.ownerId, 'ai:s:E:a');
    await say(A.ownerId, dm(d3));
    await press(A.ownerId, 'ai:s:c');
    await say(A.ownerId, '7:45');
    await press(A.ownerId, 'ai:s:A:0');
    // Saqlashdan oldin hech narsa yozilmagan
    expect((await shiftOf(A)).workStart).toBe('08:00');
    await press(A.ownerId, 'ai:s:S');
    expect(alerts().some((t) => t.includes('saqlandi'))).toBe(true);

    const s = await getSettingsFresh(A.companyId);
    const sh = s.attendance.shifts[0];
    expect(sh).toMatchObject({ workStart: '07:45', callTime: '07:45', workdays: [1, 2, 3, 4, 5, 7], skipDates: [d1], extraWorkDates: [d3] });
    expect(s.enabled).toBe(false);
    expect(s.updatedBy).toBe(A.ownerId);

    // Sayt yo'li (P8 PATCH /admin/schedule → updateSchedule) bilan bir xil natija
    const site = await updateSchedule(B.companyId, 'main', {
      workStart: '07:45', workdays: [1, 2, 3, 4, 5, 7], addSkipDates: [d1], addExtraWorkDates: [d3],
    }, { userId: B.ownerId, role: 'direktor', isOwner: true });
    expect(site.ok).toBe(true);
    expect(strip(sh)).toEqual(strip(await shiftOf(B)));

    const audit: any = await AiActionAudit.findOne({ companyId: A.companyId, tool: 'bot.schedule' }).lean();
    expect(audit).toMatchObject({ actorUserId: A.ownerId, channel: 'bot', kind: 'write', status: 'ok' });
    expect(await AuditLog.countDocuments({ companyId: A.companyId, entity: 'ai_settings' } as any)).toBeGreaterThan(0);
  });

  it("AI firmada o'chiq bo'lsa ham /jadval ishlaydi va AI'ni yoqadi", async () => {
    await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { enabled: false } });
    invalidateSettings();
    expect(await say(A.ownerId, '/jadval')).toBe(true);
    expect(datas(lastMenu()!.kb)).toContain('ai:s:A:1');
    await press(A.ownerId, 'ai:s:A:1');
    expect(datas(lastMenu()!.kb)).toContain('ai:s:D:1');
    await press(A.ownerId, 'ai:s:D:1');                       // ertalabki davomat so'rovi ham botdan yoqiladi
    await press(A.ownerId, 'ai:s:S');
    const s = await getSettingsFresh(A.companyId);
    expect(s.enabled).toBe(true);
    expect(s.attendance.enabled).toBe(true);
    expect(datas(lastMenu()!.kb)).toContain('ai:s:D:0');
  });

  it("oxirgi hafta kunini o'chirib bo'lmaydi (sayt validatori bilan bir xil)", async () => {
    await say(A.ownerId, '/jadval');
    await press(A.ownerId, 'ai:s:w');
    for (const n of [1, 2, 3, 4, 5]) await press(A.ownerId, `ai:s:W:${n}`);
    await press(A.ownerId, 'ai:s:W:6');                       // oxirgisi — rad
    expect(alerts().some((t) => t.includes('Kamida bitta'))).toBe(true);
    expect(datas(lastMenu()!.kb)).toContain('ai:s:W:6');
  });

  it("noto'g'ri sana / vaqt rad etiladi, ro'yxat o'zgarmaydi", async () => {
    await say(A.ownerId, '/jadval');
    await press(A.ownerId, 'ai:s:K:a');
    for (const bad of ['31.02.2027', 'abc', '01.01.2020']) {
      bot.sendMessage.mockClear();
      expect(await say(A.ownerId, bad)).toBe(true);
      expect(String(bot.sendMessage.mock.calls[0][1])).toContain("Noto'g'ri");
    }
    await press(A.ownerId, 'ai:s:c');
    bot.sendMessage.mockClear();
    await say(A.ownerId, '25:99');
    expect(String(bot.sendMessage.mock.calls[0][1])).toContain("Noto'g'ri vaqt");
    bot.sendMessage.mockClear();
    await say(A.ownerId, '13:00');                                  // absentCutoff (12:00) dan keyin
    expect(String(bot.sendMessage.mock.calls[0][1])).toContain('12:00');
    await press(A.ownerId, 'ai:s:T:1300');
    await press(A.ownerId, 'ai:s:S');
    const sh = await shiftOf(A);
    expect(sh.skipDates).toEqual([]);
    expect(sh.workStart).toBe('08:00');
  });

  it("boshqa oqim boshlansa (kutilayotgan holat) — menyu tozalanadi; X — yopadi", async () => {
    await say(A.ownerId, '/jadval');
    await press(A.ownerId, 'ai:s:K:a');
    expect(await say(A.ownerId, '125000 sement', true)).toBe(false);
    expect(aiBotInAiMode(CHAT[A.ownerId])).toBe(false);
    await say(A.ownerId, '/jadval');
    await press(A.ownerId, 'ai:s:X');
    expect(__scheduleDrafts().has(CHAT[A.ownerId])).toBe(false);
    await press(A.ownerId, 'ai:s:S');
    expect(alerts().at(-1)).toContain('eskirgan');
    aiBotResetChat(CHAT[A.ownerId]);
  });
});

describe('ruxsatlar', () => {
  it("ishchi va prorab /jadval va ai:s ishlata olmaydi", async () => {
    for (const id of [A.workerId, A.prorabId]) {
      bot.sendMessage.mockClear();
      expect(await say(id, '/jadval')).toBe(true);
      expect(String(bot.sendMessage.mock.calls[0][1])).toContain('faqat firma rahbari');
      await press(id, 'ai:s:m');
      await press(id, 'ai:s:T:0700');
      await press(id, 'ai:s:S');
    }
    expect((await shiftOf(A)).workStart).toBe('08:00');
    expect(__scheduleDrafts().size).toBe(0);
  });

  it("ishchi /jadval: shaxsiy ish jadvali (#5) bo'lsa — o'z kunlari va vaqti ko'rsatiladi; bo'lmasa — yo'q", async () => {
    bot.sendMessage.mockClear();
    await say(A.workerId, '/jadval');
    expect(String(bot.sendMessage.mock.calls[0][1])).not.toContain('shaxsiy');
    await AiEmployeeContact.updateOne({ companyId: A.companyId, employeeId: A.workerId },
      { $set: { scheduleOverride: { weekdays: [5, 1, 3], workStart: '10:00' } } }, { upsert: true });
    bot.sendMessage.mockClear();
    await say(A.workerId, '/jadval');
    const t = String(bot.sendMessage.mock.calls[0][1]);
    expect(t).toContain('faqat firma rahbari');
    expect(t).toContain('shaxsiy ish jadvalingiz');
    expect(t).toContain('10:00');
    expect(t).toContain('Du Ch Ju');
    await AiEmployeeContact.updateOne({ companyId: A.companyId, employeeId: A.workerId }, { $unset: { scheduleOverride: '' } });
  });

  it("o'rinbosar: bayroq yoqiq — mumkin, o'chiq — yo'q", async () => {
    await say(A.orinbosarId, '/jadval');
    await press(A.orinbosarId, 'ai:s:T:0900');
    await press(A.orinbosarId, 'ai:s:S');
    expect((await shiftOf(A)).workStart).toBe('09:00');

    await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { 'attendance.orinbosarCanEditSchedule': false } });
    invalidateSettings();
    bot.sendMessage.mockClear();
    await say(A.orinbosarId, '/jadval');
    expect(String(bot.sendMessage.mock.calls[0][1])).toContain('faqat firma rahbari');
    await press(A.orinbosarId, 'ai:s:T:0700');
    await press(A.orinbosarId, 'ai:s:S');
    expect((await shiftOf(A)).workStart).toBe('09:00');
  });

  it("boshqa firma egasi faqat o'z firmasini o'zgartiradi; begona chat'dan bosish rad", async () => {
    await say(B.ownerId, '/jadval');
    await press(B.ownerId, 'ai:s:T:0700');
    await press(B.ownerId, 'ai:s:S');
    expect((await shiftOf(B)).workStart).toBe('07:00');
    expect((await shiftOf(A)).workStart).toBe('08:00');
    // A egasining menyusi ochiq; B egasi A egasining chat id'si bilan bossa (from/chat mos emas) — rad
    await say(A.ownerId, '/jadval');
    const userB: any = await User.findById(B.ownerId).lean();
    const chatA = CHAT[A.ownerId];
    await dispatchAiCallback({ id: 'x1', data: 'ai:s:T:0700', from: { id: chatA }, message: { message_id: 1, chat: { id: chatA, type: 'private' } } }, userB, 'uz', vi.fn(async () => true));
    await dispatchAiCallback({ id: 'x2', data: 'ai:s:S', from: { id: chatA }, message: { message_id: 1, chat: { id: chatA, type: 'private' } } }, userB, 'uz', vi.fn(async () => true));
    expect((await shiftOf(A)).workStart).toBe('08:00');
  });

  it("tarifida AI yo'q firma — tushuntirish, menyu ochilmaydi", async () => {
    bot.sendMessage.mockClear();
    expect(await say(N.ownerId, '/jadval')).toBe(true);
    expect(String(bot.sendMessage.mock.calls[0][1])).toContain("Tarifingizda");
    expect(__scheduleDrafts().size).toBe(0);
  });

  it("AI_VOICE_ENABLED o'chiq — /jadval ushlanmaydi (mavjud bot xatti-harakati)", async () => {
    process.env.AI_VOICE_ENABLED = '';
    expect(await say(A.ownerId, '/jadval')).toBe(false);
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });
});
