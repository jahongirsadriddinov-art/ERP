import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Html, Instance, Instances } from "@react-three/drei";
import * as THREE from "three";
import type { OfficeAgent } from "./officeApi";
import {
  BOUNDS, CINEMA, COOK, COOLER, GAME, KITCHEN, KITCHEN_SEATS, LOUNGE, MANAGER_DESK, MICROWAVE, OWNER, PLANTS, SINK, STOVE, doorPoint,
  type Desk, type Room, type Wall, type ZoneKey,
} from "./layout";
import { SCREEN_KINDS, screenKindOf, type ScreenHub, type ScreenKind } from "./screens";

// AI ofis — statik sahna: bino, xonalar (pol rangi, devor, eshik, lavha), mebel, oshxona, PlayStation, kino, dam olish
// burchagi, egasining kabineti, soat, suv kuleri, oshpaz. Takrorlanadigan narsalar — instancing (stollar, stullar, monitorlar).

export const CLAUDE = "#D97757";
export const EYE = "#1d1410";
export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
export const SPHERE = new THREE.SphereGeometry(0.5, 18, 12);
const ICO = new THREE.IcosahedronGeometry(0.5, 0);
export const mix = (a: string, b: string, t: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

/** Xona pol rangi va lavha rangi. */
export const ZONE_COLOR: Record<ZoneKey, { floor: string; sign: string }> = {
  lead: { floor: "#f6dccf", sign: CLAUDE }, dev: { floor: "#dfe5fb", sign: "#6366f1" }, call: { floor: "#d6f1ec", sign: "#0d9488" },
  design: { floor: "#fbe0ee", sign: "#ec4899" }, secqa: { floor: "#fde3e1", sign: "#ef4444" }, marketing: { floor: "#fdebd3", sign: "#f97316" },
  finance: { floor: "#dcf2e2", sign: "#059669" }, support: { floor: "#dbeefa", sign: "#0ea5e9" }, kitchen: { floor: "#f3ead8", sign: "#9fc3b6" },
  game: { floor: "#dfe6f2", sign: "#3fa7a0" }, cinema: { floor: "#2f3442", sign: "#9b2335" }, lounge: { floor: "#efe7dc", sign: "#a3a3a3" },
  owner: { floor: "#f7ecd0", sign: "#f2c14e" },
};
const WALL_H = 1.1;

export const Box = ({ p, s, c, r, cast = false, recv = false, e, ei = 1, rough = 0.85, metal = 0, o }: {
  p: [number, number, number]; s: [number, number, number]; c: string; r?: [number, number, number]; cast?: boolean; recv?: boolean;
  e?: string; ei?: number; rough?: number; metal?: number; o?: number;
}) => (
  <mesh geometry={BOX} position={p} scale={s} rotation={r} castShadow={cast} receiveShadow={recv}>
    <meshStandardMaterial color={c} roughness={rough} metalness={metal} emissive={e || "#000"} emissiveIntensity={e ? ei : 0}
      transparent={o !== undefined} opacity={o ?? 1} />
  </mesh>
);

export function Building({ hub }: { hub: ScreenHub }) {
  const B = BOUNDS;
  const w = B.x1 - B.x0, d = B.z1 - B.z0, cz = (B.z0 + B.z1) / 2;
  return (
    <group>
      {/* Pol plitasi (diorama) */}
      <Box p={[0, -0.25, cz]} s={[w + 1, 0.5, d + 1]} c="#efe6da" recv />
      <Box p={[0, -0.75, cz]} s={[w + 1.2, 0.5, d + 1.2]} c="#cdbfae" />
      {/* Orqa va chap devorlar (kesma ko'rinish) */}
      <Box p={[0, 1.4, B.z0 - 0.35]} s={[w + 1, 2.8, 0.3]} c="#f8f3ec" recv />
      <Box p={[B.x0 - 0.35, 1.4, cz]} s={[0.3, 2.8, d + 1]} c="#f3ede4" recv />
      <Box p={[0, 2.82, B.z0 - 0.35]} s={[w + 1, 0.06, 0.34]} c={CLAUDE} />
      <Box p={[B.x0 - 0.35, 2.82, cz]} s={[0.34, 0.06, d + 1]} c={CLAUDE} />
      {/* Derazalar — osmon (bulutlar asta suzadi) */}
      {[-17.2, -8.6, 6.4, 15.4].map((x) => (
        <group key={x} position={[x, 2.3, B.z0 - 0.18]}>
          <Box p={[0, 0, -0.01]} s={[x === 15.4 ? 3.2 : 4.8, 0.7, 0.04]} c="#e9e2d8" />
          <mesh><planeGeometry args={[x === 15.4 ? 3 : 4.6, 0.55]} /><meshBasicMaterial map={hub.sky} toneMapped={false} /></mesh>
          <Box p={[0, 0, 0.02]} s={[0.04, 0.55, 0.02]} c="#e9e2d8" />
        </group>
      ))}
      {[-11, -1, 9].map((z) => (
        <group key={z} position={[B.x0 - 0.18, 2.3, z]} rotation={[0, Math.PI / 2, 0]}>
          <Box p={[0, 0, -0.01]} s={[3.2, 0.7, 0.04]} c="#e9e2d8" />
          <mesh><planeGeometry args={[3, 0.55]} /><meshBasicMaterial map={hub.sky} toneMapped={false} /></mesh>
        </group>
      ))}
      <WallClock position={[-1.4, 2.25, B.z0 - 0.18]} />
      {/* Chap devordagi neon logotip */}
      <group position={[B.x0 - 0.18, 1.7, 3]} rotation={[0, Math.PI / 2, 0]}>
        <Box p={[0, 0, 0]} s={[2.2, 1.0, 0.04]} c="#f7efe6" />
        <Box p={[-0.45, 0, 0.03]} s={[0.7, 0.42, 0.03]} c={CLAUDE} e={CLAUDE} ei={0.5} />
        <Box p={[-0.6, 0.06, 0.05]} s={[0.07, 0.14, 0.02]} c={EYE} />
        <Box p={[-0.3, 0.06, 0.05]} s={[0.07, 0.14, 0.02]} c={EYE} />
        <Box p={[0.5, 0.08, 0.03]} s={[0.8, 0.08, 0.02]} c="#3a3f4b" />
        <Box p={[0.4, -0.1, 0.03]} s={[0.6, 0.06, 0.02]} c="#9b8f84" />
      </group>
    </group>
  );
}

/** Devor soati — haqiqiy vaqtni ko'rsatadi (millar sekundiga bir marta yangilanadi). */
function WallClock({ position }: { position: [number, number, number] }) {
  const h = useRef<THREE.Group>(null), m = useRef<THREE.Group>(null), s = useRef<THREE.Group>(null);
  const last = useRef(-1);
  useFrame(() => {
    const now = new Date();
    const sec = now.getSeconds();
    if (sec === last.current) return;
    last.current = sec;
    const mm = now.getMinutes() + sec / 60, hh = (now.getHours() % 12) + mm / 60;
    if (h.current) h.current.rotation.z = -(hh / 12) * Math.PI * 2;
    if (m.current) m.current.rotation.z = -(mm / 60) * Math.PI * 2;
    if (s.current) s.current.rotation.z = -(sec / 60) * Math.PI * 2;
  });
  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.36, 0.36, 0.05, 32]} /><meshStandardMaterial color="#2b2d33" /></mesh>
      <mesh position={[0, 0, 0.03]}><circleGeometry args={[0.32, 32]} /><meshBasicMaterial color="#fbf8f3" /></mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} position={[Math.sin((i / 12) * Math.PI * 2) * 0.27, Math.cos((i / 12) * Math.PI * 2) * 0.27, 0.035]}>
          <boxGeometry args={[0.025, i % 3 ? 0.03 : 0.06, 0.005]} /><meshBasicMaterial color="#2b2d33" />
        </mesh>
      ))}
      <group position={[0, 0, 0.04]}>
        <group ref={h}><mesh position={[0, 0.08, 0]}><boxGeometry args={[0.035, 0.16, 0.01]} /><meshBasicMaterial color="#1d1d1f" /></mesh></group>
        <group ref={m}><mesh position={[0, 0.12, 0.005]}><boxGeometry args={[0.025, 0.24, 0.01]} /><meshBasicMaterial color="#1d1d1f" /></mesh></group>
        <group ref={s}><mesh position={[0, 0.12, 0.01]}><boxGeometry args={[0.01, 0.26, 0.01]} /><meshBasicMaterial color="#e5484d" /></mesh></group>
      </group>
    </group>
  );
}

/** Xonalar: rangli pol, past devorlar (shisha — Boshliq va egasi kabineti), eshik ramkasi + nomli lavha. */
export const Rooms = memo(function Rooms({ rooms, walls, names, onAir, small }: { rooms: Room[]; walls: Wall[]; names: Record<string, string>; onAir: boolean; small?: boolean }) {
  return (
    <group>
      {rooms.map((r) => {
        const R = r.rect, c = ZONE_COLOR[r.key];
        return (
          <mesh key={r.key} rotation={[-Math.PI / 2, 0, 0]} position={[(R.x0 + R.x1) / 2, 0.006, (R.z0 + R.z1) / 2]} receiveShadow>
            <planeGeometry args={[R.x1 - R.x0 - 0.1, R.z1 - R.z0 - 0.1]} />
            <meshStandardMaterial color={c.floor} roughness={1} />
          </mesh>
        );
      })}
      {/* Yo'laklar (xonalar orasida) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, -6.65]}><planeGeometry args={[42, 1.7]} /><meshStandardMaterial color="#e7ddcf" roughness={1} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 5.7]}><planeGeometry args={[42, 1.8]} /><meshStandardMaterial color="#e7ddcf" roughness={1} /></mesh>
      {walls.map((w, i) => {
        const glass = !!w.glass;
        const h = glass ? 2.4 : WALL_H;
        return (
          <group key={i}>
            <Box p={[(w.x0 + w.x1) / 2, h / 2, (w.z0 + w.z1) / 2]} s={[w.x1 - w.x0, h, w.z1 - w.z0]} c={glass ? "#cfe8fb" : "#f7f2ea"} o={glass ? 0.22 : undefined} rough={glass ? 0.1 : 0.9} cast={!glass} />
            <Box p={[(w.x0 + w.x1) / 2, h + 0.02, (w.z0 + w.z1) / 2]} s={[w.x1 - w.x0 + 0.02, 0.04, w.z1 - w.z0 + 0.06]} c={glass ? "#3a3f4b" : ZONE_COLOR[w.room].sign} />
          </group>
        );
      })}
      {rooms.flatMap((r) => r.doors.map((d, i) => {
        const p = doorPoint(r, d);
        const col = ZONE_COLOR[r.key].sign;
        return (
          <group key={`${r.key}${i}`} position={[p.x, 0, p.z]}>
            <Box p={[-d.w / 2, 1.05, 0]} s={[0.1, 2.1, 0.14]} c="#3a3f4b" />
            <Box p={[d.w / 2, 1.05, 0]} s={[0.1, 2.1, 0.14]} c="#3a3f4b" />
            <Box p={[0, 2.12, 0]} s={[d.w + 0.1, 0.36, 0.12]} c={col} e={col} ei={0.25} />
            {r.key === "call" && d.side === "n" && <Box p={[0, 2.45, 0]} s={[0.7, 0.2, 0.1]} c={onAir ? "#ff2d2d" : "#5a2020"} e={onAir ? "#ff2d2d" : undefined} ei={2.2} />}
          </group>
        );
      }))}
      {rooms.map((r) => {
        const d = r.doors.find((x) => x.side === "n") || r.doors[0];
        // Eshiksiz (ochiq) zonalar: orqa devor tepasida yoki (old qatorda) pol ustida
        const back = r.rect.z0 <= BOUNDS.z0 + 0.01;
        const p = d ? doorPoint(r, d) : { x: (r.rect.x0 + r.rect.x1) / 2, z: back ? BOUNDS.z0 - 0.3 : r.rect.z1 - 0.8 };
        return (
          <Html key={r.key} position={[p.x, d ? 2.6 : back ? 3.2 : 0.2, p.z]} center zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
            <div className="office-zone" data-testid={`ai-office-zone-${r.key}`}
              style={{
                whiteSpace: "nowrap", padding: small ? "1px 5px" : "2px 8px", borderRadius: 6, fontSize: small ? 9 : 11, fontWeight: 800, letterSpacing: 0.2, color: "#fff",
                background: ZONE_COLOR[r.key].sign, boxShadow: "0 2px 8px rgba(0,0,0,.25)", fontFamily: "inherit",
              }}>
              {r.key === "call" && <span style={{ color: onAir ? "#ffd1d1" : "rgba(255,255,255,.55)", marginRight: 5 }}>{onAir ? "● ON AIR" : "○"}</span>}
              {names[r.key] || r.key}
            </div>
          </Html>
        );
      })}
    </group>
  );
});

export function ManagerRoomFurniture() {
  return (
    <group>
      {/* Boshliq stoli — katta, yog'och */}
      <Box p={[MANAGER_DESK.x, 0.74, MANAGER_DESK.z]} s={[2.8, 0.08, 1.1]} c="#b9875f" cast recv rough={0.6} />
      <Box p={[MANAGER_DESK.x - 1.3, 0.36, MANAGER_DESK.z]} s={[0.1, 0.72, 1]} c="#2b2d33" />
      <Box p={[MANAGER_DESK.x + 1.3, 0.36, MANAGER_DESK.z]} s={[0.1, 0.72, 1]} c="#2b2d33" />
      {/* Divan va kofe stolchasi */}
      <Box p={[-19.9, 0.3, -9]} s={[0.9, 0.6, 2.6]} c="#3c4a63" cast />
      <Box p={[-20.3, 0.7, -9]} s={[0.2, 0.8, 2.6]} c="#34405a" />
      <Box p={[-18.6, 0.25, -9]} s={[0.8, 0.5, 1.1]} c="#e9e2d8" />
      {/* Kubok javoni */}
      <Box p={[-14.6, 0.9, -14.6]} s={[1.4, 1.8, 0.45]} c="#cfa77f" />
      <Box p={[-14.9, 1.95, -14.6]} s={[0.25, 0.3, 0.25]} c="#f2c14e" e="#f2c14e" ei={0.3} metal={0.6} rough={0.3} />
    </group>
  );
}

/** Egasining kabineti: katta stol, kompyuter (o'tirilsa — ish stoli ochiladi), kitob javoni, chiroq. */
export function OwnerOffice({ hub }: { hub: ScreenHub }) {
  const d = OWNER.desk, sh = OWNER.shelf;
  return (
    <group>
      <Box p={[d.x, 0.74, d.z]} s={[1.9, 0.08, 0.9]} c="#7a5638" cast recv rough={0.5} />
      <Box p={[d.x - 0.85, 0.36, d.z]} s={[0.08, 0.72, 0.8]} c="#2b2d33" />
      <Box p={[d.x + 0.85, 0.36, d.z]} s={[0.08, 0.72, 0.8]} c="#2b2d33" />
      <Box p={[d.x, 1.15, d.z + 0.22]} s={[1.1, 0.6, 0.04]} c="#1c1e23" />
      <mesh position={[d.x, 1.15, d.z + 0.195]} rotation={[0, Math.PI, 0]}><planeGeometry args={[1.02, 0.52]} /><meshBasicMaterial map={hub.textures.plan} toneMapped={false} /></mesh>
      <Box p={[d.x, 0.79, d.z - 0.12]} s={[0.55, 0.025, 0.18]} c="#e8e6e1" />
      {/* Kreslo */}
      <Box p={[OWNER.chair.x, 0.48, OWNER.chair.z]} s={[0.62, 0.1, 0.56]} c="#2b2d33" cast />
      <Box p={[OWNER.chair.x, 0.9, OWNER.chair.z - 0.3]} s={[0.6, 0.75, 0.08]} c="#2b2d33" cast />
      <Box p={[(sh.x0 + sh.x1) / 2, 0.9, (sh.z0 + sh.z1) / 2]} s={[sh.x1 - sh.x0, 1.8, sh.z1 - sh.z0]} c="#a7825d" />
      {["#e85d75", "#5b8def", "#7bd389", "#f2a541"].map((c, i) => <Box key={c} p={[(sh.x0 + sh.x1) / 2 + 0.05, 0.5 + i * 0.4, sh.z0 + 0.3 + (i % 2) * 0.4]} s={[0.3, 0.3, 0.12]} c={c} />)}
      <FloorLamp x={14.4} z={8.0} />
    </group>
  );
}

function FloorLamp({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <Box p={[0, 0.03, 0]} s={[0.36, 0.06, 0.36]} c="#2b2d33" />
      <Box p={[0, 0.8, 0]} s={[0.04, 1.6, 0.04]} c="#2b2d33" />
      <mesh position={[0, 1.65, 0]} geometry={CYL} scale={[0.42, 0.3, 0.42]}><meshStandardMaterial color="#fff3d6" emissive="#ffd98a" emissiveIntensity={0.9} /></mesh>
    </group>
  );
}

// ───────────── Stollar (instanslangan) + "jonli" monitorlar ─────────────
export const DeskSet = memo(function DeskSet({ desks, agents, hub }: { desks: Desk[]; agents: OfficeAgent[]; hub: ScreenHub }) {
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const regular = desks.filter((d) => d.team !== "lead");
  const n = Math.max(1, regular.length);
  const call = regular.filter((d) => d.team === "call");
  // Har monitor qaysi tasvirni ko'rsatadi: ish paytida — ish turi, bo'sh bo'lsa — ekran saqlovchi
  const kindOf = (d: Desk): ScreenKind => {
    const a = byId.get(d.id);
    if (!a) return "idle";
    const k = screenKindOf(a.id, d.team, a.kind);
    if (k === "call") return a.activity === "call" ? "call" : "idle";
    if (a.id === "manager") return "plan";
    return a.activity === "idle" && a.task?.status !== "running" ? "idle" : k;
  };
  const groups = new Map<ScreenKind, Desk[]>();
  for (const d of desks) { const k = kindOf(d); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(d); }
  hub.used = new Set([...groups.keys(), "plan"]);
  const screenRot = (d: Desk): [number, number, number] => [0, d.dir > 0 ? Math.PI : 0, 0];
  return (
    <group>
      <Instances geometry={BOX} limit={n} castShadow receiveShadow>
        <meshStandardMaterial color="#fbf8f3" roughness={0.55} />
        {regular.map((d) => <Instance key={d.id} position={[d.x, 0.74, d.z]} scale={[1.6, 0.06, 0.8]} />)}
      </Instances>
      <Instances geometry={BOX} limit={n * 2}>
        <meshStandardMaterial color="#30333b" roughness={0.6} />
        {regular.flatMap((d) => [-0.72, 0.72].map((dx) => <Instance key={`${d.id}${dx}`} position={[d.x + dx, 0.36, d.z]} scale={[0.05, 0.72, 0.7]} />))}
      </Instances>
      <Instances geometry={BOX} limit={n + 1}>
        <meshStandardMaterial color="#e8e6e1" roughness={0.5} />
        {desks.map((d) => <Instance key={d.id} position={[d.x, 0.79, d.z - d.dir * 0.16]} scale={[0.5, 0.025, 0.16]} />)}
      </Instances>
      <Instances geometry={BOX} limit={(n + 1) * 2} castShadow>
        <meshStandardMaterial color="#1c1e23" roughness={0.4} metalness={0.2} />
        {desks.flatMap((d) => [
          <Instance key={`${d.id}b`} position={[d.x, 1.12, d.z + d.dir * 0.2]} scale={[d.team === "lead" ? 1.3 : 0.86, 0.52, 0.04]} />,
          <Instance key={`${d.id}s`} position={[d.x, 0.88, d.z + d.dir * 0.24]} scale={[0.06, 0.22, 0.06]} />,
        ])}
      </Instances>
      {/* Monitor ekranlari — har tur uchun bitta umumiy tekstura */}
      {SCREEN_KINDS.filter((k) => groups.has(k)).map((k) => (
        <Instances key={k} limit={desks.length} frustumCulled={false}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={hub.textures[k]} toneMapped={false} />
          {groups.get(k)!.map((d) => (
            <Instance key={d.id} position={[d.x, 1.12, d.z + d.dir * 0.177]} rotation={screenRot(d)} scale={[d.team === "lead" ? 1.22 : 0.78, 0.44, 1]} />
          ))}
        </Instances>
      ))}
      <Instances geometry={BOX} limit={(n + 1) * 2} castShadow>
        <meshStandardMaterial color="#ffffff" roughness={0.7} />
        {desks.flatMap((d) => [
          <Instance key={`${d.id}c`} position={[d.chair.x, 0.46, d.chair.z]} scale={[0.56, 0.08, 0.52]} color={mix(ZONE_COLOR[d.team]?.floor || "#ddd", "#5b6474", 0.45)} />,
          <Instance key={`${d.id}k`} position={[d.chair.x, 0.78, d.chair.z - d.dir * 0.3]} scale={[0.52, 0.55, 0.07]} color={mix(ZONE_COLOR[d.team]?.floor || "#ddd", "#5b6474", 0.55)} />,
        ])}
      </Instances>
      <Instances geometry={CYL} limit={n + 1}>
        <meshStandardMaterial color="#8d939e" metalness={0.6} roughness={0.35} />
        {desks.map((d) => <Instance key={d.id} position={[d.chair.x, 0.22, d.chair.z]} scale={[0.07, 0.44, 0.07]} />)}
      </Instances>
      <Instances geometry={CYL} limit={n + 1}>
        <meshStandardMaterial color="#f4efe9" roughness={0.6} />
        {desks.map((d, i) => <Instance key={d.id} position={[d.x + (i % 2 ? 0.58 : -0.58), 0.83, d.z - d.dir * 0.1]} scale={[0.09, 0.12, 0.09]} color={i % 3 === 0 ? CLAUDE : i % 3 === 1 ? "#f4efe9" : "#5b8def"} />)}
      </Instances>
      {/* Qo'ng'iroq markazi: stol telefoni + quloqchin (qo'ng'iroqda bo'lmasa — stol ustida) */}
      {call.length > 0 && (
        <>
          <Instances geometry={BOX} limit={call.length * 2}>
            <meshStandardMaterial color="#2b2d33" roughness={0.5} />
            {call.flatMap((d) => [
              <Instance key={`${d.id}p`} position={[d.x - 0.55, 0.81, d.z - d.dir * 0.05]} scale={[0.24, 0.07, 0.18]} />,
              ...(byId.get(d.id)?.activity === "call" ? [] : [<Instance key={`${d.id}h`} position={[d.x + 0.5, 0.8, d.z - d.dir * 0.12]} scale={[0.26, 0.05, 0.08]} />]),
            ])}
          </Instances>
        </>
      )}
      {desks.map((d) => { const a = byId.get(d.id); return a ? <StatusHolo key={d.id} desk={d} agent={a} /> : null; })}
    </group>
  );
});

/** Tasdiq kutilayotgan / tugagan / xato vazifa — stol ustida kamera tomon qaragan belgi. */
const StatusHolo = memo(function StatusHolo({ desk, agent }: { desk: Desk; agent: OfficeAgent }) {
  const holo = useRef<THREE.Group>(null);
  const mode = agent.activity === "review" ? "review" : agent.activity !== "task" && agent.task?.status === "done" ? "done" : agent.activity !== "task" && agent.task?.status === "failed" ? "fail" : null;
  useFrame(({ clock }) => { if (holo.current) holo.current.position.y = Math.sin(clock.elapsedTime * 1.6 + desk.x) * 0.04; });
  if (!mode) return null;
  const color = mode === "fail" ? "#ff3b30" : mode === "done" ? "#34c759" : "#ffb020";
  const m = <meshBasicMaterial color={color} toneMapped={false} />;
  return (
    <Billboard position={[desk.x, 1.75, desk.z + desk.dir * 0.2]}>
      <group ref={holo}>
        <mesh><circleGeometry args={[0.28, 24]} /><meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} /></mesh>
        {mode === "done" ? (
          <group>
            <mesh geometry={BOX} position={[-0.08, -0.04, 0.01]} rotation={[0, 0, Math.PI / 4]} scale={[0.07, 0.2, 0.01]}>{m}</mesh>
            <mesh geometry={BOX} position={[0.07, 0.03, 0.01]} rotation={[0, 0, -Math.PI / 4]} scale={[0.07, 0.36, 0.01]}>{m}</mesh>
          </group>
        ) : mode === "fail" ? (
          <group>
            <mesh geometry={BOX} position={[0, 0.05, 0.01]} scale={[0.08, 0.28, 0.01]}>{m}</mesh>
            <mesh geometry={BOX} position={[0, -0.18, 0.01]} scale={[0.08, 0.08, 0.01]}>{m}</mesh>
          </group>
        ) : (
          <group>
            <mesh geometry={BOX} position={[0, 0.17, 0.01]} scale={[0.24, 0.06, 0.01]}>{m}</mesh>
            <mesh geometry={BOX} position={[0.1, 0.08, 0.01]} scale={[0.06, 0.16, 0.01]}>{m}</mesh>
            <mesh geometry={BOX} position={[0.02, -0.01, 0.01]} scale={[0.14, 0.06, 0.01]}>{m}</mesh>
            <mesh geometry={BOX} position={[0, -0.18, 0.01]} scale={[0.07, 0.07, 0.01]}>{m}</mesh>
          </group>
        )}
      </group>
    </Billboard>
  );
});

// ───────────── Oshxona: muzlatgich, gaz plita (choynak + qozon, bug'), rakovina, shkaflar, mikroto'lqinli pech, kofe mashinasi ─────────────
export function Kitchen() {
  const c = KITCHEN.counter, t = KITCHEN.table, f = KITCHEN.fridge, cm = KITCHEN.coffee;
  const steam = useRef<(THREE.Mesh | null)[]>([]);
  const flame = useRef<THREE.MeshStandardMaterial>(null);
  const mw = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const tt = clock.elapsedTime;
    steam.current.forEach((m, i) => {
      if (!m) return;
      const k = (tt * 0.55 + i * 0.33) % 1;
      m.position.y = 1.25 + k * 0.7;
      m.scale.setScalar(0.08 + k * 0.14);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k);
    });
    if (flame.current) flame.current.emissiveIntensity = 1.6 + Math.sin(tt * 13) * 0.4;
    if (mw.current) mw.current.emissiveIntensity = 0.5 + (Math.sin(tt * 0.7) > 0.2 ? 0.6 : 0);
  });
  const cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  const top = 0.93;
  return (
    <group>
      {/* Pastki shkaflar (eshikchalar bilan) + ish yuzasi */}
      <Box p={[cx, 0.45, cz]} s={[c.x1 - c.x0, 0.9, c.z1 - c.z0]} c="#9fc3b6" cast recv />
      {Array.from({ length: 9 }, (_, i) => (
        <Box key={i} p={[c.x0 + 0.4 + i * 0.78, 0.47, c.z1 + 0.005]} s={[0.7, 0.78, 0.02]} c="#b4d3c8" />
      ))}
      <Box p={[cx, top, cz]} s={[c.x1 - c.x0 + 0.1, 0.06, c.z1 - c.z0 + 0.1]} c="#f6f2ec" rough={0.4} />
      {/* Yuqori shkaflar */}
      <Box p={[cx, 2.0, c.z0 + 0.22]} s={[c.x1 - c.x0, 0.75, 0.45]} c="#b9d6cb" />
      {Array.from({ length: 7 }, (_, i) => <Box key={i} p={[c.x0 + 0.5 + i * 1.0, 2.0, c.z0 + 0.455]} s={[0.92, 0.68, 0.02]} c="#c8e0d7" />)}
      {/* Gaz plita: 4 ta konforka, ikkitasi yonib turibdi; ustida qozon va choynak */}
      <Box p={[STOVE.x, top + 0.04, STOVE.z]} s={[0.9, 0.04, 0.6]} c="#1f2226" metal={0.4} rough={0.3} />
      {[[-0.22, -0.14], [0.22, -0.14], [-0.22, 0.14], [0.22, 0.14]].map(([dx, dz], i) => (
        <mesh key={i} position={[STOVE.x + dx, top + 0.07, STOVE.z + dz]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.06, 0.1, 16]} />
          {i < 2 ? <meshStandardMaterial ref={i === 0 ? flame : undefined} color="#3a6cff" emissive="#4d7dff" emissiveIntensity={1.8} toneMapped={false} /> : <meshStandardMaterial color="#444" />}
        </mesh>
      ))}
      <mesh geometry={CYL} position={[STOVE.x - 0.22, top + 0.2, STOVE.z - 0.14]} scale={[0.34, 0.26, 0.34]} castShadow><meshStandardMaterial color="#b9bec7" metalness={0.7} roughness={0.25} /></mesh>
      <mesh geometry={SPHERE} position={[STOVE.x + 0.22, top + 0.19, STOVE.z - 0.14]} scale={[0.26, 0.22, 0.26]} castShadow><meshStandardMaterial color="#e5484d" roughness={0.4} /></mesh>
      <Box p={[STOVE.x + 0.36, top + 0.24, STOVE.z - 0.14]} s={[0.1, 0.03, 0.03]} c="#e5484d" />
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => { steam.current[i] = m; }} geometry={SPHERE} position={[STOVE.x + (i === 2 ? 0.22 : -0.22), 1.3, STOVE.z - 0.14]}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
      {/* Rakovina + jo'mrak */}
      <Box p={[SINK.x, top + 0.01, SINK.z]} s={[0.8, 0.03, 0.5]} c="#c9ced6" metal={0.6} rough={0.2} />
      <Box p={[SINK.x, top + 0.02, SINK.z]} s={[0.66, 0.03, 0.38]} c="#8d949e" metal={0.6} rough={0.2} />
      <Box p={[SINK.x, top + 0.2, SINK.z - 0.22]} s={[0.05, 0.36, 0.05]} c="#c9ced6" metal={0.8} rough={0.2} />
      <Box p={[SINK.x, top + 0.36, SINK.z - 0.12]} s={[0.05, 0.05, 0.22]} c="#c9ced6" metal={0.8} rough={0.2} />
      {/* Mikroto'lqinli pech */}
      <Box p={[MICROWAVE.x, top + 0.2, MICROWAVE.z]} s={[0.66, 0.38, 0.42]} c="#e9ecef" cast />
      <mesh position={[MICROWAVE.x - 0.07, top + 0.2, MICROWAVE.z + 0.215]}><planeGeometry args={[0.4, 0.26]} /><meshStandardMaterial ref={mw} color="#1d1d1f" emissive="#ffb347" emissiveIntensity={0.5} /></mesh>
      <Box p={[MICROWAVE.x + 0.22, top + 0.28, MICROWAVE.z + 0.215]} s={[0.12, 0.06, 0.01]} c="#0b0b0b" e="#7cf37c" ei={1.2} />
      {/* Kofe mashinasi */}
      <Box p={[cm.x, 1.22, cm.z]} s={[0.6, 0.55, 0.45]} c="#1f2226" cast metal={0.3} rough={0.3} />
      <Box p={[cm.x, 1.3, cm.z + 0.235]} s={[0.12, 0.05, 0.02]} c="#ff4d3d" e="#ff4d3d" ei={2} />
      <mesh geometry={CYL} position={[cm.x, top + 0.09, cm.z + 0.12]} scale={[0.1, 0.12, 0.1]}><meshStandardMaterial color="#ffffff" /></mesh>
      {/* Muzlatgich (ikki eshikli) */}
      <Box p={[f.x, 1.1, f.z]} s={[0.9, 2.2, 0.9]} c="#e6e9ee" cast metal={0.2} rough={0.35} />
      <Box p={[f.x, 1.45, f.z + 0.455]} s={[0.86, 0.02, 0.01]} c="#9aa3ad" />
      <Box p={[f.x + 0.3, 1.8, f.z + 0.47]} s={[0.04, 0.4, 0.04]} c="#9aa3ad" />
      <Box p={[f.x + 0.3, 1.0, f.z + 0.47]} s={[0.04, 0.5, 0.04]} c="#9aa3ad" />
      {/* Meva savati */}
      <mesh geometry={SPHERE} position={[-5.9, 1.0, cz]} scale={[0.5, 0.2, 0.5]}><meshStandardMaterial color="#c58b52" /></mesh>
      {["#ff6b4a", "#ffd23f", "#7bd389"].map((c2, i) => <mesh key={c2} geometry={SPHERE} position={[-6.05 + i * 0.15, 1.1, cz]} scale={0.16}><meshStandardMaterial color={c2} /></mesh>)}
      {/* Ovqat stoli + suyanchiqli stullar + likopchalar */}
      <mesh geometry={CYL} position={[t.x, 0.74, t.z]} scale={[1.7, 0.06, 1.7]} castShadow receiveShadow><meshStandardMaterial color="#fbf7f1" roughness={0.5} /></mesh>
      <mesh geometry={CYL} position={[t.x, 0.37, t.z]} scale={[0.12, 0.74, 0.12]}><meshStandardMaterial color="#30333b" /></mesh>
      {KITCHEN_SEATS.map((s, i) => {
        const a = Math.atan2(t.x - s.x, t.z - s.z);
        const bx = s.x - Math.sin(a) * 0.24, bz = s.z - Math.cos(a) * 0.24;
        const col = ["#f2a541", "#5b8def", CLAUDE, "#7bd389"][i];
        const px = t.x + (s.x - t.x) * 0.45, pz = t.z + (s.z - t.z) * 0.45;
        return (
          <group key={i}>
            <Box p={[s.x, 0.45, s.z]} s={[0.46, 0.07, 0.46]} r={[0, a, 0]} c={col} cast />
            <Box p={[bx, 0.75, bz]} s={[0.44, 0.55, 0.06]} r={[0, a, 0]} c={col} cast />
            {[[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].map(([dx, dz], j) => <Box key={j} p={[s.x + dx, 0.21, s.z + dz]} s={[0.04, 0.42, 0.04]} c="#30333b" />)}
            <mesh geometry={CYL} position={[px, 0.785, pz]} scale={[0.3, 0.02, 0.3]}><meshStandardMaterial color="#ffffff" /></mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Oshpaz (NPC): plita oldida ovqat aralashtiradi, ba'zan o'girilib qaraydi. Joyi — statik to'siq (agentlar aylanib o'tadi). */
export function Cook() {
  const g = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (arm.current) { arm.current.rotation.x = -1.2 + Math.sin(t * 4) * 0.25; arm.current.rotation.z = Math.cos(t * 4) * 0.25; }
    if (g.current) {
      const look = Math.sin(t * 0.25) > 0.85;
      g.current.rotation.y = THREE.MathUtils.lerp(g.current.rotation.y, look ? 0 : Math.PI, 0.05);
      g.current.position.y = Math.abs(Math.sin(t * 2)) * 0.015;
    }
  });
  return (
    <group position={[COOK.x, 0, COOK.z]}>
      <group ref={g} rotation={[0, Math.PI, 0]} scale={1.3}>
        {[-0.18, 0.18].map((x) => <mesh key={x} geometry={BOX} position={[x, 0.09, 0]} scale={[0.1, 0.18, 0.1]}><meshStandardMaterial color="#b8644a" /></mesh>)}
        <mesh geometry={BOX} position={[0, 0.42, 0]} scale={[0.66, 0.46, 0.42]} castShadow><meshStandardMaterial color={CLAUDE} roughness={0.75} /></mesh>
        {/* Fartuk */}
        <mesh geometry={BOX} position={[0, 0.36, 0.215]} scale={[0.5, 0.36, 0.02]}><meshStandardMaterial color="#ffffff" /></mesh>
        {[-0.13, 0.13].map((x) => <mesh key={x} geometry={BOX} position={[x, 0.5, 0.213]} scale={[0.07, 0.12, 0.02]}><meshStandardMaterial color={EYE} /></mesh>)}
        {/* Oshpaz qalpoqchasi */}
        <mesh geometry={CYL} position={[0, 0.78, 0]} scale={[0.42, 0.18, 0.42]}><meshStandardMaterial color="#ffffff" /></mesh>
        <mesh geometry={SPHERE} position={[0, 0.94, 0]} scale={[0.52, 0.26, 0.52]}><meshStandardMaterial color="#ffffff" /></mesh>
        <group position={[-0.39, 0.45, 0]}><mesh geometry={BOX} position={[0, -0.05, 0]} scale={[0.12, 0.14, 0.16]}><meshStandardMaterial color="#c9694d" /></mesh></group>
        <group ref={arm} position={[0.39, 0.45, 0]}>
          <mesh geometry={BOX} position={[0, -0.05, 0]} scale={[0.12, 0.14, 0.16]}><meshStandardMaterial color="#c9694d" /></mesh>
          <mesh geometry={BOX} position={[0, -0.05, 0.22]} scale={[0.04, 0.04, 0.34]}><meshStandardMaterial color="#a0744e" /></mesh>
        </group>
      </group>
    </group>
  );
}

// ───────────── PlayStation burchagi: TV'da Pong o'yini (o'yinchi o'ynasa — o'zi boshqaradi) ─────────────
export function GameCorner({ hub }: { hub: ScreenHub }) {
  const led = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => { if (led.current) led.current.emissiveIntensity = 1.5 + Math.sin(clock.elapsedTime * 3) * 0.8; });
  const s = GAME.sofa, st = GAME.stand, tb = GAME.table, T = GAME.tv;
  return (
    <group>
      <Box p={[(st.x0 + st.x1) / 2, 0.3, (st.z0 + st.z1) / 2]} s={[st.x1 - st.x0, 0.6, st.z1 - st.z0]} c="#2c2f36" cast />
      <Box p={[T.x, 1.55, T.z - 0.1]} s={[3.0, 1.7, 0.08]} c="#111215" cast />
      <mesh position={[T.x, 1.55, T.z - 0.055]}>
        <planeGeometry args={[2.85, 1.58]} />
        <meshBasicMaterial map={hub.tv} toneMapped={false} />
      </mesh>
      <Box p={[T.x + 0.9, 0.68, st.z0 + 0.6]} s={[0.55, 0.16, 0.4]} c="#f2f2f4" metal={0.1} rough={0.3} />
      <mesh geometry={BOX} position={[T.x + 0.9, 0.68, st.z0 + 0.81]} scale={[0.5, 0.02, 0.01]}>
        <meshStandardMaterial ref={led} color="#2f6bff" emissive="#2f6bff" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <Box p={[(s.x0 + s.x1) / 2, 0.25, (s.z0 + s.z1) / 2]} s={[s.x1 - s.x0, 0.5, s.z1 - s.z0]} c="#3fa7a0" cast recv />
      <Box p={[(s.x0 + s.x1) / 2, 0.7, s.z1 - 0.12]} s={[s.x1 - s.x0, 0.8, 0.25]} c="#358f89" cast />
      <Box p={[s.x0 + 0.12, 0.5, (s.z0 + s.z1) / 2]} s={[0.25, 0.5, s.z1 - s.z0]} c="#358f89" />
      <Box p={[s.x1 - 0.12, 0.5, (s.z0 + s.z1) / 2]} s={[0.25, 0.5, s.z1 - s.z0]} c="#358f89" />
      {[1.2, 2.6, 4.0].map((x) => <Box key={x} p={[x, 0.55, (s.z0 + s.z1) / 2 - 0.08]} s={[1.05, 0.12, 0.8]} c="#4cbcb4" />)}
      <Box p={[(tb.x0 + tb.x1) / 2, 0.3, (tb.z0 + tb.z1) / 2]} s={[tb.x1 - tb.x0, 0.08, tb.z1 - tb.z0]} c="#d9b38c" cast />
      <Box p={[3.0, 0.38, (tb.z0 + tb.z1) / 2]} s={[0.22, 0.06, 0.12]} c="#20232a" />
    </group>
  );
}

// ───────────── Kinozal: ekranda multfilm (canvas), pardalar, puflar, popkorn ─────────────
export function Cinema({ hub }: { hub: ScreenHub }) {
  const S = CINEMA.screen;
  const bagColors = ["#e85d75", "#f2a541", "#5b8def", "#7bd389", "#b57edc", CLAUDE, "#3fa7a0"];
  return (
    <group>
      <Box p={[S.x, 1.75, S.z - 0.08]} s={[S.w + 0.4, 2.7, 0.1]} c="#15171c" />
      <mesh position={[S.x, 1.75, S.z - 0.02]}>
        <planeGeometry args={[S.w, 2.4]} />
        <meshBasicMaterial map={hub.movie} toneMapped={false} />
      </mesh>
      <Box p={[S.x - S.w / 2 - 0.4, 1.4, S.z + 0.1]} s={[0.5, 2.8, 0.3]} c="#9b2335" cast />
      <Box p={[S.x + S.w / 2 + 0.4, 1.4, S.z + 0.1]} s={[0.5, 2.8, 0.3]} c="#9b2335" cast />
      {CINEMA.bags.map(([x, z], i) => (
        <mesh key={i} geometry={SPHERE} position={[x, 0.28, z - 0.1]} scale={[1.05, 0.55, 1.05]} castShadow>
          <meshStandardMaterial color={bagColors[i % bagColors.length]} roughness={0.9} />
        </mesh>
      ))}
      <Box p={[20.2, 0.7, -10.6]} s={[0.8, 1.4, 0.8]} c="#d62839" cast />
      <Box p={[20.2, 1.15, -10.6]} s={[0.66, 0.5, 0.66]} c="#fff4d6" e="#ffe08a" ei={0.6} o={0.85} />
    </group>
  );
}

/** Ochiq dam olish burchagi: divan, stolcha, suv kuleri, torsher. */
export function Lounge() {
  const s = LOUNGE.sofa, t = LOUNGE.table;
  const bub = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (bub.current) { const k = (clock.elapsedTime * 0.4) % 1; bub.current.position.y = 1.15 + k * 0.4; bub.current.visible = k < 0.9; } });
  return (
    <group>
      <Box p={[(s.x0 + s.x1) / 2, 0.25, (s.z0 + s.z1) / 2]} s={[s.x1 - s.x0, 0.5, s.z1 - s.z0]} c="#7a5c99" cast recv />
      <Box p={[(s.x0 + s.x1) / 2, 0.7, s.z1 - 0.12]} s={[s.x1 - s.x0, 0.8, 0.25]} c="#6a4f86" cast />
      {LOUNGE.seats.map((x) => <Box key={x} p={[x, 0.55, (s.z0 + s.z1) / 2 - 0.08]} s={[1.2, 0.12, 0.8]} c="#8d70ad" />)}
      <Box p={[(t.x0 + t.x1) / 2, 0.36, (t.z0 + t.z1) / 2]} s={[t.x1 - t.x0, 0.06, t.z1 - t.z0]} c="#d9b38c" cast />
      <Box p={[(t.x0 + t.x1) / 2, 0.17, (t.z0 + t.z1) / 2]} s={[t.x1 - t.x0 - 0.3, 0.34, t.z1 - t.z0 - 0.2]} c="#b9936c" />
      {/* Suv kuleri */}
      <group position={[COOLER.x, 0, COOLER.z]}>
        <Box p={[0, 0.5, 0]} s={[0.46, 1.0, 0.46]} c="#eef1f5" cast />
        <Box p={[-0.235, 0.78, 0]} s={[0.02, 0.08, 0.16]} c="#5b8def" />
        <mesh geometry={CYL} position={[0, 1.32, 0]} scale={[0.36, 0.6, 0.36]}><meshStandardMaterial color="#9fd6ff" transparent opacity={0.6} roughness={0.1} /></mesh>
        <mesh ref={bub} geometry={SPHERE} position={[0, 1.2, 0]} scale={0.05}><meshBasicMaterial color="#ffffff" /></mesh>
      </group>
      <FloorLamp x={20.3} z={12.6} />
    </group>
  );
}

export function Plants() {
  return (
    <>
      {PLANTS.map((p, i) => {
        const s = 0.8 + (i % 3) * 0.18;
        return (
          <group key={i} position={[p.x, 0, p.z]} scale={s}>
            <mesh geometry={CYL} position={[0, 0.3, 0]} scale={[0.55, 0.6, 0.55]} castShadow><meshStandardMaterial color="#e9e2d8" roughness={0.8} /></mesh>
            <mesh geometry={ICO} position={[0, 1.0, 0]} scale={[0.95, 1.1, 0.95]} castShadow><meshStandardMaterial color="#4f9d69" flatShading roughness={0.9} /></mesh>
            <mesh geometry={ICO} position={[0.22, 1.45, 0.1]} scale={0.6} castShadow><meshStandardMaterial color="#62b37b" flatShading roughness={0.9} /></mesh>
          </group>
        );
      })}
    </>
  );
}
