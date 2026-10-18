// Owner 2026-10-18: hamma narsani bilsin (valyuta, internet), xarakter va avatar sozlamasi, tarjimon (faqat rahbar),
// aniq xodimga xabar/qo'ng'iroq, qo'ng'iroq ichidan qayta qo'ng'iroq, kamera (rasm/video). Tarmoq YO'Q — soxtalar.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildSystemPrompt } from '../systemPrompt';
import { buildVoiceSystemPrompt } from '../../voice/prompts';
import { executeTool } from '../../tools/executor';
import { getTool } from '../../tools/registry';
import { currencyCode, setKnowledgeFetch, setSearchFn } from '../../tools/general/knowledge';
import { setWeatherFetch } from '../../tools/general/getWeather';
import GpsLocation from '../../../models/GpsLocation';
import { langLabel } from '../../tools/general/translator';
import { findEmployee } from '../../tools/erp/contactEmployee';
import { mergePersona, personaPromptLine, resolveAvatarLook, voiceGender } from '../../persona';
import { defaultSettings, validateSettingsUpdate } from '../../settings';
import { clearVision, getMedia, latestFrame, pushFrame } from '../../voice/vision';
import { ctxFor, resetCaches, setupErp, teardownErp, type Env } from '../../tools/erp/__tests__/erpHelpers';

let env: Env;
beforeAll(async () => { env = await setupErp(); }, 120_000);
afterAll(async () => { setKnowledgeFetch(null); setSearchFn(null); setWeatherFetch(null); await teardownErp(env); });
beforeEach(() => resetCaches());

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

describe('valyuta va internet', () => {
  it('getExchangeRate — CBU kursi, summa hisobi; xato bo\'lsa "bilmayman" emas, keyinroq', async () => {
    setKnowledgeFetch(async () => ({ ok: true, status: 200, json: async () => [{ Ccy: 'USD', Rate: '12650.15', Diff: '-12.5', Nominal: '1', Date: '18.10.2026' }] }));
    expect(currencyCode('dollar')).toBe('USD');
    expect(currencyCode('евро')).toBe('EUR');
    const out = await executeTool(ctxFor(env.A.workerId, env.A.companyId), 'getExchangeRate', { currency: 'dollar', amount: 100 });
    expect(out.result.status).toBe('ok');
    expect(out.result.message).toMatch(/1 USD = 12 650,15 so'm/);
    expect(out.result.message).toMatch(/100 USD = 1 265 015 so'm/);
    setKnowledgeFetch(async () => { throw new Error('ECONNREFUSED'); });
    const bad = await executeTool(ctxFor(env.A.workerId, env.A.companyId), 'getExchangeRate', {});
    expect(bad.result.status).toBe('error');
    expect(bad.result.retryable).toBe(true);
  });

  it('searchWeb — javob untrusted sifatida qaytadi', async () => {
    setSearchFn(async (q) => ({ text: `Javob: ${q}`, sources: ['kun.uz'] }));
    const out = await executeTool(ctxFor(env.A.workerId, env.A.companyId, { channel: 'telegram_call' }), 'searchWeb', { query: 'Toshkentda metro narxi' });
    expect(out.result.status).toBe('ok');
    expect(JSON.stringify(out.result.data)).toContain('untrusted_text');
    expect(JSON.stringify(out.result.data)).toContain('metro narxi');
  });
});

describe("ob-havo (owner 2026-10-19): zaxira manba va joylashuv", () => {
  it("Open-Meteo ishlamasa — wttr.in; shahar aytilmasa — foydalanuvchining GPS nuqtasi", async () => {
    const urls: string[] = [];
    setWeatherFetch(async (url) => {
      urls.push(url);
      if (url.includes('open-meteo')) throw new Error('HTTP_429');
      return { ok: true, status: 200, json: async () => ({
        current_condition: [{ temp_C: '14', FeelsLikeC: '12', weatherCode: '113', windspeedKmph: '7', humidity: '30' }],
        weather: [{ date: '2026-10-19', maxtempC: '18', mintempC: '6', hourly: [{ chanceofrain: '0', weatherCode: '113' }] }],
      }) };
    });
    await GpsLocation.create({ userId: env.A.workerId, lat: 39.74, lng: 64.18, timestamp: new Date() } as any);
    const out = await executeTool(ctxFor(env.A.workerId, env.A.companyId, { channel: 'telegram_call' }), 'getWeather', {});
    expect(out.result.status).toBe('ok');
    expect(out.result.message).toMatch(/Joylashuvingiz: hozir 14°C/);
    expect(urls.some((u) => u.startsWith('https://wttr.in/39.740,64.180'))).toBe(true);
  });
});

describe('xarakter va avatar', () => {
  it('sozlama: persona/avatar validatsiya va birlashtirish', () => {
    const cur = defaultSettings(env.A.companyId);
    const ok = validateSettingsUpdate({ persona: { style: 'formal', name: 'Malika' }, avatar: { look: 'orb' } }, cur, { role: 'direktor', isOwner: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.persona).toEqual({ style: 'formal', name: 'Malika' });
      expect(ok.value.avatar).toEqual({ look: 'orb' });
    }
    const bad = validateSettingsUpdate({ persona: { style: 'rude' }, avatar: { look: 'cat' } }, cur, { role: 'direktor', isOwner: true });
    expect(bad.ok).toBe(false);
    expect(mergePersona({ style: 'x', name: '  ', custom: 'a'.repeat(500) })).toEqual({ style: 'friendly', custom: 'a'.repeat(400) });
  });

  it('avatar ovozga qarab; prompt XARAKTER qatori', () => {
    expect(voiceGender('Puck')).toBe('male');
    expect(resolveAvatarLook({ voiceName: 'Puck', avatar: { look: 'auto' } })).toBe('male');
    expect(resolveAvatarLook({ voiceName: 'Kore' })).toBe('female');
    expect(resolveAvatarLook({ voiceName: 'Kore', avatar: { look: 'orb' } })).toBe('orb');
    const line = personaPromptLine({ style: 'cheerful', name: 'Jasur' }, 'Puck');
    expect(line).toMatch(/quvnoq/);
    expect(line).toMatch(/"Jasur"/);
    expect(line).toMatch(/erkak ovozi/);
    const p = buildSystemPrompt({ lang: 'uz', role: 'direktor', channel: 'web', today: '2026-10-18', persona: { style: 'formal' }, voiceName: 'Kore' });
    expect(p).toMatch(/XARAKTER: uslubingiz — rasmiy/);
    expect(p).toMatch(/searchWeb/);
    expect(p).toMatch(/getExchangeRate/);
  });

  it("ovozli prompt: o'zbek ko'cha tili boshqa til deb tushunilmaydi; kamera qoidasi faqat vision bilan", () => {
    const base = { lang: 'uz' as const, purpose: 'assistant' as const, channel: 'telegram_call' as const, role: 'direktor', today: '2026-10-18' };
    const v = buildVoiceSystemPrompt(base);
    expect(v).toMatch(/turk, qozoq, qirg'iz, tojik/);
    expect(v).not.toMatch(/KAMERA:/);
    expect(buildVoiceSystemPrompt({ ...base, vision: true })).toMatch(/KAMERA:/);
  });
});

describe('tarjimon — faqat direktor/o\'rinbosar', () => {
  it('rahbarga ruxsat, ishchiga yo\'q', async () => {
    expect(langLabel('inglizcha', 'uz')).toBe('ingliz');
    expect(langLabel('en', 'uz')).toBe('ingliz');
    const boss = await executeTool(ctxFor(env.A.ownerId, env.A.companyId, { role: 'direktor', isOwner: true, channel: 'telegram_call' }), 'setTranslatorMode', { on: true, langA: 'uz', langB: 'en' });
    expect(boss.result.status).toBe('ok');
    expect(JSON.stringify(boss.result.data)).toMatch(/TARJIMON REJIMI YOQILDI/);
    const orin = await executeTool(ctxFor(env.A.orinbosarId, env.A.companyId, { role: 'orinbosar' }), 'setTranslatorMode', { on: true, langB: 'ru' });
    expect(orin.result.status).toBe('ok');
    const worker = await executeTool(ctxFor(env.A.workerId, env.A.companyId), 'setTranslatorMode', { on: true });
    expect(worker.result.status).not.toBe('ok');
  });
});

describe('aniq xodimga murojaat', () => {
  it('ism bo\'yicha topish: bitta / bir nechta / boshqa firma emas', async () => {
    const ctx = ctxFor(env.A.ownerId, env.A.companyId, { role: 'direktor', isOwner: true });
    expect((await findEmployee(ctx, { employeeName: 'Alfa-prorab' })).one?.id).toBe(env.A.prorabId);
    expect((await findEmployee(ctx, { employeeName: 'ishchi' })).many?.length).toBe(2);
    expect((await findEmployee(ctx, { employeeName: 'Beta-prorab' })).one).toBeUndefined();
  });

  it('messageEmployee va callEmployee — tasdiq so\'raladi (boshqa odamga ta\'sir), ishchiga yopiq', async () => {
    const boss = ctxFor(env.A.ownerId, env.A.companyId, { role: 'direktor', isOwner: true, channel: 'telegram_call' });
    const m = await executeTool(boss, 'messageEmployee', { employeeName: 'Alfa-prorab', message: 'menga aloqaga chiqsin' });
    expect(m.result.status).toBe('needs_confirmation');
    const c = await executeTool(boss, 'callEmployee', { employeeName: 'Alfa-prorab', message: 'menga aloqaga chiqsin' });
    expect(c.result.status).toBe('needs_confirmation');
    const w = await executeTool(ctxFor(env.A.workerId, env.A.companyId), 'messageEmployee', { employeeName: 'Alfa-prorab', message: 'salom' });
    expect(w.result.status).not.toBe('ok');
    expect(w.result.status).not.toBe('needs_confirmation');
  });

  it("requestCallback qo'ng'iroq ichida ham mavjud", () => {
    expect(getTool('requestCallback')?.channels).toEqual(expect.arrayContaining(['telegram_call', 'inapp_call', 'web', 'bot']));
  });
});

describe('kamera', () => {
  it('kadr xotirasi: faqat JPEG, oxirgi kadr', () => {
    expect(pushFrame('s1', Buffer.from('not a jpeg'))).toBe(false);
    pushFrame('s1', JPEG);
    expect(latestFrame('s1')?.jpeg.equals(JPEG)).toBe(true);
    clearVision('s1');
    expect(latestFrame('s1')).toBeNull();
  });

  it('capturePhoto: kamera bo\'lmasa aniq sabab; bo\'lsa media saqlanadi', async () => {
    const ctx = ctxFor(env.A.ownerId, env.A.companyId, { role: 'direktor', isOwner: true, channel: 'telegram_call', sessionId: 'cam-sess-1' });
    const none = await executeTool(ctx, 'capturePhoto', {});
    expect(none.result.status).toBe('error');
    expect(none.result.message).toMatch(/kamera/i);
    pushFrame('cam-sess-1', JPEG);
    const out = await executeTool(ctx, 'capturePhoto', { caption: 'Beton' });
    expect(out.result.status).toBe('ok');
    const id = (out.result.data as any).mediaId;
    expect(getMedia(id, env.A.companyId)?.kind).toBe('photo');
    expect(getMedia(id, env.B.companyId)).toBeNull();
    clearVision('cam-sess-1');
    // Chat kanalida kamera tool'i yo'q
    const web = await executeTool(ctxFor(env.A.ownerId, env.A.companyId, { role: 'direktor', isOwner: true }), 'capturePhoto', {});
    expect(web.result.status).not.toBe('ok');
   }, 30_000);
});
