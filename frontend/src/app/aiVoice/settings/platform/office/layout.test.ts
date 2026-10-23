import { describe, it, expect } from "vitest";
import {
  assignIdle, buildGrid, cellIndex, computeLayout, findPath, MANAGER_DESK, pathLength, ROOMS, walkable, zoneOf, doorPoint, type Grid, type P,
} from "./layout";
import { AGENTS } from "./testAgents";

/** Yo'lning bo'sh qismi (o'rindiqqa kirish/chiqish bo'laklaridan tashqari) hech qachon to'siq katagidan o'tmaydi. */
function assertPathClear(g: Grid, path: P[]) {
  const free = (p: P) => walkable(g, cellIndex(p));
  const a = free(path[0]) ? 0 : 1, b = free(path[path.length - 1]) ? path.length - 1 : path.length - 2;
  // O'rindiq bo'laklari qisqa (≤ 1.6 m)
  if (a === 1) expect(Math.hypot(path[1].x - path[0].x, path[1].z - path[0].z)).toBeLessThan(1.6);
  if (b === path.length - 2) expect(Math.hypot(path.at(-1)!.x - path.at(-2)!.x, path.at(-1)!.z - path.at(-2)!.z)).toBeLessThan(1.6);
  for (let i = a; i < b; i++) {
    const p = path[i], q = path[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.05));
    for (let k = 0; k <= n; k++) {
      const s = { x: p.x + (q.x - p.x) * (k / n), z: p.z + (q.z - p.z) * (k / n) };
      if (!free(s)) expect.fail(`segment ${i} @ ${s.x.toFixed(2)},${s.z.toFixed(2)}`);
    }
  }
}

describe("AI ofis joylashuvi", () => {
  const L = computeLayout(AGENTS);
  const grid = buildGrid(L.obstacles);

  it("ish turiga qarab xonalar", () => {
    expect(zoneOf({ id: "role-prorab", team: "assistants", kind: "role" })).toBe("call");
    expect(zoneOf({ id: "tg:abc", team: "ai", kind: "tg" })).toBe("call");
    expect(zoneOf({ id: "office-designer", team: "platform" })).toBe("design");
    expect(zoneOf({ id: "reporter", team: "growth" })).toBe("finance");
    expect(zoneOf({ id: "qa", team: "ops" })).toBe("secqa");
    expect(zoneOf({ id: "translator", team: "ops" })).toBe("support");
    expect(zoneOf({ id: "backend", team: "platform" })).toBe("dev");
    expect(zoneOf({ id: "custom-x", team: "growth", kind: "content" })).toBe("marketing");
  });

  it("har agentga o'z stoli; stollar ustma-ust tushmaydi; stol o'z xonasi ichida", () => {
    expect(L.desks.size).toBe(AGENTS.length);
    expect(L.desks.get("manager")).toMatchObject({ x: MANAGER_DESK.x, z: MANAGER_DESK.z, team: "lead" });
    expect(L.desks.get("weird")?.team).toBe("dev");
    expect(L.desks.get("office-designer")?.team).toBe("design");
    const list = [...L.desks.values()];
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const R = ROOMS.find((r) => r.key === d.team)!.rect;
      expect(d.x - 0.8 > R.x0 && d.x + 0.8 < R.x1 && d.chair.z - 0.3 > R.z0 && d.chair.z + 0.3 < R.z1, `${d.id} in ${d.team}`).toBe(true);
      for (let j = i + 1; j < list.length; j++) {
        const e = list[j];
        expect(Math.abs(d.x - e.x) >= 1.6 || Math.abs(d.z - e.z) >= 0.8).toBe(true);
      }
    }
  });

  it("xonalar bir-birini kesmaydi; har eshikdan ikki tomonga o'tsa bo'ladi", () => {
    for (let i = 0; i < ROOMS.length; i++) for (let j = i + 1; j < ROOMS.length; j++) {
      const a = ROOMS[i].rect, b = ROOMS[j].rect;
      const overlap = a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
      expect(overlap, `${ROOMS[i].key} × ${ROOMS[j].key}`).toBe(false);
    }
    for (const r of ROOMS) for (const d of r.doors) {
      const p = doorPoint(r, d);
      for (const dz of [0.6, -0.6]) expect(walkable(grid, cellIndex({ x: p.x, z: p.z + dz })), `${r.key} door ${d.side} ${dz}`).toBe(true);
    }
  });

  it("devorlar yopiq: xonadan faqat eshikdan chiqiladi", () => {
    const dev = ROOMS.find((r) => r.key === "dev")!;
    const doors = dev.doors.map((x) => doorPoint(dev, x));
    for (const d of [...L.desks.values()].filter((x) => x.team === "dev")) {
      const path = findPath(grid, d.chair, L.pois[0], { fromFace: d.dir > 0 ? 0 : Math.PI, toFace: L.pois[0].face })!;
      expect(path).not.toBeNull();
      assertPathClear(grid, path);
      let crossed: P | null = null;
      for (let i = 1; i < path.length && !crossed; i++) {
        const a = path[i - 1], b = path[i];
        for (const zw of [dev.rect.z0, dev.rect.z1]) {
          if ((a.z - zw) * (b.z - zw) < 0) { const t = (zw - a.z) / (b.z - a.z); crossed = { x: a.x + (b.x - a.x) * t, z: zw }; }
        }
      }
      expect(crossed, d.id).not.toBeNull();
      expect(Math.min(...doors.map((p) => Math.hypot(p.x - crossed!.x, p.z - crossed!.z))), d.id).toBeLessThan(1.0);
    }
  });

  it("har stuldan oshxona, o'yin, kino va dam olish joyiga yo'l bor; yo'l to'siqdan o'tmaydi", () => {
    const targets = [L.pois[0], L.pois.find((p) => p.kind === "game")!, L.pois.find((p) => p.kind === "cinema")!, L.pois.find((p) => p.kind === "lounge")!];
    for (const d of L.desks.values()) {
      for (const poi of targets) {
        const path = findPath(grid, d.chair, poi, { fromFace: d.dir > 0 ? 0 : Math.PI, toFace: poi.face });
        expect(path, `${d.id} → ${poi.kind}`).not.toBeNull();
        expect(path![0]).toEqual(d.chair);
        expect(path!.at(-1)).toMatchObject({ x: poi.x, z: poi.z });
        assertPathClear(grid, path!);
        expect(pathLength(path!)).toBeLessThan(Math.hypot(poi.x - d.chair.x, poi.z - d.chair.z) * 3 + 12);
      }
    }
  });

  it("har dam olish joyiga kirish mumkin", () => {
    const d = L.desks.get("backend")!;
    for (const poi of L.pois) {
      const path = findPath(grid, d.chair, poi, { fromFace: 0, toFace: poi.face });
      expect(path, `${poi.kind} ${poi.x},${poi.z}`).not.toBeNull();
      assertPathClear(grid, path!);
    }
  });

  it("bo'sh agentlar dam olish joylariga bittadan taqsimlanadi, deterministik", () => {
    const ids = AGENTS.map((a) => a.id);
    const a = assignIdle(ids, L.pois, 3);
    const b = assignIdle(ids, L.pois, 3);
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(new Set(a.values()).size).toBe(a.size);
    // Zona sig'imi: oshxona ≤ 6, PlayStation ≤ 4, kino ≤ puflar soni
    const per: Record<string, number> = {};
    for (const i of a.values()) per[L.pois[i].kind] = (per[L.pois[i].kind] || 0) + 1;
    expect(per.kitchen || 0).toBeLessThanOrEqual(6);
    expect(per.game || 0).toBeLessThanOrEqual(4);
    expect(per.cinema || 0).toBeLessThanOrEqual(9);
    expect(a.size).toBeGreaterThan(10);
  });
});
