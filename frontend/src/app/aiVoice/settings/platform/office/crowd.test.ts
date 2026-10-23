import { describe, it, expect } from "vitest";
import { assignIdle, buildGrid, cellIndex, computeLayout, walkable, type P } from "./layout";
import { Crowd, type Goal } from "./crowd";
import { AGENTS } from "./testAgents";

const L = computeLayout(AGENTS);
const grid = buildGrid(L.obstacles);
const deskGoal = (id: string): Goal => { const d = L.desks.get(id)!; return { key: `desk:${id}`, x: d.chair.x, z: d.chair.z, face: d.dir > 0 ? 0 : Math.PI }; };
const poiGoal = (i: number): Goal => ({ key: `poi:${i}`, x: L.pois[i].x, z: L.pois[i].z, face: L.pois[i].face });

/** Simulyatsiya: har tikda hech bir ikki agent bitta katakda emas; yurgan agent faqat bo'sh kataklarda (o'rindiq yonidan tashqari). */
function simulate(crowd: Crowd, seconds: number, dt = 1 / 30) {
  const seats = new Map<string, P[]>();
  for (const w of crowd.walkers.values()) seats.set(w.id, []);
  let maxSame = 0;
  for (let t = 0; t < seconds; t += dt) {
    for (const w of crowd.walkers.values()) seats.get(w.id)!.push({ x: w.goal.x, z: w.goal.z });
    crowd.step(dt);
    const cells = new Map<number, string>();
    for (const w of crowd.walkers.values()) {
      const c = cellIndex(w.pos);
      if (cells.has(c)) { maxSame++; throw new Error(`${w.id} va ${cells.get(c)} bitta katakda (t=${t.toFixed(2)})`); }
      cells.set(c, w.id);
      if (!walkable(grid, c)) {
        // Faqat o'z o'rindig'i (maqsadi yoki boshlang'ich joyi) yonida bo'lishi mumkin
        const near = [w.goal, ...w.path.slice(0, 1), ...(seats.get(w.id) || []).slice(-1)].some((p) => Math.hypot(p.x - w.pos.x, p.z - w.pos.z) < 1.7);
        if (!near) expect.fail(`${w.id} to'siq ichida (${w.pos.x.toFixed(2)},${w.pos.z.toFixed(2)})`);
      }
    }
  }
  return maxSame;
}

describe("AI ofis olomoni (agentlar bir-biriga urilmaydi)", () => {
  it.each([1, 7, 13])("hamma stoldan dam olish joylariga va qaytib (slot %i): bir katakda ikki agent yo'q, devor/mebel orqali yurilmaydi", (slot) => {
    const crowd = new Crowd(grid);
    for (const a of AGENTS) crowd.place(a.id, deskGoal(a.id));
    const assign = assignIdle(AGENTS.map((a) => a.id), L.pois, slot);
    for (const a of AGENTS) { const k = assign.get(a.id); if (k !== undefined) crowd.setGoal(a.id, poiGoal(k)); }
    simulate(crowd, 90);
    const arrived = [...crowd.walkers.values()].filter((w) => w.arrived).length;
    expect(arrived).toBeGreaterThanOrEqual(AGENTS.length);
    // Qaytish
    for (const a of AGENTS) crowd.setGoal(a.id, deskGoal(a.id));
    simulate(crowd, 90);
    const back = [...crowd.walkers.values()].filter((w) => w.arrived && Math.hypot(w.pos.x - w.goal.x, w.pos.z - w.goal.z) < 0.01).length;
    expect(back).toBeGreaterThanOrEqual(AGENTS.length);
  });

  it("yuzma-yuz kelgan ikki agent bir-birini aylanib o'tadi", () => {
    const crowd = new Crowd(grid);
    // O'rta yo'lak (z ≈ 5.7) bo'ylab qarama-qarshi
    crowd.place("a", { key: "a0", x: -18, z: 5.75, face: 0 });
    crowd.place("b", { key: "b0", x: 18, z: 5.75, face: 0 });
    crowd.setGoal("a", { key: "a1", x: 18, z: 5.75, face: 0 });
    crowd.setGoal("b", { key: "b1", x: -18, z: 5.75, face: 0 });
    let minD = Infinity;
    for (let t = 0; t < 40; t += 1 / 30) {
      crowd.step(1 / 30);
      const a = crowd.get("a")!, b = crowd.get("b")!;
      minD = Math.min(minD, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
      expect(cellIndex(a.pos)).not.toBe(cellIndex(b.pos));
    }
    expect(minD).toBeGreaterThan(0.5);
    expect(crowd.get("a")!.arrived && crowd.get("b")!.arrived).toBe(true);
  });

  it("o'yinchi devor bo'ylab sirpanadi (to'xtab qolmaydi), odamlar orqali o'tadi (arvoh)", () => {
    const crowd = new Crowd(grid);
    // Orqa yo'lakda, Dasturlash xonasi devoriga qiya yo'nalishda yurish: devorga kirmaydi, lekin x bo'ylab siljiyveradi
    crowd.place("me", { key: "me", x: -20, z: -6.9, face: 0 }, true);
    crowd.place("x", { key: "x", x: -18.5, z: -6.9, face: 0 });
    const x0 = crowd.get("me")!.pos.x;
    for (let i = 0; i < 60; i++) crowd.drive("me", 2.0, 2.0, 1 / 30); // 45° devor tomon
    const me = crowd.get("me")!;
    expect(walkable(grid, cellIndex(me.pos))).toBe(true);
    expect(me.pos.x - x0).toBeGreaterThan(2.5); // sirpanib o'tdi (agent "x" ham to'smadi)
    expect(me.pos.z).toBeLessThan(-5.6);         // devordan o'tmadi
  });

  it("o'yinchi (drive) devor orqali o'tmaydi", () => {
    const crowd = new Crowd(grid);
    crowd.place("me", { key: "me", x: -8.4, z: -6.75, face: Math.PI }, true);
    for (let i = 0; i < 90; i++) { crowd.drive("me", 0, -2.6, 1 / 30); crowd.step(1 / 30); }
    // Chap tashqi devorga qarab yurish — chegaradan chiqmaydi
    for (let i = 0; i < 400; i++) crowd.drive("me", -2.6, 0, 1 / 30);
    expect(walkable(grid, cellIndex(crowd.get("me")!.pos))).toBe(true);
  });
});
