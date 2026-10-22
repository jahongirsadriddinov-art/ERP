// Owner 2026-10-22: "AI aqlliroq bo'lsin, hammasini tushunsin, xatosiz, aytilgan ishni qilsin; qila olmasa —
// SAQLASIN va dasturchiga aytsin". Ssenariylar (lotin / kirill o'zbek / rus / aralash / so'zlashuv) soxta
// provayder bilan: tasdiq/rad, yozuv tool'lari tasdiqni BIR MARTA so'raydi, eslatma, qo'ng'iroq, rol cheklovlari,
// "AI qila olmadi" yozuvi + dasturchi xabari (dedupe/limit). Tarmoq YO'Q.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import AiActionAudit from '../../../models/AiActionAudit';
import AiReminder from '../../../models/AiReminder';
import AiUnmetRequest from '../../../models/AiUnmetRequest';
import { addDays, localDate } from '../../lib/zonedTime';
import { __resetGeminiKeysForTests } from '../../lib/geminiKeys';
import { effectiveToolNames } from '../../tools/rbac';
import { ErpTextAgent, SUCCESS_CLAIM_RE } from '../agent';
import { createGeminiProvider } from '../providers/gemini';
import { askedToConfirm, pureYesNo, toLatinUz } from '../style';
import { explicitDecision } from '../toolPolicy';
import { __flushUnmet, __resetUnmetForTests, setUnmetNotifier, soundsLikeCant, unmetSignature } from '../unmet';
import { ctxFor, resetCaches, setupErp, teardownErp, type Env } from '../../tools/erp/__tests__/erpHelpers';
import { fakeGenai, geminiCall, geminiText } from './fakes';

let env: Env;
const savedKey = process.env.GEMINI_API_KEY;
const savedKeys = process.env.GEMINI_API_KEYS;
const alerts: string[] = [];

beforeAll(async () => {
  env = await setupErp();
  delete process.env.GEMINI_API_KEYS;
  process.env.GEMINI_API_KEY = 'test-gemini-key-not-real';
  setUnmetNotifier(async (t) => { alerts.push(t); });
}, 120_000);
afterAll(async () => {
  setUnmetNotifier(null);
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
  if (savedKeys !== undefined) process.env.GEMINI_API_KEYS = savedKeys;
  await teardownErp(env);
});
beforeEach(async () => {
  resetCaches(); __resetGeminiKeysForTests(); __resetUnmetForTests();
  alerts.length = 0;
  await Promise.all([AiReminder.deleteMany({}), AiUnmetRequest.deleteMany({}), AiActionAudit.deleteMany({ status: 'needs_confirmation' })]);
});

const agentWith = (g: ReturnType<typeof fakeGenai>) => new ErpTextAgent({
  providers: { gemini: createGeminiProvider({ factory: g.factory }) },
  env: { gemini: true, openrouter: false, claude: false },
});
const tomorrow = () => addDays(localDate(), 1);
const boss = () => ctxFor(env.A.ownerId, env.A.companyId, { role: 'direktor', isOwner: true });
const NO_MODEL = () => fakeGenai([() => geminiText('SHOULD NOT BE CALLED')]);
async function unmetRows() { await __flushUnmet(); return AiUnmetRequest.find({}).sort({ createdAt: 1 }).lean() as Promise<any[]>; }

describe('sof ha/yo\'q — barcha yozuv va so\'zlashuv shakllari', () => {
  it.each([
    'ha', 'Ha.', 'xa', 'haa', 'ha ha', 'ha tasdiqlayman', 'Ha, tasdiqlayman!', 'tasdiqlayman', 'tasdiqladim', 'albatta', 'ha albatta',
    'mayli', "xo'p", 'xo’p', 'xoʻp', 'hop', "bo'pti", 'bo‘pti', 'ok', 'okey', 'yaxshi', "bo'ladi", 'ha yuboring', 'ha qilavering', 'ha rahmat',
    // kirill o'zbek
    'ҳа', 'Ха', 'ҳа, тасдиқлайман', 'Тасдиқлайман', 'хоп', 'майли', 'албатта', 'бўпти', 'ҳа юборинг',
    // rus va aralash
    'да', 'Да, подтверждаю', 'да конечно', 'давай', 'ок', 'окей', 'угу', 'ладно', 'ha давай', 'да, отправляй',
    // emoji
    '👍', '✅',
  ])('tasdiq: %s', (t) => expect(pureYesNo(t)).toBe(true));

  it.each([
    "yo'q", 'yo’q', 'yoʻq', 'yoq', "Yo'q, kerak emas", 'kerakmas', 'shart emas', 'bekor qil', 'bekor qiling', "to'xta", "yo'q rahmat",
    "yo'q hozir emas", 'yubormang',
    'йўқ', 'Йўқ, керак эмас', 'бекор қилинг', 'тўхта',
    'нет', 'Нет, не надо', 'не нужно', 'отмена', 'отмените', 'нет спасибо', 'стоп', 'не отправляй',
    '👎',
  ])('rad: %s', (t) => expect(pureYesNo(t)).toBe(false));

  it.each([
    'ha, lekin ertaga', 'ha qil lekin 20 ga', 'qil', 'yubor', 'ertaga 7 da eslat', 'да, но завтра', 'ҳа, лекин эртага', 'rahmat', 'спасибо',
    'Alfa-prorabga ayt menga aloqaga chiqsin', '',
  ])('sof emas: %s', (t) => expect(pureYesNo(t)).toBeNull());

  it('kirill → lotin; tasdiq so\'ralganini kirillcha AI javobidan ham taniydi', () => {
    expect(toLatinUz('Тасдиқлаш керак — «ҳа» деб ёзинг')).toBe("Tasdiqlash kerak — «ha» deb yozing");
    expect(toLatinUz("Йўқ, ўзгартир")).toBe("Yo'q, o'zgartir");
    expect(askedToConfirm('Тасдиқлаш керак — пастдаги тугмани босинг')).toBe(true);
    expect(askedToConfirm('Нужно подтверждение')).toBe(true);
    expect(askedToConfirm('Бугун 3 та вазифа бор.')).toBe(false);
  });

  it("o'z qarori (approve/reject) kirill o'zbekcha buyruqni ham taniydi; savol shakli emas", () => {
    expect(explicitDecision('approve', 'Алининг чиқимини тасдиқла')).toBe(true);
    expect(explicitDecision('reject', 'рад эт')).toBe(true);
    expect(explicitDecision('approve', 'ҳа', [{ role: 'assistant', text: 'Алининг 2 млн чиқимини тасдиқлайми?' }])).toBe(true);
    expect(explicitDecision('approve', 'тасдиқлаш керак бўлганлар қайси?')).toBe(false);
    expect(explicitDecision('approve', 'ҳа', [{ role: 'assistant', text: 'Бугун 3 та чиқим бор.' }])).toBe(false);
  });
});

describe('tasdiq oqimlari (chat/bot)', () => {
  it("uz-cyrl foydalanuvchi: tarixdagi AI javobi kirillda, «ҳа, тасдиқлайман» — model chaqirilmasdan bajariladi", async () => {
    const { A } = env;
    const g = fakeGenai([() => geminiCall('notifyManager', { message: 'Sement tugadi' }), () => geminiText('Rahbarga yuboraymi? Tasdiqlaysizmi?')]);
    const ctx = ctxFor(A.workerId, A.companyId, { channel: 'bot' });
    const first = await agentWith(g).run({ ctx, history: [], userText: 'раҳбарга цемент тугади деб ёз' });
    expect(first.pendingActions).toHaveLength(1);
    const g2 = NO_MODEL();
    const second = await agentWith(g2).run({
      ctx: { ...ctx, correlationId: 'c2' }, history: [{ role: 'user', text: 'ёз' }, { role: 'assistant', text: toLatinUz(first.text) }], userText: 'ҳа, тасдиқлайман',
    });
    expect(g2.requests).toHaveLength(0);
    expect(second.text).toMatch(/^✅/);
    expect(((await AiActionAudit.findById(first.pendingActions[0].pendingActionId).lean()) as any).status).toBe('ok');
  });

  it('rus: «Нет, не надо» — bekor qilinadi, model chaqirilmaydi', async () => {
    const { A } = env;
    const g = fakeGenai([() => geminiCall('notifyManager', { message: 'Опаздываю' }), () => geminiText('Отправить руководителю? Подтвердите.')]);
    const ctx = ctxFor(A.workerId, A.companyId, { lang: 'ru' });
    const first = await agentWith(g).run({ ctx, history: [], userText: 'напиши начальнику что опаздываю' });
    const g2 = NO_MODEL();
    const out = await agentWith(g2).run({ ctx: { ...ctx, correlationId: 'c3' }, history: [{ role: 'assistant', text: first.text }], userText: 'Нет, не надо' });
    expect(g2.requests).toHaveLength(0);
    expect(out.text).toMatch(/Отменено/);
    expect(((await AiActionAudit.findById(first.pendingActions[0].pendingActionId).lean()) as any).status).toBe('cancelled');
  });

  it("bir javobda ikki amal (ikki ishchiga eslatma) — bitta «ha» IKKALASINI bajaradi (biri osilib qolmaydi)", async () => {
    const { A } = env;
    const g = fakeGenai([
      () => ({
        candidates: [{ content: { role: 'model', parts: [
          { functionCall: { name: 'createReminder', args: { text: 'Kaska', date: tomorrow(), time: '07:30', targetUserId: A.workerId } } },
          { functionCall: { name: 'createReminder', args: { text: 'Kaska', date: tomorrow(), time: '07:30', targetUserId: A.worker2Id } } },
        ] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
      () => geminiText('Ikkalasiga eslatma — tasdiqlaysizmi?'),
    ]);
    const ctx = boss();
    const first = await agentWith(g).run({ ctx, history: [], userText: 'ikkala ishchiga ertaga 7:30 da kaska eslat' });
    expect(first.pendingActions).toHaveLength(2);
    expect(first.text).not.toMatch(SUCCESS_CLAIM_RE);
    const out = await agentWith(NO_MODEL()).run({ ctx: { ...ctx, correlationId: 'c4' }, history: [{ role: 'assistant', text: first.text }], userText: 'ha' });
    expect(out.toolCalls.map((t) => [t.name, t.status])).toEqual([['confirm', 'ok'], ['confirm', 'ok']]);
    expect(out.text.split('\n')).toHaveLength(2);
    expect(await AiReminder.countDocuments({ status: 'active' })).toBe(2);
    expect(await AiActionAudit.countDocuments({ status: 'needs_confirmation' })).toBe(0);
  });

  it("tasdiq BIR MARTA: AI so'z bilan so'ragan («Yuboraymi?»), foydalanuvchi «ha» — tool chaqirilib darhol bajariladi, karta qayta chiqmaydi", async () => {
    const { A } = env;
    const g = fakeGenai([
      () => geminiCall('createReminder', { text: 'Hisobot', date: tomorrow(), time: '09:00', targetUserId: A.workerId }),
      () => geminiText('Eslatma qo\'yildi.'),
    ]);
    const out = await agentWith(g).run({
      ctx: boss(), history: [{ role: 'user', text: 'ishchiga ertaga 9 da hisobot eslat' }, { role: 'assistant', text: "Ishchiga ertaga 09:00 da «Hisobot» eslatmasini qo'yaymi?" }],
      userText: 'ha qo\'ying',
    });
    expect(out.toolCalls[0]).toMatchObject({ name: 'createReminder', status: 'ok' });
    expect(out.pendingActions).toHaveLength(0);
    expect(out.text).toBe("Eslatma qo'yildi.");
    expect(await AiReminder.countDocuments({ targetUserId: A.workerId, status: 'active' })).toBe(1);
  });

  it("savolsiz «ha» yoki mazmunli buyruq — tasdiq kartasi kerak (o'z-o'zidan bajarilmaydi)", async () => {
    const { A } = env;
    const g = fakeGenai([
      () => geminiCall('createReminder', { text: 'Hisobot', date: tomorrow(), time: '09:00', targetUserId: A.workerId }),
      () => geminiText('Tasdiqlang.'),
    ]);
    const out = await agentWith(g).run({ ctx: boss(), history: [{ role: 'assistant', text: 'Bugun 2 ta vazifa bor.' }], userText: 'ha' });
    expect(out.toolCalls[0].status).toBe('needs_confirmation');
    expect(out.pendingActions).toHaveLength(1);
    const g2 = fakeGenai([
      () => geminiCall('createReminder', { text: 'Hisobot', date: tomorrow(), time: '10:00', targetUserId: A.workerId }),
      () => geminiText('Tasdiqlang.'),
    ]);
    const out2 = await agentWith(g2).run({ ctx: boss(), history: [{ role: 'assistant', text: "Qo'yaymi?" }], userText: 'ishchiga ertaga 10 da hisobot eslat' });
    expect(out2.toolCalls[0].status).toBe('needs_confirmation');
    expect(await AiReminder.countDocuments({})).toBe(0);
  });

  it("«ha»dan keyin model avval o'qish tool'ini chaqirsa (natijani ko'rgan) — yozuv avtomatik tasdiqlanmaydi (injeksiya himoyasi)", async () => {
    const { A } = env;
    const g = fakeGenai([
      () => geminiCall('listEmployees', {}),
      () => geminiCall('createReminder', { text: 'X', date: tomorrow(), time: '09:00', targetUserId: A.workerId }),
      () => geminiText('Tasdiqlang.'),
    ]);
    const out = await agentWith(g).run({ ctx: boss(), history: [{ role: 'assistant', text: "Eslatma qo'yaymi?" }], userText: 'ha' });
    expect(out.toolCalls.map((t) => t.status)).toEqual(['ok', 'needs_confirmation']);
    expect(await AiReminder.countDocuments({})).toBe(0);
  });

  it("o'ziga eslatma — tasdiqsiz bir martada; ikkinchi «ha» (kutilayotgan amal yo'q) oddiy suhbat", async () => {
    const { A } = env;
    const g = fakeGenai([() => geminiCall('createReminder', { text: 'Suv', date: tomorrow(), time: '08:00' }), () => geminiText("Ertaga 08:00 ga eslatma qo'yildi.")]);
    const out = await agentWith(g).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'эртага соат 8 да сув ичишни эслат' });
    expect(out.toolCalls[0].status).toBe('ok');
    expect(out.pendingActions).toHaveLength(0);
    const g2 = fakeGenai([() => geminiText('Yana nima kerak?')]);
    await agentWith(g2).run({ ctx: ctxFor(A.workerId, A.companyId), history: [{ role: 'assistant', text: out.text }], userText: 'ha' });
    expect(g2.requests).toHaveLength(1);
  });
});

describe('rol cheklovlari (tool to\'plami)', () => {
  it("ishchi: requestCallback va notifyManager bor; callEmployee/moliya yo'q. Rahbar: hammasi", () => {
    const w = effectiveToolNames(null, 'ishchi', false, { channel: 'web', purpose: 'assistant' });
    expect(w).toEqual(expect.arrayContaining(['requestCallback', 'notifyManager', 'createReminder', 'getMyTasks']));
    // getAttendanceSummary va approveTransaction ishchida ham bor — handler doirasi (o'zi / o'ziga kelgan yozuv)
    for (const t of ['callEmployee', 'messageEmployee', 'getAllowedFinancialReport']) expect(w).not.toContain(t);
    const b = effectiveToolNames(null, 'direktor', true, { channel: 'bot', purpose: 'assistant' });
    expect(b).toEqual(expect.arrayContaining(['callEmployee', 'messageEmployee', 'getAttendanceSummary', 'listExpenses', 'getProjectSummary', 'requestCallback']));
  });

  it("ishchi uchun model ruxsatsiz tool'ni chaqirsa — bajarilmaydi, aniq xabar; dasturchiga «AI qila olmadi»", async () => {
    const { A } = env;
    const g = fakeGenai([() => geminiCall('callEmployee', { employeeName: 'Alfa-prorab', message: 'kel' }), () => geminiText("Kechirasiz, bunday qo'ng'iroq qila olmayman.")]);
    const out = await agentWith(g).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: "prorabga qo'ng'iroq qilib ayt" });
    expect(out.toolCalls[0]).toMatchObject({ name: 'callEmployee', status: 'denied' });
    const rows = await unmetRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'unknown_tool', toolName: 'callEmployee', companyId: A.companyId, userId: A.workerId, channel: 'web' });
    expect(rows[0].userText).toBe("prorabga qo'ng'iroq qilib ayt");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/AI qila olmadi/);
    expect(alerts[0]).toMatch(/callEmployee/);
    expect(alerts[0]).toMatch(/Alfa/);
  });
});

describe('"AI qila olmadi" — aniqlash, saqlash, xabar', () => {
  it.each([
    ["Kechirasiz, buni qila olmayman.", true], ['Men bu ishni bajara olmayman', true], ['Qilolmayman', true], ["Bunday imkoniyatim yo'q", true],
    ["Afsus, qo'limdan kelmaydi", true], ['Кечирасиз, буни қила олмайман', true], ['Извините, я не могу это сделать', true],
    ['У меня нет доступа к этому', true], ['Bilmayman', true],
    ["Ertaga 08:00 ga eslatma qo'yildi.", false], ['Bugun 3 ta vazifa bor.', false], ['Готово, напоминание создано.', false], ['', false],
  ])('soundsLikeCant(%s) = %s', (t, want) => expect(soundsLikeCant(t as string)).toBe(want));

  it("model «qila olmayman» desa — cant_reply saqlanadi; oddiy javob — saqlanmaydi", async () => {
    const { A } = env;
    await agentWith(fakeGenai([() => geminiText("Kechirasiz, Excel fayl yubora olmayman.")]))
      .run({ ctx: ctxFor(A.workerId, A.companyId, { channel: 'bot' }), history: [], userText: 'hisobotni excelda yubor' });
    await agentWith(fakeGenai([() => geminiText('Bugun 2 ta vazifa bor.')]))
      .run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'vazifalarim' });
    const rows = await unmetRows();
    expect(rows.map((r) => [r.reason, r.channel, r.userText])).toEqual([['cant_reply', 'bot', 'hisobotni excelda yubor']]);
  });

  it("tool xatosi (o'tgan vaqt) — tool_error; model o'zi tuzatsa (keyin ok) — saqlanmaydi; aniqlashtiruvchi savol — xato emas", async () => {
    const { A } = env;
    await agentWith(fakeGenai([
      () => geminiCall('createReminder', { text: 'x', date: addDays(localDate(), -2), time: '09:00' }),
      () => geminiText("Eslatmani o'tgan vaqtga qo'yib bo'lmaydi."),
    ])).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'kecha 9 ga eslat' });
    let rows = await unmetRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'tool_error', toolName: 'createReminder' });
    expect(rows[0].toolMessage).toBeTruthy();

    await AiUnmetRequest.deleteMany({});
    await agentWith(fakeGenai([
      () => geminiCall('createReminder', { text: 'x', date: addDays(localDate(), -2), time: '09:00' }),
      () => geminiCall('createReminder', { text: 'x', date: tomorrow(), time: '09:00' }),
      () => geminiText("Ertaga 09:00 ga qo'yildi."),
    ])).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'ertaga 9 ga eslat' });
    expect(await unmetRows()).toHaveLength(0);

    // "Bir nechta xodim topildi ... Qaysi biri?" — aniqlashtirish (status error, lekin savol)
    await agentWith(fakeGenai([
      () => geminiCall('messageEmployee', { employeeName: 'ishchi', message: 'kel' }),
      () => geminiText('Qaysi ishchi?'),
    ])).run({ ctx: boss(), history: [{ role: 'assistant', text: 'Xabar yuboraymi?' }], userText: 'ha' });
    rows = await unmetRows();
    expect(rows.filter((r) => r.reason === 'tool_error')).toHaveLength(0);
  });

  it("rad (refusal), juda ko'p bosqich va model ishlamasa — saqlanadi", async () => {
    const { A } = env;
    const loop = fakeGenai([() => geminiCall('getMyTasks')]);
    await agentWith(loop).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'loop qil' });
    const down = fakeGenai([() => { throw new Error('503 Service Unavailable'); }]);
    const out = await agentWith(down).run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'salom' });
    expect(out.text).toMatch(/javob bera olmayapti/);
    const rows = await unmetRows();
    expect(rows.map((r) => r.reason)).toEqual(['rounds', 'provider_failed']);
  });

  it("tasdiq kutilayotgan amal — muammo emas (saqlanmaydi)", async () => {
    const { A } = env;
    await agentWith(fakeGenai([() => geminiCall('notifyManager', { message: 'Beton keldi' }), () => geminiText('Tasdiqlaysizmi?')]))
      .run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText: 'rahbarga beton keldi de' });
    expect(await unmetRows()).toHaveLength(0);
  });

  it("dasturchi xabari: bir xil muammo 6 soatda bir marta (yozuv har safar); soatiga ≤10 ta; telefon raqami yashiriladi", async () => {
    const { A } = env;
    const ask = (userText: string) => agentWith(fakeGenai([() => geminiText('Buni qila olmayman.')]))
      .run({ ctx: ctxFor(A.workerId, A.companyId), history: [], userText });
    await ask('+998901234567 ga sms yubor');
    await ask('+998901234568 ga sms yubor');                     // raqam boshqa — imzo bir xil
    let rows = await unmetRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].userText).not.toMatch(/901234567/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).not.toMatch(/901234567/);
    expect(unmetSignature({ userText: 'A 12', issue: { reason: 'cant_reply' } })).toBe(unmetSignature({ userText: 'a 99', issue: { reason: 'cant_reply' } }));
    for (let i = 0; i < 14; i++) await ask(`boshqa so'rov ${'x'.repeat(i + 1)}`);
    rows = await unmetRows();
    expect(rows).toHaveLength(16);
    expect(alerts).toHaveLength(10);
  });
});
