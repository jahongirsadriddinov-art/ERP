// Ovozli qo'ng'iroq ishonchliligi (owner 2026-10-16 "ilovada AI qo'ng'iroq ishlamayapti"):
// xato tasnifi va sabab kodlari, Live model zanjiri + o'chirgich, Live yiqilsa kaskad (ochilishda va
// suhbat o'rtasida), kalit xatosida kaskad sinalmaydi, aiv:ready faqat provayder tayyor bo'lganda,
// osilib qolgan sessiyalar semaforni band qilmaydi.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiCallSession from '../../models/AiCallSession';
import AiConversation from '../../models/AiConversation';
import { __setActorCacheTtlForTests } from '../actor';
import type { AivEndReason } from '../contracts';
import { tone } from '../voice/audio';
import { FakeVoiceProvider } from '../voice/fakeProvider';
import type { ProviderKind } from '../voice/provider';
import { VoiceSessionManager } from '../voice/sessionManager';
import type { VoiceTransport } from '../voice/types';
import {
  __resetVoiceHealth, classifyVoiceError, failCodeFor, LIVE_FALLBACK_MODELS, liveModelDown, modelChain, noteLiveFailure,
  noteLiveOk, turnFailText, worthNextModel,
} from '../voice/voiceErrors';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';
import { __resetGeminiKeysForTests, GeminiQuotaError } from '../lib/geminiKeys';
import { __resetLiveSearchForTests, buildLiveConfig, GeminiLiveProvider, type LiveConnector } from '../voice/geminiLive';
import { CascadeProvider, type CascadeSession } from '../voice/cascade';
import { silence } from '../voice/audio';
import type { ProviderSessionCtx } from '../voice/sessionManager';

class FakeTransport implements VoiceTransport {
  kind = 'inapp' as const;
  audio: Buffer[] = [];
  events: { event: string; payload: any }[] = [];
  closed?: AivEndReason;
  sendAudio(b: Buffer) { this.audio.push(b); }
  flushAudio() { /* */ }
  sendEvent(event: string, payload: unknown) { this.events.push({ event, payload }); }
  close(r: AivEndReason) { this.closed = r; }
  ev(name: string) { return this.events.filter((e) => e.event === name).map((e) => e.payload); }
}

const QUOTA = () => new Error('LIVE_CLOSED_BEFORE_SETUP_1011: You exceeded your current quota (RESOURCE_EXHAUSTED)');

describe('voiceErrors (sof)', () => {
  afterEach(() => __resetVoiceHealth());

  it('tasnif: kvota / model yo\'q / kalit / taymaut / tarmoq / sozlanmagan', () => {
    expect(classifyVoiceError(QUOTA())).toBe('quota');
    expect(classifyVoiceError(new Error('429 Too Many Requests'))).toBe('quota');
    expect(classifyVoiceError(new Error('models/gemini-x is not found for API version v1beta, or is not supported for bidiGenerateContent'))).toBe('model');
    expect(classifyVoiceError(new Error('LIVE_CLOSED_BEFORE_SETUP_1008: model not available'))).toBe('model');
    expect(classifyVoiceError(new Error('API key not valid. Please pass a valid API key.'))).toBe('auth');
    expect(classifyVoiceError(new Error('SETUP_TIMEOUT'))).toBe('timeout');
    expect(classifyVoiceError(new Error('getaddrinfo ENOTFOUND generativelanguage.googleapis.com'))).toBe('network');
    expect(classifyVoiceError(new Error('GEMINI_NOT_CONFIGURED'))).toBe('not_configured');
    expect(classifyVoiceError(new Error('something odd'))).toBe('other');
  });

  it('mijoz kodi va kaskad navbati matni', () => {
    expect(failCodeFor('quota')).toBe('ai_quota');
    expect(failCodeFor('auth')).toBe('ai_not_configured');
    expect(failCodeFor('not_configured')).toBe('ai_not_configured');
    expect(failCodeFor('network')).toBe('ai_unavailable');
    expect(turnFailText('quota', 'uz')).toMatch(/limit/);
    expect(turnFailText('other', 'ru')).toMatch(/Повторите/);
  });

  it('keyingi modelga o\'tish: kvota/model — ha; tarmoq/taymaut/kalit — yo\'q', () => {
    expect(worthNextModel(QUOTA())).toBe(true);
    expect(worthNextModel(new Error('is not found'))).toBe(true);
    expect(worthNextModel(new Error('SETUP_TIMEOUT'))).toBe(false);
    expect(worthNextModel(new Error('ECONNRESET'))).toBe(false);
    expect(worthNextModel(new Error('API key not valid'))).toBe(false);
  });

  it('model zanjiri: env (vergul bilan) birinchi, takrorsiz, noto\'g\'ri nomlar tashlanadi, ≤ max', () => {
    expect(modelChain(undefined, LIVE_FALLBACK_MODELS)).toEqual(LIVE_FALLBACK_MODELS.slice(0, 3));
    expect(modelChain('my-live, gemini-3.8-live', LIVE_FALLBACK_MODELS, 3)).toEqual(['my-live', 'gemini-3.8-live', 'gemini-3.1-flash-live-preview']);
    expect(modelChain('bad model!; x', ['a'], 3)).toEqual(['a']);
  });

  it('o\'chirgich: kvota → 60 s o\'chiq, ok → tiklanadi; noma\'lum xato — o\'chirmaydi', () => {
    const t = 1_000_000;
    expect(noteLiveFailure('m1', QUOTA(), t)).toBe('quota');
    expect(liveModelDown('m1', t + 59_000)).toBe(true);
    expect(liveModelDown('m1', t + 61_000)).toBe(false);
    noteLiveFailure('m2', new Error('is not found'), t);
    expect(liveModelDown('m2', t + 60 * 60_000 - 1)).toBe(false);   // 30 daqiqadan keyin tiklanadi
    noteLiveFailure('m3', QUOTA(), t);
    noteLiveOk('m3');
    expect(liveModelDown('m3', t + 1)).toBe(false);
    noteLiveFailure('m4', new Error('weird'), t);
    expect(liveModelDown('m4', t + 1)).toBe(false);
  });
});

let mongo: MongoMemoryServer;
let A: SeedCompany;
const saved = { en: process.env.AI_VOICE_ENABLED, cap: process.env.AI_LIVE_MAX_CONCURRENT, model: process.env.AI_LIVE_MODEL };
const managers: VoiceSessionManager[] = [];

function mk(live: FakeVoiceProvider | null, cascade: FakeVoiceProvider | null, clip: Buffer | null = tone(100, 24_000)) {
  const mgr = new VoiceSessionManager({
    providerFor: (kind: ProviderKind) => (kind === 'gemini_live' ? live : cascade),
    clipOnLive: true, disclosure: { getClip: async () => clip },
    setupTimeoutMs: 1_000, touchMs: 200, disclosureTimeoutMs: 300,
  });
  managers.push(mgr);
  return mgr;
}

async function start(mgr: VoiceSessionManager, employeeId = A.workerId) {
  const transport = new FakeTransport();
  const r = await mgr.start({ companyId: A.companyId, employeeId, purpose: 'assistant', channel: 'inapp_call', lang: 'uz', ptt: false, transport, userInitiated: true });
  if (!r.ok) throw new Error(`start: ${r.reason}`);
  return { h: r.handle, transport };
}

describe('VoiceSessionManager ishonchliligi', () => {
  beforeAll(async () => {
    process.env.AI_VOICE_ENABLED = 'true';
    delete process.env.AI_LIVE_MODEL;
    mongo = await startMongo();
    await AiConversation.init();
    __setActorCacheTtlForTests(0);
    A = await seedCompany('VREL');
  }, 120_000);

  afterEach(async () => {
    for (const m of managers.splice(0)) { await m.drain(2_000); m.dispose(); }
    await AiCallSession.updateMany({ isActive: true }, { $set: { isActive: false, status: 'cancelled' } });
    delete process.env.AI_LIVE_MAX_CONCURRENT;
    __resetVoiceHealth();
  });

  afterAll(async () => {
    __setActorCacheTtlForTests(10_000);
    for (const [k, v] of [['AI_VOICE_ENABLED', saved.en], ['AI_LIVE_MAX_CONCURRENT', saved.cap], ['AI_LIVE_MODEL', saved.model]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await stopMongo(mongo);
  });

  it('Live kvotada: zanjirdagi har model sinaladi → kaskad; keyingi qo\'ng\'iroq o\'chiq modellarni o\'tkazadi', async () => {
    const live = new FakeVoiceProvider({ failOpen: QUOTA() });
    const cascade = new FakeVoiceProvider({ name: 'gemini_cascade' });
    const { h, transport } = await start(mk(live, cascade));
    await h.connected();
    expect(live.opens.map((o) => o.model)).toEqual(LIVE_FALLBACK_MODELS.slice(0, 3));
    expect(cascade.opens.length).toBe(1);
    expect(transport.ev('aiv:ready').length).toBe(1);
    expect(transport.closed).toBeUndefined();
    expect(((await AiCallSession.findById(h.sessionId).lean()) as any).provider).toBe('gemini_cascade');
    await h.end('hangup');

    const t0 = Date.now();
    const second = await start(mk(live, cascade));
    await second.h.connected();
    expect(live.opens.length).toBe(3);                                    // o'chirgich: Live qayta sinalmadi
    expect(cascade.opens.length).toBe(2);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('hammasi yiqilsa — mijozga sabab kodi (ai_quota) end\'dan OLDIN; aiv:ready yuborilmaydi', async () => {
    const live = new FakeVoiceProvider({ failOpen: QUOTA() });
    const { h, transport } = await start(mk(live, null));
    await h.connected();
    await vi.waitFor(() => expect(transport.closed).toBe('error'));
    const err = transport.ev('aiv:error');
    expect(err[0]).toMatchObject({ code: 'ai_quota' });
    expect(String(err[0].message)).toMatch(/limit/);
    expect(transport.ev('aiv:ready').length).toBe(0);
    expect(((await AiCallSession.findById(h.sessionId).lean()) as any).status).toBe('failed');
  });

  it('kalit noto\'g\'ri (auth) — kaskad sinalmaydi, kod ai_not_configured', async () => {
    const live = new FakeVoiceProvider({ failOpen: new Error('API key not valid. Please pass a valid API key.') });
    const cascade = new FakeVoiceProvider({ name: 'gemini_cascade' });
    const { h, transport } = await start(mk(live, cascade));
    await h.connected();
    await vi.waitFor(() => expect(transport.closed).toBe('error'));
    expect(live.opens.length).toBe(1);
    expect(cascade.opens.length).toBe(0);
    expect(transport.ev('aiv:error')[0]).toMatchObject({ code: 'ai_not_configured' });
  });

  it('tarmoq/taymaut — qolgan Live modellari o\'tkaziladi, darhol kaskad', async () => {
    const live = new FakeVoiceProvider({ failOpen: new Error('SETUP_TIMEOUT') });
    const cascade = new FakeVoiceProvider({ name: 'gemini_cascade' });
    const { h, transport } = await start(mk(live, cascade));
    await h.connected();
    expect(live.opens.length).toBe(1);
    expect(cascade.opens.length).toBe(1);
    expect(transport.ev('aiv:ready').length).toBe(1);
  });

  it('aiv:ready faqat provayder tayyor bo\'lganda; disclosure matni darhol', async () => {
    const live = new FakeVoiceProvider({ openDelayMs: 300 });
    const { h, transport } = await start(mk(live, null));
    const p = h.connected();
    await new Promise((r) => setTimeout(r, 100));
    expect(transport.ev('aiv:ready').length).toBe(0);
    await p;
    expect(transport.ev('aiv:ready').length).toBe(1);
    const first = transport.events.findIndex((e) => e.event === 'aiv:transcript');
    expect(first).toBeGreaterThan(transport.events.findIndex((e) => e.event === 'aiv:ready'));
  });

  it('suhbat o\'rtasida Live uzilsa (resume handle yo\'q) — kaskadga o\'tadi, qo\'ng\'iroq uzilmaydi', async () => {
    const live = new FakeVoiceProvider();
    const cascade = new FakeVoiceProvider({ name: 'gemini_cascade' });
    const { h, transport } = await start(mk(live, cascade));
    await h.connected();
    live.last!.drop('1011 quota exceeded');
    await vi.waitFor(() => expect(cascade.opens.length).toBe(1));
    await vi.waitFor(() => expect(transport.ev('aiv:error').some((e) => e.code === 'ai_fallback')).toBe(true));
    expect(transport.closed).toBeUndefined();
    cascade.last!.say('Davom etamiz');
    await vi.waitFor(() => expect(transport.ev('aiv:transcript').some((t) => t.text === 'Davom etamiz')).toBe(true));
    expect(((await AiCallSession.findById(h.sessionId).lean()) as any).provider).toBe('gemini_cascade');
    expect(liveModelDown(LIVE_FALLBACK_MODELS[0])).toBe(true);           // kvota — model o'chirgichda
  });

  it('semafor osilmaydi: 45 s+ yangilanmagan begona faol sessiya cap\'ni band qilmaydi (AI_LIVE_MAX_CONCURRENT=1)', async () => {
    process.env.AI_LIVE_MAX_CONCURRENT = '1';
    const orphan: any = await AiCallSession.create({
      companyId: A.companyId, employeeId: A.prorabId, correlationId: 'orphan-corr-1', purpose: 'assistant', channel: 'inapp_call',
      direction: 'inbound', status: 'connected', isActive: true, attemptNo: 1, provider: 'gemini_live', instanceId: 'dead-instance',
      limits: { ringTimeoutSec: 30, maxDurationSec: 600 }, startedAt: new Date(), ringingAt: new Date(),
    });
    await AiCallSession.collection.updateOne({ _id: orphan._id }, { $set: { updatedAt: new Date(Date.now() - 120_000) } });
    const { h } = await start(mk(new FakeVoiceProvider(), null));
    expect(h.sessionId).toBeTruthy();
    const o: any = await AiCallSession.findById(orphan._id).lean();
    expect(o).toMatchObject({ isActive: false, status: 'interrupted', endReason: 'orphan_reclaim' });
  });

  it('tirik (yangi) sessiya cap\'ni band qiladi — yopilmaydi', async () => {
    process.env.AI_LIVE_MAX_CONCURRENT = '1';
    const mgr = mk(new FakeVoiceProvider(), null);
    await start(mgr, A.prorabId);
    const transport = new FakeTransport();
    const r = await mgr.start({ companyId: A.companyId, employeeId: A.workerId, purpose: 'assistant', channel: 'inapp_call', lang: 'uz', ptt: false, transport });
    expect(r).toEqual({ ok: false, reason: 'platform_cap' });
  });

  it('band (o\'sha xodim) — eskirgan eski sessiya yopilib, yangisi ochiladi', async () => {
    const old: any = await AiCallSession.create({
      companyId: A.companyId, employeeId: A.workerId, correlationId: 'orphan-corr-2', purpose: 'assistant', channel: 'inapp_call',
      direction: 'inbound', status: 'connected', isActive: true, attemptNo: 1, provider: 'gemini_live', instanceId: 'dead-instance',
      limits: { ringTimeoutSec: 30, maxDurationSec: 600 }, startedAt: new Date(), ringingAt: new Date(),
    });
    await AiCallSession.collection.updateOne({ _id: old._id }, { $set: { updatedAt: new Date(Date.now() - 120_000) } });
    process.env.AI_LIVE_MAX_CONCURRENT = '5';
    const { h } = await start(mk(new FakeVoiceProvider(), null));
    expect(h.sessionId).not.toBe(String(old._id));
    expect(((await AiCallSession.findById(old._id).lean()) as any).isActive).toBe(false);
  });

  it('prewarm: disclosure klipi so\'raladi (firma nomi bilan), hech narsa yuborilmaydi', async () => {
    const asked: string[] = [];
    const mgr = new VoiceSessionManager({
      providerFor: () => null,
      clipOnLive: true, disclosure: { getClip: async (r) => { asked.push(r.text); return null; } },
    });
    managers.push(mgr);
    await mgr.prewarm(A.companyId, A.workerId);
    expect(asked.length).toBe(1);
    expect(asked[0]).toMatch(/VREL/);
  });
});

// ───────────── Live: barcha kalitlar sinaladi (umumiy aylanish, lib/geminiKeys) ─────────────
describe('GeminiLiveProvider — kalit aylanishi', () => {
  const savedKeys = process.env.GEMINI_API_KEYS;
  afterEach(() => {
    if (savedKeys === undefined) delete process.env.GEMINI_API_KEYS; else process.env.GEMINI_API_KEYS = savedKeys;
    __resetGeminiKeysForTests();
  });

  function connector(behave: (key: string) => 'quota' | 'auth' | 'ok') {
    const tried: string[] = [];
    const c: LiveConnector = {
      connect: async (key, p) => {
        tried.push(key);
        const b = behave(key);
        if (b === 'quota') throw new Error('LIVE_CLOSED_BEFORE_SETUP_1011: You exceeded your current quota');
        if (b === 'auth') throw new Error('API key not valid. Please pass a valid API key.');
        setTimeout(() => p.callbacks.onmessage({ setupComplete: {} } as any), 5);
        return { sendRealtimeInput() {}, sendClientContent() {}, sendToolResponse() {}, close() {} };
      },
    };
    return { c, tried };
  }
  const opts = { model: 'live-m', systemInstruction: 's', tools: [], lang: 'uz' as const, voiceName: 'Kore', ptt: false };

  it("Live Google qidiruvi (owner 2026-10-19): avval qidiruv bilan; model rad etsa — qidiruvsiz ochiladi va keyin so'ralmaydi", async () => {
    process.env.GEMINI_API_KEYS = 'k1';
    __resetGeminiKeysForTests();
    __resetLiveSearchForTests();
    const seen: boolean[] = [];
    const c: LiveConnector = {
      connect: async (_key, prm: any) => {
        const hasSearch = JSON.stringify(prm.config.tools || []).includes('googleSearch');
        seen.push(hasSearch);
        if (hasSearch) throw new Error('LIVE_CLOSED_BEFORE_SETUP_1007: Invalid tool googleSearch');
        setTimeout(() => prm.callbacks.onmessage({ setupComplete: {} } as any), 5);
        return { sendRealtimeInput() {}, sendClientContent() {}, sendToolResponse() {}, close() {} };
      },
    };
    const p = new GeminiLiveProvider({ connector: c, setupTimeoutMs: 500 });
    await (await p.open({ ...opts, model: 'search-m' })).close('t');
    expect(seen).toEqual([true, false]);
    seen.length = 0;
    await (await p.open({ ...opts, model: 'search-m' })).close('t');
    expect(seen).toEqual([false]);
    expect(JSON.stringify(buildLiveConfig({ ...opts, model: 'x' }, { search: true }).tools)).toContain('googleSearch');
  });

  it("1-va 2-kalit kvotada — 3-kalit bilan ulanadi; keyingi ochilish kvotadagi kalitlarni o'tkazadi", async () => {
    process.env.GEMINI_API_KEYS = 'k1,k2,k3';
    __resetGeminiKeysForTests();
    const { c, tried } = connector((k) => (k === 'k3' ? 'ok' : 'quota'));
    const p = new GeminiLiveProvider({ connector: c, setupTimeoutMs: 500 });
    const s = await p.open(opts);
    expect(tried).toEqual(['k1', 'k2', 'k3']);
    await s.close('t');
    tried.length = 0;
    await (await p.open(opts)).close('t');
    expect(tried).toEqual(['k3']);
  });

  it("hamma kalit kvotada — GeminiQuotaError (menejer keyingi model / kaskadga o'tadi); boshqa model alohida", async () => {
    process.env.GEMINI_API_KEYS = 'k1,k2';
    __resetGeminiKeysForTests();
    const { c, tried } = connector(() => 'quota');
    const p = new GeminiLiveProvider({ connector: c, setupTimeoutMs: 500 });
    await expect(p.open(opts)).rejects.toBeInstanceOf(GeminiQuotaError);
    expect(tried).toEqual(['k1', 'k2']);
    tried.length = 0;
    await expect(p.open(opts)).rejects.toBeInstanceOf(GeminiQuotaError);
    expect(tried).toEqual([]);                                        // sovushda — tarmoqqa chiqilmaydi
    await expect(p.open({ ...opts, model: 'live-2' })).rejects.toBeInstanceOf(GeminiQuotaError);
    expect(tried).toEqual(['k1', 'k2']);                              // kvota model bo'yicha
  });

  it("hamma kalit noto'g'ri — kvota emas, ruxsat xatosi (mijozga ai_not_configured)", async () => {
    process.env.GEMINI_API_KEYS = 'k1,k2';
    __resetGeminiKeysForTests();
    const { c } = connector(() => 'auth');
    const p = new GeminiLiveProvider({ connector: c, setupTimeoutMs: 500 });
    const err = await p.open(opts).catch((e) => e);
    expect(classifyVoiceError(err)).toBe('auth');
  });
});

describe('Kvota-chidamlilik: Live semafori va kaskad transkripsiyasi', () => {
  beforeAll(async () => {
    process.env.AI_VOICE_ENABLED = 'true';
    mongo = await startMongo();
    __setActorCacheTtlForTests(0);
    A = await seedCompany('VQ');
  }, 120_000);
  afterEach(async () => {
    for (const m of managers.splice(0)) { await m.drain(2_000); m.dispose(); }
    await AiCallSession.updateMany({ isActive: true }, { $set: { isActive: false, status: 'cancelled' } });
    delete process.env.AI_LIVE_MAX_CONCURRENT;
    __resetVoiceHealth();
  });
  afterAll(async () => {
    __setActorCacheTtlForTests(10_000);
    await stopMongo(mongo);
  });

  it("Live semafori to'lgan — foydalanuvchi qo'ng'irog'i «limit» emas: kaskad bilan ulanadi (Live ochilmaydi)", async () => {
    process.env.AI_LIVE_MAX_CONCURRENT = '1';
    const live = new FakeVoiceProvider();
    const cascade = new FakeVoiceProvider({ name: 'gemini_cascade' });
    const mgr = mk(live, cascade);
    const first = await start(mgr, A.prorabId);
    await first.h.connected();
    expect(live.opens.length).toBe(1);
    const second = await start(mgr, A.workerId);
    await second.h.connected();
    expect(live.opens.length).toBe(1);
    expect(cascade.opens.length).toBe(1);
    expect(second.transport.ev('aiv:ready').length).toBe(1);
    expect(((await AiCallSession.findById(second.h.sessionId).lean()) as any).provider).toBe('gemini_cascade');
  });

  it("rejali (AI → xodim) qo'ng'iroq Live semaforida kutadi (A6) — o'zgarmagan", async () => {
    process.env.AI_LIVE_MAX_CONCURRENT = '1';
    const mgr = mk(new FakeVoiceProvider(), new FakeVoiceProvider({ name: 'gemini_cascade' }));
    await start(mgr, A.prorabId);
    const r = await mgr.start({ companyId: A.companyId, employeeId: A.workerId, purpose: 'attendance', channel: 'inapp_call', lang: 'uz', ptt: false, transport: new FakeTransport() });
    expect(r).toEqual({ ok: false, reason: 'platform_cap' });
  });

  it("kaskad transkripsiyasi kvotada — mijozga ai_quota («matn bilan davom etamiz») va qo'ng'iroq yopiladi", async () => {
    let pctx: ProviderSessionCtx | null = null;
    const mgr = new VoiceSessionManager({
      providerFor: (kind, c) => {
        if (kind === 'gemini_live') return null;
        pctx = c;
        return new CascadeProvider({
          agent: { run: async () => ({ text: 'ok', toolCalls: [], pendingActions: [], usage: { model: 't', tokensIn: 1, tokensOut: 1 } }) },
          ctx: c.toolCtx, tts: null, transcribeModel: 'tr', ttsModel: 'tts',
          transcriber: { transcribe: async () => { throw new GeminiQuotaError(true, new Date()); } },
          onInputUnavailable: c.onInputUnavailable, onTtsUnavailable: c.onTtsUnavailable,
        });
      },
      clipOnLive: true, disclosure: { getClip: async () => null },
      setupTimeoutMs: 1_000, touchMs: 200, disclosureTimeoutMs: 100,
    });
    managers.push(mgr);
    const { h, transport } = await start(mgr);
    await h.connected();
    expect(pctx).toBeTruthy();
    const vs = (h as any).vs as CascadeSession;
    vs.pushAudio(Buffer.concat([silence(300, 16_000), tone(700, 16_000, 300, 9000), silence(700, 16_000)]));
    await vi.waitFor(() => expect(transport.closed).toBe('error'));
    expect(transport.ev('aiv:error').find((e) => e.code === 'ai_quota')?.message).toMatch(/matn bilan davom etamiz/);
  });
});
