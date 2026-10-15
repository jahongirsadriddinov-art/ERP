import { describe, it, expect } from "vitest";
import { FrameChunker, StreamingResampler, bytesToInt16, float32ToInt16, int16ToFloat32, rmsFloat32, rmsInt16 } from "./resample";

const sine = (rate: number, hz: number, n: number, amp = 0.5, offset = 0) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * (i + offset)) / rate));

/** Berilgan chastotadagi amplituda (oddiy DFT proyeksiyasi). */
function ampAt(x: Float32Array, rate: number, hz: number): number {
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) { const a = (2 * Math.PI * hz * i) / rate; re += x[i] * Math.cos(a); im += x[i] * Math.sin(a); }
  return (2 * Math.hypot(re, im)) / x.length;
}

describe("PCM o'girishlar", () => {
  it("int16 ↔ float32 qirqish va yaxlitlash", () => {
    expect(Array.from(float32ToInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5])))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
    const back = int16ToFloat32(Int16Array.from([0, 16384, -32768]));
    expect(back[1]).toBeCloseTo(0.5, 4);
    expect(back[2]).toBe(-1);
  });

  it("PCM16LE baytlar → Int16 (toq bayt tashlanadi, siljigan offset ham ishlaydi)", () => {
    const raw = new Uint8Array([9, 0x01, 0x00, 0xff, 0xff, 7]);
    expect(Array.from(bytesToInt16(raw.subarray(1)))).toEqual([1, -1]);
  });

  it("RMS", () => {
    expect(rmsFloat32(new Float32Array(0))).toBe(0);
    expect(rmsFloat32(Float32Array.from([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rmsInt16(Int16Array.from([16384, -16384]))).toBeCloseTo(0.5, 3);
  });
});

describe("StreamingResampler", () => {
  it("noto'g'ri chastota — xato", () => {
    expect(() => new StreamingResampler(0, 16000)).toThrow();
  });

  it("48 kHz → 16 kHz: uzunlik nisbati to'g'ri, bo'laklab berish bir martada berish bilan bir xil", () => {
    const x = sine(48000, 440, 48000);
    const one = new StreamingResampler(48000, 16000).process(x);
    const r = new StreamingResampler(48000, 16000);
    const parts: number[] = [];
    for (let i = 0; i < x.length; i += 960) parts.push(...r.process(x.subarray(i, i + 960)));
    expect(Math.abs(one.length - 16000)).toBeLessThan(40);
    expect(parts.length).toBe(one.length);
    for (let i = 0; i < one.length; i += 997) expect(parts[i]).toBeCloseTo(one[i], 5);
  });

  it("o'tish polosasidagi ton saqlanadi, Nyquist'dan yuqorisi (aliasing) kesiladi", () => {
    const pass = new StreamingResampler(48000, 16000).process(sine(48000, 1000, 24000));
    expect(ampAt(pass.subarray(200), 16000, 1000)).toBeGreaterThan(0.45);
    // 12 kHz ton 16 kHz'da 4 kHz'ga "qaytib tushardi" — filtr uni bostirishi kerak
    const alias = new StreamingResampler(48000, 16000).process(sine(48000, 12000, 24000));
    expect(rmsFloat32(alias.subarray(200))).toBeLessThan(0.02);
  });

  it("24 kHz → 48 kHz (ijro): ton amplitudasi saqlanadi, reset() holatni tozalaydi", () => {
    const r = new StreamingResampler(24000, 48000);
    const y = r.process(sine(24000, 500, 12000));
    expect(Math.abs(y.length - 24000)).toBeLessThan(40);
    expect(ampAt(y.subarray(400), 48000, 500)).toBeGreaterThan(0.45);
    r.reset();
    const z = r.process(new Float32Array(2400));
    expect(rmsFloat32(z)).toBe(0);
  });

  it("44.1 kHz kabi kasr nisbat ham ishlaydi", () => {
    const y = new StreamingResampler(44100, 16000).process(sine(44100, 300, 44100));
    expect(Math.abs(y.length - 16000)).toBeLessThan(40);
  });
});

describe("FrameChunker", () => {
  it("doimiy 640 namunali kadrlar, qoldiq keyingi chaqiruvga", () => {
    const c = new FrameChunker(640);
    const frames: Float32Array[] = [];
    c.push(new Float32Array(1000).fill(1), (f) => frames.push(f));
    expect(frames).toHaveLength(1);
    c.push(new Float32Array(300).fill(2), (f) => frames.push(f));
    expect(frames).toHaveLength(2);
    expect(frames[1][0]).toBe(1);
    expect(frames[1][639]).toBe(2);
    expect(frames[0]).not.toBe(frames[1]);
  });
});
