// AI ovozli suhbat — ijro AudioWorklet'i. Asosiy oqim (pcmPlayer.ts) 24 kHz ovozni qurilma chastotasiga
// o'tkazib Float32 bo'laklarni yuboradi; bu yerda halqa bufer (ring buffer):
//  - 150 ms oldindan to'plash (prebuffer) — tarmoq tebranishida "qirqilish" bo'lmasin;
//  - bufer tugasa (underrun) — sukunat (shovqin/klik emas) va qayta to'plash holati;
//  - yangi ovoz kelmay qolsa (gap oxiri) — prebuffer kutmasdan qoldiq ijro etiladi;
//  - `flush` — darhol to'xtatish (barge-in / aiv:interrupted).
// Holat (`playing`, `level`) ~40 ms'da asosiy oqimga yuboriladi — yarim dupleks darvoza (duplexGate) uchun.
// MUHIM: fayl asset sifatida o'zgarishsiz beriladi; PcmRing asosiy oqimda ham (ScriptProcessor zaxira
// yo'li va testlar) shu fayldan import qilinadi — yagona manba.

export class PcmRing {
  constructor(capacity, prebuffer) {
    this.cap = Math.max(1, capacity | 0);
    this.buf = new Float32Array(this.cap);
    this.r = 0;
    this.w = 0;
    this.size = 0;
    this.prebuffer = Math.max(0, prebuffer | 0);
    this.playing = false;
    this.idle = 0;        // oxirgi push'dan beri o'tgan namunalar
    this.underruns = 0;
    this.dropped = 0;
  }

  push(x) {
    let src = x;
    if (src.length > this.cap) {
      this.dropped += src.length - this.cap;
      src = src.subarray(src.length - this.cap);
    }
    const over = this.size + src.length - this.cap;
    if (over > 0) {
      // To'lib ketsa — eng eski namunalar tashlanadi (kechikish o'smasin)
      this.r = (this.r + over) % this.cap;
      this.size -= over;
      this.dropped += over;
    }
    const first = Math.min(src.length, this.cap - this.w);
    this.buf.set(src.subarray(0, first), this.w);
    if (first < src.length) this.buf.set(src.subarray(first), 0);
    this.w = (this.w + src.length) % this.cap;
    this.size += src.length;
    this.idle = 0;
  }

  flush() {
    this.r = 0;
    this.w = 0;
    this.size = 0;
    this.playing = false;
    this.idle = 0;
  }

  /** `out`ni to'ldiradi; haqiqiy ovoz namunalari sonini qaytaradi (qolgani — sukunat). */
  read(out) {
    const len = out.length;
    if (!this.playing) {
      if (this.size > 0 && (this.size >= this.prebuffer || this.idle >= this.prebuffer)) {
        this.playing = true;
      } else {
        out.fill(0);
        this.idle += len;
        return 0;
      }
    }
    const k = Math.min(len, this.size);
    const first = Math.min(k, this.cap - this.r);
    out.set(this.buf.subarray(this.r, this.r + first), 0);
    if (first < k) out.set(this.buf.subarray(0, k - first), first);
    this.r = (this.r + k) % this.cap;
    this.size -= k;
    if (k < len) {
      out.fill(0, k);
      this.playing = false;
      this.underruns++;
    }
    this.idle += len;
    return k;
  }
}

if (typeof AudioWorkletProcessor !== 'undefined' && typeof registerProcessor === 'function') {
  class AivPlayerProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const o = (options && options.processorOptions) || {};
      // eslint-disable-next-line no-undef
      const rate = sampleRate;
      this.ring = new PcmRing(Math.round(rate * (o.capacitySec || 20)), Math.round((rate * (o.prebufferMs || 150)) / 1000));
      this.reportEvery = Math.max(1, Math.round((rate * 0.04) / 128));
      this.blocks = 0;
      this.lastPlaying = false;
      this.acc = 0;
      this.accN = 0;
      this.active = true;
      this.port.onmessage = (e) => {
        const d = e.data;
        if (!d) return;
        if (d.type === 'push' && d.samples) this.ring.push(d.samples);
        else if (d.type === 'flush') this.ring.flush();
        else if (d.type === 'stop') this.active = false;
      };
    }

    process(_inputs, outputs) {
      if (!this.active) return false;
      const out = outputs[0];
      const ch0 = out && out[0];
      if (!ch0) return true;
      const k = this.ring.read(ch0);
      for (let c = 1; c < out.length; c++) out[c].set(ch0);
      let s = 0;
      for (let i = 0; i < ch0.length; i++) s += ch0[i] * ch0[i];
      this.acc += s;
      this.accN += ch0.length;
      const playing = k > 0;
      this.blocks++;
      if (playing !== this.lastPlaying || this.blocks >= this.reportEvery) {
        this.port.postMessage({ type: 'state', playing, level: Math.sqrt(this.acc / Math.max(1, this.accN)), buffered: this.ring.size });
        this.lastPlaying = playing;
        this.blocks = 0;
        this.acc = 0;
        this.accN = 0;
      }
      return true;
    }
  }
  registerProcessor('aiv-player', AivPlayerProcessor);
}
