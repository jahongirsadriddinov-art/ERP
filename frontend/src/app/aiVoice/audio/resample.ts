// AI ovozli suhbat — sof audio funksiyalar (DOM'siz, unit-test qilinadi).
// Mikrofon: qurilma chastotasi (odatda 48/44.1 kHz) → 16 kHz, past chastota filtri bilan (aliasing yo'q).
// Ijro: 24 kHz → qurilma chastotasi. Ikkalasi ham bitta oqimli (streaming) resampler: Blackman oynali
// sinc yadrosi, oldindan hisoblangan fazalar jadvali (polyphase) — har bir chiqish namunasi ~32–64 ko'paytma.

/** Int16 PCM → Float32 [-1, 1). */
export function int16ToFloat32(src: Int16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 32768;
  return out;
}

/** Float32 [-1, 1] → Int16 (qirqib, yaxlitlab). */
export function float32ToInt16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    let v = src[i];
    if (v > 1) v = 1; else if (v < -1) v = -1;
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  return out;
}

/** PCM16LE baytlari → Int16Array (toq bayt tashlanadi; nusxa — tekislash muammosi yo'q). */
export function bytesToInt16(b: Uint8Array): Int16Array {
  const n = b.length >> 1;
  const out = new Int16Array(n);
  const dv = new DataView(b.buffer, b.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

/** RMS (0..1). */
export function rmsFloat32(x: Float32Array): number {
  if (!x.length) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

export function rmsInt16(x: Int16Array): number {
  if (!x.length) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i] / 32768; s += v * v; }
  return Math.sqrt(s / x.length);
}

const PHASES = 128;

function blackman(x: number): number {
  // x ∈ [-1, 1]
  if (x <= -1 || x >= 1) return 0;
  return 0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x);
}

function sinc(x: number): number {
  if (Math.abs(x) < 1e-9) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/**
 * Oqimli resampler (har qanday nisbat). `process()` har safar kirish bo'lagini oladi va tayyor chiqishni
 * qaytaradi; holat (tarix) bo'laklar orasida saqlanadi — 20 ms bo'laklar bilan uzluksiz ishlaydi.
 */
export class StreamingResampler {
  readonly inRate: number;
  readonly outRate: number;
  private readonly step: number;
  private readonly half: number;
  private readonly taps: number;
  private readonly table: Float32Array[];
  private buf: Float32Array;
  private pos: number;

  constructor(inRate: number, outRate: number, opts: { taps?: number } = {}) {
    if (!(inRate > 0) || !(outRate > 0)) throw new Error('BAD_RATE');
    this.inRate = inRate;
    this.outRate = outRate;
    this.step = inRate / outRate;
    const down = outRate < inRate;
    // Pastga: kesish chastotasi chiqish Nyquist'idan biroz past (aliasing bo'lmasin); yuqoriga: kirish Nyquist'i
    const fc = down ? (outRate / inRate) * 0.9 : 0.95;
    const taps = opts.taps ?? (down ? 64 : 32);
    this.taps = taps + (taps % 2);
    this.half = this.taps / 2;
    this.table = [];
    for (let p = 0; p <= PHASES; p++) {
      const frac = p / PHASES;
      const k = new Float32Array(this.taps);
      let sum = 0;
      for (let j = 0; j < this.taps; j++) {
        const d = j - this.half + 1 - frac;              // markazdan masofa (kirish namunalarida)
        const w = blackman(d / (this.half + 1));
        const v = fc * sinc(fc * d) * w;
        k[j] = v; sum += v;
      }
      for (let j = 0; j < this.taps; j++) k[j] /= sum || 1; // DC kuchaytirish = 1
      this.table.push(k);
    }
    this.buf = new Float32Array(this.half - 1);
    this.pos = this.half - 1;
  }

  /** Ichki holatni tozalash (masalan barge-in'da ijro navbati tozalanganda). */
  reset(): void {
    this.buf = new Float32Array(this.half - 1);
    this.pos = this.half - 1;
  }

  process(input: Float32Array): Float32Array {
    const data = new Float32Array(this.buf.length + input.length);
    data.set(this.buf, 0);
    data.set(input, this.buf.length);
    const maxOut = Math.ceil((data.length - this.pos) / this.step) + 1;
    const out = new Float32Array(Math.max(0, maxOut));
    let n = 0;
    const { half, taps, table } = this;
    for (;;) {
      let i = Math.floor(this.pos);
      let phase = Math.round((this.pos - i) * PHASES);
      if (phase >= PHASES) { i += 1; phase = 0; }
      if (i + half >= data.length) break;
      const k = table[phase];
      const base = i - half + 1;
      let s = 0;
      for (let j = 0; j < taps; j++) s += data[base + j] * k[j];
      out[n++] = s;
      this.pos += this.step;
    }
    const drop = Math.max(0, Math.min(data.length, Math.floor(this.pos) - half + 1));
    this.buf = data.slice(drop);
    this.pos -= drop;
    return out.subarray(0, n);
  }
}

/**
 * Doimiy uzunlikdagi kadrlarga bo'luvchi (16 kHz'da 640 namuna = 40 ms). Qoldiq keyingi chaqiruvga qoladi.
 */
export class FrameChunker {
  private acc: Float32Array;
  private n = 0;
  constructor(readonly frameSamples: number) { this.acc = new Float32Array(frameSamples); }
  push(x: Float32Array, onFrame: (f: Float32Array) => void): void {
    let off = 0;
    while (off < x.length) {
      const k = Math.min(x.length - off, this.frameSamples - this.n);
      this.acc.set(x.subarray(off, off + k), this.n);
      this.n += k; off += k;
      if (this.n === this.frameSamples) {
        const f = this.acc;
        this.acc = new Float32Array(this.frameSamples);
        this.n = 0;
        onFrame(f);
      }
    }
  }
  reset(): void { this.n = 0; }
}
