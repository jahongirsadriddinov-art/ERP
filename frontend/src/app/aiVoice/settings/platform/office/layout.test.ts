import { describe, it, expect } from "vitest";
import { assignIdle, buildGrid, computeLayout, findPath, MANAGER_DESK, pathLength } from "./layout";

const agents = [
  { id: "manager", team: "lead" },
  ...["backend", "frontend", "database", "designer", "devpanel", "payments", "feature"].map((id) => ({ id, team: "platform" })),
  ...["mobile", "windows", "android", "miniapp", "landing"].map((id) => ({ id, team: "apps" })),
  ...["ai", "erpbot", "devbot", "tgworker", "tg:1", "tg:2", "tg:3", "tg:4", "tg:5", "tg:6", "tg:7", "tg:8"].map((id) => ({ id, team: "ai" })),
  ...["security", "qa", "perf", "devops", "translator", "analytics"].map((id) => ({ id, team: "ops" })),
  ...["smm", "marketing", "support", "docs", "billing", "reporter", "custom-1"].map((id) => ({ id, team: "growth" })),
  ...["d", "o", "p", "b", "i"].map((id) => ({ id: `role-${id}`, team: "assistants" })),
  { id: "weird", team: "unknown-team" },
];

describe("AI ofis joylashuvi", () => {
  const L = computeLayout(agents);
  const grid = buildGrid(L.obstacles);

  it("har agentga o'z stoli; stollar ustma-ust tushmaydi; pol ichida", () => {
    expect(L.desks.size).toBe(agents.length);
    expect(L.desks.get("manager")).toMatchObject({ x: MANAGER_DESK.x, z: MANAGER_DESK.z, team: "lead" });
    expect(L.desks.get("weird")?.team).toBe("growth");
    const list = [...L.desks.values()];
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      expect(Math.abs(d.x)).toBeLessThan(20.5);
      expect(d.z).toBeGreaterThan(-14.5);
      expect(d.z).toBeLessThan(11.5);
      for (let j = i + 1; j < list.length; j++) {
        const e = list[j];
        expect(Math.abs(d.x - e.x) >= 1.6 || Math.abs(d.z - e.z) >= 0.8).toBe(true);
      }
    }
  });

  it("jamoa zonalari bir-birini kesmaydi", () => {
    const z = L.zones;
    for (let i = 0; i < z.length; i++) for (let j = i + 1; j < z.length; j++) {
      const a = z[i], b = z[j];
      const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
      expect(overlap, `${a.team} × ${b.team}`).toBe(false);
    }
  });

  it("har stuldan oshxona, o'yin va kinoga yo'l bor (to'siqlardan o'tmaydi)", () => {
    for (const d of L.desks.values()) {
      for (const poi of [L.pois[0], L.pois.find((p) => p.kind === "game")!, L.pois.find((p) => p.kind === "cinema")!]) {
        const path = findPath(grid, d.chair, poi);
        expect(path.length).toBeGreaterThanOrEqual(2);
        expect(path[0]).toEqual(d.chair);
        expect(path[path.length - 1]).toMatchObject({ x: poi.x, z: poi.z });
        // Yo'l to'g'ri chiziqdan juda uzun emas (A* topdi, [from,to] zaxirasi emas)
        expect(pathLength(path)).toBeLessThan(Math.hypot(poi.x - d.chair.x, poi.z - d.chair.z) * 2.2 + 6);
      }
    }
  });

  it("bo'sh agentlar dam olish joylariga bittadan taqsimlanadi, deterministik", () => {
    const ids = agents.map((a) => a.id);
    const a = assignIdle(ids, L.pois, 3);
    const b = assignIdle(ids, L.pois, 3);
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.size).toBe(Math.min(ids.length, L.pois.length));
    expect(new Set(a.values()).size).toBe(a.size);
  });
});
