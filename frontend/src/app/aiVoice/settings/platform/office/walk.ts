import { CINEMA, COOLER, GAME, KITCHEN, KITCHEN_SEATS, LOUNGE, OWNER, ROOMS, doorPoint, type P, type ZoneKey } from "./layout";

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
  run: boolean;
  /** Birinchi shaxs ko'rinishi (V). */
  fp: boolean;
}
export interface WalkBridge {
  input: WalkInput;
  cmds: WalkCmd[];
  onNear: (t: Target | null) => void;
  onSeat: (s: SeatKind | null) => void;
}
export const newBridge = (onNear: WalkBridge["onNear"], onSeat: WalkBridge["onSeat"]): WalkBridge => ({
  input: { mx: 0, mz: 0, lookX: 0, lookY: 0, run: false, fp: false }, cmds: [], onNear, onSeat,
});

const towards = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
/** O'yinchi o'tira oladigan joylar. */
export const SEATS: SeatTarget[] = [
  ...CINEMA.bags.map(([x, z], i): SeatTarget => ({ kind: "seat", seat: "cinema", x, z, face: Math.PI, key: `cinema${i}` })),
  ...[1.2, 2.6, 4.0].map((x, i): SeatTarget => ({ kind: "seat", seat: "game", x, z: -10.85, face: Math.PI, key: `game${i}` })),
  ...KITCHEN_SEATS.map((s, i): SeatTarget => ({ kind: "seat", seat: "kitchen", x: s.x, z: s.z, face: towards(s.x, s.z, KITCHEN.table.x, KITCHEN.table.z), key: `kitchen${i}` })),
  ...LOUNGE.seats.map((x, i): SeatTarget => ({ kind: "seat", seat: "lounge", x, z: 14.0, face: Math.PI, key: `lounge${i}` })),
  { kind: "seat", seat: "computer", x: OWNER.chair.x, z: OWNER.chair.z, face: 0, key: "computer" },
];
/** Choy/kofe olish joylari (kofe mashinasi, plita yoni, suv kuleri). */
export const TEA_SPOTS: P[] = [{ x: KITCHEN.coffee.x, z: -13.3 }, { x: -7.4, z: -13.3 }, { x: COOLER.x - 0.85, z: COOLER.z }];
export const PLAYER_START = { x: 12, z: 9.2, face: Math.PI };

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
    { key: "kitchen", zone: "kitchen", x: -10.2, z: -12.3, face: Math.PI },
    { key: "game", zone: "game", x: 5.9, z: -11.2, face: -Math.PI / 2 },
    { key: "cinema", zone: "cinema", x: 15.5, z: -7.6, face: Math.PI },
    { key: "lounge", zone: "lounge", x: 18, z: 10.5, face: 0 },
    { key: "lead", zone: "lead", x: -15.3, z: -8.6, face: Math.PI },
  ];
  for (const k of ["dev", "call", "design", "secqa", "marketing", "finance", "support"] as ZoneKey[]) out.push({ key: k, zone: k, ...inside(k), face: 0 });
  return out;
}
export const GAME_TV = GAME.tv;
