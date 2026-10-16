import { AUDIO_IN_SAMPLE_RATE } from "../protocol";
import { FrameChunker, StreamingResampler, float32ToInt16, rmsFloat32 } from "./resample";

// Mikrofon → 16 kHz PCM16 kadrlar (40 ms = 640 namuna). getUserMedia FAQAT foydalanuvchi "Qabul qilish"
// yoki "AI bilan gaplashish"ni bosgandan keyin chaqiriladi (useAiVoiceSession). Brauzerning o'z aks-sado
// bekor qilish (AEC), shovqin pasaytirish va avtomatik kuchaytirishi yoqiladi.

export type MicErrorCode = "permission_denied" | "no_device" | "device_busy" | "insecure" | "unsupported" | "unknown";

export class MicError extends Error {
  constructor(readonly code: MicErrorCode, readonly cause?: unknown) {
    super(`MIC_${code.toUpperCase()}`);
    this.name = "MicError";
  }
}

export const FRAME_SAMPLES_16K = 640;

// ?no-inline: kichik fayl data: URL bo'lib qolmasin — Android WebView / Tauri WebView2'da worklet alohida fayldan yuklanadi
const CAPTURE_WORKLET_URL = new URL("./capture.worklet.js?no-inline", import.meta.url);

/** Brauzer xatosini foydalanuvchiga tushunarli kodga aylantiradi. */
export function mapMicError(e: unknown): MicErrorCode {
  const name = (e as { name?: string } | null)?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "permission_denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "no_device";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "device_busy";
  if (name === "TypeError" && typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  return "unknown";
}

/** Audio qo'llab-quvvatlanadimi (mikrofon + Web Audio). Ruxsat SO'RAMAYDI. */
export function audioSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  return !!AC && !!navigator.mediaDevices?.getUserMedia;
}

export function createAudioContext(): AudioContext {
  const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC({ latencyHint: "interactive" });
  // Foydalanuvchi harakati ichida chaqiriladi — autoplay siyosati ruxsat beradi
  ctx.resume?.().catch(() => { /* */ });
  resumeOnGesture(ctx);
  return ctx;
}

/**
 * Kontekst "suspended" qolsa (avtomatik qabul, iOS/Android WebView autoplay siyosati) — birinchi bosish /
 * tugmada uyg'otamiz; aks holda AI ovozi eshitilmaydi va mikrofon kadrlari kelmaydi.
 */
export function resumeOnGesture(ctx: AudioContext, target: Pick<Window, "addEventListener" | "removeEventListener"> | null = typeof window !== "undefined" ? window : null): void {
  if (!target) return;
  const evs = ["pointerdown", "touchend", "keydown"] as const;
  const off = () => { for (const e of evs) target.removeEventListener(e, kick, true); };
  const kick = () => {
    if (ctx.state === "closed") { off(); return; }
    if (ctx.state === "running") { off(); return; }
    ctx.resume?.().then(() => { if (ctx.state === "running") off(); }).catch(() => { /* */ });
  };
  for (const e of evs) target.addEventListener(e, kick, true);
  // Ishlayotgan bo'lsa — tinglovchilar keraksiz
  setTimeout(() => { if (ctx.state === "running" || ctx.state === "closed") off(); }, 1500);
}

export async function openMic(): Promise<MediaStream> {
  if (typeof window !== "undefined" && !window.isSecureContext) throw new MicError("insecure");
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!md?.getUserMedia) throw new MicError("unsupported");
  try {
    return await md.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
  } catch (e) {
    throw new MicError(mapMicError(e), e);
  }
}

type Ctx = AudioContext & { audioWorklet?: AudioWorklet };

export class PcmCapture {
  private resampler: StreamingResampler;
  private chunker = new FrameChunker(FRAME_SAMPLES_16K);
  private src: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private muted = false;
  private stopped = false;
  readonly mode: "worklet" | "script";

  private constructor(private ctx: Ctx, private stream: MediaStream, private onFrame: (pcm: Int16Array, rms: number) => void, mode: "worklet" | "script") {
    this.mode = mode;
    this.resampler = new StreamingResampler(ctx.sampleRate, AUDIO_IN_SAMPLE_RATE);
  }

  static async create(ctx: Ctx, stream: MediaStream, onFrame: (pcm: Int16Array, rms: number) => void): Promise<PcmCapture> {
    let mode: "worklet" | "script" = "script";
    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try { await ctx.audioWorklet.addModule(CAPTURE_WORKLET_URL.href); mode = "worklet"; } catch { /* zaxira yo'li */ }
    }
    const c = new PcmCapture(ctx, stream, onFrame, mode);
    c.src = ctx.createMediaStreamSource(stream);
    // Graf "tortilishi" uchun chiqish 0 kuchaytirish orqali destination'ga ulanadi (eshitilmaydi)
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    c.sink = sink;
    if (mode === "worklet") {
      const node = new AudioWorkletNode(ctx, "aiv-capture", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { chunkSamples: Math.round(ctx.sampleRate * 0.02) },
      });
      node.port.onmessage = (e: MessageEvent) => { if (e.data instanceof Float32Array) c.feed(e.data); };
      c.node = node;
    } else {
      const sp = ctx.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = (e: AudioProcessingEvent) => c.feed(new Float32Array(e.inputBuffer.getChannelData(0)));
      c.node = sp;
    }
    c.src.connect(c.node);
    c.node.connect(sink);
    return c;
  }

  /** Qurilma chastotasidagi namunalar (testlarda to'g'ridan-to'g'ri chaqiriladi). */
  feed(x: Float32Array): void {
    if (this.stopped) return;
    const y = this.resampler.process(x);
    this.chunker.push(y, (f) => {
      if (this.muted) return;
      this.onFrame(float32ToInt16(f), rmsFloat32(f));
    });
  }

  setMuted(m: boolean): void {
    this.muted = m;
    for (const t of this.stream.getAudioTracks()) t.enabled = !m;
  }

  get isMuted(): boolean { return this.muted; }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    try {
      if (this.node && "port" in this.node) this.node.port.postMessage({ type: "stop" });
      else if (this.node) (this.node as ScriptProcessorNode).onaudioprocess = null;
    } catch { /* */ }
    try { this.src?.disconnect(); } catch { /* */ }
    try { this.node?.disconnect(); } catch { /* */ }
    try { this.sink?.disconnect(); } catch { /* */ }
    for (const t of this.stream.getTracks()) { try { t.stop(); } catch { /* */ } }
  }
}
