import { describe, it, expect } from "vitest";
import { PcmRing } from "./player.worklet.js";
import { PcmPlayer } from "./pcmPlayer";

describe("PcmRing (ijro halqa buferi)", () => {
  it("prebuffer to'lmaguncha sukunat, keyin ijro; underrun — sukunat va qayta to'plash", () => {
    const r = new PcmRing(1000, 100);
    const out = new Float32Array(64);
    r.push(new Float32Array(50).fill(0.5));
    expect(r.read(out)).toBe(0);
    expect(out.every((v) => v === 0)).toBe(true);
    r.push(new Float32Array(60).fill(0.5));
    expect(r.read(out)).toBe(64);
    expect(r.playing).toBe(true);
    expect(r.read(out)).toBe(46);
    expect(out[45]).toBe(0.5);
    expect(out[46]).toBe(0);
    expect(r.playing).toBe(false);
    expect(r.underruns).toBe(1);
  });

  it("gap oxiri: yangi ovoz kelmasa prebuffer kutmasdan qoldiq ijro etiladi", () => {
    const r = new PcmRing(1000, 200);
    const out = new Float32Array(128);
    r.push(new Float32Array(30).fill(0.3));
    expect(r.read(out)).toBe(0);           // idle = 128 < 200
    expect(r.read(out)).toBe(0);           // idle = 128 (o'qish boshida) < 200
    expect(r.read(out)).toBe(30);          // idle = 256 ≥ prebuffer → qoldiq chiqadi
  });

  it("to'lib ketsa eng eski namunalar tashlanadi (kechikish o'smaydi), halqa chegarasidan o'tish to'g'ri", () => {
    const r = new PcmRing(8, 0);
    r.push(Float32Array.from([1, 2, 3, 4, 5, 6]));
    const o = new Float32Array(4);
    r.read(o);
    r.push(Float32Array.from([7, 8, 9, 10, 11, 12, 13]));
    expect(r.size).toBe(8);
    expect(r.dropped).toBe(1);
    const all = new Float32Array(8);
    expect(r.read(all)).toBe(8);
    expect(Array.from(all)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("flush — darhol jim", () => {
    const r = new PcmRing(100, 0);
    r.push(new Float32Array(50).fill(1));
    r.flush();
    expect(r.read(new Float32Array(10))).toBe(0);
  });
});

/** AudioWorklet'siz soxta AudioContext — ScriptProcessor zaxira yo'li. */
function fakeCtx(sampleRate = 48000) {
  const sp: any = { onaudioprocess: null, connect() {}, disconnect() { sp.disconnected = true; } };
  const gain: any = { gain: { value: 1 }, connect() {}, disconnect() {} };
  return {
    sp,
    ctx: { sampleRate, destination: {}, createScriptProcessor: () => sp, createGain: () => gain } as any,
  };
}

function tick(sp: any, n = 1024): Float32Array {
  const out = new Float32Array(n);
  sp.onaudioprocess({ outputBuffer: { getChannelData: () => out } });
  return out;
}

describe("PcmPlayer (ScriptProcessor zaxira yo'li)", () => {
  it("24 kHz PCM16 → qurilma chastotasi, holat (playing) xabari, flush va close", async () => {
    const { ctx, sp } = fakeCtx(48000);
    const states: boolean[] = [];
    const p = await PcmPlayer.create(ctx, { prebufferMs: 0, onState: (s) => states.push(s.playing) });
    expect(p.mode).toBe("script");
    // 100 ms 24 kHz ton (baytlar ko'rinishida — tarmoqdan kelgandek)
    const pcm = Int16Array.from({ length: 2400 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 24000)));
    p.push(new Uint8Array(pcm.buffer));
    const out = tick(sp);
    expect(out.some((v) => Math.abs(v) > 0.1)).toBe(true);
    expect(p.state.playing).toBe(true);
    expect(states[0]).toBe(true);

    p.flush();
    expect(p.state.playing).toBe(false);
    expect(tick(sp).every((v) => v === 0)).toBe(true);

    p.close();
    expect(sp.onaudioprocess).toBe(null);
    expect(sp.disconnected).toBe(true);
    p.push(pcm);                              // yopilgandan keyin — e'tiborsiz
  });

  it("bo'sh kirish e'tiborsiz", async () => {
    const { ctx, sp } = fakeCtx(24000);
    const p = await PcmPlayer.create(ctx, { prebufferMs: 0 });
    p.push(new Uint8Array(1));
    expect(tick(sp, 256).every((v) => v === 0)).toBe(true);
  });
});
