import type { ToolResult } from '../contracts';
import { VoiceEmitter } from './provider';
import type { VoiceOpenOpts, VoiceProvider, VoiceSession, VoiceUsage } from './types';

// FakeVoiceProvider — testlar (va P6 fake-worker e2e) uchun skriptli provayder. Haqiqiy model yo'q:
// test "model nima qiladi"ni o'zi boshqaradi (speak/say/callTool/goAway ...) va sessiyaga
// nima yuborilganini (audio, matn, tool javoblari) xronologik jurnalda tekshiradi.

export interface FakeScript {
  onOpen?(s: FakeVoiceSession): void;
  onText?(s: FakeVoiceSession, text: string): void;
  onAudio?(s: FakeVoiceSession, pcm: Buffer): void;
  onToolResponse?(s: FakeVoiceSession, r: { id: string; name: string; result: ToolResult }[]): void;
}

export class FakeVoiceSession extends VoiceEmitter implements VoiceSession {
  readonly pushed: Buffer[] = [];
  pushedBytes = 0;
  readonly texts: string[] = [];
  readonly toolResponses: { id: string; name: string; result: ToolResult }[] = [];
  readonly activity: ('start' | 'end')[] = [];
  /** Xronologik jurnal: 'audio', 'text:<..>', 'tool_response:<id>', 'close:<reason>'. */
  readonly log: string[] = [];
  closedReason?: string;

  constructor(readonly opts: VoiceOpenOpts, private script: FakeScript = {}) { super(); }

  get closed(): boolean { return this.closedReason !== undefined; }

  pushAudio(pcm: Buffer): void {
    if (this.closed) return;
    this.pushed.push(pcm);
    this.pushedBytes += pcm.length;
    if (this.log[this.log.length - 1] !== 'audio') this.log.push('audio');
    this.script.onAudio?.(this, pcm);
  }
  activityStart(): void { this.activity.push('start'); this.log.push('activity:start'); }
  activityEnd(): void { this.activity.push('end'); this.log.push('activity:end'); }
  sendText(text: string): void {
    if (this.closed) return;
    this.texts.push(text);
    this.log.push(`text:${text}`);
    this.script.onText?.(this, text);
  }
  toolResponse(responses: { id: string; name: string; result: ToolResult }[]): void {
    if (this.closed) return;
    this.toolResponses.push(...responses);
    for (const r of responses) this.log.push(`tool_response:${r.id}`);
    this.script.onToolResponse?.(this, responses);
  }
  async close(reason: string): Promise<void> {
    if (this.closed) return;
    this.closedReason = reason;
    this.log.push(`close:${reason}`);
    this.emit('closed', { reason });
  }

  // ── "Model" harakatlari (test boshqaradi) ──
  ready(): void { this.emit('setupComplete'); }
  speak(pcm24k: Buffer): void { this.emit('audioOut', pcm24k); }
  say(text: string, final = true): void { this.emit('transcript', { role: 'assistant', text, final }); }
  hear(text: string, final = true): void { this.emit('transcript', { role: 'user', text, final }); }
  callTool(id: string, name: string, args: Record<string, unknown> = {}): void { this.emit('toolCall', { id, name, args }); }
  interrupt(): void { this.emit('interrupted'); }
  goAway(timeLeftMs = 5000): void { this.emit('goAway', { timeLeftMs }); }
  resumption(handle: string): void { this.emit('resumption', { handle }); }
  usage(u: Partial<VoiceUsage>): void { this.emit('usage', { tokensIn: 0, tokensOut: 0, audioInSec: 0, audioOutSec: 0, ...u }); }
  /** Kutilmagan uzilish (tarmoq) — provayder o'zi yopilgandek. */
  drop(reason = 'remote_closed'): void {
    if (this.closed) return;
    this.closedReason = reason;
    this.log.push(`drop:${reason}`);
    this.emit('closed', { reason, error: reason });
  }
}

export interface FakeProviderOptions {
  name?: VoiceProvider['name'];
  script?: FakeScript;
  /** true yoki xato — open() rad etiladi (zaxira yo'lini sinash uchun). */
  failOpen?: boolean | Error;
  /** open() resolve bo'lishidan oldingi kechikish (taymaut sinovi). */
  openDelayMs?: number;
}

export class FakeVoiceProvider implements VoiceProvider {
  readonly name: VoiceProvider['name'];
  readonly opens: VoiceOpenOpts[] = [];
  readonly sessions: FakeVoiceSession[] = [];

  constructor(private o: FakeProviderOptions = {}) { this.name = o.name || 'fake'; }

  get last(): FakeVoiceSession | undefined { return this.sessions[this.sessions.length - 1]; }

  async open(opts: VoiceOpenOpts): Promise<VoiceSession> {
    this.opens.push(opts);
    if (this.o.openDelayMs) await new Promise((r) => setTimeout(r, this.o.openDelayMs));
    if (this.o.failOpen) throw this.o.failOpen instanceof Error ? this.o.failOpen : new Error('FAKE_OPEN_FAILED');
    const s = new FakeVoiceSession(opts, this.o.script);
    this.sessions.push(s);
    queueMicrotask(() => { s.ready(); this.o.script?.onOpen?.(s); });
    return s;
  }
}
