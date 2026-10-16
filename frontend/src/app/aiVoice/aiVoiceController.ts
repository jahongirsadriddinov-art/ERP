import { decideAiIncoming, setAiCallActive } from "./bus";
import {
  AIV_CLIENT_EVENTS as C, AIV_SERVER_EVENTS as S, decodeAudioFrame, encodeAudioFrame,
  type AivConfirm, type AivConfirmActionAck, type AivDeclineReq, type AivErrorCode, type AivEnd, type AivEndReason, type AivError,
  type AivIncoming, type AivReady, type AivSessionAck, type AivToolEvent, type AivTranscript, type Purpose, type ToolStatus,
} from "./protocol";
import { DuplexGate, type AiOutputState } from "./audio/duplexGate";
import type { TtsFallback } from "./ttsFallback";

// AI ovozli suhbat holat mashinasi (design §8, review A10–A12). React'ga bog'liq bo'lmagan
// AiVoiceController (sof — DOM/React/ilova modullarisiz, testlanadi; hook — useAiVoiceSession.ts). Barcha tashqi narsalar (socket, mikrofon, audio,
// jiringlash) `deps` orqali — testlarda soxta (fake) bilan almashtiriladi.
//
// Holatlar: idle → incoming (jiringlash) → connecting (mikrofon + aiv:accept) → connected (aiv:ready);
//           idle → connecting (aiv:start) → ringing (ack keldi, AI ulanmoqda) → connected;
//           connected → reconnecting (socket uzildi) → connected | ended('network');  har qaysi → ended → idle.
// QOIDALAR:
//  - getUserMedia FAQAT Qabul qilish / Gaplashish bosilgandan keyin (jiringlash paytida emas);
//  - WebRTC qo'ng'iroq paytida (busy) kiruvchi AI qo'ng'iroq avtomatik 'busy' bilan rad etiladi;
//  - aiv:presence {visible} — visibilitychange, har socket ulanishi va 25 s'da bir (server: lastSeen < 60 s);
//  - socket kech paydo bo'lsa ham (App.tsx keyin ulaydi) — getSocket() har soniyada tekshiriladi.

export type AiCallStatus = "idle" | "incoming" | "connecting" | "ringing" | "connected" | "reconnecting" | "ended";
export type AiCallErrorKind = "mic" | "server" | "network" | "unsupported" | "timeout";
export interface AiCallError { kind: AiCallErrorKind; code: string; message?: string }
export interface AiCaption { id: number; role: "user" | "assistant"; text: string; final: boolean }
export type AiCallEndReason = AivEndReason | "network";

export interface AiCallState {
  status: AiCallStatus;
  direction: "incoming" | "outgoing" | null;
  sessionId: string | null;
  purpose: Purpose | null;
  companyName?: string;
  expiresAt: number | null;
  connectedAt: number | null;
  muted: boolean;
  ptt: { mode: boolean; forced: boolean; held: boolean };
  aiSpeaking: boolean;
  captions: AiCaption[];
  tool: { name: string; status: ToolStatus; message: string } | null;
  confirm: AivConfirm | null;
  confirmBusy: boolean;
  endReason: AiCallEndReason | null;
  error: AiCallError | null;
  outputs: { id: string; label: string }[];
  sinkId: string;
  canSelectOutput: boolean;
}

export const INITIAL_AI_CALL_STATE: AiCallState = {
  status: "idle", direction: null, sessionId: null, purpose: null, expiresAt: null, connectedAt: null,
  muted: false, ptt: { mode: false, forced: false, held: false }, aiSpeaking: false, captions: [], tool: null,
  confirm: null, confirmBusy: false, endReason: null, error: null, outputs: [], sinkId: "", canSelectOutput: false,
};

// ───────────── Bog'liqliklar (testda soxta) ─────────────
export interface SocketLike {
  connected: boolean;
  on(ev: string, fn: (...a: any[]) => void): unknown;
  off(ev: string, fn: (...a: any[]) => void): unknown;
  emit(ev: string, ...args: any[]): unknown;
  io?: any;
}
export interface CaptureLike { setMuted(m: boolean): void; stop(): void }
export interface PlayerLike { push(pcm: Uint8Array | Int16Array): void; flush(): void; close(): void; readonly state: AiOutputState }
export interface AudioCtxLike { sampleRate: number; resume?(): Promise<void>; close?(): Promise<void>; setSinkId?(id: string): Promise<void> }
export interface StreamLike { getTracks(): { stop(): void }[] }
export interface DocLike {
  hidden: boolean;
  addEventListener(ev: "visibilitychange", fn: () => void): void;
  removeEventListener(ev: "visibilitychange", fn: () => void): void;
}

export interface AiVoiceDeps {
  getSocket(): SocketLike | null;
  supported(): boolean;
  isAndroid(): boolean;
  createContext(): AudioCtxLike;
  openMic(): Promise<StreamLike>;
  createCapture(ctx: AudioCtxLike, stream: StreamLike, onFrame: (pcm: Int16Array, rms: number) => void): Promise<CaptureLike>;
  createPlayer(ctx: AudioCtxLike, onState: (s: AiOutputState) => void): Promise<PlayerLike>;
  listOutputs(): Promise<{ id: string; label: string }[]>;
  startRing(): () => void;
  startAttention(): () => void;
  fetchPending(): Promise<AivIncoming | null>;
  /** Firmada AI faolmi: false — presence/pending so'rovlari yuborilmaydi (trafik tejash); null — noma'lum. */
  aiActive?(): boolean | null;
  tts: TtsFallback | null;
  doc: DocLike | null;
  now(): number;
  lang(): "uz" | "ru";
  onNotice(key: "busyWebrtc" | "unsupported"): void;
  /** Qo'ng'iroqni bosishsiz qabul qilish mumkinmi (sahifada avval foydalanuvchi harakati bo'lgan, iOS emas). */
  canAutoAccept?(): boolean;
}

/** Ovozli yo'l ishlamaydi (kvota/limit/sozlanmagan/transport) — oyna o'rniga matnli AI chatiga o'tamiz. */
const TEXT_FALLBACK_CODES = new Set([
  "ai_quota", "ai_unavailable", "ai_not_configured", "limit", "budget", "platform_cap", "company_cap", "unsupported_transport",
]);
/** Server aiv:error'dagi "yakuniy sabab" kodlari (end'dan OLDIN keladi). */
const SERVER_FAIL_CODES = new Set(["ai_quota", "ai_unavailable", "ai_not_configured"]);

export type TextFallbackKind = "limit" | "unavailable" | "not_configured" | "network";
/** Xato matnli rejimga o'tishni talab qiladimi; qaysi sabab bilan (UI matni uchun). */
export function textFallbackKind(err: AiCallError | null): TextFallbackKind | null {
  if (!err || err.kind !== "server" || !TEXT_FALLBACK_CODES.has(err.code)) return null;
  if (err.code === "ai_not_configured") return "not_configured";
  if (err.code === "ai_unavailable") return "unavailable";
  if (err.code === "unsupported_transport") return "network";
  return "limit";
}

// Vaqtlar (ms)
const SOCKET_POLL_MS = 1000;
const PRESENCE_HEARTBEAT_MS = 25_000;
const ACK_TIMEOUT_MS = 12_000;
const READY_TIMEOUT_MS = 20_000;
const RECONNECT_GRACE_MS = 12_000;
const WS_UPGRADE_WAIT_MS = 3000;
const ENDED_DISMISS_MS = 2500;
const PENDING_MIN_GAP_MS = 10_000;
const PTT_TAIL_FRAMES = 15;            // 600 ms sukunat — server VAD gap tugaganini sezsin
const MAX_CAPTIONS = 12;
const EXPECT_CALL_MAX_MS = 5 * 60_000;

const ACTIVE: AiCallStatus[] = ["incoming", "connecting", "ringing", "connected", "reconnecting"];
const IN_CALL: AiCallStatus[] = ["connecting", "ringing", "connected", "reconnecting"];

const SERVER_END_ERRORS: AiCallEndReason[] = ["error", "shutdown", "limit", "off_shift", "unsupported_transport", "revoked", "busy"];

export class AiVoiceController {
  private st: AiCallState = INITIAL_AI_CALL_STATE;
  private listeners = new Set<() => void>();
  private socket: SocketLike | null = null;
  private started = false;
  private busy = false;
  private gen = 0;
  private sessionId: string | null = null;
  private correlationId: string | null = null;
  private seq = 0;
  private lastInSeq: number | null = null;
  private serverPtt = false;
  private pttHeld = false;
  private pttTail = 0;
  private ctx: AudioCtxLike | null = null;
  private stream: StreamLike | null = null;
  private capture: CaptureLike | null = null;
  private player: PlayerLike | null = null;
  private gate = new DuplexGate();
  private stopRing: (() => void) | null = null;
  private stopAttention: (() => void) | null = null;
  private timers: Record<string, ReturnType<typeof setTimeout> | null> = {};
  private pollIv: ReturnType<typeof setInterval> | null = null;
  private presenceIv: ReturnType<typeof setInterval> | null = null;
  private lastPendingAt = -Infinity;
  private capId = 0;
  private toolClearTimer: ReturnType<typeof setTimeout> | null = null;
  /** Server oxirgi aiv:error'da aytgan yakuniy sabab (ai_quota …) — end kelganda xato kodi shu bo'ladi. */
  private serverFail: { code: string; message?: string } | null = null;
  /** Foydalanuvchi chatda "menga qo'ng'iroq qil" degan — shu vaqtgacha kelgan AI qo'ng'irog'i avtomatik qabul qilinadi. */
  private expectCallUntil = 0;

  constructor(private deps: AiVoiceDeps) {}

  // ───── tashqi API ─────
  getState = (): AiCallState => this.st;
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };

  start(): void {
    if (this.started) return;
    this.started = true;
    this.sync();
    this.pollIv = setInterval(this.sync, SOCKET_POLL_MS);
    this.presenceIv = setInterval(() => { if (!this.deps.doc?.hidden) this.emitPresence(); }, PRESENCE_HEARTBEAT_MS);
    this.deps.doc?.addEventListener("visibilitychange", this.onVisibility);
  }

  dispose(): void {
    if (!this.started) return;
    this.started = false;
    if (ACTIVE.includes(this.st.status)) {
      const s = this.socket;
      if (this.st.status === "incoming" && this.sessionId) s?.emit(C.decline, { sessionId: this.sessionId, reason: "declined" } as AivDeclineReq);
      else if (s?.connected) s.emit(C.hangup, this.sessionId ? { sessionId: this.sessionId } : {});
    }
    this.gen++;
    this.teardown();
    this.clearAllTimers();
    if (this.pollIv) clearInterval(this.pollIv);
    if (this.presenceIv) clearInterval(this.presenceIv);
    this.pollIv = this.presenceIv = null;
    this.deps.doc?.removeEventListener("visibilitychange", this.onVisibility);
    this.detach();
    this.st = INITIAL_AI_CALL_STATE;
    setAiCallActive(false);
  }

  setBusy(b: boolean): void { this.busy = b; }

  /**
   * Chatda AI'dan qo'ng'iroq so'raldi (requestCallback) — keyingi `ms` ichida kelgan AI qo'ng'irog'i
   * jiringlamasdan darhol ulanadi (foydalanuvchi o'zi so'ragan). Presence ham darhol yangilanadi.
   */
  expectIncoming(ms = 120_000): void {
    this.expectCallUntil = this.deps.now() + Math.max(0, Math.min(EXPECT_CALL_MAX_MS, ms));
    this.emitPresence();
  }

  /** AI holati (aiStatus) yangilanganda — darhol presence va kutilayotgan qo'ng'iroqni tekshirish. */
  notifyAiStatus(): void {
    if (!this.started) return;
    this.emitPresence();
    this.checkPending();
  }

  /** "AI bilan gaplashish" (foydalanuvchi bosishi ichida, sinxron chaqiriladi — AudioContext ochiladi). */
  startOutgoing(): void {
    if (ACTIVE.includes(this.st.status)) return;
    if (this.busy) { this.deps.onNotice("busyWebrtc"); return; }
    this.clearTimer("dismiss");
    if (!this.deps.supported()) {
      this.set({ ...INITIAL_AI_CALL_STATE, status: "ended", direction: "outgoing", endReason: "error", error: { kind: "unsupported", code: "unsupported" } });
      return;
    }
    const g = ++this.gen;
    this.resetSession();
    let ctx: AudioCtxLike;
    try { ctx = this.deps.createContext(); } catch {
      this.set({ ...INITIAL_AI_CALL_STATE, status: "ended", direction: "outgoing", endReason: "error", error: { kind: "unsupported", code: "unsupported" } });
      return;
    }
    this.ctx = ctx;
    const pttMode = this.deps.isAndroid();
    this.set({ ...INITIAL_AI_CALL_STATE, status: "connecting", direction: "outgoing", purpose: "assistant", ptt: { mode: pttMode, forced: false, held: false } });
    setAiCallActive(true);
    void this.runOutgoing(g, pttMode);
  }

  /** Kiruvchi qo'ng'iroqni qabul qilish (foydalanuvchi bosishi ichida). */
  accept(): void {
    if (this.st.status !== "incoming" || !this.sessionId) return;
    const g = ++this.gen;
    this.stopRinging();
    this.clearTimer("ringExpire");
    let ctx: AudioCtxLike;
    try { ctx = this.deps.createContext(); } catch {
      this.declineWith("unsupported");
      this.finish("error", { kind: "unsupported", code: "unsupported" });
      return;
    }
    this.ctx = ctx;
    const pttMode = this.deps.isAndroid();
    this.set({ status: "connecting", ptt: { mode: pttMode, forced: false, held: false } });
    void this.runAccept(g);
  }

  decline(): void {
    if (this.st.status !== "incoming") return;
    this.declineWith("declined");
    this.finish("declined", null, 0);
  }

  hangup(): void {
    if (!IN_CALL.includes(this.st.status)) return;
    const s = this.socket;
    if (s?.connected) s.emit(C.hangup, this.sessionId ? { sessionId: this.sessionId } : {});
    this.finish("hangup");
  }

  toggleMute(): void {
    if (!IN_CALL.includes(this.st.status)) return;
    const m = !this.st.muted;
    this.capture?.setMuted(m);
    this.set({ muted: m });
  }

  setPttMode(on: boolean): void {
    if (this.st.ptt.forced && !on) return;
    if (this.pttHeld && !on) this.pttUp();
    this.gate.reset();
    this.set({ ptt: { ...this.st.ptt, mode: on, held: false } });
  }

  pttDown(): void {
    if (this.st.status !== "connected" || !this.st.ptt.mode || this.pttHeld) return;
    this.pttHeld = true;
    this.pttTail = 0;
    this.player?.flush();
    this.deps.tts?.cancel();
    this.socket?.emit(C.ptt, { on: true });
    this.set({ ptt: { ...this.st.ptt, held: true } });
  }

  pttUp(): void {
    if (!this.pttHeld) return;
    this.pttHeld = false;
    this.pttTail = this.serverPtt ? 0 : PTT_TAIL_FRAMES;
    if (this.socket?.connected) this.socket.emit(C.ptt, { on: false });
    this.set({ ptt: { ...this.st.ptt, held: false } });
  }

  async respondConfirm(accept: boolean): Promise<void> {
    const c = this.st.confirm;
    const s = this.socket;
    if (!c || !s?.connected || this.st.confirmBusy) return;
    this.set({ confirmBusy: true });
    const g = this.gen;
    const ack = await this.emitAck<AivConfirmActionAck>(s, C.confirmAction, { pendingActionId: c.pendingActionId, accept }, ACK_TIMEOUT_MS);
    if (g !== this.gen) return;
    if (ack && ack.ok) this.showTool({ name: "confirm", status: ack.status, message: ack.message });
    else { const f = failOf(ack); this.showTool({ name: "confirm", status: "error", message: f ? (f.message || f.code) : "timeout" }); }
    this.set({ confirm: null, confirmBusy: false });
  }

  async selectOutput(id: string): Promise<void> {
    if (!this.ctx?.setSinkId) return;
    try { await this.ctx.setSinkId(id); this.set({ sinkId: id }); } catch { /* */ }
  }

  /** Tugagan oynani yopish. */
  dismiss(): void {
    if (this.st.status !== "ended") return;
    this.clearTimer("dismiss");
    this.set(INITIAL_AI_CALL_STATE);
  }

  // ───── ichki: oqimlar ─────
  private async runOutgoing(g: number, pttMode: boolean) {
    const s = this.socket;
    if (!s || !s.connected) { this.finish("network", { kind: "network", code: "offline" }); return; }
    if (!(await this.prepareMedia(g))) return;
    await this.ensureWebsocket(s);
    if (g !== this.gen) return;
    if (!s.connected) { this.finish("network", { kind: "network", code: "offline" }); return; }
    const ack = await this.emitAck<AivSessionAck>(s, C.start, { purpose: "assistant", ptt: pttMode }, ACK_TIMEOUT_MS);
    if (g !== this.gen) {
      // Foydalanuvchi kutish paytida tugatdi — server sessiyasini ham yopamiz
      if (ack && ack.ok) s.emit(C.hangup, { sessionId: ack.sessionId });
      return;
    }
    if (!ack) { s.emit(C.hangup, {}); this.finish("error", { kind: "timeout", code: "timeout" }); return; }
    const fail = failOf(ack);
    if (fail) { this.finish(ackEndReason(fail.code), { kind: "server", code: fail.code, message: fail.message }); return; }
    const ok = ack as SessionOk;
    if (!this.sessionId) this.sessionId = ok.sessionId;
    if (!this.correlationId) this.correlationId = ok.correlationId;
    if (this.st.status === "connecting") this.set({ status: "ringing", sessionId: this.sessionId });
    this.armReadyTimeout(g);
  }

  private async runAccept(g: number) {
    const sessionId = this.sessionId!;
    if (!(await this.prepareMedia(g, true))) return;
    const s = this.socket;
    if (!s || !s.connected) { this.finish("network", { kind: "network", code: "offline" }); return; }
    await this.ensureWebsocket(s);
    if (g !== this.gen) return;
    const ack = await this.emitAck<AivSessionAck>(s, C.accept, { sessionId }, ACK_TIMEOUT_MS);
    if (g !== this.gen) return;
    if (!ack) { s.emit(C.hangup, { sessionId }); this.finish("error", { kind: "timeout", code: "timeout" }); return; }
    const fail = failOf(ack);
    if (fail) {
      if (fail.code === "answered_elsewhere") { this.finish("answered_elsewhere", null, 0); return; }
      this.finish(ackEndReason(fail.code), { kind: "server", code: fail.code, message: fail.message });
      return;
    }
    if ((ack as SessionOk).correlationId) this.correlationId = (ack as SessionOk).correlationId;
    this.armReadyTimeout(g);
  }

  /** Mikrofon + ijrochi. Xato bo'lsa — sababli tugatadi (kiruvchida server keyingi kanalga o'tsin: decline). */
  private async prepareMedia(g: number, incoming = false): Promise<boolean> {
    try {
      const stream = await this.deps.openMic();
      if (g !== this.gen) { stopStream(stream); return false; }
      this.stream = stream;
      const ctx = this.ctx!;
      this.player = await this.deps.createPlayer(ctx, (ps) => this.onPlayerState(ps));
      if (g !== this.gen) return false;
      this.capture = await this.deps.createCapture(ctx, stream, (pcm, rms) => this.onFrame(pcm, rms));
      if (g !== this.gen) return false;
      // Avtomatik qabul / iOS: kontekst "suspended" qolgan bo'lishi mumkin — yana bir bor uyg'otamiz
      try { void ctx.resume?.()?.catch?.(() => { /* */ }); } catch { /* */ }
      void this.refreshOutputs(g);
      return true;
    } catch (e) {
      if (g !== this.gen) return false;
      const err: AiCallError = (e as any)?.name === "MicError"
        ? { kind: "mic", code: String((e as any).code || "unknown") }
        : { kind: "unsupported", code: "audio" };
      if (incoming) this.declineWith("unsupported");
      this.finish("error", err);
      return false;
    }
  }

  private async refreshOutputs(g: number) {
    const ctx = this.ctx;
    if (!ctx || typeof ctx.setSinkId !== "function") return;
    try {
      const outs = await this.deps.listOutputs();
      if (g !== this.gen) return;
      this.set({ outputs: outs, canSelectOutput: outs.length > 1 });
    } catch { /* */ }
  }

  /** A10: server faqat websocket transportida audio qabul qiladi — polling'dan yangilanishni qisqa kutamiz. */
  private async ensureWebsocket(s: SocketLike): Promise<void> {
    const eng = s.io?.engine;
    if (!eng || eng.transport?.name === "websocket") return;
    const ups = eng._upgrades;
    if (Array.isArray(ups) && !ups.includes("websocket")) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(t); try { eng.off?.("upgrade", finish); } catch { /* */ } resolve(); };
      const t = setTimeout(finish, WS_UPGRADE_WAIT_MS);
      try { eng.on?.("upgrade", finish); } catch { finish(); }
    });
  }

  private emitAck<T>(s: SocketLike, ev: string, data: unknown, ms: number): Promise<T | null> {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
      try {
        s.emit(ev, data, (r: T) => { if (done) return; done = true; clearTimeout(t); resolve(r ?? null); });
      } catch { done = true; clearTimeout(t); resolve(null); }
    });
  }

  private armReadyTimeout(g: number) {
    this.setTimer("ready", READY_TIMEOUT_MS, () => {
      if (g !== this.gen || this.st.status === "connected") return;
      this.socket?.emit(C.hangup, this.sessionId ? { sessionId: this.sessionId } : {});
      this.finish("error", { kind: "timeout", code: "timeout" });
    });
  }

  // ───── audio ─────
  private onFrame(pcm: Int16Array, rms: number) {
    if (this.st.status !== "connected" || this.st.muted) return;
    if (this.st.ptt.mode) {
      if (this.pttHeld) this.sendFrame(pcm);
      else if (this.pttTail > 0) { this.pttTail--; this.sendFrame(new Int16Array(pcm.length)); }
      return;
    }
    const frames = this.gate.process(pcm, rms, this.aiOutput(), this.deps.now());
    for (const f of frames) this.sendFrame(f);
  }

  private aiOutput(): AiOutputState {
    if (this.deps.tts?.speaking) return { playing: true, level: 0.1 };
    return this.player?.state ?? { playing: false, level: 0 };
  }

  private sendFrame(pcm: Int16Array) {
    const s = this.socket;
    if (!s?.connected || !this.correlationId) return;
    let bytes: Uint8Array;
    try { bytes = encodeAudioFrame(this.correlationId, this.seq, pcm); } catch { return; }
    this.seq = (this.seq + 1) >>> 0;
    s.emit(C.audio, bytes);
  }

  private onPlayerState(ps: AiOutputState) {
    if (ps.playing !== this.st.aiSpeaking) this.set({ aiSpeaking: ps.playing });
  }

  // ───── socket ─────
  private sync = () => {
    const s = this.deps.getSocket();
    if (s === this.socket) return;
    this.detach();
    this.socket = s;
    if (!s) return;
    s.on(S.incoming, this.onIncoming);
    s.on(S.ready, this.onReady);
    s.on(S.audio, this.onAudio);
    s.on(S.transcript, this.onTranscript);
    s.on(S.tool, this.onTool);
    s.on(S.confirm, this.onConfirm);
    s.on(S.interrupted, this.onInterrupted);
    s.on(S.end, this.onEnd);
    s.on(S.error, this.onError);
    s.on("connect", this.onConnect);
    s.on("disconnect", this.onDisconnect);
    if (s.connected) this.onConnect();
  };

  private detach() {
    const s = this.socket;
    if (!s) return;
    s.off(S.incoming, this.onIncoming);
    s.off(S.ready, this.onReady);
    s.off(S.audio, this.onAudio);
    s.off(S.transcript, this.onTranscript);
    s.off(S.tool, this.onTool);
    s.off(S.confirm, this.onConfirm);
    s.off(S.interrupted, this.onInterrupted);
    s.off(S.end, this.onEnd);
    s.off(S.error, this.onError);
    s.off("connect", this.onConnect);
    s.off("disconnect", this.onDisconnect);
    this.socket = null;
  }

  private aiOff(): boolean {
    try { return this.deps.aiActive?.() === false; } catch { return false; }
  }

  private emitPresence() {
    const s = this.socket;
    if (!s?.connected || this.aiOff()) return;
    s.emit(C.presence, { visible: !this.deps.doc?.hidden });
  }

  private onVisibility = () => {
    this.emitPresence();
    if (!this.deps.doc?.hidden) this.checkPending();
  };

  private onConnect = () => {
    this.emitPresence();
    if (this.st.status === "reconnecting") void this.rebind();
    else this.checkPending();
  };

  private onDisconnect = () => {
    const st = this.st.status;
    if (st !== "connected" && st !== "ringing") return;
    this.player?.flush();
    this.deps.tts?.cancel();
    this.set({ status: "reconnecting", aiSpeaking: false });
    const g = this.gen;
    this.setTimer("reconnect", RECONNECT_GRACE_MS, () => {
      if (g !== this.gen || this.st.status !== "reconnecting") return;
      this.finish("network", { kind: "network", code: "lost" });
    });
  };

  /** Qayta ulanishda sessiyani yangi socket'ga bog'lashga urinish (server aiv:accept bilan qayta bog'laydi). */
  private async rebind() {
    const s = this.socket;
    const sessionId = this.sessionId;
    const g = this.gen;
    if (!s || !sessionId) { this.finish("network", { kind: "network", code: "lost" }); return; }
    await this.ensureWebsocket(s);
    if (g !== this.gen || this.st.status !== "reconnecting") return;
    const ack = await this.emitAck<AivSessionAck>(s, C.accept, { sessionId }, ACK_TIMEOUT_MS);
    if (g !== this.gen || this.st.status !== "reconnecting") return;
    if (ack && ack.ok) {
      if (ack.correlationId) this.correlationId = ack.correlationId;
      this.clearTimer("reconnect");
      this.gate.reset();
      this.lastInSeq = null;
      this.set({ status: this.st.connectedAt ? "connected" : "ringing" });
      return;
    }
    this.finish("network", { kind: "network", code: failOf(ack)?.code || "lost" });
  }

  private checkPending() {
    if (this.st.status !== "idle" || this.deps.doc?.hidden || this.aiOff()) return;
    const now = this.deps.now();
    if (now - this.lastPendingAt < PENDING_MIN_GAP_MS) return;
    this.lastPendingAt = now;
    this.deps.fetchPending().then((call) => { if (call) this.onIncoming(call); }).catch(() => { /* */ });
  }

  private onIncoming = (d: AivIncoming) => {
    if (!d || typeof d.sessionId !== "string" || !d.sessionId) return;
    const s = this.socket;
    if (d.sessionId === this.sessionId && ACTIVE.includes(this.st.status)) return; // takror
    const exp = Date.parse(d.expiresAt);
    const nowWall = Date.now();
    if (Number.isFinite(exp) && exp <= nowWall) return;
    const declineReq = (reason: AivDeclineReq["reason"]) => s?.emit(C.decline, { sessionId: d.sessionId, reason } as AivDeclineReq);
    if (ACTIVE.includes(this.st.status)) { declineReq("busy"); return; }
    const decision = decideAiIncoming({ busy: this.busy, supported: this.deps.supported() });
    if (decision !== "ring") { declineReq(decision); return; }

    this.gen++;
    this.clearTimer("dismiss");
    this.resetSession();
    const auto = this.expectCallUntil > this.deps.now() && this.autoAcceptOk();
    this.expectCallUntil = 0;
    this.sessionId = d.sessionId;
    this.correlationId = typeof d.correlationId === "string" ? d.correlationId : null;
    const ringMs = Number.isFinite(exp) ? Math.max(5000, Math.min(120_000, exp - nowWall)) : 45_000;
    this.set({
      ...INITIAL_AI_CALL_STATE, status: "incoming", direction: "incoming", sessionId: d.sessionId,
      purpose: d.purpose || null, companyName: d.companyName, expiresAt: nowWall + ringMs,
    });
    setAiCallActive(true);
    if (auto) { this.accept(); return; }
    try { this.stopRing = this.deps.startRing(); } catch { /* */ }
    try { this.stopAttention = this.deps.startAttention(); } catch { /* */ }
    const g = this.gen;
    this.setTimer("ringExpire", ringMs, () => {
      if (g !== this.gen || this.st.status !== "incoming") return;
      this.finish("timeout", null, 0);
    });
  };

  private autoAcceptOk(): boolean {
    if (this.busy || this.deps.doc?.hidden) return false;
    try { return !!this.deps.canAutoAccept?.(); } catch { return false; }
  }

  private matches(sessionId: unknown): boolean {
    return typeof sessionId === "string" && !!this.sessionId && sessionId === this.sessionId;
  }

  private onReady = (d: AivReady) => {
    if (!d || typeof d.sessionId !== "string") return;
    const st = this.st;
    if (!["connecting", "ringing", "reconnecting"].includes(st.status)) return;
    if (this.sessionId) { if (d.sessionId !== this.sessionId) return; }
    else if (st.direction === "outgoing") this.sessionId = d.sessionId;
    else return;
    if (typeof d.correlationId === "string" && d.correlationId) this.correlationId = d.correlationId;
    this.serverPtt = !!d.ptt;
    this.clearTimer("ready");
    this.clearTimer("reconnect");
    this.gate.reset();
    const mode = this.serverPtt || st.ptt.mode;
    this.set({
      status: "connected", sessionId: this.sessionId, connectedAt: st.connectedAt ?? this.deps.now(),
      ptt: { mode, forced: this.serverPtt, held: false },
    });
  };

  private onAudio = (data: unknown) => {
    if (this.st.status !== "connected" || !this.player) return;
    let input: ArrayBuffer | Uint8Array | null = null;
    if (data instanceof Uint8Array) input = data;
    else if (data instanceof ArrayBuffer) input = data;
    else if (ArrayBuffer.isView(data)) input = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (!input) return;
    const f = decodeAudioFrame(input);
    if (!f) return;
    if (this.correlationId && f.correlationId !== this.correlationId) return;
    if (this.lastInSeq !== null && f.seq <= this.lastInSeq && this.lastInSeq - f.seq < 1_000_000) return;
    this.lastInSeq = f.seq;
    this.player.push(f.pcm);
    this.deps.tts?.noteAudio();
  };

  private onTranscript = (d: AivTranscript) => {
    if (!d || !this.matches(d.sessionId) || !IN_CALL.includes(this.st.status)) return;
    if (d.role !== "user" && d.role !== "assistant") return;
    const text = typeof d.text === "string" ? d.text.slice(0, 2000) : "";
    const caps = this.st.captions.slice();
    const last = caps[caps.length - 1];
    if (last && last.role === d.role && !last.final) {
      let merged: string;
      if (!text) merged = last.text;
      else if (text.startsWith(last.text)) merged = text;                     // to'liq (cumulative) matn
      else if (d.final && text.length >= last.text.length * 0.8) merged = text; // yakuniy to'liq matn
      else merged = last.text + text;                                           // delta bo'lak
      caps[caps.length - 1] = { ...last, text: merged, final: !!d.final };
    } else if (text) {
      caps.push({ id: ++this.capId, role: d.role, text, final: !!d.final });
    }
    while (caps.length > MAX_CAPTIONS) caps.shift();
    this.set({ captions: caps });
    if (d.role === "assistant" && d.final) {
      const full = caps[caps.length - 1]?.text || text;
      this.deps.tts?.onAssistantFinal(full, this.deps.lang());
    }
  };

  private onTool = (d: AivToolEvent) => {
    if (!d || !this.matches(d.sessionId)) return;
    this.showTool({ name: String(d.name || ""), status: d.status, message: String(d.message || "").slice(0, 300) });
  };

  private showTool(tool: { name: string; status: ToolStatus; message: string }) {
    if (this.toolClearTimer) clearTimeout(this.toolClearTimer);
    this.set({ tool });
    this.toolClearTimer = setTimeout(() => { this.toolClearTimer = null; if (this.st.tool === tool) this.set({ tool: null }); }, 5000);
  }

  private onConfirm = (d: AivConfirm) => {
    if (!d || !this.matches(d.sessionId) || typeof d.pendingActionId !== "string") return;
    this.set({ confirm: { ...d, summary: String(d.summary || "").slice(0, 500) }, confirmBusy: false });
  };

  private onInterrupted = (d?: { sessionId?: string }) => {
    if (d && d.sessionId && !this.matches(d.sessionId)) return;
    this.player?.flush();
    this.deps.tts?.cancel();
    if (this.st.aiSpeaking) this.set({ aiSpeaking: false });
  };

  private onEnd = (d: AivEnd) => {
    if (!d || !ACTIVE.includes(this.st.status)) return;
    if (this.sessionId ? d.sessionId !== this.sessionId : this.st.direction !== "outgoing") return;
    const reason = d.reason;
    if (this.st.status === "incoming" && (reason === "answered_elsewhere" || reason === "timeout" || reason === "declined")) {
      this.finish(reason, null, 0);
      return;
    }
    let err: AiCallError | null = SERVER_END_ERRORS.includes(reason) ? { kind: "server", code: reason } : null;
    // Server end'dan oldin aniq sabab aytgan bo'lsa (kvota / sozlanmagan / ulanib bo'lmadi) — shu kod
    if (reason === "error" && this.serverFail) err = { kind: "server", code: this.serverFail.code, message: this.serverFail.message };
    this.finish(reason, err);
  };

  private onError = (d: AivError) => {
    if (!d || !IN_CALL.includes(this.st.status)) return;
    const code = String(d.code || "");
    const message = String(d.message || code).slice(0, 200);
    if (SERVER_FAIL_CODES.has(code)) { this.serverFail = { code, message }; return; }
    // Zaxira rejim (Live → kaskad) yoki faqat matnli ovoz — xato emas, ma'lumot
    if (code === "ai_fallback" || code === "tts_unavailable") { this.showTool({ name: code, status: "ok", message }); return; }
    this.showTool({ name: "error", status: "error", message });
  };

  // ───── yakunlash / tozalash ─────
  private declineWith(reason: AivDeclineReq["reason"]) {
    if (this.sessionId) this.socket?.emit(C.decline, { sessionId: this.sessionId, reason } as AivDeclineReq);
  }

  private finish(reason: AiCallEndReason, error: AiCallError | null = null, dismissMs = ENDED_DISMISS_MS) {
    this.gen++;
    this.teardown();
    this.clearTimer("ready");
    this.clearTimer("reconnect");
    this.clearTimer("ringExpire");
    this.set({
      status: "ended", endReason: reason, error, aiSpeaking: false, confirm: null, confirmBusy: false,
      ptt: { ...this.st.ptt, held: false },
    });
    setAiCallActive(false);
    // Xato bo'lsa oyna ochiq qoladi (sabab va matnli chatga o'tish tugmasi ko'rinsin)
    if (!error) {
      if (dismissMs <= 0) this.dismiss();
      else this.setTimer("dismiss", dismissMs, () => this.dismiss());
    }
  }

  private resetSession() {
    this.serverFail = null;
    this.sessionId = null;
    this.correlationId = null;
    this.seq = 0;
    this.lastInSeq = null;
    this.serverPtt = false;
    this.pttHeld = false;
    this.pttTail = 0;
    this.gate.reset();
    this.capId = 0;
  }

  private stopRinging() {
    try { this.stopRing?.(); } catch { /* */ }
    try { this.stopAttention?.(); } catch { /* */ }
    this.stopRing = this.stopAttention = null;
  }

  private teardown() {
    this.stopRinging();
    this.deps.tts?.cancel();
    try { this.capture?.stop(); } catch { /* */ }
    if (!this.capture && this.stream) stopStream(this.stream);
    try { this.player?.close(); } catch { /* */ }
    try { void this.ctx?.close?.()?.catch?.(() => {}); } catch { /* */ }
    this.capture = null;
    this.player = null;
    this.stream = null;
    this.ctx = null;
    this.pttHeld = false;
    if (this.toolClearTimer) { clearTimeout(this.toolClearTimer); this.toolClearTimer = null; }
  }

  private setTimer(name: string, ms: number, fn: () => void) {
    this.clearTimer(name);
    this.timers[name] = setTimeout(() => { this.timers[name] = null; fn(); }, ms);
  }
  private clearTimer(name: string) {
    const t = this.timers[name];
    if (t) clearTimeout(t);
    this.timers[name] = null;
  }
  private clearAllTimers() { for (const k of Object.keys(this.timers)) this.clearTimer(k); }

  private set(patch: Partial<AiCallState>) {
    this.st = { ...this.st, ...patch };
    for (const l of Array.from(this.listeners)) { try { l(); } catch { /* */ } }
  }
}

type SessionOk = Extract<AivSessionAck, { ok: true }>;
type AckFail = { ok: false; code: AivErrorCode; message?: string };
/** Ack xato bo'lsa — uning kodi (strict rejimdan qat'i nazar ishlaydi). */
function failOf(a: { ok: boolean } | null | undefined): AckFail | null {
  return a && a.ok === false ? (a as AckFail) : null;
}

function stopStream(s: StreamLike) {
  for (const t of s.getTracks()) { try { t.stop(); } catch { /* */ } }
}

function ackEndReason(code: string): AiCallEndReason {
  switch (code) {
    case "busy": return "busy";
    case "off_shift": return "off_shift";
    case "limit": case "budget": case "platform_cap": case "company_cap": return "limit";
    case "unsupported_transport": return "unsupported_transport";
    case "answered_elsewhere": return "answered_elsewhere";
    default: return "error";
  }
}

