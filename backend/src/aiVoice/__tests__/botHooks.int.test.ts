// Bot ilgaklari (P4, review B5): soxta token, guruh chati, from.id mos emas, boshqa firma, takroriy bosish,
// muddati o'tgan token, bloklangan foydalanuvchi, smenasi yopiq ishchi (ai:a/ai:o/ai:r — ha, ai:x — yo'q),
// obunasiz → no_answer; rozilik oqimi; amal tasdig'i; /ai rejimi (soxta TextAgent) va oqimlar ustuvorligi.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import User from '../../models/User';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiReminder from '../../models/AiReminder';
import AiActionAudit from '../../models/AiActionAudit';
import AiNonce from '../../models/AiNonce';
import ConsentLog from '../../models/ConsentLog';
import {
  WORKER_OFFSHIFT_CALLBACK_RE, aiBotInAiMode, aiBotResetChat, dispatchAiCallback, dispatchAiMessage, registerBotInstance,
} from '../bot/botHooks';
import { attendanceKeyboard, confirmKeyboard, consentData, reminderKeyboard } from '../bot/guard';
import { sendConsentRequest, bindingCodeHash } from '../bot/consentFlow';
import { __aiModes, __flushAiModePersist, setTranscriber, warmAiModeCache } from '../bot/aiMode';
import { setTextAgentFactory, NotConfiguredTextAgent } from '../brain/textAgent';
import type { TextAgentInput, TextAgentOutput, ToolCtx } from '../contracts';
import { __setActorCacheTtlForTests, invalidateActor } from '../actor';
import { newCorrelationId } from '../lib/ids';
import { sha256Hex } from '../lib/crypto';
import { localDate, addDays } from '../lib/zonedTime';
import { invalidateSettings, __setSettingsCacheTtlForTests } from '../settings';
import { executeTool } from '../tools/executor';
import { registerTool, unregisterTool } from '../tools/registry';
import type { AiToolDef } from '../tools/types';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany, B: SeedCompany;
const ENV = { ai: process.env.AI_VOICE_ENABLED, acct: process.env.AI_TG_ACCOUNT_USERNAME };

function fakeBot() {
  let n = 500;
  return {
    sendMessage: vi.fn(async (_c: any, _t: string, _o?: any) => ({ message_id: ++n })),
    answerCallbackQuery: vi.fn(async (_id: string, _o?: any) => true),
    editMessageText: vi.fn(async (_t: string, _o?: any) => true),
    editMessageReplyMarkup: vi.fn(async (_m: any, _o?: any) => true),
    getFileLink: vi.fn(async (id: string) => `https://api.telegram.org/file/bot-x/${id}`),
    sendChatAction: vi.fn(async () => true),
  };
}
let bot: ReturnType<typeof fakeBot>;

const CHAT: Record<string, number> = {};
async function u(id: string) { return User.findById(id).lean(); }

let qn = 0;
function query(chatId: number, data: string, o: { fromId?: number; type?: string; text?: string } = {}) {
  return {
    id: `q${++qn}`, data, from: { id: o.fromId ?? chatId },
    message: { message_id: 900 + qn, text: o.text ?? 'savol', chat: { id: chatId, type: o.type ?? 'private' } },
  };
}
/** bot.ts callback_query tartibi: (obuna darvozasi) → dispatchAiCallback. */
async function press(userId: string, data: string, o: { fromId?: number; type?: string; subscribed?: boolean; chatId?: number } = {}) {
  const user = await u(userId);
  const chatId = o.chatId ?? CHAT[userId];
  const q = query(chatId, data, o);
  const answer = vi.fn(async () => true);
  if (o.subscribed === false) return { q, answer, handled: false, gated: true };   // bot.ts shu yerda qaytadi
  const handled = await dispatchAiCallback(q, user, (user as any)?.language, answer);
  return { q, answer, handled, gated: false };
}
const alerts = () => bot.answerCallbackQuery.mock.calls.map((c) => String(c[1]?.text || ''));
const sent = () => bot.sendMessage.mock.calls.map((c) => ({ chatId: c[0], text: String(c[1]), opts: c[2] }));

async function mkConf(s: SeedCompany, employeeId: string, token: string, extra: Record<string, unknown> = {}) {
  return AiAttendanceConfirmation.create({
    companyId: s.companyId, employeeId, date: localDate(), shiftId: 'main', scheduledAt: new Date(), correlationId: newCorrelationId(),
    buttonToken: token, ...extra,
  } as any);
}

beforeAll(async () => {
  mongo = await startMongo();
  A = await seedCompany('HkA');
  B = await seedCompany('HkB');
  let chat = 7000;
  for (const s of [A, B]) {
    for (const id of [s.ownerId, s.orinbosarId, s.prorabId, s.workerId, s.worker2Id]) {
      CHAT[id] = ++chat;
      await User.updateOne({ _id: id }, { $set: { telegramChatId: String(chat) } });
    }
  }
  __setSettingsCacheTtlForTests(0);
  __setActorCacheTtlForTests(0);
}, 120_000);
afterAll(async () => {
  __setSettingsCacheTtlForTests(10_000);
  __setActorCacheTtlForTests(10_000);
  setTextAgentFactory(() => new NotConfiguredTextAgent());
  await stopMongo(mongo);
});
beforeEach(async () => {
  process.env.AI_VOICE_ENABLED = 'true';
  process.env.AI_TG_ACCOUNT_USERNAME = 'qurilish_ai';
  invalidateSettings();
  invalidateActor();
  bot = fakeBot();
  registerBotInstance(bot);
  await Promise.all([AiAttendanceConfirmation.deleteMany({}), AiEmployeeContact.deleteMany({}), AiReminder.deleteMany({}), AiNonce.deleteMany({}), AiActionAudit.deleteMany({})]);
  await User.updateMany({}, { $set: { isBlocked: false } });
  await AiAssistantSettings.updateMany({}, { $set: { enabled: true } });
  for (const k of [...__aiModes().keys()]) aiBotResetChat(k);
  await __flushAiModePersist();
});
afterEach(() => {
  for (const [k, v] of [['AI_VOICE_ENABLED', ENV.ai], ['AI_TG_ACCOUNT_USERNAME', ENV.acct]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('ai:a — davomat tugmalari', () => {
  it("tasdiq: status confirmed, javob yoziladi, mavjud check-in tugmasi (confirm_checkin) ko'rsatiladi; Attendance yozilmaydi", async () => {
    await mkConf(A, A.workerId, 'TokAAAA001');
    const r = await press(A.workerId, 'ai:a:TokAAAA001:c');
    expect(r.handled).toBe(true);
    const c: any = await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA001' }).lean();
    expect(c).toMatchObject({ status: 'confirmed', buttonAnswer: 'confirm' });
    expect(c.buttonAt).toBeInstanceOf(Date);
    const checkin = sent().find((m) => JSON.stringify(m.opts || {}).includes('confirm_checkin'));
    expect(checkin?.chatId).toBe(CHAT[A.workerId]);
    expect(bot.editMessageText).toHaveBeenCalled();    // eski xabardan tugmalar olib tashlandi
  });

  it("kechikaman → late; kelmayman → declined (check-in tugmasi yo'q)", async () => {
    await mkConf(A, A.workerId, 'TokAAAA002');
    await mkConf(A, A.worker2Id, 'TokAAAA003');
    await press(A.workerId, 'ai:a:TokAAAA002:l');
    await press(A.worker2Id, 'ai:a:TokAAAA003:d');
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA002' }).lean() as any).status).toBe('late');
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA003' }).lean() as any).status).toBe('declined');
    expect(sent().filter((m) => m.chatId === CHAT[A.worker2Id] && JSON.stringify(m.opts || {}).includes('confirm_checkin'))).toHaveLength(0);
  });

  it("takroriy bosish — 'allaqachon qayd etilgan', birinchi javob saqlanadi; parallel bosishda faqat bittasi yutadi", async () => {
    await mkConf(A, A.workerId, 'TokAAAA004');
    await press(A.workerId, 'ai:a:TokAAAA004:c');
    await press(A.workerId, 'ai:a:TokAAAA004:d');
    expect(alerts().some((t) => t.includes('Allaqachon'))).toBe(true);
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA004' }).lean() as any).buttonAnswer).toBe('confirm');

    await mkConf(A, A.worker2Id, 'TokAAAA005');
    bot.answerCallbackQuery.mockClear();
    await Promise.all([press(A.worker2Id, 'ai:a:TokAAAA005:c'), press(A.worker2Id, 'ai:a:TokAAAA005:d'), press(A.worker2Id, 'ai:a:TokAAAA005:l')]);
    const c: any = await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA005' }).lean();
    expect(['confirm', 'decline', 'late']).toContain(c.buttonAnswer);
    expect(alerts().filter((t) => t.includes('Allaqachon'))).toHaveLength(2);
  });

  it("check-in allaqachon bo'lgan bo'lsa status checked_in qoladi (tugma hech qachon checked_in o'rnatmaydi)", async () => {
    await mkConf(A, A.workerId, 'TokAAAA006', { status: 'checked_in', checkInAt: new Date() });
    await press(A.workerId, 'ai:a:TokAAAA006:d');
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA006' }).lean() as any).status).toBe('checked_in');
    await mkConf(A, A.worker2Id, 'TokAAAA016');
    await press(A.worker2Id, 'ai:a:TokAAAA016:c');
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA016' }).lean() as any).status).toBe('confirmed');
  });

  it("soxta token, noto'g'ri format — rad, hech narsa o'zgarmaydi", async () => {
    await mkConf(A, A.workerId, 'TokAAAA007');
    for (const d of ['ai:a:ZZZZZZZZZZ:c', 'ai:a:TokAAAA007:q', 'ai:a:TokAAAA007', 'ai:a:Tok$$$$$$$:c', 'ai:a:TokAAAA007:c:extra']) {
      const r = await press(A.workerId, d);
      expect(r.handled).toBe(true);
    }
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA007' }).lean() as any).buttonAnswer).toBe('none');
    expect(alerts().every((t) => t.includes('eskirgan'))).toBe(true);
  });

  it("guruh chati va from.id ≠ chat.id — ilgak ishlamaydi (faqat jim javob)", async () => {
    await mkConf(A, A.workerId, 'TokAAAA008');
    const g = await press(A.workerId, 'ai:a:TokAAAA008:c', { type: 'supergroup' });
    expect(g.handled).toBe(true);
    expect(g.answer).toHaveBeenCalledTimes(1);           // dispatch jim javob berdi
    const f = await press(A.workerId, 'ai:a:TokAAAA008:c', { fromId: 999999 });
    expect(f.answer).toHaveBeenCalledTimes(1);
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA008' }).lean() as any).buttonAnswer).toBe('none');
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it("boshqa xodim yoki boshqa firma tokeni — rad", async () => {
    await mkConf(A, A.workerId, 'TokAAAA009');
    await press(A.worker2Id, 'ai:a:TokAAAA009:c');          // shu firma, boshqa xodim
    await press(B.workerId, 'ai:a:TokAAAA009:c');           // boshqa firma
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA009' }).lean() as any).buttonAnswer).toBe('none');
  });

  it("muddati o'tgan token (kecha / yakunlangan) — rad", async () => {
    await mkConf(A, A.workerId, 'TokAAAA010', { date: addDays(localDate(), -1) });
    await mkConf(A, A.worker2Id, 'TokAAAA011', { finalizedAt: new Date(), status: 'absent' });
    await press(A.workerId, 'ai:a:TokAAAA010:c');
    await press(A.worker2Id, 'ai:a:TokAAAA011:c');
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA010' }).lean() as any).buttonAnswer).toBe('none');
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA011' }).lean() as any).status).toBe('absent');
  });

  it('bloklangan foydalanuvchi — rad', async () => {
    await mkConf(A, A.workerId, 'TokAAAA012');
    await User.updateOne({ _id: A.workerId }, { $set: { isBlocked: true } });
    await press(A.workerId, 'ai:a:TokAAAA012:c');
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA012' }).lean() as any).buttonAnswer).toBe('none');
  });

  it("AI firmada o'chiq yoki AI_VOICE_ENABLED o'chiq — hech narsa yozilmaydi", async () => {
    await mkConf(A, A.workerId, 'TokAAAA013');
    await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { enabled: false } });
    invalidateSettings();
    await press(A.workerId, 'ai:a:TokAAAA013:c');
    process.env.AI_VOICE_ENABLED = '';
    await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { enabled: true } });
    invalidateSettings();
    const r = await press(A.workerId, 'ai:a:TokAAAA013:c');
    expect(r.answer).toHaveBeenCalledTimes(1);
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA013' }).lean() as any).buttonAnswer).toBe('none');
  });

  it("obunasiz foydalanuvchi: bosish ilgakka yetmaydi → yozuv pending/none qoladi (oqim uni no_answer deb hisoblaydi), xato emas", async () => {
    await mkConf(A, A.workerId, 'TokAAAA014');
    const r = await press(A.workerId, 'ai:a:TokAAAA014:c', { subscribed: false });
    expect(r.gated).toBe(true);
    const c: any = await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA014' }).lean();
    expect(c).toMatchObject({ status: 'pending', buttonAnswer: 'none' });
    expect(c.status).not.toBe('call_failed');
  });
});

describe('smena darvozasi (ishchi smenadan tashqarida)', () => {
  it("ai:a / ai:o / ai:r tugmalari o'tadi, ai:x va ai:s / ai:m — yo'q", () => {
    for (const d of [
      ...attendanceKeyboard('TokAAAA015', 'uz').flat().map((b) => b.callback_data),
      ...reminderKeyboard('665f1c2e9b1e8a0012345678', 'uz').flat().map((b) => b.callback_data),
      consentData('ConsentTok0001', 'y'), consentData('ConsentTok0001', 'n'),
    ]) expect(WORKER_OFFSHIFT_CALLBACK_RE.test(d)).toBe(true);
    for (const d of [...confirmKeyboard('ConfirmTokenAAAAAAAAAA', 'uz').flat().map((b) => b.callback_data), 'ai:s:m', 'ai:m:x']) {
      expect(WORKER_OFFSHIFT_CALLBACK_RE.test(d)).toBe(false);
    }
  });
  it("smenasi yopiq ishchi ai:a ni bosa oladi (darvozadan o'tadi va qayd etiladi)", async () => {
    await mkConf(A, A.workerId, 'TokAAAA017');
    expect(WORKER_OFFSHIFT_CALLBACK_RE.test('ai:a:TokAAAA017:c')).toBe(true);
    await press(A.workerId, 'ai:a:TokAAAA017:c');
    expect((await AiAttendanceConfirmation.findOne({ buttonToken: 'TokAAAA017' }).lean() as any).status).toBe('confirmed');
  });
});

describe('ai:r — eslatma', () => {
  const mkRem = (s: SeedCompany, target: string, extra: Record<string, unknown> = {}) => AiReminder.create({
    companyId: s.companyId, ownerId: s.ownerId, targetUserId: target, text: 'Sement buyurtma', dueAt: new Date(), nextFireAt: null,
    fireCount: 1, channels: ['bot_message'], correlationId: newCorrelationId(), ...extra,
  } as any);

  it("bajarildi: bir martalik eslatma 'done'; takroriy bosish — allaqachon", async () => {
    const r: any = await mkRem(A, A.workerId);
    await press(A.workerId, `ai:r:${r._id}:d`);
    expect((await AiReminder.findById(r._id).lean() as any).status).toBe('done');
    await press(A.workerId, `ai:r:${r._id}:d`);
    expect(alerts().some((t) => t.includes('Allaqachon'))).toBe(true);
  });
  it("10 daqiqa: nextFireAt ≈ +10 daq; takroriy — allaqachon; boshqa xodim/firma — rad", async () => {
    const r: any = await mkRem(A, A.workerId, { recurrence: { freq: 'daily', interval: 1, byWeekday: [] } });
    const t0 = Date.now();
    await press(A.worker2Id, `ai:r:${r._id}:s`);
    await press(B.workerId, `ai:r:${r._id}:s`);
    expect((await AiReminder.findById(r._id).lean() as any).nextFireAt).toBeNull();
    expect(alerts().filter((t) => t.includes('eskirgan'))).toHaveLength(2);
    await press(A.workerId, `ai:r:${r._id}:s`);
    const after: any = await AiReminder.findById(r._id).lean();
    expect(after.status).toBe('active');
    expect(after.nextFireAt.getTime() - t0).toBeGreaterThanOrEqual(9.5 * 60_000);
    await press(A.workerId, `ai:r:${r._id}:s`);
    expect(alerts().some((t) => t.includes('Allaqachon'))).toBe(true);
  });
});

describe('ai:o — rozilik oqimi', () => {
  it("so'rov yuboriladi; 'Ha' → granted, tgUserId = from.id, bog'lash kodi va t.me havolasi; takroriy — allaqachon", async () => {
    const s = await sendConsentRequest({ companyId: A.companyId, employeeId: A.workerId });
    expect(s.ok).toBe(true);
    const msg = sent()[0];
    expect(msg.text).toContain("AI yordamchi qo'ng'iroq qilishiga rozimisiz?");
    const yes = msg.opts.reply_markup.inline_keyboard[0][0].callback_data as string;
    expect(yes).toMatch(/^ai:o:[A-Za-z0-9]{16}:y$/);
    expect((await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean() as any).telegram.callConsent).toBe('requested');

    bot.sendMessage.mockClear();
    await press(A.workerId, yes);
    const ct: any = await AiEmployeeContact.findOne({ employeeId: A.workerId }).select('+telegram.bindingCodeHash').lean();
    expect(ct.telegram.callConsent).toBe('granted');
    expect(ct.telegram.tgUserId).toBe(String(CHAT[A.workerId]));
    const bind = sent().find((m) => /AI-\d{4}/.test(m.text))!;
    const code = /AI-\d{4}/.exec(bind.text)![0];
    expect(bind.text).toContain('@qurilish_ai');
    expect(JSON.stringify(bind.opts)).toContain('https://t.me/qurilish_ai');
    expect(ct.telegram.bindingCodeHash).toBe(bindingCodeHash(code));
    expect(ct.telegram.bindingCodeHash).toBe(sha256Hex(code));
    expect(await ConsentLog.countDocuments({ userId: A.workerId, consentType: 'ai_call', source: 'bot' })).toBe(1);

    await press(A.workerId, yes);
    expect(alerts().some((t) => t.includes('Allaqachon'))).toBe(true);
    expect(await ConsentLog.countDocuments({ userId: A.workerId, consentType: 'ai_call' })).toBe(1);
  });

  it("boshqa xodim tokeni, muddati o'tgan token — rad; 'Yo'q' → revoked", async () => {
    await sendConsentRequest({ companyId: A.companyId, employeeId: A.workerId });
    const tok = (await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean() as any).telegram.consentToken;
    await press(A.worker2Id, consentData(tok, 'y'));
    await press(B.workerId, consentData(tok, 'y'));
    expect((await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean() as any).telegram.callConsent).toBe('requested');
    await press(A.workerId, consentData(tok, 'n'));
    expect((await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean() as any).telegram.callConsent).toBe('revoked');

    await sendConsentRequest({ companyId: A.companyId, employeeId: A.worker2Id });
    await AiEmployeeContact.updateOne({ employeeId: A.worker2Id }, { $set: { 'telegram.consentTokenExpiresAt': new Date(Date.now() - 1000) } });
    const tok2 = (await AiEmployeeContact.findOne({ employeeId: A.worker2Id }).lean() as any).telegram.consentToken;
    await press(A.worker2Id, consentData(tok2, 'y'));
    expect((await AiEmployeeContact.findOne({ employeeId: A.worker2Id }).lean() as any).telegram.callConsent).toBe('requested');
  });

  it("bitta Telegram identifikatori ikki xodimga bog'lanmaydi", async () => {
    await AiEmployeeContact.create({ companyId: B.companyId, employeeId: B.workerId, telegram: { tgUserId: String(CHAT[A.workerId]) } } as any);
    await sendConsentRequest({ companyId: A.companyId, employeeId: A.workerId });
    const tok = (await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean() as any).telegram.consentToken;
    await press(A.workerId, consentData(tok, 'y'));
    expect((await AiEmployeeContact.findOne({ employeeId: A.workerId }).lean() as any).telegram.callConsent).not.toBe('granted');
    expect(alerts().some((t) => t.includes('boshqa xodimga'))).toBe(true);
  });
});

describe('ai:x — amal tasdig\'i (atomik)', () => {
  let runs = 0;
  const tool: AiToolDef = {
    name: 'p4Note', description: { uz: 't', ru: 't' }, kind: 'write', confirm: 'always', behavior: 'BLOCKING',
    channels: ['bot', 'web'], purposes: ['assistant'], maxRoles: ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'],
    defaultRoles: ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'], parameters: { type: 'object', properties: {} },
    summarize: () => 'Eslatma yozish', handler: async () => { runs++; return { status: 'ok', message: 'Bajarildi', retryable: false }; },
  };
  beforeAll(() => registerTool(tool));
  afterAll(() => unregisterTool('p4Note'));
  const ctxOf = (s: SeedCompany, userId: string, role: ToolCtx['role']): ToolCtx => ({
    companyId: s.companyId, userId, role, isOwner: false, lang: 'uz', tz: 'Asia/Tashkent', channel: 'bot', purpose: 'assistant', correlationId: newCorrelationId(),
  });

  it("'Ha' bir marta bajaradi; takroriy/parallel bosish — bajarilmaydi; boshqa foydalanuvchi — yo'q", async () => {
    runs = 0;
    const out = await executeTool(ctxOf(A, A.prorabId, 'prorab'), 'p4Note', {});
    expect(out.result.status).toBe('needs_confirmation');
    const token = out.pending!.token!;
    await press(A.workerId, `ai:x:${token}:y`);                                   // boshqa foydalanuvchi
    expect(runs).toBe(0);
    await Promise.all([press(A.prorabId, `ai:x:${token}:y`), press(A.prorabId, `ai:x:${token}:y`)]);
    expect(runs).toBe(1);
    await press(A.prorabId, `ai:x:${token}:y`);
    expect(runs).toBe(1);
    expect(alerts().some((t) => t.includes("allaqachon ko'rib chiqilgan"))).toBe(true);
  });
  it("'Yo'q' — bekor qilinadi, bajarilmaydi", async () => {
    runs = 0;
    const out = await executeTool(ctxOf(A, A.orinbosarId, 'orinbosar'), 'p4Note', {});
    await press(A.orinbosarId, `ai:x:${out.pending!.token}:n`);
    expect(runs).toBe(0);
    expect((await AiActionAudit.findById(out.auditId).lean() as any).status).toBe('cancelled');
  });
});

describe('/ai rejimi', () => {
  const calls: TextAgentInput[] = [];
  let reply: Partial<TextAgentOutput> = {};
  beforeAll(() => {
    setTextAgentFactory(() => ({
      async run(input: TextAgentInput): Promise<TextAgentOutput> {
        calls.push(input);
        return { text: 'Javob: ' + input.userText, toolCalls: [], pendingActions: [], usage: { model: 'fake', tokensIn: 1, tokensOut: 1 }, ...reply };
      },
    }));
  });
  beforeEach(() => { calls.length = 0; reply = {}; });

  const msgOf = (userId: string, m: Record<string, unknown>) => ({ chat: { id: CHAT[userId], type: 'private' }, from: { id: CHAT[userId] }, ...m });
  const gate = (userId: string, pending = false) => ({
    hasOtherPendingState: pending, clearOtherStates: vi.fn(), loadUser: () => User.findById(userId).lean(),
  });

  it("/ai → rejimga kiradi (boshqa holatlar tozalanadi); matn TextAgent'ga bot kanali bilan; chiqish tugmasi", async () => {
    const g = gate(A.prorabId);
    expect(await dispatchAiMessage(msgOf(A.prorabId, { text: '/ai' }), g)).toBe(true);
    expect(g.clearOtherStates).toHaveBeenCalled();
    expect(aiBotInAiMode(CHAT[A.prorabId])).toBe(true);
    await __flushAiModePersist();
    expect((await AiEmployeeContact.findOne({ employeeId: A.prorabId }).lean() as any).botAiModeUntil.getTime()).toBeGreaterThan(Date.now());

    expect(await dispatchAiMessage(msgOf(A.prorabId, { text: 'Bugun nima ish bor?' }), gate(A.prorabId))).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].ctx).toMatchObject({ channel: 'bot', purpose: 'assistant', companyId: A.companyId, userId: A.prorabId, role: 'prorab' });
    const last = sent().at(-1)!;
    expect(last.text).toBe('Javob: Bugun nima ish bor?');
    expect(JSON.stringify(last.opts)).toContain('ai:m:x');
    // Tarix keyingi savolga uzatiladi
    await dispatchAiMessage(msgOf(A.prorabId, { text: 'Yana?' }), gate(A.prorabId));
    expect(calls[1].history.map((h) => h.text)).toEqual(['Bugun nima ish bor?', 'Javob: Bugun nima ish bor?']);
  });

  it('ovozli xabar matnga aylantirilib TextAgent\'ga beriladi', async () => {
    setTranscriber(async () => 'ovozdan matn');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4])));
    await dispatchAiMessage(msgOf(A.prorabId, { text: '/ai' }), gate(A.prorabId));
    expect(await dispatchAiMessage(msgOf(A.prorabId, { voice: { file_id: 'v1', duration: 3, mime_type: 'audio/ogg' } }), gate(A.prorabId))).toBe(true);
    expect(calls.at(-1)?.userText).toBe('ovozdan matn');
    fetchSpy.mockRestore();
  });

  it("AI rejimi chiqim/chat oqimlarini o'g'irlamaydi: boshqa holat bo'lsa rejim tugaydi va xabar o'sha oqimga qoladi", async () => {
    await dispatchAiMessage(msgOf(A.prorabId, { text: '/ai' }), gate(A.prorabId));
    expect(await dispatchAiMessage(msgOf(A.prorabId, { voice: { file_id: 'expense' } }), gate(A.prorabId, true))).toBe(false);
    expect(aiBotInAiMode(CHAT[A.prorabId])).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("menyu tugmasi matni (masalan '✅ Ishga keldim') — rejim tugaydi, xabar mavjud oqimga", async () => {
    await dispatchAiMessage(msgOf(A.workerId, { text: '/ai' }), gate(A.workerId));
    expect(await dispatchAiMessage(msgOf(A.workerId, { text: '✅ Ishga keldim' }), gate(A.workerId))).toBe(false);
    expect(aiBotInAiMode(CHAT[A.workerId])).toBe(false);
  });

  it('chiqish tugmasi (ai:m:x) va /res (aiBotResetChat) rejimni tugatadi; DB belgisi ham olib tashlanadi', async () => {
    await dispatchAiMessage(msgOf(A.prorabId, { text: '/ai' }), gate(A.prorabId));
    await press(A.prorabId, 'ai:m:x');
    expect(aiBotInAiMode(CHAT[A.prorabId])).toBe(false);
    await __flushAiModePersist();
    expect((await AiEmployeeContact.findOne({ employeeId: A.prorabId }).lean() as any).botAiModeUntil).toBeUndefined();
    await dispatchAiMessage(msgOf(A.prorabId, { text: '/ai' }), gate(A.prorabId));
    aiBotResetChat(CHAT[A.prorabId]);
    expect(aiBotInAiMode(CHAT[A.prorabId])).toBe(false);
  });

  it("tasdiq talab qiluvchi amal — ai:x tugmalari yuboriladi (model o'zi tasdiqlay olmaydi)", async () => {
    reply = { pendingActions: [{ pendingActionId: 'x', token: 'ConfirmTokenBBBBBBBBBB', summary: 'Eslatma yozish', expiresAt: new Date().toISOString(), confirmVia: 'bot', tool: 'p4Note' }] };
    await dispatchAiMessage(msgOf(A.prorabId, { text: '/ai eslatma qo\'y' }), gate(A.prorabId));
    const m = sent().find((x) => JSON.stringify(x.opts || {}).includes('ai:x:ConfirmTokenBBBBBBBBBB:y'));
    expect(m?.text).toContain('Eslatma yozish');
  });

  it("AI firmada o'chiq — /ai tushuntirish beradi, rejimga kirmaydi; firmasiz foydalanuvchi — mavjud oqim", async () => {
    await AiAssistantSettings.updateOne({ companyId: A.companyId }, { $set: { enabled: false } });
    invalidateSettings();
    expect(await dispatchAiMessage(msgOf(A.prorabId, { text: '/ai' }), gate(A.prorabId))).toBe(true);
    expect(aiBotInAiMode(CHAT[A.prorabId])).toBe(false);
    expect(sent().at(-1)?.text).toContain("o'chirilgan");
    const g = { hasOtherPendingState: false, clearOtherStates: vi.fn(), loadUser: async () => ({ _id: '665f1c2e9b1e8a00000000ff', language: 'uz' }) };
    // Firmasiz (yoki dasturchi) — jim qolmaydi: tushuntirish beradi, AI rejimiga kirmaydi
    expect(await dispatchAiMessage({ chat: { id: 1, type: 'private' }, from: { id: 1 }, text: '/ai' }, g)).toBe(true);
    expect(sent().at(-1)?.text).toContain('dasturchi');
    expect(g.clearOtherStates).not.toHaveBeenCalled();
  });

  it('qayta ishga tushish: botAiModeUntil DB\'dan xotiraga isitiladi', async () => {
    await AiEmployeeContact.create({ companyId: A.companyId, employeeId: A.orinbosarId, botAiModeUntil: new Date(Date.now() + 60_000) } as any);
    __aiModes().clear();
    expect(aiBotInAiMode(CHAT[A.orinbosarId])).toBe(false);
    expect(await warmAiModeCache()).toBe(1);
    expect(aiBotInAiMode(CHAT[A.orinbosarId])).toBe(true);
  });
});
