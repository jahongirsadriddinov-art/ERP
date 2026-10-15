// AI ovozli suhbat — mikrofon AudioWorklet'i (audio oqimida ishlaydi). Hech qanday DSP yo'q: qurilma
// chastotasidagi Float32 namunalarni ~20 ms bo'laklarga yig'ib asosiy oqimga yuboradi (transferable).
// Resampling va kadrlash pcmCapture.ts'da (resample.ts — test qilingan yagona manba).
// MUHIM: bu fayl o'zgartirilmasdan asset sifatida beriladi (Vite `new URL(..., import.meta.url)`) —
// faqat oddiy JS, import yo'q.

class AivCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opt = (options && options.processorOptions) || {};
    // eslint-disable-next-line no-undef
    this.chunk = opt.chunkSamples > 0 ? opt.chunkSamples : Math.round(sampleRate * 0.02);
    this.buf = new Float32Array(this.chunk);
    this.n = 0;
    this.active = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stop') this.active = false;
    };
  }

  process(inputs) {
    if (!this.active) return false;
    const input = inputs[0];
    const ch = input && input[0];
    if (ch && ch.length) {
      let off = 0;
      while (off < ch.length) {
        const k = Math.min(ch.length - off, this.chunk - this.n);
        this.buf.set(ch.subarray(off, off + k), this.n);
        this.n += k;
        off += k;
        if (this.n === this.chunk) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.chunk);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('aiv-capture', AivCaptureProcessor);
