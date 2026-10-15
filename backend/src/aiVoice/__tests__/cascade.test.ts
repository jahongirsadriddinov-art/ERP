// Kaskad provayder (VAD → transkripsiya → TextAgent → TTS), energiya VAD, chiqish navbati (pacing + cap)
// va Gemini Live xabar xaritasi (soxta connector bilan — haqiqiy tarmoq yo'q).
import { describe, it, expect, vi } from 'vitest';
import type { TextAgent, TextAgentInput, TextAgentOutput, ToolCtx, VoiceOpenOpts } from '../contracts';
import { chunkPcm, silence, splitSentences, tone } from '../voice/audio';
import { CascadeProvider, type CascadeSession } from '../voice/cascade';
import { buildLiveConfig, GeminiLiveProvider, type LiveConnector } from '../voice/geminiLive';
import { OutQueue } from '../voice/outQueue';
import { EnergyVad } from '../voice/vad';

const ctx: ToolCtx = {
  companyId: 'c1', userId: 'u1', role: 'ishchi', isOwner: false, lang: 'uz', tz: 'Asia/Tashkent',
  channel: 'inapp_call', purpose: 'assistant', correlationId: '00000000-0000-4000-8000-000000000000',
};
const openOpts: VoiceOpenOpts = { model: 'm', systemInstruction: 'sys', tools: [], lang: 'uz', voiceName: 'Kore', ptt: false };

function agent(reply = 'Sizda 2 ta vazifa bor. Yana savol bormi?', extra: Partial<TextAgentOutput> = {}) {
  const inputs: TextAgentInput[] = [];
  const a: TextAgent = {
    run: async (i) => {
      inputs.push(i);
      return { text: reply, toolCalls: [], pendingActions: [], usage: { model: 't', tokensIn: 10, tokensOut: 5 }, ...extra };
    },
  };
  return { a, inputs };
}

const speech = (ms: number) => tone(ms, 16_000, 300, 9000);

async function openCascade(over: Partial<ConstructorParameters<typeof CascadeProvider>[0]> = {}, opts: Partial<VoiceOpenOpts> = {}) {
  const ag = agent();
  const tts = { synth: vi.fn(async (t: string) => tone(Math.min(400, 20 * t.length), 24_000)) };
  const transcriber = { transcribe: vi.fn(async () => ({ text: 'vazifalarim qanday', tokensIn: 3, tokensOut: 2 })) };
  const p = new CascadeProvider({ agent: ag.a, ctx, transcriber, tts, transcribeModel: 'tr', ttsModel: 'tts', ...over });
  const s = (await p.open({ ...openOpts, ...opts })) as CascadeSession;
  const ev = { audio: [] as Buffer[], transcripts: [] as any[], usage: [] as any[], interrupted: 0, closed: [] as any[] };
  s.on('audioOut', (b) => ev.audio.push(b));
  s.on('transcript', (t) => ev.transcripts.push(t));
  s.on('usage', (u) => ev.usage.push(u));
  s.on('interrupted', () => ev.interrupted++);
  s.on('closed', (c) => ev.closed.push(c));
  return { s, ev, ag, tts, transcriber };
}

describe('EnergyVad', () => {
  it('nutq segmentini ajratadi (jimlik → nutq → 500 ms jimlik)', () => {
    const v = new EnergyVad();
    const evs = [...v.push(silence(400, 16_000)), ...v.push(speech(800)), ...v.push(silence(700, 16_000))];
    expect(evs.map((e) => e.type)).toEqual(['start', 'end']);
    const end = evs[1] as { type: 'end'; pcm: Buffer; forced: boolean };
    expect(end.forced).toBe(false);
    expect(end.pcm.length).toBeGreaterThanOrEqual(800 * 32);
  });
  it('qisqa shovqin (<200 ms) nutq emas; uzun nutq maxSegment bo\'yicha bo\'linadi', () => {
    const v = new EnergyVad({ maxSegmentMs: 1_000 });
    expect(v.push(speech(100)).length).toBe(0);
    v.push(silence(600, 16_000));
    const evs = v.push(speech(2_500));
    expect(evs.filter((e) => e.type === 'end' && e.forced).length).toBeGreaterThanOrEqual(1);
  });
});

describe('CascadeProvider', () => {
  it('ovoz → transkripsiya → agent → TTS gapma-gap; transkriptlar va usage', async () => {
    const { s, ev, ag, tts } = await openCascade();
    s.pushAudio(Buffer.concat([silence(300, 16_000), speech(700), silence(700, 16_000)]));
    await s.idle();
    expect(ag.inputs[0].userText).toBe('vazifalarim qanday');
    expect(ag.inputs[0].ctx).toBe(ctx);
    expect(ev.transcripts.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(tts.synth).toHaveBeenCalledTimes(splitSentences('Sizda 2 ta vazifa bor. Yana savol bormi?').length);
    expect(ev.audio.length).toBe(2);
    expect(ev.usage.some((u) => u.tokensIn === 10)).toBe(true);
  });

  it('matnli navbat (disclosure\'dan keyingi start) agentga boradi, tarixga user sifatida yozilmaydi', async () => {
    const { s, ag } = await openCascade();
    s.sendText('[TIZIM] start');
    await s.idle();
    s.sendText('ikkinchi');
    await s.idle();
    expect(ag.inputs[0].userText).toBe('[TIZIM] start');
    expect(ag.inputs[1].history.every((h) => h.role === 'assistant')).toBe(true);
  });

  it('tool voqealari va tasdiq kartalari tashqariga uzatiladi (A7: tool agent ichida, toolCall chiqmaydi)', async () => {
    const onToolEvent = vi.fn();
    const onPendingAction = vi.fn();
    const ag = agent('Tasdiqlang.', {
      toolCalls: [{ name: 'notifyManager', status: 'needs_confirmation', message: 'tasdiq kerak' }],
      pendingActions: [{ pendingActionId: 'p1', summary: 's', expiresAt: 'x', confirmVia: 'ui', tool: 'notifyManager' }],
    });
    const { s } = await openCascade({ agent: ag.a, onToolEvent, onPendingAction });
    const toolCalls = vi.fn();
    s.on('toolCall', toolCalls);
    s.sendText('menejerga ayt');
    await s.idle();
    expect(onToolEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_confirmation' }));
    expect(onPendingAction).toHaveBeenCalledWith(expect.objectContaining({ pendingActionId: 'p1' }));
    expect(toolCalls).not.toHaveBeenCalled();
  });

  it('TTS ishlamasa: in-app — faqat matn (onTtsUnavailable), Telegram — sessiya yopiladi', async () => {
    const onTtsUnavailable = vi.fn();
    const bad = { synth: vi.fn(async () => { throw new Error('TTS down'); }) };
    const a = await openCascade({ tts: bad, onTtsUnavailable, ttsFailureMode: 'text_only' });
    a.s.sendText('salom');
    await a.s.idle();
    expect(onTtsUnavailable).toHaveBeenCalled();
    expect(a.ev.transcripts.some((t) => t.role === 'assistant')).toBe(true);
    expect(a.ev.closed).toHaveLength(0);

    const b = await openCascade({ tts: bad, ttsFailureMode: 'close' });
    b.s.sendText('salom');
    await b.s.idle();
    expect(b.ev.closed[0]).toMatchObject({ reason: 'tts_unavailable' });
  });

  it('barge-in: model gapirayotganda foydalanuvchi gapirsa — interrupted', async () => {
    let t = 0;
    const { s, ev } = await openCascade({ now: () => t });
    s.sendText('salom');
    await s.idle();
    expect(s.speaking).toBe(true);
    s.pushAudio(Buffer.concat([silence(200, 16_000), speech(400)]));
    expect(ev.interrupted).toBe(1);
    t = 1e9;
    expect(s.speaking).toBe(false);
  });

  it('PTT: faqat activityStart..End orasidagi audio, ≥200 ms', async () => {
    const { s, ag, transcriber } = await openCascade({}, { ptt: true });
    s.pushAudio(speech(500));                         // PTT bosilmagan — e'tiborsiz
    s.activityStart();
    s.pushAudio(speech(100));
    s.activityEnd();                                  // 100 ms — juda qisqa
    s.activityStart();
    s.pushAudio(speech(600));
    s.activityEnd();
    await s.idle();
    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);
    expect(ag.inputs).toHaveLength(1);
  });
});

describe('OutQueue (A10)', () => {
  it('real vaqtda chiqaradi (~lead ms oldinda), clear() kutayotganni bekor qiladi', () => {
    let now = 0;
    const sent: Buffer[] = [];
    const q = new OutQueue({ maxBytes: 24_000, send: (f) => sent.push(f), leadMs: 400, now: () => now });
    for (const f of chunkPcm(tone(2_000, 24_000))) q.push(f);          // 2 s = 50 kadr
    expect(sent.length).toBe(10);                                      // 400 ms
    now = 200; q.pump();
    expect(sent.length).toBe(15);
    q.clear();
    now = 5_000; q.pump();
    expect(sent.length).toBe(15);
    q.close();
  });
  it('transport buferi ~500 ms dan oshsa — eng eski kadrlar tashlanadi', () => {
    const sent: Buffer[] = [];
    let backlog = 0;
    const q = new OutQueue({ maxBytes: 24_000, backlogBytes: () => backlog, send: (f) => { sent.push(f); backlog += f.length; }, leadMs: 10_000 });
    for (const f of chunkPcm(tone(1_000, 24_000))) q.push(f);
    expect(sent.length).toBe(12);                                      // 12 × 1920 ≤ 24 000
    expect(q.droppedFrames).toBe(13);
    q.close();
  });
});

describe('GeminiLive (soxta connector)', () => {
  function fakeConnector() {
    const sent: any[] = [];
    let cb: any;
    let params: any;
    const connector: LiveConnector = {
      connect: async (_key, p) => {
        cb = p.callbacks; params = p;
        queueMicrotask(() => cb.onmessage({ setupComplete: {} }));
        return {
          sendRealtimeInput: (x: any) => sent.push(['rt', x]),
          sendClientContent: (x: any) => sent.push(['cc', x]),
          sendToolResponse: (x: any) => sent.push(['tr', x]),
          close: () => { sent.push(['close']); cb.onclose({ code: 1000 }); },
        };
      },
    };
    return { connector, sent, msg: (m: any) => cb.onmessage(m), get params() { return params; } };
  }

  it('konfiguratsiya: AUDIO, transkripsiyalar, BLOCKING tool\'lar, resumption, PTT', () => {
    const cfg: any = buildLiveConfig({
      ...openOpts, ptt: true, resumptionHandle: 'h',
      tools: [{ name: 'x', description: 'd', behavior: 'BLOCKING', parameters: { type: 'object', properties: { a: { type: 'string', enum: ['p', 'q'] } } } }],
    });
    expect(cfg.responseModalities).toEqual(['AUDIO']);
    expect(cfg.inputAudioTranscription).toEqual({});
    expect(cfg.outputAudioTranscription).toEqual({});
    expect(cfg.tools[0].functionDeclarations[0].behavior).toBe('BLOCKING');
    expect(cfg.sessionResumption).toEqual({ handle: 'h' });
    expect(cfg.realtimeInputConfig.automaticActivityDetection.disabled).toBe(true);
  });

  it('xabarlar → hodisalar: audio, transkript, toolCall, goAway, resumption; tool javobi hech qachon {} emas', async () => {
    const f = fakeConnector();
    const p = new GeminiLiveProvider({ connector: f.connector });
    const s = await p.open({ ...openOpts, apiKey: 'k' });
    expect(f.params.model).toBe('m');
    const got: any = { audio: 0, tr: [] as any[], calls: [] as any[], goAway: 0, handle: '' };
    s.on('audioOut', () => got.audio++);
    s.on('transcript', (t) => got.tr.push(t));
    s.on('toolCall', (c) => got.calls.push(c));
    s.on('goAway', (g) => { got.goAway = g.timeLeftMs; });
    s.on('resumption', (r) => { got.handle = r.handle; });
    f.msg({ serverContent: { inputTranscription: { text: 'salom' } } });
    f.msg({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(480).toString('base64') } }] }, outputTranscription: { text: 'Assalomu' } } });
    f.msg({ serverContent: { turnComplete: true } });
    f.msg({ toolCall: { functionCalls: [{ id: 'c1', name: 'getMyTasks', args: { a: 1 } }] } });
    f.msg({ goAway: { timeLeft: '5s' } });
    f.msg({ sessionResumptionUpdate: { resumable: true, newHandle: 'H2' } });
    expect(got.audio).toBe(1);
    expect(got.tr.filter((t: any) => t.final).map((t: any) => [t.role, t.text])).toEqual([['user', 'salom'], ['assistant', 'Assalomu']]);
    expect(got.calls[0]).toEqual({ id: 'c1', name: 'getMyTasks', args: { a: 1 } });
    expect(got.goAway).toBe(5000);
    expect(got.handle).toBe('H2');
    s.pushAudio(Buffer.alloc(640));
    s.toolResponse([{ id: 'c1', name: 'getMyTasks', result: { status: 'ok', message: 'm', retryable: false } }]);
    const rt = f.sent.find((x) => x[0] === 'rt')[1];
    expect(rt.audio.mimeType).toBe('audio/pcm;rate=16000');
    const tr = f.sent.find((x) => x[0] === 'tr')[1];
    expect(tr.functionResponses[0]).toMatchObject({ id: 'c1', name: 'getMyTasks', response: { status: 'ok', message: 'm' } });
    const closed = vi.fn();
    s.on('closed', closed);
    await s.close('hangup');
    expect(closed).toHaveBeenCalledWith({ reason: 'hangup' });
  });

  it('setup kelmasa — SETUP_TIMEOUT (menejer kaskadga o\'tadi)', async () => {
    const connector: LiveConnector = { connect: async () => ({ sendRealtimeInput() {}, sendClientContent() {}, sendToolResponse() {}, close() {} }) };
    const p = new GeminiLiveProvider({ connector, setupTimeoutMs: 50 });
    await expect(p.open({ ...openOpts, apiKey: 'k' })).rejects.toThrow('SETUP_TIMEOUT');
  });
});
