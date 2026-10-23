// AI ofis — sof joylashuv va yo'l topish (three.js'siz, unit test qilinadi). Koordinatalar: x — chap/o'ng, z — yuqori/past
// (tepadan qaraganda), birlik ≈ 1 metr. Pol: x ∈ [-21, 21], z ∈ [-15, 12].
//  • orqa devor bo'ylab: Boshliqning shisha kabineti, oshxona, PlayStation burchagi, kinozal (kamera tomon qaragan);
//  • oldinda — ikki qator jamoa "pod"lari (stollar orqama-orqa, har jamoa o'z gilami bilan).
// Yo'l: 0.5 m katakli A* (to'siqlar — stollar, mebel, shisha devorlar), keyin ko'rinish chizig'i bo'yicha silliqlash.

export interface P { x: number; z: number }
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Desk { id: string; team: string; x: number; z: number; /** stol qaysi tomonga qaragan: +1 → agent yuqorida o'tirib pastga qaraydi */ dir: 1 | -1; chair: P }
export interface Zone { team: string; x: number; z: number; w: number; d: number }
export type Pose = "stand" | "sit" | "coffee" | "game" | "beanbag";
export interface Poi extends P { kind: "kitchen" | "game" | "cinema"; pose: Pose; face: number }
export interface Layout { desks: Map<string, Desk>; zones: Zone[]; obstacles: Rect[]; pois: Poi[]; bounds: Rect }

export const BOUNDS: Rect = { x0: -21, z0: -15, x1: 21, z1: 12 };
export const DESK_W = 1.6;
export const DESK_D = 0.8;
const COL = 1.95;
const MAX_COLS = 5;

/** Boshliq kabineti (orqa chap burchak, shisha devorlar; eshik — pastki devorda). */
export const MANAGER_ROOM: Rect = { x0: -21, z0: -15, x1: -13.5, z1: -7.5 };
export const MANAGER_DOOR = { x0: -16.2, x1: -14.4 };
export const MANAGER_DESK: P = { x: -17.2, z: -11.6 };

const POD_ANCHORS: Record<string, P> = {
  platform: { x: -13.2, z: -3.4 }, apps: { x: -3, z: -3.4 }, ai: { x: 8.6, z: -3.4 },
  ops: { x: -13.2, z: 6.6 }, growth: { x: -3, z: 6.6 }, assistants: { x: 8.6, z: 6.6 },
};
export const TEAM_ORDER = ["lead", "platform", "apps", "ai", "ops", "growth", "assistants"];
export const teamOf = (team: string) => (TEAM_ORDER.includes(team) ? team : "growth");

// ── Dam olish zonalari — orqa devor bo'ylab (kamera tomon qaragan): oshxona, PlayStation, kinozal ──
export const KITCHEN = {
  counter: { x0: -12.4, z0: -14.95, x1: -5.4, z1: -13.95 } as Rect, fridge: { x: -4.6, z: -14.4 },
  table: { x: -8.6, z: -10.6, r: 1.0 }, coffee: { x: -11.2, z: -14.45 },
};
export const GAME = {
  tv: { x: 2.6, z: -14.55 }, stand: { x0: 1, z0: -14.95, x1: 4.2, z1: -14.05 } as Rect,
  sofa: { x0: 0.2, z0: -11.3, x1: 5.0, z1: -10.3 } as Rect, table: { x0: 1.6, z0: -12.9, x1: 3.6, z1: -12.25 } as Rect,
};
export const CINEMA = {
  screen: { x: 15.4, z: -14.75, w: 8 },
  bags: [[12.5, -11.9], [14.4, -11.9], [16.3, -11.9], [18.2, -11.9], [13.4, -10], [15.4, -10], [17.4, -10]] as [number, number][],
};
export const PLANTS: P[] = [
  { x: -3.3, z: -14.4 }, { x: 7.6, z: -14.4 }, { x: 20.3, z: -14.3 }, { x: 20.3, z: -7.9 }, { x: -12.9, z: -8 },
  { x: -20.3, z: 1.6 }, { x: 20.3, z: 1.6 }, { x: 2.8, z: 1.6 }, { x: -8.1, z: 1.6 },
  { x: -20.3, z: 11.2 }, { x: 20.3, z: 11.2 }, { x: -8.1, z: 11.2 }, { x: 2.8, z: 11.2 },
];
const towards = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

/** Agentlarni jamoalar bo'yicha stollarga joylaydi (tartib — kelgan tartib). */
export function computeLayout(agents: { id: string; team: string }[]): Layout {
  const desks = new Map<string, Desk>();
  const zones: Zone[] = [];
  const obstacles: Rect[] = [];
  const byTeam = new Map<string, string[]>();
  for (const a of agents) {
    const t = teamOf(a.team);
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t)!.push(a.id);
  }
  // Boshliq: kabinetdagi katta stol (birinchi "lead" agenti; qolganlari — platform pod'iga)
  const leads = byTeam.get("lead") || [];
  if (leads[0]) {
    desks.set(leads[0], { id: leads[0], team: "lead", x: MANAGER_DESK.x, z: MANAGER_DESK.z, dir: 1, chair: { x: MANAGER_DESK.x, z: MANAGER_DESK.z - 1.15 } });
    obstacles.push({ x0: MANAGER_DESK.x - 1.4, z0: MANAGER_DESK.z - 0.55, x1: MANAGER_DESK.x + 1.4, z1: MANAGER_DESK.z + 0.55 });
  }
  if (leads.length > 1) byTeam.set("platform", [...leads.slice(1), ...(byTeam.get("platform") || [])]);
  for (const team of TEAM_ORDER.slice(1)) {
    const ids = byTeam.get(team) || [];
    if (!ids.length) continue;
    const a = POD_ANCHORS[team];
    const cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(ids.length / 2)));
    const pairs = Math.ceil(ids.length / (cols * 2));
    const w = cols * COL;
    ids.forEach((id, i) => {
      const pair = Math.floor(i / (cols * 2));
      const k = i % (cols * 2);
      const top = k < cols;
      const c = top ? k : k - cols;
      const pz = a.z + pair * 3.6;
      const x = a.x - w / 2 + COL / 2 + c * COL;
      const z = pz + (top ? -0.42 : 0.42);
      desks.set(id, { id, team, x, z, dir: top ? 1 : -1, chair: { x, z: top ? z - 1.0 : z + 1.0 } });
    });
    for (let p = 0; p < pairs; p++) {
      const pz = a.z + p * 3.6;
      obstacles.push({ x0: a.x - w / 2 + 0.1, z0: pz - 0.85, x1: a.x + w / 2 - 0.1, z1: pz + 0.85 });
    }
    zones.push({ team, x: a.x, z: a.z + ((pairs - 1) * 3.6) / 2, w: w + 1.6, d: pairs * 3.6 + 0.9 });
  }
  if (leads[0]) zones.unshift({ team: "lead", x: (MANAGER_ROOM.x0 + MANAGER_ROOM.x1) / 2, z: (MANAGER_ROOM.z0 + MANAGER_ROOM.z1) / 2, w: 8, d: 8 });

  // Boshliq kabineti devorlari (eshik bo'shlig'i bilan)
  const R = MANAGER_ROOM;
  obstacles.push({ x0: R.x1 - 0.1, z0: R.z0, x1: R.x1 + 0.1, z1: R.z1 });
  obstacles.push({ x0: R.x0, z0: R.z1 - 0.1, x1: MANAGER_DOOR.x0, z1: R.z1 + 0.1 });
  obstacles.push({ x0: MANAGER_DOOR.x1, z0: R.z1 - 0.1, x1: R.x1 + 0.1, z1: R.z1 + 0.1 });
  // Dam olish mebeli
  const K = KITCHEN, t = KITCHEN.table;
  obstacles.push(K.counter, { x0: K.fridge.x - 0.5, z0: K.fridge.z - 0.5, x1: K.fridge.x + 0.5, z1: K.fridge.z + 0.5 });
  obstacles.push({ x0: t.x - 0.8, z0: t.z - 0.8, x1: t.x + 0.8, z1: t.z + 0.8 });
  obstacles.push(GAME.stand, GAME.sofa, GAME.table);
  obstacles.push({ x0: CINEMA.screen.x - CINEMA.screen.w / 2 - 0.6, z0: -15, x1: CINEMA.screen.x + CINEMA.screen.w / 2 + 0.6, z1: -14.4 });
  for (const p of PLANTS) obstacles.push({ x0: p.x - 0.35, z0: p.z - 0.35, x1: p.x + 0.35, z1: p.z + 0.35 });

  const tv = GAME.tv;
  const pois: Poi[] = [
    ...[0, 1, 2, 3].map((i): Poi => {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = t.x + Math.cos(ang) * 1.35, z = t.z + Math.sin(ang) * 1.35;
      return { kind: "kitchen", pose: "sit", x, z, face: towards(x, z, t.x, t.z) };
    }),
    { kind: "kitchen", pose: "coffee", x: K.coffee.x, z: -13.3, face: Math.PI },
    { kind: "kitchen", pose: "coffee", x: -7.4, z: -13.3, face: Math.PI },
    ...([[-12.6, -9.4], [-4.9, -9.6], [-4.7, -11.7], [-12.6, -11.6]] as const)
      .map(([x, z]): Poi => ({ kind: "kitchen", pose: "stand", x, z, face: towards(x, z, t.x, t.z) })),
    ...[1.2, 2.6, 4.0].map((x): Poi => ({ kind: "game", pose: "game", x, z: -10.85, face: Math.PI })),
    { kind: "game", pose: "stand", x: 6.2, z: -12.2, face: towards(6.2, -12.2, tv.x, tv.z) },
    ...[1.2, 2.6, 4.0].map((x): Poi => ({ kind: "game", pose: "stand", x, z: -9.4, face: Math.PI })),
    ...CINEMA.bags.map(([x, z]): Poi => ({ kind: "cinema", pose: "beanbag", x, z, face: Math.PI })),
    ...[12.4, 14.6, 16.8, 18.8].map((x): Poi => ({ kind: "cinema", pose: "stand", x, z: -8.5, face: Math.PI })),
  ];
  return { desks, zones, obstacles, pois, bounds: BOUNDS };
}

// ───────────── Yo'l topish ─────────────
const CELL = 0.5;
const COLS = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL);
const ROWS = Math.round((BOUNDS.z1 - BOUNDS.z0) / CELL);
const INFLATE = 0.25;

export interface Grid { blocked: Uint8Array; cols: number; rows: number }
export function buildGrid(obstacles: Rect[]): Grid {
  const blocked = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = BOUNDS.x0 + (c + 0.5) * CELL;
      const z = BOUNDS.z0 + (r + 0.5) * CELL;
      if (c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1) { blocked[r * COLS + c] = 1; continue; }
      for (const o of obstacles) {
        if (x > o.x0 - INFLATE && x < o.x1 + INFLATE && z > o.z0 - INFLATE && z < o.z1 + INFLATE) { blocked[r * COLS + c] = 1; break; }
      }
    }
  }
  return { blocked, cols: COLS, rows: ROWS };
}
const cellOf = (p: P) => ({
  c: Math.min(COLS - 1, Math.max(0, Math.floor((p.x - BOUNDS.x0) / CELL))),
  r: Math.min(ROWS - 1, Math.max(0, Math.floor((p.z - BOUNDS.z0) / CELL))),
});
const center = (c: number, r: number): P => ({ x: BOUNDS.x0 + (c + 0.5) * CELL, z: BOUNDS.z0 + (r + 0.5) * CELL });

/** Eng yaqin bo'sh katak (stul stol yonida — ichida bo'lishi mumkin). */
function nearestFree(g: Grid, c: number, r: number): { c: number; r: number } {
  if (!g.blocked[r * g.cols + c]) return { c, r };
  for (let rad = 1; rad < 12; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const cc = c + dc, rr = r + dr;
        if (cc > 0 && rr > 0 && cc < g.cols - 1 && rr < g.rows - 1 && !g.blocked[rr * g.cols + cc]) return { c: cc, r: rr };
      }
    }
  }
  return { c, r };
}

function lineFree(g: Grid, a: P, b: P): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.ceil(d / (CELL / 2));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const { c, r } = cellOf({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    if (g.blocked[r * g.cols + c]) return false;
  }
  return true;
}

/** A* (8 yo'nalish) + silliqlash. Natija: [start, ..., goal] — boshlanish/oxir aniq nuqtalar. */
export function findPath(g: Grid, from: P, to: P): P[] {
  const s0 = cellOf(from), g0 = cellOf(to);
  const s = nearestFree(g, s0.c, s0.r), e = nearestFree(g, g0.c, g0.r);
  const N = g.cols * g.rows;
  const gs = new Float32Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const fs = new Float32Array(N).fill(Infinity);
  const h = (i: number) => {
    const dc = Math.abs((i % g.cols) - e.c), dr = Math.abs(Math.floor(i / g.cols) - e.r);
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
  };
  // Ikkilik uyum (binary heap) — fs bo'yicha
  const heap: number[] = [];
  const push = (v: number) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (fs[heap[p]] <= fs[v]) break; heap[i] = heap[p]; i = p; }
    heap[i] = v;
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        const fm = () => (m === i ? fs[last] : fs[heap[m]]);
        if (l < heap.length && fs[heap[l]] < fm()) m = l;
        if (r < heap.length && fs[heap[r]] < fm()) m = r;
        if (m === i) break;
        heap[i] = heap[m]; i = m;
      }
      heap[i] = last;
    }
    return top;
  };
  const si = s.r * g.cols + s.c, ei = e.r * g.cols + e.c;
  gs[si] = 0; fs[si] = h(si); push(si);
  let found = si === ei;
  while (heap.length && !found) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === ei) { found = true; break; }
    const cc = cur % g.cols, cr = Math.floor(cur / g.cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
        const ni = nr * g.cols + nc;
        if (g.blocked[ni] || closed[ni]) continue;
        // Diagonalda burchak kesilmasin
        if (dr && dc && (g.blocked[cr * g.cols + nc] || g.blocked[nr * g.cols + cc])) continue;
        const ng = gs[cur] + (dr && dc ? Math.SQRT2 : 1);
        if (ng < gs[ni]) { gs[ni] = ng; fs[ni] = ng + h(ni); parent[ni] = cur; push(ni); }
      }
    }
  }
  if (!found) return [from, to];
  const cells: P[] = [];
  for (let i = ei; i !== -1; i = parent[i]) { cells.push(center(i % g.cols, Math.floor(i / g.cols))); if (i === si) break; }
  cells.reverse();
  const raw = [from, ...cells.slice(1, -1), to];
  // Silliqlash: ko'rinish chizig'i bo'yicha keraksiz nuqtalarni tashlab ketish
  const out: P[] = [raw[0]];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && !lineFree(g, raw[i], raw[j])) j--;
    out.push(raw[j]);
    i = j;
  }
  return out;
}

export const pathLength = (path: P[]) => path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) : 0), 0);

/** Deterministik "tasodif" — agent id + vaqt bo'lagidan (hamma qurilmada bir xil). */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Bo'sh agent qayerda dam oladi: har ~45 s o'zgaradi; bitta joyga ikki agent tushmaydi. */
export function assignIdle(idleIds: string[], pois: Poi[], slot: number): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  const sorted = [...idleIds].sort((a, b) => hash(`${a}:${slot}`) - hash(`${b}:${slot}`));
  for (const id of sorted) {
    if (taken.size >= pois.length) break;
    let k = hash(`${id}#${slot}`) % pois.length;
    while (taken.has(k)) k = (k + 1) % pois.length;
    taken.add(k);
    out.set(id, k);
  }
  return out;
}
