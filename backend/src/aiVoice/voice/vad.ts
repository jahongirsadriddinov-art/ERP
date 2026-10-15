import { rmsInt16 } from './audio';

// Serverdagi energiya VAD (kaskad uchun): 20 ms oynalar bo'yicha RMS, moslashuvchan shovqin
// sathi, 500 ms "hangover" (gap tugadi deb hisoblashdan oldin jimlik), minimal gap uzunligi va
// maksimal segment (uzun nutq bo'laklanadi). Gemini Live o'z server VAD'idan foydalanadi.

export interface VadOptions {
  sampleRate: number;
  frameMs: number;
  /** Absolyut minimal RMS chegarasi (Int16 shkalasi). */
  minThreshold: number;
  /** Shovqin sathiga ko'paytiruvchi (chegara = max(minThreshold, floor × k)). */
  noiseFactor: number;
  hangoverMs: number;
  minSpeechMs: number;
  maxSegmentMs: number;
  /** Nutq boshlanishidan oldingi kontekst (so'z boshi kesilmasin). */
  prerollMs: number;
}

export const DEFAULT_VAD: VadOptions = {
  sampleRate: 16_000, frameMs: 20, minThreshold: 600, noiseFactor: 3, hangoverMs: 500,
  minSpeechMs: 200, maxSegmentMs: 15_000, prerollMs: 200,
};

export type VadEvent = { type: 'start' } | { type: 'end'; pcm: Buffer; forced: boolean };

export class EnergyVad {
  readonly o: VadOptions;
  private frameBytes: number;
  private carry = Buffer.alloc(0);
  private noiseFloor = 0;
  private speaking = false;
  private seg: Buffer[] = [];
  private segBytes = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private preroll: Buffer[] = [];

  constructor(opts: Partial<VadOptions> = {}) {
    this.o = { ...DEFAULT_VAD, ...opts };
    this.frameBytes = Math.round((this.o.sampleRate * this.o.frameMs) / 1000) * 2;
  }

  get isSpeaking(): boolean { return this.speaking; }

  threshold(): number { return Math.max(this.o.minThreshold, this.noiseFloor * this.o.noiseFactor); }

  /** PCM qo'shadi va hosil bo'lgan voqealarni qaytaradi. */
  push(pcm: Buffer): VadEvent[] {
    const events: VadEvent[] = [];
    let buf = this.carry.length ? Buffer.concat([this.carry, pcm]) : pcm;
    let off = 0;
    while (off + this.frameBytes <= buf.length) {
      this.frame(buf.subarray(off, off + this.frameBytes), events);
      off += this.frameBytes;
    }
    this.carry = Buffer.from(buf.subarray(off));
    buf = Buffer.alloc(0);
    return events;
  }

  /** Oqim tugadi (masalan PTT qo'yib yuborildi) — ochiq segmentni yopadi. */
  flush(): VadEvent[] {
    const ev: VadEvent[] = [];
    if (this.speaking) this.finish(ev, true);
    this.carry = Buffer.alloc(0);
    return ev;
  }

  reset(): void {
    this.carry = Buffer.alloc(0); this.speaking = false; this.seg = []; this.segBytes = 0;
    this.speechMs = 0; this.silenceMs = 0; this.preroll = [];
  }

  private frame(f: Buffer, events: VadEvent[]) {
    const rms = rmsInt16(f);
    const voiced = rms >= this.threshold();
    const fm = this.o.frameMs;
    if (!this.speaking) {
      if (!voiced) this.noiseFloor = this.noiseFloor ? this.noiseFloor * 0.95 + rms * 0.05 : rms;
      this.preroll.push(Buffer.from(f));
      const maxPre = Math.max(1, Math.round(this.o.prerollMs / fm));
      while (this.preroll.length > maxPre) this.preroll.shift();
      if (voiced) {
        this.speechMs += fm;
        if (this.speechMs >= this.o.minSpeechMs) {
          this.speaking = true;
          this.silenceMs = 0;
          this.seg = [...this.preroll];
          this.segBytes = this.seg.reduce((a, b) => a + b.length, 0);
          this.preroll = [];
          events.push({ type: 'start' });
        }
      } else {
        this.speechMs = 0;
      }
      return;
    }
    this.seg.push(Buffer.from(f));
    this.segBytes += f.length;
    if (voiced) this.silenceMs = 0; else this.silenceMs += fm;
    const segMs = (this.segBytes / 2 / this.o.sampleRate) * 1000;
    if (this.silenceMs >= this.o.hangoverMs) this.finish(events, false);
    else if (segMs >= this.o.maxSegmentMs) this.finish(events, true);
  }

  private finish(events: VadEvent[], forced: boolean) {
    const pcm = Buffer.concat(this.seg);
    this.speaking = false; this.seg = []; this.segBytes = 0; this.speechMs = 0; this.silenceMs = 0;
    events.push({ type: 'end', pcm, forced });
  }
}
