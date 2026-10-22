// Owner 2026-10-17 (#1–#5): bitta salom, umumiy savollar (getWeather), aytilganini bajarish (endCall),
// tasdiq SHU joyda (bot/chat tugmasi, matnli "ha", ovozli answerPendingAction), kanal + shaxs konteksti,
// dasturchi (firmasiz) rejimi. Tarmoq YO'Q — soxta fetch / soxta provayder.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import AiActionAudit from '../../../models/AiActionAudit';
import User from '../../../models/User';
import { ErpTextAgent } from '../agent';
import { createGeminiProvider } from '../providers/gemini';
import { buildSystemPrompt, CHANNEL_GUIDE } from '../systemPrompt';
import { pureYesNo, stripRepeatedGreeting } from '../style';
import { buildVoiceSystemPrompt } from '../../voice/prompts';
import { buildPlatformSystemPrompt, PLATFORM_SCOPE } from '../../platform';
import { __resetGeminiKeysForTests } from '../../lib/geminiKeys';
import { executeTool } from '../../tools/executor';
import { generalToolNames } from '../../tools/rbac';
import { registerTool } from '../../tools/registry';
import { setWeatherFetch } from '../../tools/general/getWeather';
import { setEndCallHook } from '../../tools/general/callControl';
import { ctxFor, resetCaches, setupErp, teardownErp, type Env } from '../../tools/erp/__tests__/erpHelpers';
import { fakeGenai, geminiCall, geminiText } from './fakes';

let env: Env;
let devId = '';
const savedKey = process.env.GEMINI_API_KEY;
const savedKeys = process.env.GEMINI_API_KEYS;

beforeAll(async () => {
  env = await setupErp();
  delete process.env.GEMINI_API_KEYS;
  process.env.GEMINI_API_KEY = 'test-gemini-key-not-real';
  devId = String(((await User.create({ firstName: 'Dev', phone: '+998900001717', role: 'dasturchi' } as any)) as any)._id);
}, 120_000);
afterAll(async () => {
  setWeatherFetch(null); setEndCallHook(null);
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
  if (savedKeys !== undefined) process.env.GEMINI_API_KEYS = savedKeys;
  await teardownErp(env);
});
beforeEach(() => { resetCaches(); __resetGeminiKeysForTests(); });

const agentWith = (g: ReturnType<typeof fakeGenai>) => new ErpTextAgent({
  providers: { gemini: createGeminiProvider({ factory: g.factory }) },
  env: { gemini: true, openrouter: false, claude: false },
});

/** Open-Meteo soxtasi: geokodlash + prognoz. */
function fakeWeather(opts: { fail?: boolean; noPlace?: boolean } = {}) {
  const urls: string[] = [];
  setWeatherFetch(async (url) => {
    urls.push(url);
    if (opts.fail) throw new Error('ECONNREFUSED');
    if (url.includes('geocoding')) return { ok: true, status: 200, json: async () => (opts.noPlace ? { results: [] } : { results: [{ name: 'Samarqand', latitude: 39.65, longitude: 66.96 }] }) };
    return {
      ok: true, status: 200, json: async () => ({
        current: { temperature_2m: 18.4, apparent_temperature: 17, weather_code: 2, wind_speed_10m: 9, relative_humidity_2m: 40 },
        daily: { time: ['2026-10-17', '2026-10-18', '2026-10-19'], weather_code: [2, 61, 0], temperature_2m_max: [21, 15, 19], temperature_2m_min: [9, 8, 7], precipitation_probability_max: [5, 80, 0] },
      }),
    };
  });
  return urls;
}

describe('#1 bitta salom va sof ha/yo\'q', () => {
  it('takroriy salom va tanishtiruv olib tashlanadi; foydalanuvchi salom bersa — tegilmaydi', () => {
    expect(stripRepeatedGreeting("Assalomu alaykum! Bugun 3 ta vazifa bor.", 'vazifalarim')).toBe('Bugun 3 ta vazifa bor.');
    expect(stripRepeatedGreeting("Assalomu alaykum, men Alfa kompaniyasining sun'iy intellekt yordamchisiman. Eshitaman.", 'nima gap')).toBe('Eshitaman.');
    expect(stripRepeatedGreeting('Здравствуйте! Сейчас 15:00.', 'который час')).toBe('Сейчас 15:00.');
    expect(stripRepeatedGreeting('Va alaykum assalom!', 'salom')).toBe('Va alaykum assalom!');
    expect(stripRepeatedGreeting('Salom!', 'nima')).toBe('Salom!');            // bo'sh qolsa — asl matn
  });

  it("pureYesNo: faqat sof javob", () => {
    expect(pureYesNo('Ha')).toBe(true);
    expect(pureYesNo('tasdiqlayman!')).toBe(true);
    expect(pureYesNo('да')).toBe(true);
    expect(pureYesNo("yo'q")).toBe(false);
    expect(pureYesNo('bekor qil')).toBe(false);
    expect(pureYesNo('ha, lekin ertaga')).toBeNull();
    expect(pureYesNo('ertaga 7 da eslat')).toBeNull();
    // Owner 2026-10-22: qisqa tasdiq iborasi ham sof javob (avval "aniq tasdiqlang" deb aylanib qolardi)
    expect(pureYesNo('ha tasdiqlayman')).toBe(true);
    expect(pureYesNo('Ha, albatta qiling')).toBe(true);
    expect(pureYesNo('да, подтверждаю')).toBe(true);
    expect(pureYesNo("yo'q kerak emas")).toBe(false);
    expect(pureYesNo('ha qil lekin 20 ga')).toBeNull();
    expect(pureYesNo('qil')).toBeNull();
  });
});

describe('#2 #5 prompt: kanal, shaxs, umumiy savollar', () => {
  it('Telegram qo\'ng\'irog\'i: jonli ovoz, "ulana olmayman" yo\'q, og\'zaki tasdiq va endCall; kim gaplashyapti', () => {
    const p = buildSystemPrompt({ lang: 'uz', role: 'prorab', channel: 'telegram_call', today: '2026-10-17', companyName: 'Alfa', userName: 'Ali Valiyev' });
    expect(p).toContain(CHANNEL_GUIDE.telegram_call);
    expect(p).toMatch(/JONLI OVOZLI/);
    expect(p).toMatch(/"ulana olmayman"/);
    expect(p).toMatch(/answerPendingAction/);
    expect(p).toMatch(/endCall/);
    expect(p).toMatch(/- Siz: ERP AI yordamchi \(Alfa firmasi\)/);
    expect(p).toMatch(/- Suhbatdosh: Ali Valiyev \(prorab, Alfa\)/);
    expect(p).toMatch(/Kanal: Telegram orqali JONLI OVOZLI/);
  });

  it('umumiy savollarga ruxsat, salom bir marta, aytilganni bajarish', () => {
    const p = buildSystemPrompt({ lang: 'uz', role: 'ishchi', channel: 'bot', today: '2026-10-17' });
    expect(p).toMatch(/UMUMIY SAVOLLAR/);
    expect(p).toMatch(/"men faqat ERP bo'yicha" DEMANG/);
    expect(p).toMatch(/Salomlashish BIR MARTA/);
    expect(p).toMatch(/Aytilgan ishni BAJARING/);
    expect(p).toMatch(/tugmalari SHU chatda/);
    expect(p).toMatch(/getWeather/);
  });

  it('ovozli prompt kanal yo\'riqnomasini meros oladi', () => {
    const v = buildVoiceSystemPrompt({ lang: 'uz', role: 'ishchi', channel: 'inapp_call', today: '2026-10-17', purpose: 'assistant' });
    expect(v).toContain(CHANNEL_GUIDE.inapp_call);
  });

  it('dasturchi prompti: kanal, shaxs, firma ma\'lumoti yo\'q', () => {
    const p = buildPlatformSystemPrompt({ lang: 'uz', userName: 'Dev', today: '2026-10-17', channel: 'telegram_call', status: { aiEnabled: true, companiesWithAi: 3, account: 'connected', workerOnline: true } });
    expect(p).toContain(CHANNEL_GUIDE.telegram_call);
    expect(p).toMatch(/Suhbatdosh: Dev \(dasturchi, firmasiz\)/);
    expect(p).toMatch(/getWeather/);
    expect(p).toMatch(/AI yoqilgan faol firmalar: 3 ta/);
  });
});

describe('#2 getWeather (Open-Meteo, kalitsiz)', () => {
  it('shahar bo\'yicha: geokodlash → prognoz; javob qisqa va aniq', async () => {
    const urls = fakeWeather();
    const out = await executeTool(ctxFor(env.A.workerId, env.A.companyId), 'getWeather', { city: 'Samarqand' });
    expect(out.result.status).toBe('ok');
    expect(out.result.message).toBe("Samarqand: hozir 18°C, qisman bulutli. Bugun 9…21°C, yog'ingarchilik ehtimoli 5%.");
    expect(urls[0]).toMatch(/geocoding-api\.open-meteo\.com.*name=Samarqand/);
    expect(urls[1]).toMatch(/api\.open-meteo\.com\/v1\/forecast\?latitude=39\.650&longitude=66\.960/);
  });

  it('ertaga; shahar aytilmasa — obyekt nuqtasi yo\'q → Toshkent', async () => {
    const urls = fakeWeather();
    const out = await executeTool(ctxFor(env.A.workerId, env.A.companyId), 'getWeather', { day: 'tomorrow' });
    expect(out.result.status).toBe('ok');
    expect(out.result.message).toBe("Toshkent, 2026-10-18: 8…15°C, yomg'ir, yog'ingarchilik ehtimoli 80%.");
    expect(urls[0]).toMatch(/latitude=41\.300&longitude=69\.240/);
  });

  it('joy topilmasa — not_found; xizmat ishlamasa — error (o\'ylab topmaydi)', async () => {
    fakeWeather({ noPlace: true });
    expect((await executeTool(ctxFor(env.A.workerId, env.A.companyId), 'getWeather', { city: 'Qwertyabad' })).result.status).toBe('not_found');
    fakeWeather({ fail: true });
    expect((await executeTool(ctxFor(env.A.workerId, env.A.companyId), 'getWeather', { city: 'Buxoro' })).result.status).toBe('error');
  });

  it('firma tool matritsasida bo\'lmasa ham yoqiq (general)', async () => {
    const AiAssistantSettings = (await import('../../../models/AiAssistantSettings')).default;
    await AiAssistantSettings.updateOne({ companyId: env.A.companyId }, { $set: { 'tools.byRole.ishchi': ['getMyTasks'] } });
    resetCaches();
    fakeWeather();
    try {
      expect((await executeTool(ctxFor(env.A.workerId, env.A.companyId), 'getWeather', { city: 'Samarqand' })).result.status).toBe('ok');
    } finally {
      await AiAssistantSettings.updateOne({ companyId: env.A.companyId }, { $unset: { 'tools.byRole': 1 } });
      resetCaches();
    }
  });
});

describe('#3 endCall — "telefonni o\'chir"', () => {
  it('ovozli kanalda shu sessiyani tugatadi; chatda — ruxsat yo\'q', async () => {
    const hook = vi.fn(async () => true);
    setEndCallHook(hook);
    const ctx = ctxFor(env.A.workerId, env.A.companyId, { channel: 'telegram_call', sessionId: 'sess-end-1' });
    const out = await executeTool(ctx, 'endCall', {});
    expect(out.result.status).toBe('ok');
    expect(out.result.message).toMatch(/xayrlashuv/);
    expect(hook).toHaveBeenCalledWith('sess-end-1', env.A.workerId, expect.any(Number));
    const web = await executeTool(ctxFor(env.A.workerId, env.A.companyId, { channel: 'web' }), 'endCall', {});
    expect(web.result.status).toBe('denied');
    setEndCallHook(async () => false);
    expect((await executeTool(ctx, 'endCall', {}, { idempotencyKey: 'other' })).result.status).toBe('not_found');
    setEndCallHook(null);
  });
});

describe('#4 tasdiq SHU joyda', () => {
  it('ovoz: needs_confirmation xabari og\'zaki so\'rashni aytadi; answerPendingAction faqat SHU sessiya amalini bajaradi', async () => {
    const { A } = env;
    const ctx = ctxFor(A.workerId, A.companyId, { channel: 'inapp_call', sessionId: 'sess-voice-1' });
    const p = await executeTool(ctx, 'notifyManager', { message: 'Sement tugadi' });
    expect(p.result.status).toBe('needs_confirmation');
    expect(p.result.message).toMatch(/Tasdiqlaysizmi\?/);
    expect(p.result.message).toMatch(/answerPendingAction/);
    expect(p.result.message).not.toMatch(/bot|tugmani bos/i);
    // Boshqa sessiya — topilmaydi
    const other = await executeTool({ ...ctx, sessionId: 'sess-voice-2' }, 'answerPendingAction', { accept: true });
    expect(other.result.status).toBe('not_found');
    // Shu sessiya — bajariladi
    const yes = await executeTool(ctx, 'answerPendingAction', { accept: true });
    expect(yes.result.status).toBe('ok');
    const row: any = await AiActionAudit.findById(p.pending!.pendingActionId).lean();
    expect(row.status).toBe('ok');
    // Chat kanalida bu tool yo'q
    expect((await executeTool(ctxFor(A.workerId, A.companyId, { channel: 'web' }), 'answerPendingAction', { accept: true })).result.status).toBe('denied');
  });

  it('chat: tasdiq xabari SHU chatdagi tugma/"ha" haqida; "ha" deb yozilsa — model chaqirilmasdan bajariladi', async () => {
    const { A } = env;
    const g = fakeGenai([() => geminiCall('notifyManager', { message: 'Beton kech keladi' }), () => geminiText('Rahbarga yuboraymi? Tasdiqlaysizmi?')]);
    const ctx = ctxFor(A.workerId, A.companyId, { channel: 'web' });
    const first = await agentWith(g).run({ ctx, history: [], userText: 'rahbarga beton kech keladi deb yoz' });
    expect(first.pendingActions).toHaveLength(1);
    expect(first.pendingActions[0].confirmVia).toBe('ui');
    const g2 = fakeGenai([() => geminiText('SHOULD NOT BE CALLED')]);
    const second = await agentWith(g2).run({
      ctx: { ...ctx, correlationId: 'c2' }, history: [{ role: 'user', text: 'rahbarga yoz' }, { role: 'assistant', text: first.text }], userText: 'ha',
    });
    expect(g2.requests).toHaveLength(0);
    expect(second.toolCalls[0]).toMatchObject({ name: 'confirm', status: 'ok' });
    expect(second.text).toMatch(/^✅/);
    const row: any = await AiActionAudit.findById(first.pendingActions[0].pendingActionId).lean();
    expect(row.status).toBe('ok');
  });

  it('"ha" — AI tasdiq so\'ramagan bo\'lsa oddiy suhbat (model chaqiriladi)', async () => {
    const { A } = env;
    const g = fakeGenai([() => geminiText('Yaxshi.')]);
    const out = await agentWith(g).run({ ctx: ctxFor(A.workerId, A.companyId), history: [{ role: 'assistant', text: 'Bugun 2 ta vazifa bor.' }], userText: 'ha' });
    expect(g.requests).toHaveLength(1);
    expect(out.text).toBe('Yaxshi.');
  });

  it('bot: takroriy salom olib tashlanadi', async () => {
    const { A } = env;
    const g = fakeGenai([() => geminiText('Assalomu alaykum! Bugun smenangiz 08:00 da.')]);
    const out = await agentWith(g).run({ ctx: ctxFor(A.workerId, A.companyId, { channel: 'bot' }), history: [], userText: 'smenam qachon' });
    expect(out.text).toBe('Bugun smenangiz 08:00 da.');
  });
});

describe('dasturchi (firmasiz) rejimi', () => {
  it('executor: firma tool\'i firmasiz — rad; dasturchi + umumiy tool — ishlaydi; oddiy firmasiz foydalanuvchi — rad', async () => {
    fakeWeather();
    const devCtx = ctxFor(devId, PLATFORM_SCOPE, { channel: 'bot' });
    const erp = await executeTool(devCtx, 'getMyTasks', {});
    expect(erp.result.status).toBe('denied');
    const w = await executeTool(devCtx, 'getWeather', { city: 'Samarqand' });
    expect(w.result.status).toBe('ok');
    const audit: any = await AiActionAudit.findOne({ actorUserId: devId, tool: 'getMyTasks' }).lean();
    expect(audit.errorCode).toBe('no_company');
    expect(audit.companyId).toBe(PLATFORM_SCOPE);
    const stranger = await executeTool(ctxFor(env.A.workerId, ''), 'getWeather', { city: 'Samarqand' });
    expect(stranger.result.status).toBe('denied');
  });

  it('agent: platforma prompti, faqat umumiy tool\'lar e\'lon qilinadi', async () => {
    fakeWeather();
    const g = fakeGenai([() => geminiCall('getWeather', { city: 'Samarqand' }), () => geminiText('Samarqandda 18°C.')]);
    const out = await agentWith(g).run({ ctx: ctxFor(devId, PLATFORM_SCOPE, { channel: 'bot' }), history: [], userText: 'Samarqandda havo qanday?' });
    expect(out.text).toBe('Samarqandda 18°C.');
    const decl = g.requests[0].config.tools[0].functionDeclarations.map((d: any) => d.name);
    expect(decl).toEqual(generalToolNames({ channel: 'bot', purpose: 'assistant' }));
    expect(decl).toContain('getWeather');
    expect(decl).not.toContain('getMyTasks');
    expect(g.requests[0].config.systemInstruction).toMatch(/platforma DASTURCHISI/);
    expect(out.toolCalls[0]).toMatchObject({ name: 'getWeather', status: 'ok' });
  });

  it('agent: dasturchi bo\'lmagan firmasiz foydalanuvchi — model chaqirilmaydi', async () => {
    const g = fakeGenai([() => geminiText('x')]);
    const out = await agentWith(g).run({ ctx: ctxFor(env.A.workerId, ''), history: [], userText: 'salom' });
    expect(g.requests).toHaveLength(0);
    expect(out.text).toMatch(/o'chirilgan|mavjud emas/);
  });
});

describe('registry: ovozli tasdiq faqat bitta nom va faqat ovozli kanallar (B3)', () => {
  const base = {
    description: { uz: 'x', ru: 'x' }, parameters: { type: 'object' as const, properties: {} }, kind: 'write' as const, confirm: 'never' as const,
    maxRoles: ['ishchi' as const], defaultRoles: [], purposes: ['assistant' as const], behavior: 'BLOCKING' as const, handler: async () => ({ status: 'ok' as const, message: '', retryable: false }),
  };
  it('boshqa nom yoki chat kanali — registerTool rad etadi', () => {
    expect(() => registerTool({ ...base, name: 'sayYesTool', spokenConfirm: true, channels: ['inapp_call'] })).toThrow(/spokenConfirm/);
    expect(() => registerTool({ ...base, name: 'confirmByVoice', channels: ['inapp_call'] })).toThrow(/taqiqlangan/);
  });
});
