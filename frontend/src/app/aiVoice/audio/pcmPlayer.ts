import { AUDIO_OUT_SAMPLE_RATE } from "../protocol";
import { PcmRing } from "./player.worklet.js";
import { StreamingResampler, bytesToInt16, int16ToFloat32 } from "./resample";

// AI ovozini ijro etish: 24 kHz PCM16 → qurilma chastotasi (asosiy oqimda resample) → AudioWorklet halqa
// buferi (player.worklet.js). AudioWorklet bo'lmagan eski WebView'larda — ScriptProcessor zaxira yo'li,
// xuddi o'sha PcmRing bilan. Ovoz to'g'ridan-to'g'ri ctx.destination'ga (kuchaytirgich/siqgichsiz —
// "xira, aks-sadoli" ovoz bo'lmasin).

export interface PlayerState { playing: boolean; level: number }
export interface PcmPlayerOpts {
  prebufferMs?: number;
  inputRate?: number;
  onState?: (s: PlayerState) => void;
}

// Vite bu faylni asset sifatida chiqaradi (dev'da ham, build'da ham, Tauri/Capacitor'da oflayn ishlaydi)
const PLAYER_WORKLET_URL = new URL("./player.worklet.js", import.meta.url);

type Ctx = BaseAudioContext & { audioWorklet?: AudioWorklet };

export class PcmPlayer {
  private resampler: StreamingResampler;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private gain: GainNode | null = null;
  private ring: PcmRing | null = null;   // faqat ScriptProcessor yo'lida
  private st: PlayerState = { playing: false, level: 0 };
  private closed = false;
  readonly mode: "worklet" | "script";

  private constructor(private ctx: Ctx, private opts: PcmPlayerOpts, mode: "worklet" | "script") {
    this.mode = mode;
    this.resampler = new StreamingResampler(opts.inputRate ?? AUDIO_OUT_SAMPLE_RATE, ctx.sampleRate);
  }

  static async create(ctx: Ctx, opts: PcmPlayerOpts = {}): Promise<PcmPlayer> {
    const prebufferMs = opts.prebufferMs ?? 150;
    const canWorklet = !!ctx.audioWorklet && typeof AudioWorkletNode !== "undefined";
    if (canWorklet) {
      try {
        await ctx.audioWorklet!.addModule(PLAYER_WORKLET_URL.href);
        const p = new PcmPlayer(ctx, opts, "worklet");
        const node = new AudioWorkletNode(ctx, "aiv-player", {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
          processorOptions: { prebufferMs, capacitySec: 20 },
        });
        node.port.onmessage = (e: MessageEvent) => {
          const d = e.data;
          if (d && d.type === "state") p.setState({ playing: !!d.playing, level: Number(d.level) || 0 });
        };
        p.node = node;
        p.connect(node);
        return p;
      } catch {
        // addModule muvaffaqiyatsiz (eski WebView / CSP) — zaxira yo'li
      }
    }
    const p = new PcmPlayer(ctx, opts, "script");
    const ring = new PcmRing(Math.round(ctx.sampleRate * 20), Math.round((ctx.sampleRate * prebufferMs) / 1000));
    const sp = ctx.createScriptProcessor(1024, 1, 1);
    sp.onaudioprocess = (e: AudioProcessingEvent) => {
      const out = e.outputBuffer.getChannelData(0);
      const k = ring.read(out);
      let s = 0;
      for (let i = 0; i < out.length; i++) s += out[i] * out[i];
      p.setState({ playing: k > 0, level: Math.sqrt(s / Math.max(1, out.length)) });
    };
    p.ring = ring;
    p.node = sp;
    p.connect(sp);
    return p;
  }

  private connect(node: AudioNode) {
    const g = this.ctx.createGain();
    g.gain.value = 1;
    node.connect(g);
    g.connect(this.ctx.destination);
    this.gain = g;
  }

  private setState(s: PlayerState) {
    const changed = s.playing !== this.st.playing;
    this.st = s;
    if (changed || s.playing) this.opts.onState?.(s);
  }

  get state(): PlayerState { return this.st; }

  /** 24 kHz PCM16LE (Uint8Array baytlar yoki Int16Array). */
  push(pcm: Int16Array | Uint8Array): void {
    if (this.closed) return;
    const i16 = pcm instanceof Int16Array ? pcm : bytesToInt16(pcm);
    if (!i16.length) return;
    const f = this.resampler.process(int16ToFloat32(i16));
    if (!f.length) return;
    if (this.ring) { this.ring.push(f); return; }
    const node = this.node as AudioWorkletNode | null;
    const copy = f.slice();
    node?.port.postMessage({ type: "push", samples: copy }, [copy.buffer]);
  }

  /** Darhol jim bo'lish (aiv:interrupted / barge-in). */
  flush(): void {
    if (this.closed) return;
    this.resampler.reset();
    if (this.ring) this.ring.flush();
    else (this.node as AudioWorkletNode | null)?.port.postMessage({ type: "flush" });
    this.setState({ playing: false, level: 0 });
  }

  setVolume(v: number): void {
    if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1, v));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.ring) (this.node as ScriptProcessorNode).onaudioprocess = null;
      else (this.node as AudioWorkletNode | null)?.port.postMessage({ type: "stop" });
    } catch { /* */ }
    try { this.node?.disconnect(); } catch { /* */ }
    try { this.gain?.disconnect(); } catch { /* */ }
    this.node = null;
    this.gain = null;
    this.st = { playing: false, level: 0 };
  }
}
