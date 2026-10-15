import { describe, it, expect } from "vitest";
import { DuplexGate } from "./duplexGate";

const F = (v = 0) => new Int16Array(640).fill(v);
const silentAi = { playing: false, level: 0 };
const loudAi = { playing: true, level: 0.05 };

describe("DuplexGate (A12 yarim dupleks)", () => {
  it("AI jim — har bir kadr o'tadi (to'liq dupleks)", () => {
    const g = new DuplexGate();
    for (let t = 0; t < 5; t++) expect(g.process(F(), 0.001, silentAi, t * 40)).toHaveLength(1);
  });

  it("AI gapirayotganda past ovoz (aks-sado) yuborilmaydi", () => {
    const g = new DuplexGate();
    for (let t = 0; t < 20; t++) expect(g.process(F(), 0.05, loudAi, t * 40)).toHaveLength(0);
    expect(g.bargedIn).toBe(false);
  });

  it("aks-sado dumi: AI to'xtagach tailMs davomida hali yopiq", () => {
    const g = new DuplexGate({ tailMs: 300 });
    g.process(F(), 0.01, loudAi, 0);
    expect(g.process(F(), 0.01, silentAi, 200)).toHaveLength(0);
    expect(g.process(F(), 0.01, silentAi, 400)).toHaveLength(1);
  });

  it("barge-in: ketma-ket baland kadrlar — darvoza ochiladi va pre-roll ham yuboriladi", () => {
    const g = new DuplexGate({ attackFrames: 3, preRollFrames: 3 });
    expect(g.process(F(1), 0.3, loudAi, 0)).toHaveLength(0);
    expect(g.process(F(2), 0.3, loudAi, 40)).toHaveLength(0);
    const out = g.process(F(3), 0.3, loudAi, 80);
    expect(out.map((f) => f[0])).toEqual([1, 2, 3]);
    expect(g.bargedIn).toBe(true);
    // ochiq: jim kadrlar ham holdMs davomida o'tadi
    expect(g.process(F(4), 0.001, loudAi, 400)).toHaveLength(1);
    // holdMs o'tdi — yana yopiladi
    expect(g.process(F(5), 0.001, loudAi, 80 + 900)).toHaveLength(0);
    expect(g.bargedIn).toBe(false);
  });

  it("chegara AI ovozi darajasiga nisbatan: AI baland bo'lsa, o'rtacha mikrofon barge-in emas", () => {
    const g = new DuplexGate({ bargeInRms: 0.06, echoRatio: 1.5, attackFrames: 2, preRollFrames: 1 });
    const veryLoudAi = { playing: true, level: 0.2 };
    for (let t = 0; t < 6; t++) expect(g.process(F(), 0.25, veryLoudAi, t * 40)).toHaveLength(0);
    expect(g.process(F(), 0.35, veryLoudAi, 400)).toHaveLength(0);
    expect(g.process(F(), 0.35, veryLoudAi, 440)).toHaveLength(2);
  });

  it("uzilgan baland kadrlar hisoblagichni nolga tushiradi; reset() holatni tozalaydi", () => {
    const g = new DuplexGate({ attackFrames: 3 });
    g.process(F(), 0.3, loudAi, 0);
    g.process(F(), 0.3, loudAi, 40);
    g.process(F(), 0.001, loudAi, 80);
    expect(g.process(F(), 0.3, loudAi, 120)).toHaveLength(0);
    g.reset();
    expect(g.process(F(), 0.001, silentAi, 10_000)).toHaveLength(1);
  });
});
