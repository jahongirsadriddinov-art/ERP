import { describe, it, expect } from "vitest";
import { buildGrid, cellIndex, computeLayout, CORRIDORS, BOUNDS, ROOMS, doorPoint, doorZones, walkable, CELL } from "./layout";
import { Crowd, type Goal } from "./crowd";
import { AGENTS } from "./testAgents";

// Kengaytirilgan ofis (owner 2026-10-23): yo'laklar va eshiklar keng, ~55 agent bir necha (simulyatsiya) daqiqa tasodifiy
// yuradi — hech qachon ikki agent bitta katakda emas, hech kim 10 s dan ko'p tiqilib qolmaydi, hamma manzilga yetadi.
const MORE = [...AGENTS, ...["tg:9", "tg:10", "tg:11", "tg:12"].map((id) => ({ id, team: "ai", kind: "tg" }))];
const L = computeLayout(MORE);
const grid = buildGrid(L.obstacles);

function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }

describe("kengroq ofis", () => {
  it("eshiklar ≥ 2 katak, yo'laklar ≥ 4 katak bo'sh", () => {
    for (const r of ROOMS) for (const d of r.doors) {
      const p = doorPoint(r, d);
      let n = 0;
      for (let x = d.at - d.w / 2; x <= d.at + d.w / 2; x += CELL) if (walkable(grid, cellIndex({ x, z: p.z }))) n++;
      expect(n, `${r.key} ${d.side}`).toBeGreaterThanOrEqual(2);
    }
    for (const c of CORRIDORS) for (let x = BOUNDS.x0 + 2; x < BOUNDS.x1 - 2; x += 1.7) {
      let n = 0;
      for (let z = c.z0; z <= c.z1; z += CELL) if (walkable(grid, cellIndex({ x, z }))) n++;
      // Yo'lak bo'ylab (eshik/mebel bo'lmagan joylarda) kamida 4 katak
      if (n) expect(n, `corridor ${c.z0} @ x=${x.toFixed(1)}`).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("olomon: ~55 agent, tasodifiy sayohatlar", () => {
  it.each([1, 2, 3, 42])("seed %i — 6 daqiqa: bir katakda ikki agent yo'q, 10 s dan ortiq tiqilish yo'q, hamma yetib boradi", (seed) => {
    const rand = rng(seed);
    const crowd = new Crowd(grid, doorZones());
    const desk = (id: string): Goal => { const d = L.desks.get(id)!; return { key: `desk:${id}`, x: d.chair.x, z: d.chair.z, face: d.dir > 0 ? 0 : Math.PI }; };
    for (const a of MORE) crowd.place(a.id, desk(a.id));
    const taken = new Map<number, string>(); // POI → kim
    const wait = new Map<string, number>(MORE.map((a) => [a.id, rand() * 20]));
    let trips = 0, arrivals = 0, maxStuck = 0, worst = "";
    const lastProgress = new Map<string, { x: number; z: number; t: number }>();
    const dt = 1 / 20;
    const T = 360;
    for (let t = 0; t < T; t += dt) {
      for (const a of MORE) {
        const w = crowd.get(a.id)!;
        if (!w.arrived) continue;
        const left = (wait.get(a.id) || 0) - dt;
        wait.set(a.id, left);
        if (left > 0 || t > T - 60) continue; // oxirgi minutda yangi sayohat yo'q — hamma yetib borishi kerak
        // Yangi manzil: bo'sh dam olish joyi yoki o'z stoli
        for (const [k, v] of taken) if (v === a.id) taken.delete(k);
        let goal = desk(a.id);
        if (!w.key.startsWith("poi:") && rand() < 0.7) {
          for (let tries = 0; tries < 8; tries++) {
            const i = Math.floor(rand() * L.pois.length);
            if (taken.has(i)) continue;
            taken.set(i, a.id);
            const p = L.pois[i];
            goal = { key: `poi:${i}:${t.toFixed(1)}`, x: p.x, z: p.z, face: p.face };
            break;
          }
        }
        crowd.setGoal(a.id, goal);
        lastProgress.set(a.id, { x: w.pos.x, z: w.pos.z, t });
        trips++;
        wait.set(a.id, 20 + rand() * 40); // ilovadagidek: dam olish joyi ~45 s da almashadi (agentlar navbatma-navbat)
      }
      crowd.step(dt);
      const cells = new Map<number, string>();
      for (const w of crowd.walkers.values()) {
        const c = cellIndex(w.pos);
        if (cells.has(c)) throw new Error(`${w.id} va ${cells.get(c)} bitta katakda (t=${t.toFixed(2)})`);
        cells.set(c, w.id);
        if (w.arrived) { if (lastProgress.has(w.id)) { arrivals++; lastProgress.delete(w.id); } continue; }
        const lp = lastProgress.get(w.id);
        if (!lp) continue;
        // Tiqilish = joyidan (1 m radiusdan) chiqmay turish; aylanma yo'l (maqsaddan vaqtincha uzoqlashish) — tiqilish emas
        if (Math.hypot(w.pos.x - lp.x, w.pos.z - lp.z) > 1) { lp.x = w.pos.x; lp.z = w.pos.z; lp.t = t; }
        const stuck = t - lp.t;
        if (stuck > maxStuck) { maxStuck = stuck; worst = `${w.id}@${w.pos.x.toFixed(1)},${w.pos.z.toFixed(1)}→${w.goal.x.toFixed(1)},${w.goal.z.toFixed(1)} t=${t.toFixed(1)}`; }
      }
    }
    expect(trips).toBeGreaterThan(250);
    expect(maxStuck, worst).toBeLessThan(10);
    expect([...crowd.walkers.values()].filter((w) => !w.arrived).map((w) => w.id)).toEqual([]);
    expect(arrivals).toBe(trips);
  }, 120_000);
});
