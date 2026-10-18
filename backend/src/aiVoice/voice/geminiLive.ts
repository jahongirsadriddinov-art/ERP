import { Behavior, GoogleGenAI, Modality, Type } from '@google/genai';
import type { JsonSchema, ToolDeclaration, ToolResult } from '../contracts';
import { GeminiQuotaError, isAuthError, isQuotaError, withGeminiKey } from '../lib/geminiKeys';
import { VoiceEmitter, parseDurationMs } from './provider';
import type { VoiceOpenOpts, VoiceProvider, VoiceSession } from './types';

// Gemini Live provayderi (@google/genai 2.28 `ai.live.connect`). Kirish: 16 kHz PCM16
// (audio/pcm;rate=16000), chiqish: 24 kHz PCM16. Kirish/chiqish transkripsiyasi yoqilgan.
// Tool'lar BLOCKING (A7) — model tool javobini kutadi. Sessiya resumption (GoAway → yangi ulanish
// handle bilan, menejer qiladi), contextWindowCompression slidingWindow.
// open() faqat setupComplete kelgach resolve bo'ladi (≤4 s, aks holda SETUP_TIMEOUT → kaskad).
// API sirti node_modules/@google/genai/dist/genai.d.ts bo'yicha tekshirilgan (Session.sendRealtimeInput,
// sendClientContent, sendToolResponse, LiveServerMessage). Model nomi — env/sozlamada (kodda emas).
// 2026-10-16 haqiqiy kalit bilan sinaldi (12 ERP tool + to'liq prompt): gemini-3.8-live setup ~0.9 s,
// birinchi ovoz ~1.7 s; gemini-3.1-flash-live-preview ham ishlaydi. Qayta sinash: geminiLive.live.test.ts.

export interface LiveSessionLike {
  sendRealtimeInput(p: any): void;
  sendClientContent(p: any): void;
  sendToolResponse(p: any): void;
  close(): void;
}
export interface LiveCallbacksLike {
  onopen?: () => void;
  onmessage: (m: any) => void;
  onerror?: (e: any) => void;
  onclose?: (e: any) => void;
}
export interface LiveConnector {
  connect(apiKey: string, params: { model: string; config: Record<string, unknown>; callbacks: LiveCallbacksLike }): Promise<LiveSessionLike>;
}

export const defaultLiveConnector: LiveConnector = {
  connect: (apiKey, params) => new GoogleGenAI({ apiKey }).live.connect(params as any) as unknown as Promise<LiveSessionLike>,
};

const TYPE_MAP: Record<JsonSchema['type'], Type> = {
  object: Type.OBJECT, string: Type.STRING, number: Type.NUMBER, integer: Type.INTEGER, boolean: Type.BOOLEAN, array: Type.ARRAY,
};

/** Bizning JsonSchema → Gemini Schema (OpenAPI 3 qism-to'plami). Cheklovlar tavsifga yoziladi. */
export function toGeminiSchema(s: JsonSchema, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = { type: TYPE_MAP[s.type] };
  const hints: string[] = [];
  if (s.format === 'objectId') hints.push('24-character hex id');
  if (s.format === 'date') hints.push('YYYY-MM-DD');
  if (s.format === 'time') hints.push('HH:mm');
  if (s.format === 'date-time') hints.push('ISO date-time');
  if (s.minimum !== undefined) hints.push(`min ${s.minimum}`);
  if (s.maximum !== undefined) hints.push(`max ${s.maximum}`);
  if (s.maxLength !== undefined) hints.push(`max ${s.maxLength} chars`);
  if (s.maxItems !== undefined) hints.push(`max ${s.maxItems} items`);
  if (s.enum?.length && s.type !== 'string') hints.push(`one of ${s.enum.join(', ')}`);
  const desc = [s.description, hints.length ? `(${hints.join(', ')})` : ''].filter(Boolean).join(' ').trim();
  if (desc) out.description = desc;
  if (s.enum?.length && s.type === 'string') out.enum = s.enum.map(String);
  if (s.type === 'array' && s.items && depth < 6) out.items = toGeminiSchema(s.items, depth + 1);
  if (s.type === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties || {})) props[k] = toGeminiSchema(v, depth + 1);
    out.properties = props;
    if (s.required?.length) out.required = [...s.required];
  }
  return out;
}

export function toFunctionDeclarations(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toGeminiSchema(t.parameters),
    behavior: Behavior.BLOCKING,                    // A7: HAR DOIM bloklovchi
  }));
}

/** Live ulanish konfiguratsiyasi (test uchun eksport). */
export function buildLiveConfig(opts: VoiceOpenOpts): Record<string, unknown> {
  const decls = toFunctionDeclarations(opts.tools || []);
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: { parts: [{ text: opts.systemInstruction }] },
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName || 'Kore' } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: opts.ptt
      ? { automaticActivityDetection: { disabled: true } }
      : { automaticActivityDetection: { silenceDurationMs: 600, prefixPaddingMs: 200 } },
    contextWindowCompression: { slidingWindow: {} },
    // Har doim yoqiladi — server SessionResumptionUpdate yuboradi (GoAway'da qayta ulanish uchun)
    sessionResumption: opts.resumptionHandle ? { handle: opts.resumptionHandle } : {},
    ...(decls.length ? { tools: [{ functionDeclarations: decls }] } : {}),
    ...(opts.signal ? { abortSignal: opts.signal } : {}),
  };
}

const sumModality = (list: any, modality: string): number =>
  Array.isArray(list) ? list.filter((x) => String(x?.modality || '').toUpperCase() === modality).reduce((a, x) => a + (Number(x?.tokenCount) || 0), 0) : 0;

export class GeminiLiveSession extends VoiceEmitter implements VoiceSession {
  private live: LiveSessionLike | null = null;
  private closing = false;
  private closeReason = 'client';
  private closedEmitted = false;
  private inText = '';
  private outText = '';
  private setupResolve: (() => void) | null = null;
  private setupReject: ((e: Error) => void) | null = null;
  readonly setupDone: Promise<void>;
  setupOk = false;

  constructor() {
    super();
    this.setupDone = new Promise<void>((res, rej) => { this.setupResolve = res; this.setupReject = rej; });
    this.setupDone.catch(() => undefined);
  }

  attach(live: LiveSessionLike) { this.live = live; }

  /** LiveServerMessage → VoiceSession hodisalari. */
  handleMessage(m: any): void {
    if (!m || typeof m !== 'object') return;
    if (m.setupComplete) {
      this.setupOk = true;
      this.setupResolve?.();
      this.emit('setupComplete');
    }
    const sc = m.serverContent;
    if (sc) {
      const parts: any[] = Array.isArray(sc.modelTurn?.parts) ? sc.modelTurn.parts : [];
      for (const p of parts) {
        const d = p?.inlineData;
        if (d?.data && /^audio\//i.test(String(d.mimeType || 'audio/pcm'))) {
          const b = Buffer.from(String(d.data), 'base64');
          if (b.length >= 2) this.emit('audioOut', b.length % 2 ? b.subarray(0, b.length - 1) : b);
        }
      }
      if (sc.inputTranscription?.text) {
        this.inText += String(sc.inputTranscription.text);
        this.emit('transcript', { role: 'user', text: this.inText.trim(), final: false });
      }
      if (sc.inputTranscription?.finished) this.flushIn();
      if (sc.outputTranscription?.text) {
        // Model gapira boshladi — foydalanuvchi navbati yakunlangan
        this.flushIn();
        this.outText += String(sc.outputTranscription.text);
        this.emit('transcript', { role: 'assistant', text: this.outText.trim(), final: false });
      }
      if (sc.outputTranscription?.finished) this.flushOut();
      if (sc.interrupted) { this.flushOut(); this.emit('interrupted'); }
      if (sc.turnComplete) { this.flushIn(); this.flushOut(); }
    }
    const calls: any[] = Array.isArray(m.toolCall?.functionCalls) ? m.toolCall.functionCalls : [];
    for (const fc of calls) {
      if (!fc?.name) continue;
      this.emit('toolCall', {
        id: String(fc.id || `${fc.name}_${Date.now()}`), name: String(fc.name),
        args: fc.args && typeof fc.args === 'object' ? fc.args : {},
      });
    }
    if (m.goAway) this.emit('goAway', { timeLeftMs: parseDurationMs(m.goAway.timeLeft, 0) });
    const sr = m.sessionResumptionUpdate;
    if (sr?.resumable && sr.newHandle) this.emit('resumption', { handle: String(sr.newHandle) });
    const um = m.usageMetadata;
    if (um) {
      // ESLATMA (tekshirilmagan): Live usageMetadata har javob uchun deb olinadi (delta).
      const tokensIn = Number(um.promptTokenCount) || 0;
      const tokensOut = (Number(um.responseTokenCount) || 0) + (Number(um.thoughtsTokenCount) || 0);
      const audioIn = sumModality(um.promptTokensDetails, 'AUDIO');
      const audioOut = sumModality(um.responseTokensDetails, 'AUDIO');
      this.emit('usage', {
        tokensIn: Math.max(0, tokensIn - audioIn), tokensOut: Math.max(0, tokensOut - audioOut), audioInSec: 0, audioOutSec: 0,
      });
    }
  }

  handleClose(e: any): void {
    if (!this.setupOk) this.setupReject?.(new Error(`LIVE_CLOSED_BEFORE_SETUP${e?.code ? `_${e.code}` : ''}${e?.reason ? `: ${String(e.reason).slice(0, 200)}` : ''}`));
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.flushIn(); this.flushOut();
    if (this.closing) this.emit('closed', { reason: this.closeReason });
    else this.emit('closed', { reason: 'remote_closed', error: [e?.code, e?.reason].filter(Boolean).join(' ').slice(0, 200) || undefined });
  }

  handleError(e: any): void {
    const msg = String(e?.message || e?.error?.message || 'live_error').slice(0, 200);
    if (!this.setupOk) this.setupReject?.(new Error(msg));
  }

  private flushIn() {
    if (this.inText.trim()) this.emit('transcript', { role: 'user', text: this.inText.trim(), final: true });
    this.inText = '';
  }
  private flushOut() {
    if (this.outText.trim()) this.emit('transcript', { role: 'assistant', text: this.outText.trim(), final: true });
    this.outText = '';
  }

  pushAudio(pcm16k: Buffer): void {
    if (!this.live || this.closing) return;
    this.live.sendRealtimeInput({ audio: { data: pcm16k.toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
  }
  activityStart(): void { if (this.live && !this.closing) this.live.sendRealtimeInput({ activityStart: {} }); }
  activityEnd(): void { if (this.live && !this.closing) this.live.sendRealtimeInput({ activityEnd: {} }); }
  sendText(text: string, opts?: { silent?: boolean }): void {
    if (!this.live || this.closing) return;
    this.live.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: !opts?.silent });
  }
  sendVideo(jpeg: Buffer): void {
    if (!this.live || this.closing || !jpeg?.length) return;
    this.live.sendRealtimeInput({ video: { data: jpeg.toString('base64'), mimeType: 'image/jpeg' } });
  }
  toolResponse(responses: { id: string; name: string; result: ToolResult }[]): void {
    if (!this.live || this.closing || !responses.length) return;
    this.live.sendToolResponse({
      functionResponses: responses.map((r) => ({
        id: r.id, name: r.name,
        // Hech qachon {} emas (Live talabi): status/message doim bor
        response: { status: r.result.status, message: r.result.message, retryable: r.result.retryable, ...(r.result.data !== undefined ? { data: r.result.data } : {}) },
      })),
    });
  }
  async close(reason: string): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.closeReason = reason;
    try { this.live?.close(); } catch { /* allaqachon yopiq */ }
    // Ba'zi holatlarda onclose kelmaydi — o'zimiz yopamiz
    setTimeout(() => this.handleClose({ code: 1000 }), 1500).unref?.();
  }
}

export interface GeminiLiveOptions { connector?: LiveConnector; setupTimeoutMs?: number }

export class GeminiLiveProvider implements VoiceProvider {
  readonly name = 'gemini_live' as const;
  private connector: LiveConnector;
  private setupTimeoutMs: number;

  constructor(o: GeminiLiveOptions = {}) {
    this.connector = o.connector || defaultLiveConnector;
    this.setupTimeoutMs = o.setupTimeoutMs ?? 4_000;
  }

  async open(opts: VoiceOpenOpts): Promise<VoiceSession> {
    const config = buildLiveConfig(opts);
    const connectWith = async (key: string): Promise<VoiceSession> => {
      const s = new GeminiLiveSession();
      try {
        const live = await this.connector.connect(key, {
          model: opts.model,
          config,
          callbacks: {
            onmessage: (m) => s.handleMessage(m),
            onerror: (e) => s.handleError(e),
            onclose: (e) => s.handleClose(e),
          },
        });
        s.attach(live);
        await this.waitSetup(s);
        return s;
      } catch (e) {
        void s.close('setup_failed');
        throw e;
      }
    };
    if (opts.apiKey) return connectWith(opts.apiKey);
    // Umumiy kalit aylanishi (lib/geminiKeys): kvota kalit × model bo'yicha (scope) — Live 429 matn
    // modellarini to'smaydi; sovushdagi kalitlar o'tkaziladi, hammasi band bo'lsa — darhol GeminiQuotaError
    // (tarmoqsiz) va menejer keyingi Live modeli / kaskadga o'tadi.
    let sawQuota = false;
    let authErr: unknown = null;
    try {
      return await withGeminiKey(async (key) => {
        try { return await connectWith(key); } catch (e) {
          if (isQuotaError(e)) sawQuota = true;
          else if (isAuthError(e)) authErr = e;
          throw e;
        }
      }, { scope: opts.model });
    } catch (e) {
      // Hamma kalit RUXSAT xatosi bilan yiqildi — "limit" emas, "kalit noto'g'ri" (aniq sabab mijozga)
      if (e instanceof GeminiQuotaError && authErr && !sawQuota) throw authErr;
      throw e;
    }
  }

  private async waitSetup(s: GeminiLiveSession): Promise<void> {
    let t: NodeJS.Timeout | undefined;
    try {
      await Promise.race([s.setupDone, new Promise<void>((_, rej) => { t = setTimeout(() => rej(new Error('SETUP_TIMEOUT')), this.setupTimeoutMs); })]);
    } finally { if (t) clearTimeout(t); }
  }
}
