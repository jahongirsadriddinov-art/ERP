import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AiVoiceController, textFallbackKind, type AiVoiceDeps, type SocketLike } from "./aiVoiceController";
import { __resetAiVoiceBus, isAiCallActive } from "./bus";
import { encodeAudioFrame } from "./protocol";

// useAiVoiceSession holat mashinasi (AiVoiceController) — soxta socket/mikrofon/audio bilan (A10–A12, §8).

const SID = "sess-1";
const CID = "123e4567-e89b-12d3-a456-426614174000";

class FakeSocket implements SocketLike {
  connected = true;
  handlers = new Map<string, Set<(...a: any[]) => void>>();
  emitted: { ev: string; data: any }[] = [];
  acks: Record<string, (data: any) => any> = {};
  on(ev: string, fn: (...a: any[]) => void) { if (!this.handlers.has(ev)) this.handlers.set(ev, new Set()); this.handlers.get(ev)!.add(fn); }
  off(ev: string, fn: (...a: any[]) => void) { this.handlers.get(ev)?.delete(fn); }
  emit(ev: string, data?: any, cb?: (r: any) => void) {
    this.emitted.push({ ev, data });
    if (cb && this.acks[ev]) { const r = this.acks[ev](data); if (r !== undefined) queueMicrotask(() => cb(r)); }
  }
  fire(ev: string, data?: any) { for (const fn of Array.from(this.handlers.get(ev) || [])) fn(data); }
  sent(ev: string) { return this.emitted.filter((e) => e.ev === ev); }
}

function makeDeps(sock: FakeSocket | null, over: Partial<AiVoiceDeps> = {}) {
  const docListeners = new Set<() => void>();
  const doc = {
    hidden: false,
    addEventListener: (_: "visibilitychange", fn: () => void) => docListeners.add(fn),
    removeEventListener: (_: "visibilitychange", fn: () => void) => docListeners.delete(fn),
  };
  const spies = {
    openMic: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
    onFrame: null as null | ((pcm: Int16Array, rms: number) => void),
    pushed: [] as Int16Array[],
    ringStop: vi.fn(),
    startRing: vi.fn(),
    fetchPending: vi.fn(async () => null),
    playerState: { playing: false, level: 0 },
    flush: vi.fn(),
  };
  let current = sock;
  const deps: AiVoiceDeps = {
    getSocket: () => current,
    supported: () => true,
    isAndroid: () => false,
    createContext: () => ({ sampleRate: 48000, close: async () => {} }),
    openMic: spies.openMic,
    createCapture: async (_c, _s, onFrame) => { spies.onFrame = onFrame; return { setMuted: vi.fn(), stop: vi.fn() }; },
    createPlayer: async () => ({ push: (p: any) => spies.pushed.push(p), flush: spies.flush, close: vi.fn(), get state() { return spies.playerState; } }),
    listOutputs: async () => [],
    startRing: () => { spies.startRing(); return spies.ringStop; },
    startAttention: () => () => {},
    fetchPending: spies.fetchPending,
    aiActive: () => true,
    tts: null,
    doc,
    now: () => Date.now(),
    lang: () => "uz",
    onNotice: vi.fn(),
    ...over,
  };
  return { deps, spies, doc, docListeners, setSocket: (s: FakeSocket | null) => { current = s; } };
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const incoming = (over: Record<string, unknown> = {}) => ({ sessionId: SID, correlationId: CID, purpose: "attendance", expiresAt: new Date(Date.now() + 30_000).toISOString(), ...over });
const ready = (ptt = false) => ({ sessionId: SID, correlationId: CID, inputSampleRate: 16000, outputSampleRate: 24000, frameMs: 40, ptt });

let ctl: AiVoiceController | null = null;
beforeEach(() => { vi.useFakeTimers(); __resetAiVoiceBus(); });
afterEach(() => { ctl?.dispose(); ctl = null; vi.useRealTimers(); });

describe("AiVoiceController — kiruvchi qo'ng'iroq", () => {
  it("jiringlash paytida mikrofon OCHILMAYDI; Qabul → getUserMedia, aiv:accept, aiv:ready → connected", async () => {
    const s = new FakeSocket();
    s.acks["aiv:accept"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    const { deps, spies } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    s.fire("aiv:incoming", incoming());
    expect(ctl.getState().status).toBe("incoming");
    expect(spies.startRing).toHaveBeenCalledTimes(1);
    expect(spies.openMic).not.toHaveBeenCalled();
    expect(isAiCallActive()).toBe(true);

    ctl.accept();
    await flush();
    expect(spies.ringStop).toHaveBeenCalled();
    expect(spies.openMic).toHaveBeenCalledTimes(1);
    expect(s.sent("aiv:accept")[0].data).toEqual({ sessionId: SID });
    expect(ctl.getState().status).toBe("connecting");
    s.fire("aiv:ready", ready());
    expect(ctl.getState().status).toBe("connected");

    // Mikrofon kadri → sarlavhali binar kadr
    spies.onFrame!(new Int16Array(640), 0.01);
    const audio = s.sent("aiv:audio");
    expect(audio).toHaveLength(1);
    expect(audio[0].data).toBeInstanceOf(Uint8Array);
    expect((audio[0].data as Uint8Array).byteLength).toBe(20 + 1280);
  });

  it("WebRTC qo'ng'iroq paytida (busy) — avtomatik 'busy' rad etish, jiringlamaydi", () => {
    const s = new FakeSocket();
    const { deps, spies } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.setBusy(true);
    s.fire("aiv:incoming", incoming());
    expect(s.sent("aiv:decline")[0].data).toEqual({ sessionId: SID, reason: "busy" });
    expect(ctl.getState().status).toBe("idle");
    expect(spies.startRing).not.toHaveBeenCalled();
  });

  it("audio qo'llanmasa — 'unsupported' rad etish; muddati o'tgan taklif e'tiborsiz", () => {
    const s = new FakeSocket();
    const { deps } = makeDeps(s, { supported: () => false });
    ctl = new AiVoiceController(deps);
    ctl.start();
    s.fire("aiv:incoming", incoming({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(s.sent("aiv:decline")).toHaveLength(0);
    s.fire("aiv:incoming", incoming());
    expect(s.sent("aiv:decline")[0].data.reason).toBe("unsupported");
  });

  it("Rad etish → aiv:decline 'declined', holat idle; jiringlash muddati tugasa — idle", () => {
    const s = new FakeSocket();
    const { deps } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    s.fire("aiv:incoming", incoming());
    ctl.decline();
    expect(s.sent("aiv:decline")[0].data).toEqual({ sessionId: SID, reason: "declined" });
    expect(ctl.getState().status).toBe("idle");
    expect(isAiCallActive()).toBe(false);

    s.fire("aiv:incoming", incoming({ sessionId: "sess-2", expiresAt: new Date(Date.now() + 6000).toISOString() }));
    expect(ctl.getState().status).toBe("incoming");
    vi.advanceTimersByTime(6500);
    expect(ctl.getState().status).toBe("idle");
  });

  it("boshqa qurilmada javob berildi (aiv:end answered_elsewhere) — jim yopiladi", () => {
    const s = new FakeSocket();
    const { deps } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    s.fire("aiv:incoming", incoming());
    s.fire("aiv:end", { sessionId: SID, reason: "answered_elsewhere" });
    expect(ctl.getState().status).toBe("idle");
  });
});

describe("AiVoiceController — chiquvchi qo'ng'iroq", () => {
  it("startOutgoing → aiv:start (ack) → ringing → ready → connected; captions, interrupted, hangup", async () => {
    const s = new FakeSocket();
    s.acks["aiv:start"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    const { deps, spies } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.startOutgoing();
    expect(ctl.getState().status).toBe("connecting");
    await flush();
    expect(s.sent("aiv:start")[0].data).toEqual({ purpose: "assistant", ptt: false });
    expect(ctl.getState().status).toBe("ringing");
    s.fire("aiv:ready", ready());
    expect(ctl.getState().status).toBe("connected");

    // Kiruvchi ovoz: to'g'ri correlationId — ijroga; boshqa sessiya — tashlanadi
    s.fire("aiv:audio", encodeAudioFrame(CID, 0, new Int16Array(480)));
    s.fire("aiv:audio", encodeAudioFrame("00000000-0000-0000-0000-000000000000", 1, new Int16Array(480)));
    expect(spies.pushed).toHaveLength(1);

    // Jonli matn: server yig'ma (cumulative) matn yuboradi — bitta qator yangilanadi, final'dan keyin yangi qator
    s.fire("aiv:transcript", { sessionId: SID, role: "assistant", text: "Assalomu", final: false });
    s.fire("aiv:transcript", { sessionId: SID, role: "assistant", text: "Assalomu alaykum", final: true });
    s.fire("aiv:transcript", { sessionId: "boshqa", role: "user", text: "begona", final: true });
    s.fire("aiv:transcript", { sessionId: SID, role: "user", text: "Salom", final: true });
    expect(ctl.getState().captions.map((c) => [c.role, c.text])).toEqual([["assistant", "Assalomu alaykum"], ["user", "Salom"]]);

    s.fire("aiv:interrupted", { sessionId: SID });
    expect(spies.flush).toHaveBeenCalled();

    ctl.toggleMute();
    expect(ctl.getState().muted).toBe(true);
    spies.onFrame!(new Int16Array(640), 0.2);
    expect(s.sent("aiv:audio")).toHaveLength(0);

    ctl.hangup();
    expect(s.sent("aiv:hangup")[0].data).toEqual({ sessionId: SID });
    expect(ctl.getState()).toMatchObject({ status: "ended", endReason: "hangup" });
    vi.advanceTimersByTime(3000);
    expect(ctl.getState().status).toBe("idle");
  });

  it("server rad etsa (limit) — xato bilan tugaydi va oyna ochiq qoladi (matnli zaxira tugmasi uchun)", async () => {
    const s = new FakeSocket();
    s.acks["aiv:start"] = () => ({ ok: false, code: "platform_cap" });
    const { deps } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.startOutgoing();
    await flush();
    expect(ctl.getState()).toMatchObject({ status: "ended", endReason: "limit", error: { kind: "server", code: "platform_cap" } });
    vi.advanceTimersByTime(10_000);
    expect(ctl.getState().status).toBe("ended");
    ctl.dismiss();
    expect(ctl.getState().status).toBe("idle");
  });

  it("mikrofon ruxsati yo'q — 'mic' xatosi, aiv:start yuborilmaydi", async () => {
    const s = new FakeSocket();
    const err = Object.assign(new Error("x"), { name: "MicError", code: "permission_denied" });
    const { deps } = makeDeps(s, { openMic: async () => { throw err; } });
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.startOutgoing();
    await flush();
    expect(ctl.getState().error).toEqual({ kind: "mic", code: "permission_denied" });
    expect(s.sent("aiv:start")).toHaveLength(0);
  });

  it("WebRTC qo'ng'iroq paytida chiquvchi AI qo'ng'iroq boshlanmaydi (xabar)", () => {
    const s = new FakeSocket();
    const { deps } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.setBusy(true);
    ctl.startOutgoing();
    expect(deps.onNotice).toHaveBeenCalledWith("busyWebrtc");
    expect(ctl.getState().status).toBe("idle");
  });

  it("ack kelmasa — timeout xatosi va server sessiyasi yopiladi", async () => {
    const s = new FakeSocket();
    const { deps } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.startOutgoing();
    await flush();
    await vi.advanceTimersByTimeAsync(12_500);
    expect(ctl.getState().error?.kind).toBe("timeout");
    expect(s.sent("aiv:hangup")).toHaveLength(1);
  });
});

describe("AiVoiceController — bosib gapirish (Android) va yarim dupleks", () => {
  it("Android'da PTT standart: tugma bosilmaguncha kadr yuborilmaydi, qo'yib yuborilgach qisqa sukunat dumi", async () => {
    const s = new FakeSocket();
    s.acks["aiv:start"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    const { deps, spies } = makeDeps(s, { isAndroid: () => true });
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.startOutgoing();
    await flush();
    expect(s.sent("aiv:start")[0].data.ptt).toBe(true);
    s.fire("aiv:ready", ready(false));
    expect(ctl.getState().ptt).toMatchObject({ mode: true, forced: false });

    spies.onFrame!(new Int16Array(640).fill(100), 0.3);
    expect(s.sent("aiv:audio")).toHaveLength(0);
    ctl.pttDown();
    expect(s.sent("aiv:ptt")[0].data).toEqual({ on: true });
    expect(spies.flush).toHaveBeenCalled();             // AI gapini bo'ladi
    spies.onFrame!(new Int16Array(640).fill(100), 0.3);
    expect(s.sent("aiv:audio")).toHaveLength(1);
    ctl.pttUp();
    expect(s.sent("aiv:ptt")[1].data).toEqual({ on: false });
    for (let i = 0; i < 20; i++) spies.onFrame!(new Int16Array(640).fill(100), 0.3);
    expect(s.sent("aiv:audio")).toHaveLength(1 + 15);   // 600 ms sukunat dumi, keyin jim
  });

  it("server PTT'ni majburlasa (ready.ptt) — o'chirib bo'lmaydi", async () => {
    const s = new FakeSocket();
    s.acks["aiv:start"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    const { deps } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.startOutgoing();
    await flush();
    s.fire("aiv:ready", ready(true));
    expect(ctl.getState().ptt).toMatchObject({ mode: true, forced: true });
    ctl.setPttMode(false);
    expect(ctl.getState().ptt.mode).toBe(true);
  });

  it("AI gapirayotganda past (aks-sado) mikrofon kadrlari yuborilmaydi", async () => {
    const s = new FakeSocket();
    s.acks["aiv:start"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    const { deps, spies } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.startOutgoing();
    await flush();
    s.fire("aiv:ready", ready());
    spies.playerState = { playing: true, level: 0.05 };
    for (let i = 0; i < 5; i++) spies.onFrame!(new Int16Array(640), 0.02);
    expect(s.sent("aiv:audio")).toHaveLength(0);
    spies.playerState = { playing: false, level: 0 };
    vi.advanceTimersByTime(400);
    spies.onFrame!(new Int16Array(640), 0.02);
    expect(s.sent("aiv:audio")).toHaveLength(1);
  });
});

describe("AiVoiceController — presence, kech ulanish, qayta ulanish", () => {
  it("socket kech paydo bo'lsa ham ulanadi; presence va kutilayotgan qo'ng'iroq tekshiriladi; visibilitychange", async () => {
    const s = new FakeSocket();
    const { deps, setSocket, spies, doc, docListeners } = makeDeps(null);
    ctl = new AiVoiceController(deps);
    ctl.start();
    expect(s.sent("aiv:presence")).toHaveLength(0);
    setSocket(s);
    vi.advanceTimersByTime(1000);
    expect(s.sent("aiv:presence")[0].data).toEqual({ visible: true });
    expect(spies.fetchPending).toHaveBeenCalledTimes(1);
    // keyin kelgan aiv:incoming ham ishlaydi
    s.fire("aiv:incoming", incoming());
    expect(ctl.getState().status).toBe("incoming");
    ctl.decline();

    doc.hidden = true;
    for (const fn of docListeners) fn();
    expect(s.sent("aiv:presence").at(-1)!.data).toEqual({ visible: false });
    // yashirin paytda heartbeat yuborilmaydi
    const n = s.sent("aiv:presence").length;
    vi.advanceTimersByTime(30_000);
    expect(s.sent("aiv:presence")).toHaveLength(n);
  });

  it("AI firmada o'chiq — presence ham, pending so'rovi ham yuborilmaydi", () => {
    const s = new FakeSocket();
    const { deps, spies } = makeDeps(s, { aiActive: () => false });
    ctl = new AiVoiceController(deps);
    ctl.start();
    vi.advanceTimersByTime(30_000);
    expect(s.sent("aiv:presence")).toHaveLength(0);
    expect(spies.fetchPending).not.toHaveBeenCalled();
  });

  it("uzilish → reconnecting; qayta ulanganda aiv:accept bilan sessiyaga qaytadi; grace tugasa — network", async () => {
    const s = new FakeSocket();
    s.acks["aiv:start"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    s.acks["aiv:accept"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    const { deps } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.startOutgoing();
    await flush();
    s.fire("aiv:ready", ready());
    s.connected = false;
    s.fire("disconnect");
    expect(ctl.getState().status).toBe("reconnecting");
    s.connected = true;
    s.fire("connect");
    await flush();
    expect(s.sent("aiv:accept")[0].data).toEqual({ sessionId: SID });
    expect(ctl.getState().status).toBe("connected");

    s.connected = false;
    s.fire("disconnect");
    vi.advanceTimersByTime(12_500);
    expect(ctl.getState()).toMatchObject({ status: "ended", endReason: "network" });
  });

  it("dispose — faol qo'ng'iroqni yopadi (hangup) va bus holatini tozalaydi", async () => {
    const s = new FakeSocket();
    s.acks["aiv:start"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    const { deps } = makeDeps(s);
    const c = new AiVoiceController(deps);
    c.start();
    c.startOutgoing();
    await flush();
    c.dispose();
    expect(s.sent("aiv:hangup")).toHaveLength(1);
    expect(isAiCallActive()).toBe(false);
    expect(c.getState().status).toBe("idle");
  });
});

describe("AiVoiceController — ovozli ishonchlilik (kvota → matn, 'menga qo'ng'iroq qil')", () => {
  it("server ai_quota sababini aytib tugatsa — xato kodi ai_quota, matnli rejim 'limit'", async () => {
    const s = new FakeSocket();
    s.acks["aiv:start"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    const { deps } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.startOutgoing();
    await flush();
    s.fire("aiv:error", { code: "ai_quota", message: "Ovozli limit tugadi — matn bilan davom etamiz." });
    expect(ctl.getState().tool).toBeNull();               // sabab — chip emas, yakuniy xato
    s.fire("aiv:end", { sessionId: SID, reason: "error" });
    const st = ctl.getState();
    expect(st).toMatchObject({ status: "ended", error: { kind: "server", code: "ai_quota" } });
    expect(textFallbackKind(st.error)).toBe("limit");
  });

  it("ack rad etish kodlari matnga o'tkazadi: limit/budget/platform_cap → limit; unsupported_transport → network; boshqalar — yo'q", () => {
    expect(textFallbackKind({ kind: "server", code: "limit" })).toBe("limit");
    expect(textFallbackKind({ kind: "server", code: "budget" })).toBe("limit");
    expect(textFallbackKind({ kind: "server", code: "platform_cap" })).toBe("limit");
    expect(textFallbackKind({ kind: "server", code: "ai_not_configured" })).toBe("not_configured");
    expect(textFallbackKind({ kind: "server", code: "ai_unavailable" })).toBe("unavailable");
    expect(textFallbackKind({ kind: "server", code: "unsupported_transport" })).toBe("network");
    expect(textFallbackKind({ kind: "server", code: "off_shift" })).toBeNull();
    expect(textFallbackKind({ kind: "mic", code: "permission_denied" })).toBeNull();
    expect(textFallbackKind(null)).toBeNull();
  });

  it("ai_fallback / tts_unavailable — xato emas, ma'lumot chipi; qo'ng'iroq davom etadi", async () => {
    const s = new FakeSocket();
    s.acks["aiv:start"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    const { deps } = makeDeps(s);
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.startOutgoing();
    await flush();
    s.fire("aiv:ready", ready());
    s.fire("aiv:error", { code: "ai_fallback", message: "zaxira" });
    expect(ctl.getState()).toMatchObject({ status: "connected", tool: { name: "ai_fallback", status: "ok" } });
    s.fire("aiv:end", { sessionId: SID, reason: "hangup" });
    expect(ctl.getState().error).toBeNull();
  });

  it("chatda qo'ng'iroq so'ralgan (expectIncoming) — kelgan AI qo'ng'irog'i jiringlamasdan ulanadi", async () => {
    const s = new FakeSocket();
    s.acks["aiv:accept"] = () => ({ ok: true, sessionId: SID, correlationId: CID });
    const { deps, spies } = makeDeps(s, { canAutoAccept: () => true });
    ctl = new AiVoiceController(deps);
    ctl.start();
    const presenceBefore = s.sent("aiv:presence").length;
    ctl.expectIncoming(60_000);
    expect(s.sent("aiv:presence").length).toBe(presenceBefore + 1);
    s.fire("aiv:incoming", incoming({ purpose: "assistant" }));
    expect(spies.startRing).not.toHaveBeenCalled();
    expect(ctl.getState().status).toBe("connecting");
    await flush();
    expect(s.sent("aiv:accept")[0].data).toEqual({ sessionId: SID });
    s.fire("aiv:ready", ready());
    expect(ctl.getState().status).toBe("connected");
  });

  it("kutish oynasi o'tgan yoki avtomatik qabul mumkin emas — oddiy jiringlash", () => {
    const s = new FakeSocket();
    const { deps, spies } = makeDeps(s, { canAutoAccept: () => false });
    ctl = new AiVoiceController(deps);
    ctl.start();
    ctl.expectIncoming(60_000);
    s.fire("aiv:incoming", incoming());
    expect(ctl.getState().status).toBe("incoming");
    expect(spies.startRing).toHaveBeenCalledTimes(1);
    ctl.decline();

    const s2 = new FakeSocket();
    const m2 = makeDeps(s2, { canAutoAccept: () => true });
    ctl.dispose();
    ctl = new AiVoiceController(m2.deps);
    ctl.start();
    ctl.expectIncoming(1_000);
    vi.advanceTimersByTime(2_000);
    s2.fire("aiv:incoming", incoming({ sessionId: "sess-9" }));
    expect(ctl.getState().status).toBe("incoming");
  });
});
