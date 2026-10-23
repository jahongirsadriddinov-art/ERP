// AI ofis — sof joylashuv va yo'l topish (three.js'siz, unit test qilinadi). Koordinatalar: x — chap/o'ng, z — yuqori/past
// (tepadan qaraganda), birlik ≈ 1 metr. Pol: x ∈ [-21, 21], z ∈ [-15, 15].
//  • orqa qator (dam olish): Boshliqning shisha kabineti, oshxona (oshpaz bilan), PlayStation burchagi, kinozal;
//  • o'rta qator — xonalar: Dasturlash, (o'tish yo'lagi), Qo'ng'iroq markazi, Dizayn, Xavfsizlik & QA;
//  • old qator — Marketing & SMM, Moliya & hisobot, Qo'llab-quvvatlash va ochiq dam olish burchagi.
// Har xonaning devori va ESHIGI bor (eshik ustida nomli lavha) — yo'llar faqat eshiklardan o'tadi.
// Yo'l: 0.5 m katakli A* (to'siqlar — devorlar, stollar, stullar, mebel; agent kengligi bo'yicha kengaytirilgan), keyin
// ko'rinish chizig'i bo'yicha silliqlash. O'tiriladigan joy (stul, puf, divan) — to'siq: agent unga faqat oxirgi qadamda,
// old yoki orqa tomonidan kiradi.

export interface P { x: number; z: number }
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export type ZoneKey = "lead" | "dev" | "call" | "design" | "secqa" | "marketing" | "finance" | "support" | "kitchen" | "game" | "cinema" | "lounge" | "owner";
export interface Desk { id: string; team: ZoneKey; x: number; z: number; /** stol qaysi tomonga qaragan: +1 → agent yuqorida o'tirib pastga qaraydi */ dir: 1 | -1; chair: P }
export interface Door { side: "n" | "s"; at: number; w: number }
export interface Room { key: ZoneKey; rect: Rect; doors: Door[]; walls: boolean; glass?: boolean }
export interface Wall extends Rect { room: ZoneKey; glass?: boolean }
export interface Zone { team: ZoneKey; x: number; z: number; w: number; d: number }
export type Pose = "stand" | "sit" | "coffee" | "game" | "beanbag";
export interface Poi extends P { kind: "kitchen" | "game" | "cinema" | "lounge"; pose: Pose; face: number }
export interface Layout { desks: Map<string, Desk>; zones: Zone[]; rooms: Room[]; walls: Wall[]; obstacles: Rect[]; pois: Poi[]; bounds: Rect }

export const BOUNDS: Rect = { x0: -21, z0: -15, x1: 21, z1: 15 };
export const DESK_W = 1.6;
export const DESK_D = 0.8;
const COL = 1.95;
/** Stul markazi stol markazidan qancha uzoqda. */
export const CHAIR_OFF = 0.9;
/** Juft stol qatorlari orasidagi masofa — orqama-orqa stullar orasida yurish yo'lagi qoladi. */
export const PAIR = 4.6;
export const WALL_T = 0.06;

/** Boshliq kabineti (orqa chap burchak, shisha devorlar; eshik — pastki devorda). */
export const MANAGER_ROOM: Rect = { x0: -21, z0: -15, x1: -13.5, z1: -7.5 };
export const MANAGER_DOOR = { x0: -16.2, x1: -14.4 };
export const MANAGER_DESK: P = { x: -17.2, z: -11.6 };

const ROW_A = { z0: -5.8, z1: 4.8 };
const ROW_B = { z0: 6.6, z1: 15 };
export const ROOMS: Room[] = [
  { key: "lead", rect: MANAGER_ROOM, doors: [{ side: "s", at: (MANAGER_DOOR.x0 + MANAGER_DOOR.x1) / 2, w: MANAGER_DOOR.x1 - MANAGER_DOOR.x0 }], walls: true, glass: true },
  { key: "kitchen", rect: { x0: -13.5, z0: -15, x1: -3.6, z1: -7.5 }, doors: [], walls: false },
  { key: "game", rect: { x0: -3.6, z0: -15, x1: 8.6, z1: -7.5 }, doors: [], walls: false },
  { key: "cinema", rect: { x0: 8.6, z0: -15, x1: 21, z1: -7.5 }, doors: [], walls: false },
  { key: "dev", rect: { x0: -21, z0: ROW_A.z0, x1: -5.4, z1: ROW_A.z1 }, doors: [{ side: "n", at: -8.4, w: 2 }, { side: "s", at: -13.2, w: 2 }], walls: true },
  { key: "call", rect: { x0: -3.4, z0: ROW_A.z0, x1: 6.6, z1: ROW_A.z1 }, doors: [{ side: "n", at: 1.6, w: 2 }, { side: "s", at: -1.4, w: 2 }], walls: true },
  { key: "design", rect: { x0: 6.6, z0: ROW_A.z0, x1: 12.6, z1: ROW_A.z1 }, doors: [{ side: "n", at: 9.6, w: 2 }, { side: "s", at: 9.6, w: 2 }], walls: true },
  { key: "secqa", rect: { x0: 12.6, z0: ROW_A.z0, x1: 21, z1: ROW_A.z1 }, doors: [{ side: "n", at: 16.8, w: 2 }, { side: "s", at: 16.8, w: 2 }], walls: true },
  { key: "marketing", rect: { x0: -21, z0: ROW_B.z0, x1: -11, z1: ROW_B.z1 }, doors: [{ side: "n", at: -16, w: 2 }], walls: true },
  { key: "finance", rect: { x0: -11, z0: ROW_B.z0, x1: -1, z1: ROW_B.z1 }, doors: [{ side: "n", at: -6, w: 2 }], walls: true },
  { key: "support", rect: { x0: -1, z0: ROW_B.z0, x1: 9, z1: ROW_B.z1 }, doors: [{ side: "n", at: 4, w: 2 }], walls: true },
  { key: "owner", rect: { x0: 9, z0: ROW_B.z0, x1: 15, z1: ROW_B.z1 }, doors: [{ side: "n", at: 12, w: 2 }], walls: true, glass: true },
  { key: "lounge", rect: { x0: 15, z0: ROW_B.z0, x1: 21, z1: ROW_B.z1 }, doors: [], walls: false },
];
export const DESK_ZONES: ZoneKey[] = ["lead", "dev", "call", "design", "secqa", "marketing", "finance", "support"];
export const roomOf = (key: ZoneKey) => ROOMS.find((r) => r.key === key)!;
export const doorPoint = (r: Room, d: Door): P => ({ x: d.at, z: d.side === "n" ? r.rect.z0 : r.rect.z1 });

/** Agent qaysi xonada ishlaydi — ish turiga qarab (id bo'yicha; noma'lumlar — jamoa/turi bo'yicha). */
const ZONE_BY_ID: Record<string, ZoneKey> = {
  designer: "design", botdesign: "design", "office-designer": "design",
  smm: "marketing", marketing: "marketing", landing: "marketing",
  security: "secqa", qa: "secqa", monitoring: "secqa",
  finance: "finance", billing: "finance", reporter: "finance", analytics: "finance", payments: "finance",
  support: "support", docs: "support", translator: "support",
};
export function zoneOf(a: { id: string; team: string; kind?: string }): ZoneKey {
  if (a.team === "lead") return "lead";
  if (a.kind === "role" || a.kind === "tg" || a.team === "assistants" || a.id.startsWith("tg:") || a.id.startsWith("role-")) return "call";
  if (ZONE_BY_ID[a.id]) return ZONE_BY_ID[a.id];
  if (a.team === "growth" || a.kind === "content") return "marketing";
  return "dev";
}
export const TEAM_ORDER = ["lead", "platform", "apps", "ai", "ops", "growth", "assistants"];
export const teamOf = (team: string) => (TEAM_ORDER.includes(team) ? team : "growth");

// ── Dam olish zonalari — orqa devor bo'ylab (kamera tomon qaragan): oshxona, PlayStation, kinozal ──
export const KITCHEN = {
  counter: { x0: -12.4, z0: -14.95, x1: -5.4, z1: -13.95 } as Rect, fridge: { x: -4.6, z: -14.4 },
  table: { x: -8.6, z: -10.6, r: 1.0 }, coffee: { x: -11.2, z: -14.45 },
};
export const STOVE: P = { x: -9.6, z: -14.45 };
export const SINK: P = { x: -6.6, z: -14.45 };
export const MICROWAVE: P = { x: -8.1, z: -14.5 };
/** Oshpaz (NPC) plita oldida ishlaydi. */
export const COOK: P = { x: -9.6, z: -13.3 };
/** Oshxona stoli atrofidagi 4 ta stul. */
export const KITCHEN_SEATS: P[] = [0, 1, 2, 3].map((i) => {
  const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
  return { x: KITCHEN.table.x + Math.cos(ang) * 1.35, z: KITCHEN.table.z + Math.sin(ang) * 1.35 };
});
export const GAME = {
  tv: { x: 2.6, z: -14.55 }, stand: { x0: 1, z0: -14.95, x1: 4.2, z1: -14.05 } as Rect,
  sofa: { x0: 0.2, z0: -11.3, x1: 5.0, z1: -10.3 } as Rect, table: { x0: 1.6, z0: -13.3, x1: 3.6, z1: -12.65 } as Rect,
};
export const CINEMA = {
  screen: { x: 15.4, z: -14.75, w: 8 },
  bags: [[12.5, -11.9], [14.4, -11.9], [16.3, -11.9], [18.2, -11.9], [13.4, -10], [15.4, -10], [17.4, -10]] as [number, number][],
};
/** Old o'ng burchak — ochiq dam olish joyi: divan, kofe stolchasi, suv kuleri. */
export const LOUNGE = {
  sofa: { x0: 15.9, z0: 13.6, x1: 19.9, z1: 14.6 } as Rect, table: { x0: 16.7, z0: 11.9, x1: 19.1, z1: 12.6 } as Rect,
  seats: [16.6, 17.9, 19.2] as number[],
};
/** Egasining shaxsiy kabineti ("Mening ofisim"): kompyuterli stol — o'yinchi o'tirsa, kompyuter ochiladi. */
export const OWNER = { desk: { x: 12, z: 12.7 } as P, chair: { x: 12, z: 11.75 } as P, shelf: { x0: 9.3, z0: 13.6, x1: 9.8, z1: 14.9 } as Rect };
export const COOLER: P = { x: 20.45, z: 9.2 };
export const PLANTS: P[] = [
  { x: -3.3, z: -14.4 }, { x: 7.6, z: -14.4 }, { x: 20.3, z: -14.3 }, { x: 20.3, z: -8.3 }, { x: -12.9, z: -8.1 },
  { x: 20.4, z: 14.4 }, { x: 15.7, z: 7.3 }, { x: 14.4, z: 14.4 },
];
const around = (p: P, hx: number, hz: number): Rect => ({ x0: p.x - hx, z0: p.z - hz, x1: p.x + hx, z1: p.z + hz });
const towards = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

/** Xona devorlari (eshik bo'shliqlari bilan). Orqa/chap tashqi devor — binoning o'zida; qo'shni xonalar umumiy devorni bir marta chizadi. */
export function roomWalls(r: Room): Wall[] {
  if (!r.walls) return [];
  const R = r.rect, out: Wall[] = [];
  const w = (x0: number, z0: number, x1: number, z1: number) => out.push({ x0, z0, x1, z1, room: r.key, glass: r.glass });
  const hz = (z: number, side: "n" | "s") => {
    const gaps = r.doors.filter((d) => d.side === side).map((d) => [d.at - d.w / 2, d.at + d.w / 2]).sort((a, b) => a[0] - b[0]);
    let x = R.x0;
    for (const [g0, g1] of gaps) { if (g0 > x) w(x, z - WALL_T, g0, z + WALL_T); x = g1; }
    if (x < R.x1) w(x, z - WALL_T, R.x1, z + WALL_T);
  };
  if (R.z0 > BOUNDS.z0) hz(R.z0, "n");
  hz(R.z1, "s");
  const sharedWest = ROOMS.some((o) => o !== r && o.walls && o.rect.x1 === R.x0 && o.rect.z0 === R.z0);
  if (R.x0 > BOUNDS.x0 && !sharedWest) w(R.x0 - WALL_T, R.z0, R.x0 + WALL_T, R.z1);
  w(R.x1 - WALL_T, R.z0, R.x1 + WALL_T, R.z1);
  return out;
}

/** Agentlarni xonalar bo'yicha stollarga joylaydi (tartib — kelgan tartib). */
export function computeLayout(agents: { id: string; team: string; kind?: string }[]): Layout {
  const desks = new Map<string, Desk>();
  const zones: Zone[] = [];
  const obstacles: Rect[] = [];
  const byZone = new Map<ZoneKey, string[]>();
  for (const a of agents) {
    const z = zoneOf(a);
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(a.id);
  }
  // Boshliq: kabinetdagi katta stol (birinchi "lead" agenti; qolganlari — Dasturlash xonasiga)
  const leads = byZone.get("lead") || [];
  if (leads[0]) {
    desks.set(leads[0], { id: leads[0], team: "lead", x: MANAGER_DESK.x, z: MANAGER_DESK.z, dir: 1, chair: { x: MANAGER_DESK.x, z: MANAGER_DESK.z - 1.15 } });
    obstacles.push({ x0: MANAGER_DESK.x - 1.4, z0: MANAGER_DESK.z - 0.55, x1: MANAGER_DESK.x + 1.4, z1: MANAGER_DESK.z + 0.55 });
  }
  if (leads.length > 1) byZone.set("dev", [...leads.slice(1), ...(byZone.get("dev") || [])]);
  const lr = MANAGER_ROOM;
  zones.push({ team: "lead", x: (lr.x0 + lr.x1) / 2, z: (lr.z0 + lr.z1) / 2, w: lr.x1 - lr.x0, d: lr.z1 - lr.z0 });
  for (const key of DESK_ZONES.slice(1)) {
    const ids = byZone.get(key) || [];
    const R = roomOf(key).rect;
    zones.push({ team: key, x: (R.x0 + R.x1) / 2, z: (R.z0 + R.z1) / 2, w: R.x1 - R.x0, d: R.z1 - R.z0 });
    if (!ids.length) continue;
    const maxCols = Math.max(1, Math.floor((R.x1 - R.x0 - 1.8) / COL));
    const cols = Math.min(maxCols, Math.max(1, Math.ceil(ids.length / 2)));
    const pairs = Math.ceil(ids.length / (cols * 2));
    const w = cols * COL;
    const cx = (R.x0 + R.x1) / 2, z0 = (R.z0 + R.z1) / 2 - ((pairs - 1) * PAIR) / 2;
    ids.forEach((id, i) => {
      const pair = Math.floor(i / (cols * 2));
      const k = i % (cols * 2);
      const top = k < cols;
      const c = top ? k : k - cols;
      const pz = z0 + pair * PAIR;
      const x = cx - w / 2 + COL / 2 + c * COL;
      const z = pz + (top ? -0.42 : 0.42);
      desks.set(id, { id, team: key, x, z, dir: top ? 1 : -1, chair: { x, z: top ? z - CHAIR_OFF : z + CHAIR_OFF } });
    });
    for (let p = 0; p < pairs; p++) {
      const pz = z0 + p * PAIR;
      obstacles.push({ x0: cx - w / 2 + 0.1, z0: pz - 0.85, x1: cx + w / 2 - 0.1, z1: pz + 0.85 });
    }
  }

  // Devorlar (eshik bo'shliqlari bilan)
  const walls = ROOMS.flatMap(roomWalls);
  obstacles.push(...walls);
  // Dam olish mebeli
  const K = KITCHEN, t = KITCHEN.table;
  obstacles.push(K.counter, around(K.fridge, 0.5, 0.5), around(t, 0.8, 0.8));
  // TV stendi va kofe stolchasi orasidagi tor tirqish (kabel zonasi) — yurilmaydi
  obstacles.push(GAME.stand, GAME.sofa, GAME.table, { x0: GAME.table.x0, z0: GAME.stand.z1, x1: GAME.table.x1, z1: GAME.table.z0 });
  obstacles.push({ x0: CINEMA.screen.x - CINEMA.screen.w / 2 - 0.6, z0: -15, x1: CINEMA.screen.x + CINEMA.screen.w / 2 + 0.6, z1: -14.4 });
  obstacles.push(LOUNGE.sofa, LOUNGE.table, OWNER.shelf, around(OWNER.desk, 0.95, 0.45), around(OWNER.chair, 0.28, 0.26));
  for (const p of PLANTS) obstacles.push(around(p, 0.35, 0.35));
  // O'tiriladigan joylar ham to'siq (agent ularning ustidan yurmaydi; o'z o'rindig'iga faqat oxirgi qadamda kiradi)
  for (const d of desks.values()) obstacles.push(around(d.chair, 0.28, 0.26));
  for (const s of KITCHEN_SEATS) obstacles.push(around(s, 0.24, 0.24));
  for (const [x, z] of CINEMA.bags) obstacles.push(around({ x, z: z - 0.1 }, 0.5, 0.5));
  // Boshliq kabineti mebeli (divan, stolcha, kubok javoni), popkorn, suv kuleri, oshpaz
  obstacles.push({ x0: -20.35, z0: -10.3, x1: -19.45, z1: -7.7 }, { x0: -19.0, z0: -9.55, x1: -18.2, z1: -8.45 }, { x0: -15.3, z0: -14.85, x1: -13.9, z1: -14.35 });
  obstacles.push(around({ x: 20.2, z: -10.6 }, 0.4, 0.4), around(COOLER, 0.3, 0.3), around(COOK, 0.32, 0.3));

  const tv = GAME.tv;
  const pois: Poi[] = [
    ...KITCHEN_SEATS.map(({ x, z }): Poi => ({ kind: "kitchen", pose: "sit", x, z, face: towards(x, z, t.x, t.z) })),
    { kind: "kitchen", pose: "coffee", x: K.coffee.x, z: -13.3, face: Math.PI },
    { kind: "kitchen", pose: "coffee", x: -7.4, z: -13.3, face: Math.PI },
    ...([[-12.6, -9.4], [-4.9, -9.6], [-4.7, -11.7], [-12.6, -11.6]] as const)
      .map(([x, z]): Poi => ({ kind: "kitchen", pose: "stand", x, z, face: towards(x, z, t.x, t.z) })),
    ...[1.2, 2.6, 4.0].map((x): Poi => ({ kind: "game", pose: "game", x, z: -10.85, face: Math.PI })),
    { kind: "game", pose: "stand", x: 6.2, z: -12.2, face: towards(6.2, -12.2, tv.x, tv.z) },
    ...[1.2, 2.6, 4.0].map((x): Poi => ({ kind: "game", pose: "stand", x, z: -9.4, face: Math.PI })),
    ...CINEMA.bags.map(([x, z]): Poi => ({ kind: "cinema", pose: "beanbag", x, z, face: Math.PI })),
    ...[12.4, 14.6, 16.8, 18.8].map((x): Poi => ({ kind: "cinema", pose: "stand", x, z: -8.5, face: Math.PI })),
    ...LOUNGE.seats.map((x): Poi => ({ kind: "lounge", pose: "sit", x, z: 14.0, face: Math.PI })),
    { kind: "lounge", pose: "coffee", x: COOLER.x - 0.85, z: COOLER.z, face: Math.PI / 2 },
  ];
  return { desks, zones, rooms: ROOMS, walls, obstacles, pois, bounds: BOUNDS };
}

// ───────────── Yo'l topish ─────────────
export const CELL = 0.5;
const COLS = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL);
const ROWS = Math.round((BOUNDS.z1 - BOUNDS.z0) / CELL);
/** To'siqlar agent yarim kengligiga yaqin kengaytiriladi — agent mebelga "kirib" ketmaydi. */
export const INFLATE = 0.3;

export interface Grid {
  blocked: Uint8Array; cols: number; rows: number;
  /** Asosiy (eng katta) bog'langan bo'sh hudud: 1 — shu hududda. Yopiq "cho'ntak"larga yo'l qidirilmaydi. */
  main: Uint8Array;
}
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
  // Bog'langan hududlar (4 yo'nalish) — eng kattasi "asosiy"
  const comp = new Int32Array(COLS * ROWS).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    if (blocked[i] || comp[i] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    comp[i] = id; stack.push(i);
    while (stack.length) {
      const cur = stack.pop()!;
      n++;
      const c = cur % COLS, r = (cur / COLS) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const ni = nr * COLS + nc;
        if (!blocked[ni] && comp[ni] < 0) { comp[ni] = id; stack.push(ni); }
      }
    }
    sizes.push(n);
  }
  const best = sizes.indexOf(Math.max(...sizes));
  const main = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < COLS * ROWS; i++) if (comp[i] === best) main[i] = 1;
  return { blocked, cols: COLS, rows: ROWS, main };
}
export const cellOf = (p: P) => ({
  c: Math.min(COLS - 1, Math.max(0, Math.floor((p.x - BOUNDS.x0) / CELL))),
  r: Math.min(ROWS - 1, Math.max(0, Math.floor((p.z - BOUNDS.z0) / CELL))),
});
export const cellIndex = (p: P) => { const { c, r } = cellOf(p); return r * COLS + c; };
export const cellCenter = (i: number): P => ({ x: BOUNDS.x0 + ((i % COLS) + 0.5) * CELL, z: BOUNDS.z0 + (Math.floor(i / COLS) + 0.5) * CELL });
/** Katak yurish mumkinmi (statik to'siqsiz, asosiy hududda, vaqtinchalik band emas). */
export const walkable = (g: Grid, i: number, extra?: Set<number>) => !g.blocked[i] && !!g.main[i] && !extra?.has(i);

/** O'tiriladigan joyga kirish katagi: avval old tomoni, keyin orqasi, yonlari (≤ 1.4 m), keyin eng yaqin bo'sh katak. */
export function entryCell(g: Grid, p: P, face?: number, extra?: Set<number>): number {
  const i0 = cellIndex(p);
  if (walkable(g, i0, extra)) return i0;
  if (face !== undefined) {
    const fx = Math.sin(face), fz = Math.cos(face);
    for (const [ax, az] of [[fx, fz], [-fx, -fz], [fz, -fx], [-fz, fx]]) {
      for (const d of [0.6, 0.8, 1.0, 1.2, 1.4]) {
        const i = cellIndex({ x: p.x + ax * d, z: p.z + az * d });
        if (walkable(g, i, extra)) return i;
      }
    }
  }
  const { c, r } = cellOf(p);
  for (let rad = 1; rad < 14; rad++) {
    let best = -1, bd = Infinity;
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const cc = c + dc, rr = r + dr;
        if (cc <= 0 || rr <= 0 || cc >= g.cols - 1 || rr >= g.rows - 1) continue;
        const i = rr * g.cols + cc;
        if (!walkable(g, i, extra)) continue;
        const q = cellCenter(i), d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bd) { bd = d; best = i; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Kesma bosib o'tadigan BARCHA kataklar bo'shmi (Amanatides–Woo; aniq burchakdan o'tsa — ikki qo'shni ham tekshiriladi). */
export function lineFree(g: Grid, a: P, b: P, extra?: Set<number>): boolean {
  let { c, r } = cellOf(a);
  const e = cellOf(b);
  const ok = (cc: number, rr: number) => cc >= 0 && rr >= 0 && cc < g.cols && rr < g.rows && walkable(g, rr * g.cols + cc, extra);
  if (!ok(c, r)) return false;
  const dx = b.x - a.x, dz = b.z - a.z;
  const sc = dx > 0 ? 1 : -1, sr = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? CELL / Math.abs(dx) : Infinity, tdz = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
  let tx = dx !== 0 ? (BOUNDS.x0 + (c + (dx > 0 ? 1 : 0)) * CELL - a.x) / dx : Infinity;
  let tz = dz !== 0 ? (BOUNDS.z0 + (r + (dz > 0 ? 1 : 0)) * CELL - a.z) / dz : Infinity;
  for (let guard = 0; (c !== e.c || r !== e.r) && guard < 4 * (g.cols + g.rows); guard++) {
    if (Math.min(tx, tz) > 1 + 1e-9) break;
    if (Math.abs(tx - tz) < 1e-9) {
      if (!ok(c + sc, r) || !ok(c, r + sr)) return false;
      c += sc; r += sr; tx += tdx; tz += tdz;
    } else if (tx < tz) { c += sc; tx += tdx; } else { r += sr; tz += tdz; }
    if (!ok(c, r)) return false;
  }
  return true;
}

export interface PathOpts {
  /** Vaqtinchalik band kataklar (boshqa agentlar turgan joy). */
  extra?: Set<number>;
  /** Boshlanish/oxirgi nuqta o'rindiq bo'lsa — agent qaysi tomonga qaragan (kirish tomoni shundan). */
  fromFace?: number; toFace?: number;
}

/**
 * A* (8 yo'nalish, burchak kesilmaydi) + silliqlash. Natija: [from, (kirish katagi), ..., (kirish katagi), to].
 * from/to o'rindiqda (to'siq ichida) bo'lsa, birinchi/oxirgi qisqa bo'lak — o'rindiqqa o'tirish/turish. Yo'l topilmasa — null
 * (agent devor yoki mebel orqali to'g'ri chiziqda yurib ketmaydi).
 */
export function findPath(g: Grid, from: P, to: P, opts: PathOpts = {}): P[] | null {
  const { extra } = opts;
  const si = entryCell(g, from, opts.fromFace, extra), ei = entryCell(g, to, opts.toFace, extra);
  if (si < 0 || ei < 0) return null;
  const N = g.cols * g.rows;
  const gs = new Float32Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const fs = new Float32Array(N).fill(Infinity);
  const ec = ei % g.cols, er = Math.floor(ei / g.cols);
  const h = (i: number) => {
    const dc = Math.abs((i % g.cols) - ec), dr = Math.abs(Math.floor(i / g.cols) - er);
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
        if (closed[ni] || !walkable(g, ni, extra)) continue;
        // Diagonalda burchak kesilmasin
        if (dr && dc && (!walkable(g, cr * g.cols + nc, extra) || !walkable(g, nr * g.cols + cc, extra))) continue;
        const ng = gs[cur] + (dr && dc ? Math.SQRT2 : 1);
        if (ng < gs[ni]) { gs[ni] = ng; fs[ni] = ng + h(ni); parent[ni] = cur; push(ni); }
      }
    }
  }
  if (!found) return null;
  const cells: P[] = [];
  for (let i = ei; i !== -1; i = parent[i]) { cells.push(cellCenter(i)); if (i === si) break; }
  cells.reverse();
  // Bo'sh qism: nuqta bo'sh katakda bo'lsa — o'zi, aks holda (o'rindiq) kirish katagi markazi
  const fromFree = walkable(g, cellIndex(from), extra), toFree = walkable(g, cellIndex(to), extra);
  const raw = [fromFree ? from : cells[0], ...cells.slice(1, -1), toFree ? to : cells[cells.length - 1]];
  // Silliqlash: ko'rinish chizig'i bo'yicha keraksiz nuqtalarni tashlab ketish
  const out: P[] = [raw[0]];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && !lineFree(g, raw[i], raw[j], extra)) j--;
    out.push(raw[j]);
    i = j;
  }
  if (!fromFree) out.unshift(from);
  if (!toFree) out.push(to);
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
