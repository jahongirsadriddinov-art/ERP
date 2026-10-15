// PCM16LE yordamchilari (ovoz dvigateli uchun): davomiylik, bo'laklash, RMS, WAV, resampling,
// gaplarga ajratish. Hammasi sof funksiyalar — testlanadi.

export const IN_RATE = 16_000;
export const OUT_RATE = 24_000;
/** 40 ms @ 24 kHz PCM16 = 1920 bayt — mijozga yuboriladigan chiqish kadri. */
export const OUT_FRAME_BYTES = 1920;

export function pcmDurationMs(bytes: number, rate: number): number {
  return Math.round((bytes / 2 / rate) * 1000);
}

/** Buferni ≤maxBytes (juft) bo'laklarga ajratadi; toq oxirgi bayt tashlanadi. */
export function chunkPcm(buf: Buffer, maxBytes = OUT_FRAME_BYTES): Buffer[] {
  const max = Math.max(2, maxBytes - (maxBytes % 2));
  const len = buf.length - (buf.length % 2);
  const out: Buffer[] = [];
  for (let i = 0; i < len; i += max) out.push(buf.subarray(i, Math.min(len, i + max)));
  return out;
}

/** Int16 RMS (0..32768). */
export function rmsInt16(buf: Buffer): number {
  const n = Math.floor(buf.length / 2);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = buf.readInt16LE(i * 2); sum += v * v; }
  return Math.sqrt(sum / n);
}

export function silence(ms: number, rate: number): Buffer {
  return Buffer.alloc(Math.round((rate * ms) / 1000) * 2);
}

export function pcm16ToWav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);          // PCM
  h.writeUInt16LE(1, 22);          // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** RIFF/WAVE (PCM16 mono) → {pcm, rate}. Boshqa format — null. */
export function wavToPcm16(buf: Buffer): { pcm: Buffer; rate: number } | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12; let rate = 0; let bits = 16; let channels = 1;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16 || channels !== 1 || !rate) return null;
      const end = Math.min(buf.length, body + size);
      const pcm = buf.subarray(body, end - ((end - body) % 2));
      return { pcm, rate };
    }
    off = body + size + (size % 2);
  }
  return null;
}

/** Chiziqli resampling (TTS boshqa chastotada qaytarsa). Bir xil chastota — o'zi. */
export function resamplePcm16(pcm: Buffer, from: number, to: number): Buffer {
  if (from === to || !from || !to) return pcm;
  const n = Math.floor(pcm.length / 2);
  const outN = Math.max(0, Math.floor((n * to) / from));
  const out = Buffer.alloc(outN * 2);
  for (let i = 0; i < outN; i++) {
    const x = (i * from) / to;
    const i0 = Math.floor(x);
    const i1 = Math.min(n - 1, i0 + 1);
    const f = x - i0;
    const v = pcm.readInt16LE(i0 * 2) * (1 - f) + pcm.readInt16LE(i1 * 2) * f;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2);
  }
  return out;
}

/** Matnni gaplarga ajratadi (TTS gapma-gap oqimi uchun); juda uzun gap ≤max bo'laklarga. */
export function splitSentences(text: string, max = 220): string[] {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.match(/[^.!?…]+[.!?…]+["»”)]*|[^.!?…]+$/g) || [clean];
  const out: string[] = [];
  for (const p0 of parts) {
    let p = p0.trim();
    while (p.length > max) {
      const cut = p.lastIndexOf(' ', max);
      const at = cut > max / 2 ? cut : max;
      out.push(p.slice(0, at).trim());
      p = p.slice(at).trim();
    }
    if (p) out.push(p);
  }
  return out;
}

/** Sinov/baholash uchun: sinus to'lqin (PCM16LE). */
export function tone(ms: number, rate: number, freq = 440, amp = 8000): Buffer {
  const n = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * amp), i * 2);
  return b;
}
