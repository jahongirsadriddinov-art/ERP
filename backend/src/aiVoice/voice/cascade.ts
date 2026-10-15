import type { AiLang, PendingActionInfo, TextAgent, ToolCtx, ToolResult, ToolStatus } from '../contracts';
import { VoiceEmitter } from './provider';
import { EnergyVad, type VadOptions } from './vad';
import { OUT_RATE, pcmDurationMs, splitSentences } from './audio';
import type { Transcriber, TtsSynth } from './geminiSpeech';
import type { VoiceOpenOpts, VoiceProvider, VoiceSession } from './types';

// Kaskad provayder (zaxira, A6/D6): server VAD (energiya) → transkripsiya → TextAgent (P2,
// DI orqali; tool'lar agent ichida tools/executor orqali — bir xil RBAC/audit) → TTS gapma-gap.
// Live'dan sekinroq (~2–3.5 s), lekin bir xil kalitlar. Barge-in: model "gapirayotgan" paytda
// (taxminiy ijro oynasi) foydalanuvchi gapirsa — interrupted va joriy javob bekor qilinadi.
// TTS ishlamasa: in-app — faqat matn + mijozdagi speechSynthesis (onTtsUnavailable), Telegram —
// sessiya yopiladi ('tts_unavailable').

export interface CascadeDeps {
  agent: TextAgent;
  ctx: ToolCtx;
  transcriber: Transcriber;
  tts: TtsSynth | null;
  transcribeModel: string;
  ttsModel: string;
  vad?: Partial<VadOptions>;
  ttsFailureMode?: 'text_only' | 'close';
  onTtsUnavailable?: () => void;
  onToolEvent?: (e: { name: string; status: ToolStatus; message: string }) => void;
  onPendingAction?: (p: PendingActionInfo) => void;
  now?: () => number;
  /** Bitta navbat uchun maksimal vaqt. */
  turnTimeoutMs?: number;
}

const HISTORY_MAX = 12;
const PTT_MAX_BYTES = 16_000 * 2 * 20; // 20 s

export class CascadeSession extends VoiceEmitter implements VoiceSession {
  private vad: EnergyVad;
  private history: { role: 'user' | 'assistant'; text: string }[] = [];
  private chain: Promise<void> = Promise.resolve();
  private current: AbortController | null = null;
  private speakingUntil = 0;
  private pttBuf: Buffer[] = [];
  private pttBytes = 0;
  private capturing = false;
  private closed = false;
  private now: () => number;
  readonly lang: AiLang;

  constructor(private d: CascadeDeps, private opts: VoiceOpenOpts) {
    super();
    this.vad = new EnergyVad(d.vad);
    this.now = d.now || Date.now;
    this.lang = opts.lang === 'ru' ? 'ru' : 'uz';
  }

  /** Model hozir "gapiryaptimi" (yuborilgan audio taxminan hali ijro etilmoqda). */
  get speaking(): boolean { return this.now() < this.speakingUntil; }

  pushAudio(pcm16k: Buffer): void {
    if (this.closed) return;
    if (this.opts.ptt) {
      if (!this.capturing) return;
      if (this.pttBytes + pcm16k.length <= PTT_MAX_BYTES) { this.pttBuf.push(pcm16k); this.pttBytes += pcm16k.length; }
      return;
    }
    for (const ev of this.vad.push(pcm16k)) {
      if (ev.type === 'start') { if (this.speaking) this.bargeIn(); }
      else if (ev.pcm.length) this.enqueue({ audio: ev.pcm });
    }
  }

  activityStart(): void {
    if (this.closed) return;
    if (this.speaking) this.bargeIn();
    this.capturing = true; this.pttBuf = []; this.pttBytes = 0;
  }

  activityEnd(): void {
    if (this.closed || !this.capturing) return;
    this.capturing = false;
    const audio = Buffer.concat(this.pttBuf);
    this.pttBuf = []; this.pttBytes = 0;
    if (audio.length >= 16_000 * 2 * 0.2) this.enqueue({ audio });   // ≥200 ms
  }

  sendText(text: string): void { if (!this.closed && text) this.enqueue({ text }); }

  /** Kaskadda tool'larni agent o'zi bajaradi — model toolCall chiqarmaydi. */
  toolResponse(_r: { id: string; name: string; result: ToolResult }[]): void { /* no-op */ }

  async close(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.current?.abort();
    this.emit('closed', { reason });
  }

  private bargeIn() {
    this.current?.abort();
    this.current = null;
    this.speakingUntil = 0;
    this.emit('interrupted');
  }

  private enqueue(input: { audio?: Buffer; text?: string }) {
    this.chain = this.chain.then(() => this.runTurn(input)).catch((e) => {
      console.warn('[aiVoice] kaskad navbati xatosi:', (e as Error).message);
    });
  }

  ready(): void { this.emit('setupComplete'); }

  /** Testlar uchun: navbatdagi barcha ishlar tugashini kutish. */
  idle(): Promise<void> { return this.chain; }

  private async runTurn(input: { audio?: Buffer; text?: string }): Promise<void> {
    if (this.closed) return;
    const ac = new AbortController();
    this.current = ac;
    const timeout = setTimeout(() => ac.abort(), this.d.turnTimeoutMs ?? 30_000);
    try {
      let userText = input.text || '';
      if (input.audio) {
        const audioInSec = input.audio.length / 32_000;
        const tr = await this.d.transcriber.transcribe(input.audio, { lang: this.lang, model: this.d.transcribeModel, signal: ac.signal });
        this.emit('usage', { tokensIn: tr.tokensIn || 0, tokensOut: tr.tokensOut || 0, audioInSec, audioOutSec: 0 });
        userText = (tr.text || '').trim();
        if (!userText || ac.signal.aborted || this.closed) return;
        this.emit('transcript', { role: 'user', text: userText, final: true });
      }
      if (!userText) return;
      const out = await this.d.agent.run({ ctx: this.d.ctx, history: [...this.history], userText, signal: ac.signal, maxToolRounds: 5 });
      this.emit('usage', { tokensIn: out.usage.tokensIn || 0, tokensOut: out.usage.tokensOut || 0, audioInSec: 0, audioOutSec: 0 });
      for (const tc of out.toolCalls || []) this.d.onToolEvent?.(tc);
      for (const p of out.pendingActions || []) this.d.onPendingAction?.(p);
      if (ac.signal.aborted || this.closed) return;
      const reply = (out.text || '').trim();
      if (input.audio) this.history.push({ role: 'user', text: userText });
      if (reply) this.history.push({ role: 'assistant', text: reply });
      while (this.history.length > HISTORY_MAX) this.history.shift();
      if (!reply) return;
      this.emit('transcript', { role: 'assistant', text: reply, final: true });
      await this.speak(reply, ac);
    } finally {
      clearTimeout(timeout);
      if (this.current === ac) this.current = null;
    }
  }

  private async speak(text: string, ac: AbortController) {
    if (!this.d.tts) { this.ttsFailed(); return; }
    for (const sentence of splitSentences(text)) {
      if (ac.signal.aborted || this.closed) return;
      let pcm: Buffer;
      try {
        pcm = await this.d.tts.synth(sentence, { voiceName: this.opts.voiceName, lang: this.lang, model: this.d.ttsModel, signal: ac.signal });
      } catch (e) {
        if (ac.signal.aborted) return;
        console.warn('[aiVoice] kaskad TTS xatosi:', (e as Error).message);
        this.ttsFailed();
        return;
      }
      if (ac.signal.aborted || this.closed) return;
      const now = this.now();
      this.speakingUntil = Math.max(now, this.speakingUntil) + pcmDurationMs(pcm.length, OUT_RATE);
      this.emit('audioOut', pcm);
    }
  }

  private ttsFailed() {
    if ((this.d.ttsFailureMode || 'text_only') === 'close') void this.close('tts_unavailable');
    else this.d.onTtsUnavailable?.();
  }
}

export class CascadeProvider implements VoiceProvider {
  readonly name = 'gemini_cascade' as const;
  readonly sessions: CascadeSession[] = [];
  constructor(private d: CascadeDeps) {}

  async open(opts: VoiceOpenOpts): Promise<VoiceSession> {
    const s = new CascadeSession(this.d, opts);
    this.sessions.push(s);
    queueMicrotask(() => s.ready());
    return s;
  }
}
