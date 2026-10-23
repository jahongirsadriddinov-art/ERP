// AI ofis — sof joylashuv va yo'l topish (three.js'siz, unit test qilinadi). Koordinatalar: x — chap/o'ng, z — yuqori/past
// (tepadan qaraganda), birlik ≈ 1 metr. Pol: x ∈ [-26, 26], z ∈ [-18, 20] (owner 2026-10-23: kengroq — yo'laklar 3 m, eshiklar 2.6 m).
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

export const BOUNDS: Rect = { x0: -26, z0: -18, x1: 26, z1: 20 };
export const DESK_W = 1.6;
export const DESK_D = 0.8;
/** Stol ustunlari orasidagi masofa — stullar orasida ≥ 2 katak yo'lak qoladi. */
const COL = 2.3;
/** Stul markazi stol markazidan qancha uzoqda. */
export const CHAIR_OFF = 0.9;
/** Juft stol qatorlari orasidagi masofa — orqama-orqa stullar orasida ≥ 2 katak yo'lak qoladi. */
export const PAIR = 5.2;
export const WALL_T = 0.06;
/** Eshik kengligi (≥ 2 katak bo'sh o'tish joyi — ikki tomonlama harakat). */
const DOOR = 2.6;

/** Boshliq kabineti (orqa chap burchak, shisha devorlar; eshik — pastki devorda). */
export const MANAGER_ROOM: Rect = { x0: -26, z0: -18, x1: -17, z1: -9 };
export const MANAGER_DOOR = { x0: -21.3, x1: -18.7 };
export const MANAGER_DESK: P = { x: -21.6, z: -14.2 };
export const MANAGER_FURN = {
  sofa: { x0: -25.6, z0: -13.6, x1: -24.7, z1: -11.0 } as Rect, table: { x0: -24.2, z0: -12.85, x1: -23.4, z1: -11.75 } as Rect,
  shelf: { x0: -19.6, z0: -17.85, x1: -18.2, z1: -17.35 } as Rect,
};

/** Yo'laklar: orqa (dam olish qatori ↔ xonalar) va o'rta — 3 m (≥ 4 katak bo'sh). */
export const CORRIDORS = [{ z0: -9, z1: -6 }, { z0: 6.6, z1: 9.6 }];
/** Xonalar orasidagi tik o'tish yo'laklari (orqa ↔ o'rta yo'lak), 3 m. */
export const HALLWAYS = [{ x0: -9, x1: -6 }, { x0: 17, x1: 20 }];
const ROW_A = { z0: -6, z1: 6.6 };
const ROW_B = { z0: 9.6, z1: 20 };
export const ROOMS: Room[] = [
  { key: "lead", rect: MANAGER_ROOM, doors: [{ side: "s", at: (MANAGER_DOOR.x0 + MANAGER_DOOR.x1) / 2, w: MANAGER_DOOR.x1 - MANAGER_DOOR.x0 }], walls: true, glass: true },
  { key: "kitchen", rect: { x0: -17, z0: -18, x1: -5, z1: -9 }, doors: [], walls: false },
  { key: "game", rect: { x0: -5, z0: -18, x1: 8, z1: -9 }, doors: [], walls: false },
  { key: "cinema", rect: { x0: 8, z0: -18, x1: 26, z1: -9 }, doors: [], walls: false },
  { key: "dev", rect: { x0: -26, z0: ROW_A.z0, x1: -9, z1: ROW_A.z1 }, doors: [{ side: "n", at: -13, w: DOOR }, { side: "s", at: -19, w: DOOR }], walls: true },
  { key: "call", rect: { x0: -6, z0: ROW_A.z0, x1: 11, z1: ROW_A.z1 }, doors: [{ side: "n", at: 3, w: DOOR }, { side: "s", at: -1, w: DOOR }], walls: true },
  { key: "design", rect: { x0: 11, z0: ROW_A.z0, x1: 17, z1: ROW_A.z1 }, doors: [{ side: "n", at: 14, w: DOOR }, { side: "s", at: 14, w: DOOR }], walls: true },
  { key: "secqa", rect: { x0: 20, z0: ROW_A.z0, x1: 26, z1: ROW_A.z1 }, doors: [{ side: "n", at: 23, w: DOOR }, { side: "s", at: 23, w: DOOR }], walls: true },
  { key: "marketing", rect: { x0: -26, z0: ROW_B.z0, x1: -13, z1: ROW_B.z1 }, doors: [{ side: "n", at: -19.5, w: DOOR }], walls: true },
  { key: "finance", rect: { x0: -13, z0: ROW_B.z0, x1: 0, z1: ROW_B.z1 }, doors: [{ side: "n", at: -6.5, w: DOOR }], walls: true },
  { key: "support", rect: { x0: 0, z0: ROW_B.z0, x1: 13, z1: ROW_B.z1 }, doors: [{ side: "n", at: 6.5, w: DOOR }], walls: true },
  { key: "owner", rect: { x0: 13, z0: ROW_B.z0, x1: 20, z1: ROW_B.z1 }, doors: [{ side: "n", at: 16.5, w: DOOR }], walls: true, glass: true },
  { key: "lounge", rect: { x0: 20, z0: ROW_B.z0, x1: 26, z1: ROW_B.z1 }, doors: [], walls: false },
];
/** Eshik zonalari (navbat uchun): eshik bo'shlig'i bo'ylab ± 1.1 m. */
export const doorZones = (): Rect[] => ROOMS.flatMap((r) => r.doors.map((d) => { const p = doorPoint(r, d); return { x0: d.at - d.w / 2 - 0.2, z0: p.z - 1.1, x1: d.at + d.w / 2 + 0.2, z1: p.z + 1.1 }; }));
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
  counter: { x0: -15.8, z0: -17.95, x1: -7.4, z1: -16.95 } as Rect, fridge: { x: -6.5, z: -17.4 },
  table: { x: -11.5, z: -12.6, r: 1.0 }, coffee: { x: -14.8, z: -17.45 },
};
export const STOVE: P = { x: -12.8, z: -17.45 };
export const SINK: P = { x: -9.2, z: -17.45 };
export const MICROWAVE: P = { x: -11.0, z: -17.5 };
/** Oshpaz (NPC) plita oldida ishlaydi. */
export const COOK: P = { x: -12.8, z: -16.3 };
/** Oshxona stoli atrofidagi 4 ta stul. */
export const KITCHEN_SEATS: P[] = [0, 1, 2, 3].map((i) => {
  const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
  return { x: KITCHEN.table.x + Math.cos(ang) * 1.45, z: KITCHEN.table.z + Math.sin(ang) * 1.45 };
});
/** Kofe olish joylari (kofe mashinasi va rakovina yonida). */
export const COFFEE_SPOTS: P[] = [{ x: KITCHEN.coffee.x, z: -16.2 }, { x: -9.6, z: -16.2 }];
/** Oshxonada tik turib choy ichish joylari. */
export const KITCHEN_STANDS: P[] = [{ x: -15.6, z: -11.0 }, { x: -7.2, z: -11.0 }, { x: -7.0, z: -14.0 }, { x: -15.8, z: -14.0 }];
export const GAME = {
  tv: { x: 1, z: -17.55 }, stand: { x0: -0.6, z0: -17.95, x1: 2.6, z1: -17.05 } as Rect,
  sofa: { x0: -1.4, z0: -14.0, x1: 3.4, z1: -13.0 } as Rect, table: { x0: 0, z0: -16.1, x1: 2, z1: -15.45 } as Rect,
  seats: [-0.4, 1.0, 2.4] as number[], seatZ: -13.55, standZ: -11.0,
};
export const CINEMA = {
  screen: { x: 17, z: -17.75, w: 9 },
  bags: [[12.6, -14.6], [14.9, -14.6], [17.2, -14.6], [19.5, -14.6], [21.8, -14.6], [13.75, -12.2], [16.05, -12.2], [18.35, -12.2], [20.65, -12.2]] as [number, number][],
  stands: [13, 15.6, 18.2, 20.8] as number[], standZ: -10.2, popcorn: { x: 25.2, z: -13.4 } as P,
};
/** Old o'ng burchak — ochiq dam olish joyi: divan, kofe stolchasi, suv kuleri. */
export const LOUNGE = {
  sofa: { x0: 21, z0: 18.6, x1: 25, z1: 19.6 } as Rect, table: { x0: 21.8, z0: 16.6, x1: 24.2, z1: 17.3 } as Rect,
  seats: [21.7, 23, 24.3] as number[], seatZ: 19.0,
};
/** Egasining shaxsiy kabineti ("Mening ofisim"): kompyuterli stol — o'yinchi o'tirsa, kompyuter ochiladi. */
export const OWNER = { desk: { x: 16.5, z: 17.7 } as P, chair: { x: 16.5, z: 16.75 } as P, shelf: { x0: 13.3, z0: 18.5, x1: 13.8, z1: 19.8 } as Rect, lamp: { x: 19.3, z: 11.0 } as P };
export const COOLER: P = { x: 25.45, z: 12.0 };
export const PLANTS: P[] = [
  { x: -4.6, z: -17.4 }, { x: 7.4, z: -17.4 }, { x: 25.3, z: -17.3 }, { x: 25.3, z: -9.8 }, { x: -16.4, z: -9.7 },
  { x: 25.4, z: 19.4 }, { x: 20.7, z: 10.3 }, { x: 19.3, z: 19.4 },
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
    // Yon yo'laklar ≥ 2 m (ikki tomonlama harakat) — ustunlar soni shunga qarab
    const maxCols = Math.max(1, Math.floor((R.x1 - R.x0 - 4.4) / COL));
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
  obstacles.push({ x0: CINEMA.screen.x - CINEMA.screen.w / 2 - 0.6, z0: BOUNDS.z0, x1: CINEMA.screen.x + CINEMA.screen.w / 2 + 0.6, z1: CINEMA.screen.z + 0.35 });
  obstacles.push(LOUNGE.sofa, LOUNGE.table, OWNER.shelf, around(OWNER.desk, 0.95, 0.45), around(OWNER.chair, 0.28, 0.26));
  for (const p of PLANTS) obstacles.push(around(p, 0.35, 0.35));
  // O'tiriladigan joylar ham to'siq (agent ularning ustidan yurmaydi; o'z o'rindig'iga faqat oxirgi qadamda kiradi)
  for (const d of desks.values()) obstacles.push(around(d.chair, 0.28, 0.26));
  for (const s of KITCHEN_SEATS) obstacles.push(around(s, 0.24, 0.24));
  for (const [x, z] of CINEMA.bags) obstacles.push(around({ x, z: z - 0.1 }, 0.5, 0.5));
  // Boshliq kabineti mebeli (divan, stolcha, kubok javoni), popkorn, suv kuleri, oshpaz
  obstacles.push(MANAGER_FURN.sofa, MANAGER_FURN.table, MANAGER_FURN.shelf);
  obstacles.push(around(CINEMA.popcorn, 0.4, 0.4), around(COOLER, 0.3, 0.3), around(COOK, 0.32, 0.3));

  const tv = GAME.tv;
  const pois: Poi[] = [
    ...KITCHEN_SEATS.map(({ x, z }): Poi => ({ kind: "kitchen", pose: "sit", x, z, face: towards(x, z, t.x, t.z) })),
    ...COFFEE_SPOTS.map(({ x, z }): Poi => ({ kind: "kitchen", pose: "coffee", x, z, face: Math.PI })),
    ...KITCHEN_STANDS.map(({ x, z }): Poi => ({ kind: "kitchen", pose: "stand", x, z, face: towards(x, z, t.x, t.z) })),
    ...GAME.seats.map((x): Poi => ({ kind: "game", pose: "game", x, z: GAME.seatZ, face: Math.PI })),
    { kind: "game", pose: "stand", x: 4.8, z: -15.0, face: towards(4.8, -15.0, tv.x, tv.z) },
    // Tik turib tomosha qiluvchilar — bir-biridan ≥ 3 m (orasidan bemalol o'tiladi)
    ...[GAME.seats[0] - 0.2, GAME.seats[2] + 0.2].map((x): Poi => ({ kind: "game", pose: "stand", x, z: GAME.standZ, face: Math.PI })),
    ...CINEMA.bags.map(([x, z]): Poi => ({ kind: "cinema", pose: "beanbag", x, z, face: Math.PI })),
    ...CINEMA.stands.map((x): Poi => ({ kind: "cinema", pose: "stand", x, z: CINEMA.standZ, face: Math.PI })),
    ...LOUNGE.seats.map((x): Poi => ({ kind: "lounge", pose: "sit", x, z: LOUNGE.seatZ, face: Math.PI })),
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
  /** Katak narxi (A*): xonalar ichi qimmatroq — begona xona orqali "qisqa yo'l" qilinmaydi, yo'laklardan yuriladi. */
  cost: Float32Array;
  /** "O'ng tomondan yurish" yo'laklari: tik o'tish yo'lagining o'rta x'i / gorizontal yo'lakning o'rta z'i (yo'q — NaN). */
  laneX: Float32Array; laneZ: Float32Array;
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
  const cost = new Float32Array(COLS * ROWS).fill(1);
  for (const r of ROOMS) {
    if (!r.walls) continue;
    for (let rr = 0; rr < ROWS; rr++) for (let c = 0; c < COLS; c++) {
      const x = BOUNDS.x0 + (c + 0.5) * CELL, z = BOUNDS.z0 + (rr + 0.5) * CELL;
      if (x > r.rect.x0 && x < r.rect.x1 && z > r.rect.z0 && z < r.rect.z1) cost[rr * COLS + c] = 2.5;
    }
  }
  const laneX = new Float32Array(COLS * ROWS).fill(NaN), laneZ = new Float32Array(COLS * ROWS).fill(NaN);
  for (let rr = 0; rr < ROWS; rr++) for (let c = 0; c < COLS; c++) {
    const x = BOUNDS.x0 + (c + 0.5) * CELL, z = BOUNDS.z0 + (rr + 0.5) * CELL;
    for (const h of HALLWAYS) if (x > h.x0 && x < h.x1 && z > CORRIDORS[0].z0 && z < CORRIDORS[1].z1) laneX[rr * COLS + c] = (h.x0 + h.x1) / 2;
    for (const k of CORRIDORS) if (z > k.z0 && z < k.z1) laneZ[rr * COLS + c] = (k.z0 + k.z1) / 2;
  }
  return { blocked, cols: COLS, rows: ROWS, main, cost, laneX, laneZ };
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
        // Yo'laklarda "o'ngdan yurish": qarama-qarshi oqimlar bir-biriga yuzma-yuz kelmaydi
        let lane = 1;
        if (g.laneX) {
          const lx = g.laneX[ni], lz = g.laneZ[ni];
          const x = BOUNDS.x0 + (nc + 0.5) * CELL, z = BOUNDS.z0 + (nr + 0.5) * CELL;
          if (lx === lx && dr) lane = (dr > 0 ? x > lx : x < lx) ? 1.6 : 1;
          else if (lz === lz && dc) lane = (dc > 0 ? z < lz : z > lz) ? 1.6 : 1;
        }
        const ng = gs[cur] + (dr && dc ? Math.SQRT2 : 1) * (g.cost ? g.cost[ni] : 1) * lane;
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

/** Har dam olish joyiga bir vaqtda ko'pi bilan nechta agent (tiqilinch bo'lmasin): oshxona 6, PlayStation 4, kino — puflar soni. */
export const POI_CAPS: Record<Poi["kind"], number> = { kitchen: 6, game: 4, cinema: CINEMA.bags.length, lounge: 4 };

/** Bo'sh agent qayerda dam oladi: har ~45 s o'zgaradi; bitta joyga ikki agent tushmaydi; har zona sig'imi cheklangan (qolganlar stolida). */
export function assignIdle(idleIds: string[], pois: Poi[], slot: number, caps: Partial<Record<Poi["kind"], number>> = POI_CAPS): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  const used: Record<string, number> = {};
  const sorted = [...idleIds].sort((a, b) => hash(`${a}:${slot}`) - hash(`${b}:${slot}`));
  for (const id of sorted) {
    let k = hash(`${id}#${slot}`) % pois.length;
    let found = -1;
    for (let n = 0; n < pois.length; n++, k = (k + 1) % pois.length) {
      const kind = pois[k].kind;
      if (taken.has(k) || (used[kind] || 0) >= (caps[kind] ?? Infinity)) continue;
      found = k; break;
    }
    if (found < 0) continue;
    taken.add(found);
    used[pois[found].kind] = (used[pois[found].kind] || 0) + 1;
    out.set(id, found);
  }
  return out;
}
