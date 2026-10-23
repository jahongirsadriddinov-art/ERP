import { CINEMA, COFFEE_SPOTS, COOLER, GAME, KITCHEN, KITCHEN_SEATS, LOUNGE, MANAGER_DOOR, MANAGER_ROOM, OWNER, ROOMS, doorPoint, type P, type ZoneKey } from "./layout";

// AI ofis — "Ofisga kirish" (yurish rejimi) uchun umumiy turlar: DOM (AiOffice) ↔ sahna (Player) ko'prigi.
export type SeatKind = "cinema" | "game" | "kitchen" | "lounge" | "computer";
export interface SeatTarget { kind: "seat"; seat: SeatKind; x: number; z: number; face: number; key: string }
export type Target = { kind: "agent"; id: string; name: string } | SeatTarget | { kind: "tea"; key: string };
export type WalkCmd =
  | { type: "goto"; key: string; x: number; z: number; face: number; stop?: number }
  | { type: "gotoAgent"; id: string }
  | { type: "sit"; target: SeatTarget }
  | { type: "stand" };

export interface WalkInput {
  /** Harakat: mx — o'ngga (+), mz — oldinga (+), [-1..1]. */
  mx: number; mz: number;
  /** Qarash (piksel, yig'iladi; sahna har kadrda o'qib nolga tushiradi). */
  lookX: number; lookY: number;
  /** Kamera masofasi (g'ildirak bilan), 1.8 … 9 m. */
  zoom: number;
  run: boolean;
  /** Birinchi shaxs ko'rinishi (V). */
  fp: boolean;
}
export interface WalkBridge {
  input: WalkInput;
  cmds: WalkCmd[];
  onNear: (t: Target | null) => void;
  onSeat: (s: SeatKind | null) => void;
  /** O'yinchi joylashuvi (~4 marta/s) — DOM'da data-pos (testlar va mini-xarita uchun). */
  onPos?: (x: number, z: number) => void;
}
export const newBridge = (onNear: WalkBridge["onNear"], onSeat: WalkBridge["onSeat"]): WalkBridge => ({
  input: { mx: 0, mz: 0, lookX: 0, lookY: 0, zoom: 4.2, run: false, fp: false }, cmds: [], onNear, onSeat,
});

const towards = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
/** O'yinchi o'tira oladigan joylar. */
export const SEATS: SeatTarget[] = [
  ...CINEMA.bags.map(([x, z], i): SeatTarget => ({ kind: "seat", seat: "cinema", x, z, face: Math.PI, key: `cinema${i}` })),
  ...GAME.seats.map((x, i): SeatTarget => ({ kind: "seat", seat: "game", x, z: GAME.seatZ, face: Math.PI, key: `game${i}` })),
  ...KITCHEN_SEATS.map((s, i): SeatTarget => ({ kind: "seat", seat: "kitchen", x: s.x, z: s.z, face: towards(s.x, s.z, KITCHEN.table.x, KITCHEN.table.z), key: `kitchen${i}` })),
  ...LOUNGE.seats.map((x, i): SeatTarget => ({ kind: "seat", seat: "lounge", x, z: LOUNGE.seatZ, face: Math.PI, key: `lounge${i}` })),
  { kind: "seat", seat: "computer", x: OWNER.chair.x, z: OWNER.chair.z, face: 0, key: "computer" },
];
/** Choy/kofe olish joylari (kofe mashinasi, plita yoni, suv kuleri). */
export const TEA_SPOTS: P[] = [...COFFEE_SPOTS, { x: COOLER.x - 0.85, z: COOLER.z }];
export const PLAYER_START = { x: OWNER.chair.x, z: OWNER.chair.z - 2.6, face: Math.PI };

/** "Qayerga borish" menyusi: joylar (eshik orqasidagi nuqta) — yo'l A* bilan topiladi. */
export function places(): { key: string; zone: ZoneKey | "computer"; x: number; z: number; face: number; stop?: number }[] {
  const inside = (key: ZoneKey) => {
    const r = ROOMS.find((x) => x.key === key)!;
    const d = r.doors.find((x) => x.side === "n") || r.doors[0];
    if (!d) return { x: (r.rect.x0 + r.rect.x1) / 2, z: (r.rect.z0 + r.rect.z1) / 2 };
    const p = doorPoint(r, d);
    return { x: p.x, z: p.z + (d.side === "n" ? 1.0 : -1.0) };
  };
  const out: ReturnType<typeof places> = [
    { key: "computer", zone: "computer", x: OWNER.chair.x, z: OWNER.chair.z - 1.0, face: 0 },
    { key: "kitchen", zone: "kitchen", x: KITCHEN.table.x + 2.3, z: KITCHEN.table.z - 1.6, face: Math.PI },
    { key: "game", zone: "game", x: 5.2, z: -13.2, face: -Math.PI / 2 },
    { key: "cinema", zone: "cinema", x: CINEMA.screen.x, z: -9.6, face: Math.PI },
    { key: "lounge", zone: "lounge", x: 23, z: 14, face: 0 },
    { key: "lead", zone: "lead", x: (MANAGER_DOOR.x0 + MANAGER_DOOR.x1) / 2, z: MANAGER_ROOM.z1 - 1.2, face: Math.PI },
  ];
  for (const k of ["dev", "call", "design", "secqa", "marketing", "finance", "support"] as ZoneKey[]) out.push({ key: k, zone: k, ...inside(k), face: 0 });
  return out;
}
export const GAME_TV = GAME.tv;

/** Sichqoncha/barmoq sezgirligi (0.4 … 2.5) — eslab qolinadi. */
export const SENS_KEY = "aiOffice.sens";
export const readSens = () => { try { const v = Number(localStorage.getItem(SENS_KEY)); return v >= 0.4 && v <= 2.5 ? v : 1; } catch { return 1; } };
