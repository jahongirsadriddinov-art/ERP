import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { OfficeAgent } from "./officeApi";
import { BOUNDS, ROOMS, cellIndex, doorPoint, entryCell, cellCenter, hash as hashId, roomWalls, walkable, type Desk, type Grid, type Poi, type Pose, type Rect } from "./layout";
import { lerpAngle, type Crowd, type Goal } from "./crowd";
import { BOX, CLAUDE, CYL, EYE, SPHERE, mix } from "./props";
import { PLAYER_START, SEATS, TEA_SPOTS, type SeatKind, type SeatTarget, type Target, type WalkBridge } from "./walk";

// AI ofis — tirik mavjudotlar: agentlar (Claude Code maskoti uslubida) va o'yinchi (egasi, toj + "Siz").
// Harakat — Crowd (crowd.ts) orqali: A* yo'l, bir-biriga urilmaslik. Bu yerda faqat poza/animatsiya va kamera.

type BodyPose = Pose | "walk" | "work" | "relax" | "think" | "visit" | "eat";
const CONFETTI = 28;
const DUMMY = new THREE.Object3D();

interface BodyRefs {
  body: React.RefObject<THREE.Group | null>; legs: React.MutableRefObject<(THREE.Mesh | null)[]>; arms: React.MutableRefObject<(THREE.Group | null)[]>;
  cup: React.MutableRefObject<THREE.Mesh | null>; pad: React.MutableRefObject<THREE.Mesh | null>; papers: React.MutableRefObject<THREE.Mesh | null>;
  headset: React.MutableRefObject<THREE.Group | null>;
}
function useBodyRefs(): BodyRefs {
  return {
    body: useRef<THREE.Group>(null), legs: useRef<(THREE.Mesh | null)[]>([]), arms: useRef<(THREE.Group | null)[]>([]),
    cup: useRef<THREE.Mesh | null>(null), pad: useRef<THREE.Mesh | null>(null), papers: useRef<THREE.Mesh | null>(null), headset: useRef<THREE.Group | null>(null),
  };
}

/** Poza → tana, oyoq, qo'l animatsiyasi (agent va o'yinchi uchun bir xil). */
function animateBody(r: BodyRefs, pose: BodyPose, t: number, dt: number, o: { call?: boolean; celebrating?: boolean; cheer?: boolean; cup?: boolean; papers?: boolean }) {
  const b = r.body.current;
  if (!b) return;
  let y = 0, tiltX = 0, tiltZ = 0;
  const seated = pose === "work" || pose === "relax" || pose === "think" || pose === "sit" || pose === "game" || pose === "eat";
  if (pose === "walk") y = Math.abs(Math.sin(t * 11)) * 0.06;
  else if (seated) y = pose === "sit" || pose === "eat" ? 0.3 : 0.32;
  else if (pose === "beanbag") { y = 0.22; tiltX = -0.35; }
  else y = Math.sin(t * 2) * 0.012;
  if (pose === "relax") tiltX = -0.18;
  if (pose === "think") tiltZ = Math.sin(t * 1.2) * 0.12;
  if (pose === "game") tiltZ = Math.sin(t * 3.1) * 0.1;
  if (pose === "beanbag") y += Math.sin(t * 1.5) * 0.01;
  if (o.celebrating) y += Math.abs(Math.sin(t * 9)) * 0.35;
  if (o.cheer) y += Math.abs(Math.sin(t * 9)) * 0.15;
  b.position.y = y;
  b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, tiltX, Math.min(1, dt * 5));
  b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, tiltZ, Math.min(1, dt * 5));
  r.legs.current.forEach((l, i) => {
    if (!l) return;
    l.rotation.x = pose === "walk" ? Math.sin(t * 11 + (i % 2 ? Math.PI : 0)) * 0.6 : 0;
    l.position.z = seated ? 0.12 : 0;
    l.scale.y = seated ? 0.6 : 1;
  });
  r.arms.current.forEach((a, i) => {
    if (!a) return;
    let rx = 0, rz = 0;
    if (pose === "walk") rx = Math.sin(t * 11 + (i ? 0 : Math.PI)) * 0.6;
    else if (pose === "work") rx = o.call ? (i ? -1.9 : -0.2) : -0.9 + Math.sin(t * 18 + i * 1.7) * 0.18;
    else if (pose === "game") rx = -1.1 + Math.sin(t * 14 + i) * 0.12;
    else if (pose === "eat") rx = i ? -1.3 + Math.max(0, Math.sin(t * 2.2)) * -0.7 : -0.8;
    else if (pose === "coffee" || pose === "sit") rx = i ? -1.2 + Math.max(0, Math.sin(t * 0.8)) * -0.5 : 0;
    else if (pose === "visit") rx = i ? -0.9 : 0;
    else if (pose === "think") rx = i ? -2.1 : 0;
    if (o.celebrating) { rx = -2.6; rz = (i ? -1 : 1) * 0.4; }
    a.rotation.x = THREE.MathUtils.lerp(a.rotation.x, rx, Math.min(1, dt * 12));
    a.rotation.z = THREE.MathUtils.lerp(a.rotation.z, rz, Math.min(1, dt * 12));
  });
  if (r.cup.current) r.cup.current.visible = !!o.cup || pose === "coffee" || pose === "sit" || pose === "eat";
  if (r.pad.current) r.pad.current.visible = pose === "game";
  if (r.papers.current) r.papers.current.visible = !!o.papers;
  if (r.headset.current) r.headset.current.visible = !!o.call;
}

/** Maskot tanasi: oyoqlar, tana, ko'zlar, qo'llar, rekvizitlar (krujka, pult, qog'oz, quloqchin) va nishon (shapka/toj). */
function Mascot({ r, tint, color, hat, failed }: { r: BodyRefs; tint: string; color: string; hat: "boss" | "cap" | "antenna" | "player"; failed?: boolean }) {
  return (
    <group ref={r.body}>
      {[-0.22, -0.08, 0.08, 0.22].map((x, i) => (
        <mesh key={x} ref={(m) => { r.legs.current[i] = m; }} geometry={BOX} position={[x, 0.09, 0]} scale={[0.09, 0.18, 0.1]} castShadow>
          <meshStandardMaterial color={mix(tint, "#000", 0.12)} roughness={0.8} />
        </mesh>
      ))}
      <mesh geometry={BOX} position={[0, 0.42, 0]} scale={[0.66, 0.46, 0.42]} castShadow>
        <meshStandardMaterial color={tint} roughness={0.75} emissive={failed ? "#ff2020" : "#000"} emissiveIntensity={failed ? 0.35 : 0} />
      </mesh>
      {[-0.13, 0.13].map((x) => (
        <mesh key={x} geometry={BOX} position={[x, 0.48, 0.213]} scale={[0.07, 0.14, 0.02]}><meshStandardMaterial color={EYE} roughness={0.3} /></mesh>
      ))}
      {[-1, 1].map((sd, i) => (
        <group key={sd} ref={(m) => { r.arms.current[i] = m; }} position={[sd * 0.39, 0.45, 0]}>
          <mesh geometry={BOX} position={[0, -0.05, 0]} scale={[0.12, 0.14, 0.16]} castShadow><meshStandardMaterial color={mix(tint, "#000", 0.06)} roughness={0.8} /></mesh>
          {i === 1 && <mesh ref={(m) => { r.cup.current = m; }} geometry={CYL} position={[0, -0.02, 0.16]} scale={[0.1, 0.14, 0.1]} visible={false}><meshStandardMaterial color="#ffffff" /></mesh>}
        </group>
      ))}
      <mesh ref={(m) => { r.pad.current = m; }} geometry={BOX} position={[0, 0.36, 0.34]} scale={[0.3, 0.06, 0.12]} visible={false}><meshStandardMaterial color="#1c1e24" /></mesh>
      <mesh ref={(m) => { r.papers.current = m; }} geometry={BOX} position={[0, 0.5, 0.32]} scale={[0.34, 0.12, 0.26]} visible={false}><meshStandardMaterial color="#ffffff" /></mesh>
      {/* Quloqchin (qo'ng'iroq paytida) */}
      <group ref={(m) => { r.headset.current = m; }} visible={false}>
        <mesh geometry={BOX} position={[0, 0.69, 0]} scale={[0.72, 0.05, 0.06]}><meshStandardMaterial color="#2b2d33" /></mesh>
        {[-0.35, 0.35].map((x) => <mesh key={x} geometry={BOX} position={[x, 0.5, 0]} scale={[0.06, 0.16, 0.16]}><meshStandardMaterial color="#2b2d33" /></mesh>)}
        <mesh geometry={BOX} position={[-0.25, 0.36, 0.16]} rotation={[0, 0.6, 0]} scale={[0.22, 0.025, 0.025]}><meshStandardMaterial color="#2b2d33" /></mesh>
      </group>
      {hat === "boss" || hat === "player" ? (
        <group position={[0, 0.69, 0]}>
          <mesh geometry={BOX} scale={[0.5, 0.1, 0.34]}><meshStandardMaterial color="#f2c14e" metalness={0.6} roughness={0.3} /></mesh>
          {[-0.18, 0, 0.18].map((x) => <mesh key={x} geometry={BOX} position={[x, 0.1, 0]} scale={[0.09, 0.12, 0.09]}><meshStandardMaterial color="#f2c14e" metalness={0.6} roughness={0.3} /></mesh>)}
        </group>
      ) : hat === "cap" ? (
        <mesh geometry={BOX} position={[0, 0.69, -0.02]} scale={[0.46, 0.08, 0.32]} castShadow><meshStandardMaterial color={color} roughness={0.6} /></mesh>
      ) : (
        <group position={[0.2, 0.74, 0]}>
          <mesh geometry={BOX} scale={[0.03, 0.18, 0.03]}><meshStandardMaterial color="#30333b" /></mesh>
          <mesh geometry={SPHERE} position={[0, 0.11, 0]} scale={0.08}><meshStandardMaterial color="#2aabee" emissive="#2aabee" emissiveIntensity={0.6} /></mesh>
        </group>
      )}
      <mesh geometry={BOX} position={[0, 0.3, 0.215]} scale={[0.14, 0.08, 0.02]}>
        <meshStandardMaterial color={hat === "player" ? "#f2c14e" : color} emissive={hat === "player" ? "#f2c14e" : color} emissiveIntensity={hat === "player" ? 0.8 : 0.25} />
      </mesh>
    </group>
  );
}

// ───────────── Agent ─────────────
export interface AgentProps {
  agent: OfficeAgent; desk: Desk; poi?: Poi; tour?: { x: number; z: number; face: number }[]; crowd: Crowd;
  selected: boolean;
  /** Ism yorlig'i doim (tanlangan yoki "Ismlar" yoqilgan). Aks holda — faqat sichqoncha ustida / o'yinchi yaqinida. */
  showLabel: boolean;
  talking: boolean;
  /** Qo'ng'iroq pufagiga ruxsat (bir vaqtda ko'pi bilan 3 ta). */
  bubble?: boolean;
  /** Agent gapirayotgan matn (suhbat javobi) — pufakda va "gapirish" animatsiyasi. */
  speech?: string | null;
  onSelect: (id: string | null) => void;
}
type GoalPose = Pose | "work" | "relax" | "think" | "visit";
const LABEL: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", padding: "1px 7px 1px 5px", borderRadius: 999, fontSize: 11, fontWeight: 700,
  boxShadow: "0 1px 4px rgba(40,30,20,.2)", fontFamily: "inherit", lineHeight: "16px",
};
const BUBBLE: React.CSSProperties = {
  width: "max-content", maxWidth: 220, padding: "3px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: "#fff", color: "#1f2937",
  boxShadow: "0 2px 8px rgba(0,0,0,.18)", fontFamily: "inherit", lineHeight: "15px",
};

export const Agent = memo(function Agent({ agent, desk, poi, tour, crowd, selected, showLabel, talking, bubble = false, speech = null, onSelect }: AgentProps) {
  const root = useRef<THREE.Group>(null);
  const r = useBodyRefs();
  const ring = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const confetti = useRef<THREE.InstancedMesh>(null);
  const [hover, setHover] = useState(false);
  const [near, setNear] = useState(false);
  const isBoss = agent.id === "manager";
  const tint = useMemo(() => mix(CLAUDE, agent.color || CLAUDE, agent.kind === "tg" ? 0 : 0.16), [agent.color, agent.kind]);
  const st = useRef({ tourIdx: 0, celebrateAt: -1, prevTask: agent.task?.status, phase: Math.random() * 10, nearCheck: 0, near: false, goal: null as (Goal & { pose: GoalPose }) | null, pendingKey: "", pendingAt: 0 });
  // Hamma bo'sh agent bir vaqtda o'rnidan turmasin — har biri o'z kechikishi bilan (0–9 s) yo'lga chiqadi
  const stagger = useMemo(() => (hashId(agent.id) % 10), [agent.id]);

  const deskGoal = (pose: GoalPose): Goal & { pose: GoalPose } => ({ key: `desk:${pose}`, x: desk.chair.x, z: desk.chair.z, face: desk.dir > 0 ? 0 : Math.PI, pose });
  const baseGoal = agent.activity === "task" || agent.activity === "chat" || agent.activity === "call" ? deskGoal("work")
    : agent.activity === "review" ? deskGoal("think")
      : poi ? { key: `poi:${poi.x},${poi.z}`, x: poi.x, z: poi.z, face: poi.face, pose: poi.pose as GoalPose }
        : deskGoal("relax");

  useEffect(() => {
    const s = st.current;
    const status = agent.task?.status;
    if (status === "done" && s.prevTask !== "done") {
      const fresh = !agent.task?.finishedAt || Date.now() - Date.parse(agent.task.finishedAt) < 30_000 || (s.prevTask && s.prevTask !== "done");
      if (fresh) s.celebrateAt = performance.now() / 1000;
    }
    s.prevTask = status;
  }, [agent.task?.status, agent.task?.finishedAt]);
  useEffect(() => () => crowd.remove(agent.id), [crowd, agent.id]);

  useFrame(({ clock }, dtRaw) => {
    const s = st.current;
    const g = root.current;
    if (!g) return;
    const dt = Math.min(dtRaw, 0.05);
    const t = clock.elapsedTime + s.phase;
    let goal: Goal & { pose: GoalPose } = baseGoal;
    // Dam olish joyi almashsa — kechikish bilan (ish boshlanishi esa darhol)
    if (!s.goal) s.goal = goal;
    else if (s.goal.key !== goal.key) {
      if (s.pendingKey !== goal.key) { s.pendingKey = goal.key; s.pendingAt = clock.elapsedTime; }
      if (goal.pose === "work" || goal.pose === "think" || clock.elapsedTime - s.pendingAt >= stagger) s.goal = goal;
      else goal = s.goal;
    }
    const cur = crowd.get(agent.id);
    if (tour && tour.length) {
      if (cur && cur.arrived && cur.key.startsWith("tour:") && crowd.time > cur.arrivedAt + 2.2) s.tourIdx = (s.tourIdx + 1) % tour.length;
      const p = tour[s.tourIdx % tour.length];
      goal = { key: `tour:${s.tourIdx}:${p.x},${p.z}`, x: p.x, z: p.z, face: p.face, pose: "visit" };
    }
    const w = crowd.setGoal(agent.id, goal);
    w.hold = talking;
    if (talking) {
      const me = crowd.get("me");
      if (me) w.rot = lerpAngle(w.rot, Math.atan2(me.pos.x - w.pos.x, me.pos.z - w.pos.z), Math.min(1, dt * 6));
    }
    g.position.set(w.pos.x, 0, w.pos.z);
    g.rotation.y = w.rot;
    const pose: BodyPose = w.moving ? "walk" : talking ? "stand" : w.arrived ? goal.pose : "stand";
    const now = performance.now() / 1000;
    const since = now - s.celebrateAt;
    const celebrating = s.celebrateAt >= 0 && since < 3;
    animateBody(r, pose, t, dt, {
      call: agent.activity === "call", celebrating, papers: agent.id === "reporter" && !!tour,
      cheer: (pose === "stand" && (s.phase * 10) % 3 < 1 && agent.activity === "idle" && Math.sin(t * 0.7) > 0.93) || (!!speech && !w.moving),
    });
    if (ring.current) {
      ring.current.visible = agent.activity === "task" || agent.activity === "review";
      ring.current.rotation.z = -t * 2.2;
      ring.current.position.y = 1.55 + (r.body.current?.position.y || 0);
    }
    if (halo.current) { const k = 1 + Math.sin(clock.elapsedTime * 5) * 0.12; halo.current.scale.set(k, k, k); }
    // Yurish rejimida — o'yinchi yaqinidagi agentlar ismi (crowd.labels — Player hisoblaydi)
    s.nearCheck -= dt;
    if (s.nearCheck <= 0) { s.nearCheck = 0.3; const n = crowd.labels.has(agent.id); if (n !== s.near) { s.near = n; setNear(n); } }
    const cf = confetti.current;
    if (cf) {
      cf.visible = celebrating && since < 2.8;
      if (cf.visible) {
        for (let i = 0; i < CONFETTI; i++) {
          const a = (i / CONFETTI) * Math.PI * 2 * 3.7, v = 1.2 + (i % 5) * 0.35;
          DUMMY.position.set(Math.cos(a) * v * since * 0.6, 1.2 + v * since * 1.6 - 2.4 * since * since, Math.sin(a) * v * since * 0.6);
          DUMMY.rotation.set(since * 6 + i, since * 4, 0);
          DUMMY.scale.setScalar(0.07);
          DUMMY.updateMatrix();
          cf.setMatrixAt(i, DUMMY.matrix);
        }
        cf.instanceMatrix.needsUpdate = true;
      }
    }
  });

  const failed = agent.task?.status === "failed" && agent.activity !== "task";
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(agent.id); };
  const scale = isBoss ? 1.2 : 1.0;
  const statusDot = agent.activity === "task" ? "#5ea8ff" : agent.activity === "call" ? "#2dd4bf" : agent.activity === "chat" ? "#a78bfa"
    : agent.activity === "review" ? "#ffb020" : failed ? "#ff3b30" : agent.task?.status === "done" ? "#34c759" : "#b8b2aa";
  const label = showLabel || hover || near || talking || !!speech;
  const bubbleText = speech ? (speech.length > 90 ? `${speech.slice(0, 88)}…` : speech) : talking ? "👋 …" : bubble && agent.activity === "call" ? "📞 Alo, …" : null;
  return (
    <group ref={root} onClick={click}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; setHover(true); }}
      onPointerOut={() => { document.body.style.cursor = ""; setHover(false); }}>
      {(selected || failed) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.44, 0.58, 32]} />
          <meshBasicMaterial color={failed && !selected ? "#ff3b30" : agent.color} transparent opacity={0.85} toneMapped={false} />
        </mesh>
      )}
      {selected && (
        <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
          <ringGeometry args={[0.7, 0.8, 40]} />
          <meshBasicMaterial color={agent.color} transparent opacity={0.55} toneMapped={false} />
        </mesh>
      )}
      <group scale={scale}>
        <Mascot r={r} tint={tint} color={agent.color} hat={isBoss ? "boss" : agent.kind === "tg" ? "antenna" : "cap"} failed={failed} />
      </group>
      <mesh ref={ring} position={[0, 1.55, 0]} rotation={[-Math.PI / 2.4, 0, 0]} visible={false}>
        <torusGeometry args={[0.24, 0.035, 8, 32, Math.PI * 1.4]} />
        <meshBasicMaterial color={agent.activity === "review" ? "#ffb020" : "#5ea8ff"} toneMapped={false} />
      </mesh>
      <instancedMesh ref={confetti} args={[BOX, undefined, CONFETTI]} visible={false}>
        <meshBasicMaterial color="#ffd23f" toneMapped={false} />
      </instancedMesh>
      {(label || bubbleText) && (
        <Html position={[0, isBoss ? 1.95 : 1.72, 0]} center zIndexRange={[selected || speech ? 30 : 20, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            {bubbleText && <div className="office-bubble" data-testid={`ai-office-bubble-${agent.id}`} style={BUBBLE}>{bubbleText}</div>}
            {label && (
              <div className="office-label" data-testid={`ai-office-label-${agent.id}`}
                style={{ ...LABEL, background: selected ? agent.color : "rgba(255,255,255,0.95)", color: selected ? "#fff" : "#1f2328" }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: statusDot }} />
                {agent.name}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
});

// ───────────── O'yinchi (egasi) — yurish rejimi ─────────────
const HEAD = 1.3;
/** Kamera to'qnashadigan narsalar: xona devorlari (past / shisha — baland) va eshik ustidagi lavhalar. */
const CAM_BLOCKERS: { r: Rect; y0: number; y1: number }[] = [
  ...ROOMS.flatMap(roomWalls).map((w) => ({ r: w, y0: 0, y1: (w.glass ? 2.4 : 1.1) + 0.08 })),
  ...ROOMS.flatMap((room) => room.doors.map((d) => { const p = doorPoint(room, d); return { r: { x0: p.x - d.w / 2 - 0.1, z0: p.z - 0.1, x1: p.x + d.w / 2 + 0.1, z1: p.z + 0.1 }, y0: 1.9, y1: 2.6 }; })),
];
function camBlocked(x: number, y: number, z: number) {
  for (const b of CAM_BLOCKERS) if (y >= b.y0 && y <= b.y1 && x > b.r.x0 - 0.18 && x < b.r.x1 + 0.18 && z > b.r.z0 - 0.18 && z < b.r.z1 + 0.18) return true;
  return false;
}
export function Player({ crowd, grid, bridge, agents, holding, youLabel }: {
  crowd: Crowd; grid: Grid; bridge: WalkBridge; agents: OfficeAgent[]; holding: boolean; youLabel: string;
}) {
  const root = useRef<THREE.Group>(null);
  const r = useBodyRefs();
  const { camera } = useThree();
  const st = useRef({
    yaw: PLAYER_START.face, pitch: 0.38, seat: null as SeatTarget | null, sitting: false, nearKey: "", scan: 0,
    agentGoal: null as string | null, focus: null as string | null, retarget: 0, camPos: new THREE.Vector3(), camInit: false, phase: 0,
  });
  const names = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);

  useEffect(() => {
    crowd.place("me", { key: "me:start", x: PLAYER_START.x, z: PLAYER_START.z, face: PLAYER_START.face }, true);
    return () => crowd.remove("me");
  }, [crowd]);

  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = st.current;
    const w = crowd.get("me");
    if (!w || !root.current) return;
    const inp = bridge.input;
    // Buyruqlar (DOM'dan)
    while (bridge.cmds.length) {
      const c = bridge.cmds.shift()!;
      // "Qayerga?" — bir zumda ko'chish (teleport) eng yaqin bo'sh pol katagiga; kamera ham darhol
      if (c.type === "goto") { s.agentGoal = null; s.focus = null; standUp(); if (crowd.teleport("me", { x: c.x, z: c.z }, c.face)) { s.yaw = c.face; s.camInit = false; } }
      else if (c.type === "gotoAgent") {
        standUp(); s.agentGoal = null; s.focus = c.id; s.nearKey = "?";
        const a = crowd.get(c.id);
        if (a) {
          // Agent oldiga (u qaragan tomonga 1.2 m) — bo'sh katak topilmasa, yon tomonlardan
          for (const ang of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
            const fx = Math.sin(a.rot + ang), fz = Math.cos(a.rot + ang);
            const p = { x: a.pos.x + fx * 1.2, z: a.pos.z + fz * 1.2 };
            if (walkable(grid, cellIndex(p))) { crowd.teleport("me", p, Math.atan2(-fx, -fz)); s.yaw = Math.atan2(-fx, -fz); s.camInit = false; break; }
          }
        }
      }
      else if (c.type === "sit") { s.agentGoal = null; s.seat = c.target; s.sitting = false; crowd.setGoal("me", { key: `seat:${c.target.key}:${clock.elapsedTime}`, x: c.target.x, z: c.target.z, face: c.target.face }); }
      else if (c.type === "stand") standUp();
    }
    // Qarash
    s.yaw -= inp.lookX * 0.0032;
    s.pitch = THREE.MathUtils.clamp(s.pitch + inp.lookY * 0.0028, -0.35, 1.1);
    inp.lookX = 0; inp.lookY = 0;
    // Agent tomon avtomatik yurish (agent ham yursa — har 0.8 s nishonni yangilaydi)
    if (s.agentGoal) {
      const a = crowd.get(s.agentGoal);
      s.retarget -= dt;
      const d = a ? Math.hypot(a.pos.x - w.pos.x, a.pos.z - w.pos.z) : 0;
      if (a && d < 1.6) { if (w.path.length) w.path = []; }
      else if (a && s.retarget <= 0) { s.retarget = 0.8; crowd.setGoal("me", { key: `agent:${s.agentGoal}:${Math.round(a.pos.x * 2)},${Math.round(a.pos.z * 2)}`, x: a.pos.x, z: a.pos.z, face: w.rot }, 1.15); }
    }
    // Klaviatura / joystik
    const mv = Math.hypot(inp.mx, inp.mz);
    if (mv > 0.05) {
      if (s.sitting || s.seat) standUp();
      s.agentGoal = null; s.focus = null;
      const sp = (inp.run ? 4.6 : 2.6) * Math.min(1, mv);
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      const vx = (fx * inp.mz - Math.cos(s.yaw) * inp.mx) / Math.max(1, mv), vz = (fz * inp.mz + Math.sin(s.yaw) * inp.mx) / Math.max(1, mv);
      crowd.drive("me", vx * sp, vz * sp, dt);
    } else if (!w.path.length) w.moving = false;
    // Yo'l bo'ylab yurganda — kamera yo'nalishi asta yurish yo'nalishiga buriladi
    if (w.moving && mv <= 0.05) s.yaw = lerpAngle(s.yaw, w.rot, Math.min(1, dt * 2.5));
    // O'tirish: joyga yetib keldi
    if (s.seat && !s.sitting && w.arrived && Math.hypot(w.pos.x - s.seat.x, w.pos.z - s.seat.z) < 0.05) {
      s.sitting = true; w.rot = s.seat.face; bridge.onSeat(s.seat.seat);
      if (s.seat.seat === "cinema") { s.yaw = Math.PI; s.pitch = -0.05; }
    }
    root.current.position.set(w.pos.x, 0, w.pos.z);
    root.current.rotation.y = w.rot;
    const seatPose: Record<SeatKind, BodyPose> = { cinema: "beanbag", game: "game", kitchen: "eat", lounge: "sit", computer: "work" };
    const pose: BodyPose = w.moving ? "walk" : s.sitting && s.seat ? seatPose[s.seat.seat] : "stand";
    animateBody(r, pose, clock.elapsedTime, dt, { cup: holding });
    const fp = inp.fp || (s.sitting && s.seat?.seat === "cinema");
    root.current.visible = !fp;

    // Kamera: uchinchi shaxs (orqadan, to'qnashuvdan qochadi) yoki birinchi shaxs
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const head = new THREE.Vector3(w.pos.x, HEAD + (s.sitting ? -0.3 : 0), w.pos.z);
    const target = new THREE.Vector3();
    if (fp) {
      target.set(head.x + fx * 0.15, head.y + 0.05, head.z + fz * 0.15);
      s.camPos.copy(target);
      camera.position.copy(target);
      camera.lookAt(target.x + fx * Math.cos(s.pitch), target.y - Math.sin(s.pitch), target.z + fz * Math.cos(s.pitch));
    } else {
      let dist = 4.4;
      const back = (d: number) => new THREE.Vector3(head.x - fx * d * Math.cos(s.pitch), head.y + 0.4 + d * Math.sin(s.pitch), head.z - fz * d * Math.cos(s.pitch));
      let p = back(dist);
      // Tashqi devorlar ichida qolsin (orqa/chap baland devor) — masofa qisqaradi
      while (dist > 1.2 && (p.x < BOUNDS.x0 + 0.3 || p.x > BOUNDS.x1 + 3 || p.z < BOUNDS.z0 + 0.3 || p.z > BOUNDS.z1 + 3)) { dist -= 0.2; p = back(dist); }
      // Devor / eshik lavhasi kamera bilan o'yinchi orasida qolsa — kamera yaqinlashadi
      for (let i = 1; i <= 16; i++) {
        const q = back((dist * i) / 16);
        if (camBlocked(q.x, q.y, q.z)) { dist = Math.max(0.6, (dist * (i - 1)) / 16 - 0.1); p = back(dist); s.camInit = false; break; }
      }
      p.y = Math.max(0.6, p.y);
      if (!s.camInit) { s.camPos.copy(p); s.camInit = true; }
      s.camPos.lerp(p, Math.min(1, dt * 8));
      camera.position.copy(s.camPos);
      camera.lookAt(head.x + fx * 0.6, head.y + 0.2, head.z + fz * 0.6);
    }

    // Yaqin atrofdagi narsa (har ~0.15 s): agent → o'rindiq → choy
    s.scan -= dt;
    if (s.scan <= 0) {
      s.scan = 0.15;
      bridge.onPos?.(w.pos.x, w.pos.z);
      let best: Target | null = null, bd = Infinity;
      // "Qayerga?" orqali tanlangan agent yonida bo'lsa — o'sha birinchi
      const f = s.focus ? crowd.get(s.focus) : undefined;
      if (f && Math.hypot(f.pos.x - w.pos.x, f.pos.z - w.pos.z) < 3.0) { best = { kind: "agent", id: f.id, name: names.get(f.id) || f.id }; bd = 0; }
      else for (const o of crowd.walkers.values()) {
        if (o.id === "me") continue;
        const d = Math.hypot(o.pos.x - w.pos.x, o.pos.z - w.pos.z);
        if (d < 1.7 && d < bd) { bd = d; best = { kind: "agent", id: o.id, name: names.get(o.id) || o.id }; }
      }
      if (!best && !s.sitting) {
        for (const seat of SEATS) {
          const d = Math.hypot(seat.x - w.pos.x, seat.z - w.pos.z);
          if (d > 1.35 || d >= bd) continue;
          let taken = false;
          for (const o of crowd.walkers.values()) if (o.id !== "me" && Math.hypot(o.pos.x - seat.x, o.pos.z - seat.z) < 0.4) taken = true;
          if (!taken) { bd = d; best = seat; }
        }
        if (!best) TEA_SPOTS.forEach((p, i) => { const d = Math.hypot(p.x - w.pos.x, p.z - w.pos.z); if (d < 1.4 && d < bd) { bd = d; best = { kind: "tea", key: `tea${i}` }; } });
      }
      // Yaqindagi (≤ 7 m) eng yaqin 5 agentning ismi ko'rinadi — qolganlari yashirin (tartibsizlik bo'lmasin)
      const nearList: [string, number][] = [];
      for (const o of crowd.walkers.values()) {
        if (o.id === "me") continue;
        const d = Math.hypot(o.pos.x - w.pos.x, o.pos.z - w.pos.z);
        if (d < 7) nearList.push([o.id, d]);
      }
      nearList.sort((x, y) => x[1] - y[1]);
      crowd.labels = new Set(nearList.slice(0, 5).map((x) => x[0]));
      // Yo'l ko'rsatgich: qolgan yo'l polda chiziq + manzilda halqa
      const ln = line.current, mk = marker.current;
      if (ln && mk) {
        const pts = w.path.length && !s.sitting ? [w.pos, ...w.path.slice(w.pi)] : [];
        if (pts.length >= 2) {
          const arr = ln.geometry.getAttribute("position") as THREE.BufferAttribute;
          const n = Math.min(pts.length, 64);
          for (let i = 0; i < n; i++) arr.setXYZ(i, pts[i].x, 0.06, pts[i].z);
          arr.needsUpdate = true;
          ln.geometry.setDrawRange(0, n);
          ln.computeLineDistances();
          ln.visible = true;
          mk.position.set(pts[n - 1].x, 0.05, pts[n - 1].z);
          mk.visible = true;
        } else { ln.visible = false; mk.visible = false; }
      }
      const b = best as Target | null;
      const key = !b ? "" : b.kind === "agent" ? `a:${b.id}` : b.kind === "seat" ? `s:${b.key}` : `t:${b.key}`;
      if (key !== s.nearKey) { s.nearKey = key; bridge.onNear(b); }
    }

    function standUp() {
      if (!s.seat) return;
      const seat = s.seat;
      s.seat = null;
      if (s.sitting) {
        s.sitting = false;
        bridge.onSeat(null);
        const i = entryCell(grid, seat, seat.face);
        if (i >= 0) {
          const c = cellCenter(i);
          crowd.setGoal("me", { key: `stand:${clock.elapsedTime}`, x: c.x, z: c.z, face: w!.rot });
        }
      } else crowd.setGoal("me", { key: `cancel:${clock.elapsedTime}`, x: w!.pos.x, z: w!.pos.z, face: w!.rot });
    }
  });

  // Telefonda polga tegish — o'sha joyga yo'l topib boradi
  const tap = useRef<{ x: number; y: number; t: number } | null>(null);
  const line = useRef<THREE.Line>(null);
  const marker = useRef<THREE.Mesh>(null);
  const lineGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(64 * 3), 3)); return g; }, []);
  useEffect(() => () => { lineGeo.dispose(); crowd.labels = new Set(); }, [lineGeo, crowd]);
  return (
    <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}
      onPointerDown={(e) => { tap.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, t: performance.now() }; }}
      onPointerUp={(e) => {
        const t0 = tap.current; tap.current = null;
        if (!t0 || e.nativeEvent.pointerType !== "touch" || performance.now() - t0.t > 350 || Math.hypot(e.nativeEvent.clientX - t0.x, e.nativeEvent.clientY - t0.y) > 12) return;
        bridge.cmds.push({ type: "goto", key: `tap${Math.round(e.point.x * 4)},${Math.round(e.point.z * 4)}`, x: e.point.x, z: e.point.z, face: 0 });
      }}>
      <planeGeometry args={[BOUNDS.x1 - BOUNDS.x0, BOUNDS.z1 - BOUNDS.z0]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    {/* @ts-expect-error — r3f <line> (SVG line emas) */}
    <line ref={line} geometry={lineGeo} visible={false} frustumCulled={false}>
      <lineDashedMaterial color="#f2c14e" dashSize={0.35} gapSize={0.22} linewidth={2} toneMapped={false} />
    </line>
    <mesh ref={marker} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.32, 0.46, 24]} />
      <meshBasicMaterial color="#f2c14e" transparent opacity={0.9} toneMapped={false} />
    </mesh>
    <group ref={root}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.44, 0.58, 32]} />
        <meshBasicMaterial color="#f2c14e" transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <group scale={1.2}><Mascot r={r} tint="#e8895f" color="#f2c14e" hat="player" /></group>
      <Html position={[0, 1.85, 0]} center zIndexRange={[25, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ padding: "2px 8px", borderRadius: 999, background: "#f2c14e", color: "#3b2a05", fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap", boxShadow: "0 1px 6px rgba(0,0,0,.25)" }}>
          ★ {youLabel}
        </div>
      </Html>
    </group>
    </>
  );
}
