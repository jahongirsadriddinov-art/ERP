import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Html, Instance, Instances, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OfficeAgent } from "./officeApi";
import {
  assignIdle, BOUNDS, buildGrid, CINEMA, computeLayout, findPath, GAME, KITCHEN, MANAGER_DESK, MANAGER_DOOR, MANAGER_ROOM, PLANTS,
  type Desk, type Grid, type P, type Poi, type Pose,
} from "./layout";

// AI ofis — 3D sahna (three.js + @react-three/fiber, faqat shu lazy chunk'da). Agentlar — Claude Code maskoti uslubidagi
// terrakota rangli "voxel" jonzotlar (qutilardan: tana, ikki qora ko'z, yon qo'llar, kalta oyoqlar), har biri o'z rangidagi
// shapka va nishon bilan. Band → stolida o'tiradi, golografik ekranda faollik (kod / to'lqin / chat / reja); bo'sh →
// oshxona, PlayStation, kinozal. Boshliq band agentlar stollarini aylanib chiqadi; Hisobotchi hisobot paytida stollardan
// qog'oz yig'adi. Kadrlar: dpr ≤ 1.75, sahifa yashirin bo'lsa yoki sahna ekrandan tashqarida — chizish to'xtaydi.

export const CLAUDE = "#D97757";
const EYE = "#1d1410";
const TEAM_RUG: Record<string, string> = {
  lead: "#f6dccf", platform: "#e1e5fb", apps: "#fbe8d2", ai: "#ecdcfb", ops: "#dcf0e4", growth: "#fbdfe6", assistants: "#d8eef8",
};
const SPEED = 2.6;
const CZ = (BOUNDS.z0 + BOUNDS.z1) / 2 + 1.2;
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
const SPHERE = new THREE.SphereGeometry(0.5, 18, 12);
const ICO = new THREE.IcosahedronGeometry(0.5, 0);
const mix = (a: string, b: string, t: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

type ScreenMode = "idle" | "code" | "wave" | "chat" | "review" | "plan" | "done" | "fail";
const screenMode = (a: OfficeAgent): ScreenMode => {
  if (a.activity === "task") return a.id === "manager" ? "plan" : "code";
  if (a.activity === "call") return "wave";
  if (a.activity === "chat") return "chat";
  if (a.activity === "review") return "review";
  if (a.task?.status === "done") return "done";
  if (a.task?.status === "failed") return "fail";
  return "idle";
};
const SCREEN_COLOR: Record<ScreenMode, string> = {
  idle: "#2a3550", code: "#0f1d2e", wave: "#0f2a26", chat: "#13203a", review: "#3a2a0c", plan: "#2c1a12", done: "#0f2e1c", fail: "#3a1010",
};

// ───────────── Asosiy komponent ─────────────
export interface OfficeSceneProps {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showAllLabels: boolean;
  compact: boolean;
}

export default function OfficeScene({ agents, selectedId, onSelect, showAllLabels, compact }: OfficeSceneProps) {
  const layoutKey = agents.map((a) => `${a.id}:${a.team}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout(agents.map((a) => ({ id: a.id, team: a.team }))), [layoutKey]);
  const grid = useMemo(() => buildGrid(layout.obstacles), [layout]);
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);

  // Sahifa yashirin yoki sahna ko'rinmasa — chizish to'xtaydi
  useEffect(() => {
    let visible = !document.hidden, onScreen = true;
    const upd = () => setActive(visible && onScreen);
    const onVis = () => { visible = !document.hidden; upd(); };
    document.addEventListener("visibilitychange", onVis);
    let io: IntersectionObserver | undefined;
    if (wrap.current && "IntersectionObserver" in window) {
      io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; upd(); });
      io.observe(wrap.current);
    }
    return () => { document.removeEventListener("visibilitychange", onVis); io?.disconnect(); };
  }, []);

  // Bo'sh agentlar dam olish joylari — har 45 s almashadi
  const [slot, setSlot] = useState(() => Math.floor(Date.now() / 45_000));
  useEffect(() => {
    const t = setInterval(() => setSlot(Math.floor(Date.now() / 45_000)), 5_000);
    return () => clearInterval(t);
  }, []);
  const roaming = (a: OfficeAgent) => a.activity === "idle" && !(a.id === "manager" && agents.some((x) => x.busy && x.id !== "manager"));
  const idleIds = agents.filter(roaming).map((a) => a.id);
  const idleKey = idleIds.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const poiOf = useMemo(() => assignIdle(idleIds, layout.pois, slot), [idleKey, slot, layout]);

  const busyChairs = agents.filter((a) => a.busy && a.id !== "manager").map((a) => layout.desks.get(a.id)).filter(Boolean) as Desk[];
  const busyKey = busyChairs.map((d) => d.id).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const managerTour = useMemo(() => busyChairs.slice(0, 6).map((d) => ({ x: d.chair.x + 0.85, z: d.chair.z, face: d.dir > 0 ? Math.PI / 2 : -Math.PI / 2 })), [busyKey]);
  const othersKey = agents.filter((a) => a.id !== "reporter" && a.id !== "manager" && layout.desks.has(a.id)).map((a) => a.id).join("|");
  const reporterTour = useMemo(() => {
    const ids = othersKey.split("|").filter(Boolean);
    return ids.filter((_, i) => i % Math.max(1, Math.floor(ids.length / 5)) === 0).slice(0, 5)
      .map((id) => { const d = layout.desks.get(id)!; return { x: d.chair.x - 0.85, z: d.chair.z, face: d.dir > 0 ? -Math.PI / 2 : Math.PI / 2 }; });
  }, [othersKey, layout]);

  return (
    <div ref={wrap} className="absolute inset-0" data-testid="ai-office-canvas-wrap">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        frameloop={active ? "always" : "never"}
        camera={{ position: [0, 40, 30], fov: compact ? 44 : 36, near: 0.5, far: 250 }}
        gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
        onPointerMissed={() => onSelect(null)}
        data-testid="ai-office-canvas"
      >
        <color attach="background" args={["#efe9e1"]} />
        <fog attach="fog" args={["#efe9e1", 70, 120]} />
        <Lights />
        <Building />
        {layout.zones.map((z) => <Rug key={z.team} x={z.x} z={z.z} w={z.w} d={z.d} color={TEAM_RUG[z.team] || "#eee"} />)}
        <ManagerRoom />
        <DeskSet desks={[...layout.desks.values()]} agents={agents} />
        <Kitchen />
        <GameCorner />
        <Cinema />
        {PLANTS.map((p, i) => <Plant key={i} x={p.x} z={p.z} s={0.8 + (i % 3) * 0.18} />)}
        {agents.map((a) => {
          const desk = layout.desks.get(a.id);
          if (!desk) return null;
          const pi = poiOf.get(a.id);
          const tour = a.id === "manager" && a.activity === "idle" && managerTour.length ? managerTour
            : a.id === "reporter" && a.activity === "task" && a.since && Date.now() - Date.parse(a.since) < 25_000 ? reporterTour : undefined;
          return (
            <Agent key={a.id} agent={a} desk={desk} poi={pi !== undefined ? layout.pois[pi] : undefined} tour={tour} grid={grid}
              selected={selectedId === a.id} showLabel={showAllLabels || a.busy || selectedId === a.id || a.activity === "review" || !!a.task && a.task.status !== "queued"}
              onSelect={onSelect} />
          );
        })}
        <Controls compact={compact} />
      </Canvas>
    </div>
  );
}

/** Kamerani ofisga moslash: kompyuterda — old tomondan 3/4 ko'rinish; telefonda — yon tomondan (uzun o'q ekran bo'ylab). */
function fitCamera(camera: THREE.PerspectiveCamera, aspect: number, compact: boolean) {
  const polar = compact ? 0.6 : 0.66;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const L = compact ? 42 : 27, W = compact ? 27 : 42;
  const V = L * Math.cos(polar) + 3 * Math.sin(polar);
  const tanV = Math.tan(fov / 2);
  const d = Math.max(V / 2 / tanV, ((compact ? 0.82 : 1) * W) / 2 / (tanV * aspect)) * (compact ? 1.04 : 1.16);
  const az = compact ? Math.PI / 2 : 0;
  camera.position.set(Math.sin(polar) * Math.sin(az) * d, Math.cos(polar) * d, Math.sin(polar) * Math.cos(az) * d + CZ);
  camera.lookAt(0, 0, CZ);
  camera.updateProjectionMatrix();
}

function Controls({ compact }: { compact: boolean }) {
  const ref = useRef<any>(null);
  const { camera, size } = useThree();
  const fitted = useRef("");
  useEffect(() => {
    const key = `${compact}:${Math.round((size.width / size.height) * 20)}`;
    if (fitted.current === key) return;
    fitted.current = key;
    fitCamera(camera as THREE.PerspectiveCamera, size.width / size.height, compact);
    if (ref.current) { ref.current.target.set(0, 0, CZ); ref.current.update(); }
  }, [camera, size.width, size.height, compact]);
  return (
    <OrbitControls ref={ref} makeDefault enableDamping dampingFactor={0.08} target={[0, 0, CZ]}
      minDistance={8} maxDistance={90} minPolarAngle={0.12} maxPolarAngle={1.18} screenSpacePanning={false}
      onChange={() => {
        // Kamera markazi ofisdan chiqib ketmasin
        const t = ref.current?.target as THREE.Vector3 | undefined;
        if (t) { t.x = THREE.MathUtils.clamp(t.x, -18, 18); t.z = THREE.MathUtils.clamp(t.z, -13, 10); t.y = 0; }
      }} />
  );
}

function Lights() {
  return (
    <>
      <hemisphereLight args={["#fff7ee", "#d6cabd", 1.15]} />
      <directionalLight position={[16, 30, 14]} intensity={1.7} color="#fff1e2" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-28} shadow-camera-right={28} shadow-camera-top={22} shadow-camera-bottom={-22} shadow-camera-near={5} shadow-camera-far={80} />
      <directionalLight position={[-20, 14, 20]} intensity={0.35} color="#cfe0ff" />
    </>
  );
}

const Box = ({ p, s, c, r, cast = false, recv = false, e, ei = 1, rough = 0.85, metal = 0, o }: {
  p: [number, number, number]; s: [number, number, number]; c: string; r?: [number, number, number]; cast?: boolean; recv?: boolean;
  e?: string; ei?: number; rough?: number; metal?: number; o?: number;
}) => (
  <mesh geometry={BOX} position={p} scale={s} rotation={r} castShadow={cast} receiveShadow={recv}>
    <meshStandardMaterial color={c} roughness={rough} metalness={metal} emissive={e || "#000"} emissiveIntensity={e ? ei : 0}
      transparent={o !== undefined} opacity={o ?? 1} />
  </mesh>
);

function Building() {
  const B = BOUNDS;
  const w = B.x1 - B.x0, d = B.z1 - B.z0, cz = (B.z0 + B.z1) / 2;
  return (
    <group>
      {/* Pol plitasi (diorama) */}
      <Box p={[0, -0.25, cz]} s={[w + 1, 0.5, d + 1]} c="#efe6da" recv />
      <Box p={[0, -0.75, cz]} s={[w + 1.2, 0.5, d + 1.2]} c="#cdbfae" />
      {/* Yo'laklar */}
      {[-6.6, 1.6].map((z) => <Box key={z} p={[0, 0.005, z]} s={[w - 1, 0.01, 1.3]} c="#e7ddcf" recv />)}
      {/* Orqa va chap devorlar (kesma ko'rinish) */}
      <Box p={[0, 1.4, B.z0 - 0.35]} s={[w + 1, 2.8, 0.3]} c="#f8f3ec" recv />
      <Box p={[B.x0 - 0.35, 1.4, cz]} s={[0.3, 2.8, d + 1]} c="#f3ede4" recv />
      <Box p={[0, 2.82, B.z0 - 0.35]} s={[w + 1, 0.06, 0.34]} c={CLAUDE} />
      <Box p={[B.x0 - 0.35, 2.82, cz]} s={[0.34, 0.06, d + 1]} c={CLAUDE} />
      {/* Yuqori derazalar qatori */}
      {[-17.2, -8.6, 2.6, 15.4].map((x) => <Box key={x} p={[x, 2.32, B.z0 - 0.19]} s={[x === 15.4 ? 3 : 4.6, 0.55, 0.04]} c="#dbeaf7" e="#cfe6ff" ei={0.35} />)}
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

function Rug({ x, z, w, d, color }: { x: number; z: number; w: number; d: number; color: string }) {
  return (
    <group position={[x, 0.012, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[w + 0.3, d + 0.3]} />
        <meshStandardMaterial color={mix(color, "#8a7a6a", 0.25)} roughness={1} />
      </mesh>
    </group>
  );
}

function ManagerRoom() {
  const R = MANAGER_ROOM;
  const glass = "#cfe8fb";
  const cx = (R.x0 + R.x1) / 2;
  return (
    <group>
      {/* Shisha devorlar + ramka */}
      <Box p={[R.x1, 1.2, (R.z0 + R.z1) / 2]} s={[0.06, 2.4, R.z1 - R.z0]} c={glass} o={0.22} rough={0.1} />
      <Box p={[(R.x0 + MANAGER_DOOR.x0) / 2, 1.2, R.z1]} s={[MANAGER_DOOR.x0 - R.x0, 2.4, 0.06]} c={glass} o={0.22} rough={0.1} />
      <Box p={[(MANAGER_DOOR.x1 + R.x1) / 2, 1.2, R.z1]} s={[R.x1 - MANAGER_DOOR.x1, 2.4, 0.06]} c={glass} o={0.22} rough={0.1} />
      <Box p={[R.x1, 2.42, (R.z0 + R.z1) / 2]} s={[0.1, 0.06, R.z1 - R.z0]} c="#3a3f4b" />
      <Box p={[cx, 2.42, R.z1]} s={[R.x1 - R.x0, 0.06, 0.1]} c="#3a3f4b" />
      {[R.x0 + 0.2, MANAGER_DOOR.x0, MANAGER_DOOR.x1, R.x1].map((x) => <Box key={x} p={[x, 1.2, R.z1]} s={[0.1, 2.4, 0.1]} c="#3a3f4b" />)}
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

// ───────────── Stollar (instanslangan) ─────────────
function DeskSet({ desks, agents }: { desks: Desk[]; agents: OfficeAgent[] }) {
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const regular = desks.filter((d) => d.team !== "lead");
  const n = Math.max(1, regular.length);
  return (
    <group>
      {/* Stol usti */}
      <Instances geometry={BOX} limit={n} castShadow receiveShadow>
        <meshStandardMaterial color="#fbf8f3" roughness={0.55} />
        {regular.map((d) => <Instance key={d.id} position={[d.x, 0.74, d.z]} scale={[1.6, 0.06, 0.8]} />)}
      </Instances>
      {/* Oyoqlar (har stolda 2 panel) */}
      <Instances geometry={BOX} limit={n * 2}>
        <meshStandardMaterial color="#30333b" roughness={0.6} />
        {regular.flatMap((d) => [-0.72, 0.72].map((dx) => <Instance key={`${d.id}${dx}`} position={[d.x + dx, 0.36, d.z]} scale={[0.05, 0.72, 0.7]} />))}
      </Instances>
      {/* Klaviatura */}
      <Instances geometry={BOX} limit={n + 1}>
        <meshStandardMaterial color="#e8e6e1" roughness={0.5} />
        {desks.map((d) => <Instance key={d.id} position={[d.x, 0.79, d.z - d.dir * 0.16]} scale={[0.5, 0.025, 0.16]} />)}
      </Instances>
      {/* Monitor korpusi + oyog'i */}
      <Instances geometry={BOX} limit={(n + 1) * 2} castShadow>
        <meshStandardMaterial color="#1c1e23" roughness={0.4} metalness={0.2} />
        {desks.flatMap((d) => [
          <Instance key={`${d.id}b`} position={[d.x, 1.12, d.z + d.dir * 0.2]} scale={[d.team === "lead" ? 1.3 : 0.86, 0.52, 0.04]} />,
          <Instance key={`${d.id}s`} position={[d.x, 0.88, d.z + d.dir * 0.24]} scale={[0.06, 0.22, 0.06]} />,
        ])}
      </Instances>
      {/* Stullar: o'rindiq, suyanchiq, oyoq */}
      <Instances geometry={BOX} limit={(n + 1) * 2} castShadow>
        <meshStandardMaterial color="#ffffff" roughness={0.7} />
        {desks.flatMap((d) => [
          <Instance key={`${d.id}c`} position={[d.chair.x, 0.46, d.chair.z]} scale={[0.56, 0.08, 0.52]} color={mix(TEAM_RUG[d.team] || "#ddd", "#5b6474", 0.45)} />,
          <Instance key={`${d.id}k`} position={[d.chair.x, 0.78, d.chair.z - d.dir * 0.3]} scale={[0.52, 0.55, 0.07]} color={mix(TEAM_RUG[d.team] || "#ddd", "#5b6474", 0.55)} />,
        ])}
      </Instances>
      <Instances geometry={CYL} limit={n + 1}>
        <meshStandardMaterial color="#8d939e" metalness={0.6} roughness={0.35} />
        {desks.map((d) => <Instance key={d.id} position={[d.chair.x, 0.22, d.chair.z]} scale={[0.07, 0.44, 0.07]} />)}
      </Instances>
      {/* Har stolda — kichik buyumlar (krujka / o'simlik) */}
      <Instances geometry={CYL} limit={n + 1}>
        <meshStandardMaterial color="#f4efe9" roughness={0.6} />
        {desks.map((d, i) => <Instance key={d.id} position={[d.x + (i % 2 ? 0.58 : -0.58), 0.83, d.z - d.dir * 0.1]} scale={[0.09, 0.12, 0.09]} color={i % 3 === 0 ? CLAUDE : i % 3 === 1 ? "#f4efe9" : "#5b8def"} />)}
      </Instances>
      {desks.map((d) => <Screen key={d.id} desk={d} mode={byId.get(d.id) ? screenMode(byId.get(d.id)!) : "idle"} wide={d.team === "lead"} printer={d.id === "reporter"} />)}
    </group>
  );
}

/** Monitor ekrani (agentga qaragan) + band paytda kamera tomon qaragan golografik panel. */
const Screen = memo(function Screen({ desk, mode, wide, printer }: { desk: Desk; mode: ScreenMode; wide: boolean; printer: boolean }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const holo = useRef<THREE.Group>(null);
  const bars = useRef<(THREE.Mesh | null)[]>([]);
  const paper = useRef<THREE.Mesh>(null);
  const col = SCREEN_COLOR[mode];
  const glow = mode === "idle" ? "#3b5b9a" : mode === "fail" ? "#ff3b30" : mode === "done" ? "#34c759" : mode === "review" ? "#ffb020" : mode === "wave" ? "#2dd4bf" : mode === "plan" ? CLAUDE : "#5ea8ff";
  const offset = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + offset;
    if (mat.current) mat.current.emissiveIntensity = mode === "idle" ? 0.35 : mode === "fail" ? 0.8 + Math.sin(t * 6) * 0.4 : 0.9 + Math.sin(t * 2) * 0.1;
    if (holo.current) {
      holo.current.position.y = Math.sin(t * 1.6) * 0.04;
      bars.current.forEach((b, i) => {
        if (!b) return;
        if (mode === "code" || mode === "plan") {
          // "kod" qatorlari pastga siljiydi, uzunligi o'zgaradi
          const row = (i + t * 1.6) % 6;
          b.position.set(-0.32 + ((i * 37) % 5) * 0.03 + (b.scale.x / 2), 0.2 - row * 0.08, 0.01);
          b.scale.set(0.15 + ((i * 53 + Math.floor(t * 1.6 + i)) % 7) * 0.06, 0.03, 0.01);
        } else if (mode === "wave") {
          b.position.set(-0.3 + i * 0.075, 0, 0.01);
          b.scale.set(0.04, 0.05 + Math.abs(Math.sin(t * 7 + i * 0.9)) * 0.3, 0.01);
        } else if (mode === "chat") {
          const k = i % 3;
          b.position.set(k === 1 ? 0.08 : -0.08, 0.16 - k * 0.15, 0.01);
          b.scale.set(i < 3 ? 0.42 + Math.sin(t + i) * 0.05 : 0.001, 0.1, 0.01);
        } else {
          b.scale.set(0.001, 0.001, 0.001);
        }
      });
    }
    if (paper.current) {
      const k = mode === "code" ? (t * 0.5) % 1 : 0;
      paper.current.position.set(0, 0.22 + k * 0.02, 0.12 + k * 0.25);
      paper.current.visible = mode === "code";
    }
  });
  const showHolo = mode !== "idle";
  return (
    <group>
      <mesh position={[desk.x, 1.12, desk.z + desk.dir * 0.177]} rotation={[0, desk.dir > 0 ? Math.PI : 0, 0]}>
        <planeGeometry args={[wide ? 1.22 : 0.78, 0.44]} />
        <meshStandardMaterial ref={mat} color={col} emissive={glow} emissiveIntensity={0.5} roughness={0.3} />
      </mesh>
      {showHolo && (
        <Billboard position={[desk.x, 1.72, desk.z + desk.dir * 0.2]}>
          <group ref={holo}>
            <mesh>
              <planeGeometry args={[0.86, 0.6]} />
              <meshBasicMaterial color={glow} transparent opacity={0.16} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0, -0.005]}>
              <planeGeometry args={[0.9, 0.64]} />
              <meshBasicMaterial color={glow} transparent opacity={0.08} depthWrite={false} />
            </mesh>
            {(mode === "review" || mode === "done" || mode === "fail") ? (
              <StatusGlyph mode={mode} color={glow} />
            ) : (
              Array.from({ length: 9 }, (_, i) => (
                <mesh key={i} ref={(m) => { bars.current[i] = m; }} geometry={BOX}>
                  <meshBasicMaterial color={mode === "chat" ? (i % 2 ? "#ffffff" : glow) : glow} toneMapped={false} />
                </mesh>
              ))
            )}
          </group>
        </Billboard>
      )}
      {printer && (
        <group position={[desk.x + 1.05, 0.74, desk.z]}>
          <Box p={[0, 0.12, 0]} s={[0.5, 0.24, 0.4]} c="#e9e6e0" cast />
          <Box p={[0, 0.25, -0.05]} s={[0.4, 0.03, 0.2]} c="#2b2d33" />
          <mesh ref={paper} geometry={BOX} scale={[0.3, 0.01, 0.4]}><meshStandardMaterial color="#ffffff" /></mesh>
        </group>
      )}
    </group>
  );
});

function StatusGlyph({ mode, color }: { mode: ScreenMode; color: string }) {
  const m = <meshBasicMaterial color={color} toneMapped={false} />;
  if (mode === "done") return (
    <group>
      <mesh geometry={BOX} position={[-0.08, -0.04, 0.01]} rotation={[0, 0, Math.PI / 4]} scale={[0.07, 0.2, 0.01]}>{m}</mesh>
      <mesh geometry={BOX} position={[0.07, 0.03, 0.01]} rotation={[0, 0, -Math.PI / 4]} scale={[0.07, 0.36, 0.01]}>{m}</mesh>
    </group>
  );
  if (mode === "fail") return (
    <group>
      <mesh geometry={BOX} position={[0, 0.05, 0.01]} scale={[0.08, 0.28, 0.01]}>{m}</mesh>
      <mesh geometry={BOX} position={[0, -0.18, 0.01]} scale={[0.08, 0.08, 0.01]}>{m}</mesh>
    </group>
  );
  return (
    <group>
      <mesh geometry={BOX} position={[0, 0.17, 0.01]} scale={[0.24, 0.06, 0.01]}>{m}</mesh>
      <mesh geometry={BOX} position={[0.1, 0.08, 0.01]} scale={[0.06, 0.16, 0.01]}>{m}</mesh>
      <mesh geometry={BOX} position={[0.02, -0.01, 0.01]} scale={[0.14, 0.06, 0.01]}>{m}</mesh>
      <mesh geometry={BOX} position={[0, -0.18, 0.01]} scale={[0.07, 0.07, 0.01]}>{m}</mesh>
    </group>
  );
}

// ───────────── Dam olish zonalari ─────────────
function Kitchen() {
  const c = KITCHEN.counter, t = KITCHEN.table, f = KITCHEN.fridge, cm = KITCHEN.coffee;
  const steam = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (steam.current) {
      const k = (clock.elapsedTime * 0.6) % 1;
      steam.current.position.y = 1.55 + k * 0.5;
      (steam.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
    }
  });
  const cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  return (
    <group>
      <Rug x={-8.4} z={-11.2} w={8.6} d={6.6} color="#f3ead8" />
      <Box p={[cx, 0.45, cz]} s={[c.x1 - c.x0, 0.9, c.z1 - c.z0]} c="#9fc3b6" cast recv />
      <Box p={[cx, 0.93, cz]} s={[c.x1 - c.x0 + 0.1, 0.06, c.z1 - c.z0 + 0.1]} c="#f6f2ec" rough={0.4} />
      {/* Yuqori shkaflar */}
      <Box p={[cx, 2.0, c.z0 + 0.22]} s={[c.x1 - c.x0, 0.75, 0.45]} c="#b9d6cb" />
      {/* Kofe mashinasi + bug' */}
      <Box p={[cm.x, 1.22, cm.z]} s={[0.6, 0.55, 0.45]} c="#1f2226" cast metal={0.3} rough={0.3} />
      <Box p={[cm.x, 1.3, cm.z + 0.235]} s={[0.12, 0.05, 0.02]} c="#ff4d3d" e="#ff4d3d" ei={2} />
      <mesh ref={steam} position={[cm.x, 1.6, cm.z + 0.1]} geometry={SPHERE} scale={0.14}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      {/* Muzlatgich */}
      <Box p={[f.x, 1.1, f.z]} s={[0.9, 2.2, 0.9]} c="#e6e9ee" cast metal={0.2} rough={0.35} />
      <Box p={[f.x + 0.3, 1.35, f.z + 0.46]} s={[0.05, 0.5, 0.04]} c="#9aa3ad" />
      {/* Meva savati */}
      <mesh geometry={SPHERE} position={[-7.2, 1.05, cz]} scale={[0.5, 0.2, 0.5]}><meshStandardMaterial color="#c58b52" /></mesh>
      {["#ff6b4a", "#ffd23f", "#7bd389"].map((c2, i) => <mesh key={c2} geometry={SPHERE} position={[-7.35 + i * 0.15, 1.15, cz]} scale={0.16}><meshStandardMaterial color={c2} /></mesh>)}
      {/* Stol + kursilar */}
      <mesh geometry={CYL} position={[t.x, 0.74, t.z]} scale={[1.7, 0.06, 1.7]} castShadow receiveShadow><meshStandardMaterial color="#fbf7f1" roughness={0.5} /></mesh>
      <mesh geometry={CYL} position={[t.x, 0.37, t.z]} scale={[0.12, 0.74, 0.12]}><meshStandardMaterial color="#30333b" /></mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return <mesh key={i} geometry={CYL} position={[t.x + Math.cos(a) * 1.35, 0.25, t.z + Math.sin(a) * 1.35]} scale={[0.42, 0.5, 0.42]} castShadow><meshStandardMaterial color={["#f2a541", "#5b8def", CLAUDE, "#7bd389"][i]} /></mesh>;
      })}
      <mesh geometry={CYL} position={[t.x + 0.3, 0.84, t.z - 0.2]} scale={[0.12, 0.14, 0.12]}><meshStandardMaterial color={CLAUDE} /></mesh>
    </group>
  );
}

function GameCorner() {
  const tv = useRef<THREE.MeshStandardMaterial>(null);
  const led = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (tv.current) tv.current.emissive.setHSL((t * 0.08) % 1, 0.75, 0.5);
    if (led.current) led.current.emissiveIntensity = 1.5 + Math.sin(t * 3) * 0.8;
  });
  const s = GAME.sofa, st = GAME.stand, tb = GAME.table, T = GAME.tv;
  return (
    <group>
      <Rug x={2.6} z={-11.6} w={7.4} d={6.2} color="#dfe6f2" />
      {/* TV + stend + PlayStation */}
      <Box p={[(st.x0 + st.x1) / 2, 0.3, (st.z0 + st.z1) / 2]} s={[st.x1 - st.x0, 0.6, st.z1 - st.z0]} c="#2c2f36" cast />
      <Box p={[T.x, 1.55, T.z - 0.1]} s={[3.0, 1.7, 0.08]} c="#111215" cast />
      <mesh position={[T.x, 1.55, T.z - 0.055]}>
        <planeGeometry args={[2.85, 1.58]} />
        <meshStandardMaterial ref={tv} color="#111" emissive="#4466ff" emissiveIntensity={0.9} />
      </mesh>
      <Box p={[T.x + 0.9, 0.68, st.z0 + 0.6]} s={[0.55, 0.16, 0.4]} c="#f2f2f4" metal={0.1} rough={0.3} />
      <mesh geometry={BOX} position={[T.x + 0.9, 0.68, st.z0 + 0.81]} scale={[0.5, 0.02, 0.01]}>
        <meshStandardMaterial ref={led} color="#2f6bff" emissive="#2f6bff" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      {/* Divan (TV tomonga qaragan, suyanchig'i kameraga) */}
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

function Cinema() {
  const scr = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (scr.current) scr.current.emissive.setHSL((0.55 + Math.sin(t * 0.3) * 0.12) % 1, 0.5, 0.45 + Math.sin(t * 2.3) * 0.08);
  });
  const S = CINEMA.screen;
  const bagColors = ["#e85d75", "#f2a541", "#5b8def", "#7bd389", "#b57edc", CLAUDE, "#3fa7a0"];
  return (
    <group>
      <Rug x={15.4} z={-11.2} w={10.6} d={7.2} color="#2f3442" />
      <Box p={[S.x, 1.75, S.z - 0.08]} s={[S.w + 0.4, 2.7, 0.1]} c="#15171c" />
      <mesh position={[S.x, 1.75, S.z - 0.02]}>
        <planeGeometry args={[S.w, 2.4]} />
        <meshStandardMaterial ref={scr} color="#222" emissive="#557799" emissiveIntensity={1.1} />
      </mesh>
      {/* Pardalar */}
      <Box p={[S.x - S.w / 2 - 0.4, 1.4, S.z + 0.1]} s={[0.5, 2.8, 0.3]} c="#9b2335" cast />
      <Box p={[S.x + S.w / 2 + 0.4, 1.4, S.z + 0.1]} s={[0.5, 2.8, 0.3]} c="#9b2335" cast />
      {CINEMA.bags.map(([x, z], i) => (
        <mesh key={i} geometry={SPHERE} position={[x, 0.28, z - 0.1]} scale={[1.05, 0.55, 1.05]} castShadow>
          <meshStandardMaterial color={bagColors[i % bagColors.length]} roughness={0.9} />
        </mesh>
      ))}
      {/* Popkorn mashinasi */}
      <Box p={[20.2, 0.7, -10.6]} s={[0.8, 1.4, 0.8]} c="#d62839" cast />
      <Box p={[20.2, 1.15, -10.6]} s={[0.66, 0.5, 0.66]} c="#fff4d6" e="#ffe08a" ei={0.6} o={0.85} />
    </group>
  );
}

function Plant({ x, z, s }: { x: number; z: number; s: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh geometry={CYL} position={[0, 0.3, 0]} scale={[0.55, 0.6, 0.55]} castShadow><meshStandardMaterial color="#e9e2d8" roughness={0.8} /></mesh>
      <mesh geometry={ICO} position={[0, 1.0, 0]} scale={[0.95, 1.1, 0.95]} castShadow><meshStandardMaterial color="#4f9d69" flatShading roughness={0.9} /></mesh>
      <mesh geometry={ICO} position={[0.22, 1.45, 0.1]} scale={0.6} castShadow><meshStandardMaterial color="#62b37b" flatShading roughness={0.9} /></mesh>
    </group>
  );
}

// ───────────── Agent (Claude Code maskoti uslubida) ─────────────
interface Goal extends P { key: string; face: number; pose: Pose | "work" | "relax" | "think" | "visit" }

const Agent = memo(function Agent({ agent, desk, poi, tour, grid, selected, showLabel, onSelect }: {
  agent: OfficeAgent; desk: Desk; poi?: Poi; tour?: { x: number; z: number; face: number }[]; grid: Grid;
  selected: boolean; showLabel: boolean; onSelect: (id: string | null) => void;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legs = useRef<(THREE.Mesh | null)[]>([]);
  const arms = useRef<(THREE.Group | null)[]>([]);
  const ring = useRef<THREE.Mesh>(null);
  const confetti = useRef<THREE.InstancedMesh>(null);
  const prop = useRef<{ cup: THREE.Mesh | null; pad: THREE.Mesh | null; papers: THREE.Mesh | null }>({ cup: null, pad: null, papers: null });
  const isBoss = agent.id === "manager";
  const tint = useMemo(() => mix(CLAUDE, agent.color || CLAUDE, agent.kind === "tg" ? 0 : 0.16), [agent.color, agent.kind]);
  const st = useRef({
    pos: { x: desk.chair.x, z: desk.chair.z }, rot: 0, path: [] as P[], pi: 0, key: "", arrived: true, dwellUntil: 0, tourIdx: 0,
    goal: null as Goal | null, celebrateAt: -1, prevTask: agent.task?.status, init: false, phase: Math.random() * 10,
  });

  // Agent nima qilishi kerak (tur bo'lmasa)
  const deskGoal = (pose: Goal["pose"]): Goal => ({ key: `desk:${pose}`, x: desk.chair.x, z: desk.chair.z, face: desk.dir > 0 ? 0 : Math.PI, pose });
  const baseGoal: Goal = agent.activity === "task" || agent.activity === "chat" || agent.activity === "call" ? deskGoal("work")
    : agent.activity === "review" ? deskGoal("think")
      : poi ? { key: `poi:${poi.x},${poi.z}`, x: poi.x, z: poi.z, face: poi.face, pose: poi.pose }
        : deskGoal("relax");

  // Bayram: vazifa "done" bo'lganda (yoki yangi ko'rilganda yaqinda tugagan bo'lsa)
  useEffect(() => {
    const s = st.current;
    const now = performance.now() / 1000;
    const status = agent.task?.status;
    if (status === "done" && s.prevTask !== "done") {
      const fresh = !agent.task?.finishedAt || Date.now() - Date.parse(agent.task.finishedAt) < 30_000 || (s.prevTask && s.prevTask !== "done");
      if (fresh) s.celebrateAt = now;
    }
    s.prevTask = status;
  }, [agent.task?.status, agent.task?.finishedAt]);

  useFrame(({ clock }, dtRaw) => {
    const s = st.current;
    const g = root.current;
    if (!g) return;
    const dt = Math.min(dtRaw, 0.05);
    const t = clock.elapsedTime + s.phase;
    const now = clock.elapsedTime;

    // Maqsad: tur (Boshliq / Hisobotchi) yoki asosiy
    let goal: Goal = baseGoal;
    if (tour && tour.length) {
      if (s.arrived && s.key.startsWith("tour:") && now > s.dwellUntil) s.tourIdx = (s.tourIdx + 1) % tour.length;
      const p = tour[s.tourIdx % tour.length];
      goal = { key: `tour:${s.tourIdx}:${p.x},${p.z}`, x: p.x, z: p.z, face: p.face, pose: "visit" };
    }
    if (!s.init) {
      s.init = true; s.pos = { x: goal.x, z: goal.z }; s.rot = goal.face; s.key = goal.key; s.arrived = true; s.goal = goal;
    }
    if (goal.key !== s.key) {
      s.path = findPath(grid, s.pos, goal);
      s.pi = 1; s.key = goal.key; s.arrived = false; s.goal = goal;
    }
    // Yurish
    let walking = false;
    if (!s.arrived) {
      let left = SPEED * dt;
      while (left > 0 && s.pi < s.path.length) {
        const tgt = s.path[s.pi];
        const dx = tgt.x - s.pos.x, dz = tgt.z - s.pos.z;
        const d = Math.hypot(dx, dz);
        if (d <= left) { s.pos = { x: tgt.x, z: tgt.z }; left -= d; s.pi++; }
        else { s.pos = { x: s.pos.x + (dx / d) * left, z: s.pos.z + (dz / d) * left }; left = 0; s.rot = lerpAngle(s.rot, Math.atan2(dx, dz), Math.min(1, dt * 10)); }
      }
      walking = true;
      if (s.pi >= s.path.length) { s.arrived = true; s.dwellUntil = now + (goal.pose === "visit" ? 2.2 : 0); }
    } else {
      s.rot = lerpAngle(s.rot, goal.face, Math.min(1, dt * 6));
    }
    const pose = walking ? "walk" : goal.pose;
    g.position.set(s.pos.x, 0, s.pos.z);
    g.rotation.y = s.rot;

    // Poza va animatsiya
    const b = body.current;
    if (b) {
      let y = 0, tiltX = 0, tiltZ = 0;
      const seated = pose === "work" || pose === "relax" || pose === "think" || pose === "sit" || pose === "game";
      if (pose === "walk") y = Math.abs(Math.sin(t * 11)) * 0.06;
      else if (seated) y = pose === "sit" ? 0.3 : 0.32;
      else if (pose === "beanbag") { y = 0.22; tiltX = -0.35; }
      else y = Math.sin(t * 2) * 0.012;
      if (pose === "relax") tiltX = -0.18;
      if (pose === "think") tiltZ = Math.sin(t * 1.2) * 0.12;
      if (pose === "game") tiltZ = Math.sin(t * 3.1) * 0.1;
      if (pose === "beanbag") y += Math.sin(t * 1.5) * 0.01;
      // Bayram — sakrash
      const since = now - (s.celebrateAt < 0 ? -99 : s.celebrateAt);
      const celebrating = s.celebrateAt >= 0 && since < 3;
      if (celebrating) y += Math.abs(Math.sin(since * 9)) * 0.35;
      if (pose === "stand" && (s.phase * 10) % 3 < 1 && agent.activity === "idle" && Math.sin(t * 0.7) > 0.93) y += Math.abs(Math.sin(t * 9)) * 0.15; // tomoshabin quvonchi
      b.position.y = y;
      b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, tiltX, Math.min(1, dt * 5));
      b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, tiltZ, Math.min(1, dt * 5));
      // Oyoqlar
      legs.current.forEach((l, i) => {
        if (!l) return;
        const sw = pose === "walk" ? Math.sin(t * 11 + (i % 2 ? Math.PI : 0)) * 0.6 : 0;
        l.rotation.x = sw;
        l.position.z = seated ? 0.12 : 0;
        l.scale.y = seated ? 0.6 : 1;
      });
      // Qo'llar
      arms.current.forEach((a, i) => {
        if (!a) return;
        let rx = 0, rz = 0;
        if (pose === "walk") rx = Math.sin(t * 11 + (i ? 0 : Math.PI)) * 0.6;
        else if (pose === "work") rx = agent.activity === "call" ? (i ? -1.9 : -0.2) : -0.9 + Math.sin(t * 18 + i * 1.7) * 0.18;
        else if (pose === "game") rx = -1.1 + Math.sin(t * 14 + i) * 0.12;
        else if (pose === "coffee" || pose === "sit") rx = i ? -1.2 + Math.max(0, Math.sin(t * 0.8)) * -0.5 : 0;
        else if (pose === "visit") rx = i ? -0.9 : 0;
        else if (pose === "think") rx = i ? -2.1 : 0;
        if (celebrating) { rx = -2.6; rz = (i ? -1 : 1) * 0.4; }
        a.rotation.x = THREE.MathUtils.lerp(a.rotation.x, rx, Math.min(1, dt * 12));
        a.rotation.z = THREE.MathUtils.lerp(a.rotation.z, rz, Math.min(1, dt * 12));
      });
      const pr = prop.current;
      if (pr.cup) pr.cup.visible = !walking && (pose === "coffee" || pose === "sit");
      if (pr.pad) pr.pad.visible = !walking && pose === "game";
      if (pr.papers) pr.papers.visible = agent.id === "reporter" && !!tour;
    }
    // Ish halqasi (progress ring) — vazifa bajarilayotganda
    if (ring.current) {
      ring.current.visible = agent.activity === "task" || agent.activity === "review";
      ring.current.rotation.z = -t * 2.2;
      ring.current.position.y = 1.55 + (b?.position.y || 0);
    }
    // Konfetti
    const cf = confetti.current;
    if (cf) {
      const since = now - s.celebrateAt;
      const on = s.celebrateAt >= 0 && since < 2.8;
      cf.visible = on;
      if (on) {
        for (let i = 0; i < CONFETTI; i++) {
          const a = (i / CONFETTI) * Math.PI * 2 * 3.7;
          const v = 1.2 + (i % 5) * 0.35;
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
  const scale = isBoss ? 1.55 : 1.3;
  const statusDot = agent.activity === "task" ? "#5ea8ff" : agent.activity === "call" ? "#2dd4bf" : agent.activity === "chat" ? "#a78bfa"
    : agent.activity === "review" ? "#ffb020" : failed ? "#ff3b30" : agent.task?.status === "done" ? "#34c759" : "#b8b2aa";

  return (
    <group ref={root} onClick={click} onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = ""; }}>
      {/* Tanlangan / xato halqasi polda */}
      {(selected || failed) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.48, 0.62, 32]} />
          <meshBasicMaterial color={failed ? "#ff3b30" : agent.color} transparent opacity={0.85} toneMapped={false} />
        </mesh>
      )}
      <group ref={body} scale={scale}>
        {/* Oyoqlar — 4 ta kalta */}
        {[-0.22, -0.08, 0.08, 0.22].map((x, i) => (
          <mesh key={x} ref={(m) => { legs.current[i] = m; }} geometry={BOX} position={[x, 0.09, 0]} scale={[0.09, 0.18, 0.1]} castShadow>
            <meshStandardMaterial color={mix(tint, "#000", 0.12)} roughness={0.8} />
          </mesh>
        ))}
        {/* Tana */}
        <mesh geometry={BOX} position={[0, 0.42, 0]} scale={[0.66, 0.46, 0.42]} castShadow>
          <meshStandardMaterial color={tint} roughness={0.75} emissive={failed ? "#ff2020" : "#000"} emissiveIntensity={failed ? 0.35 : 0} />
        </mesh>
        {/* Ko'zlar (vertikal piksel) */}
        {[-0.13, 0.13].map((x) => (
          <mesh key={x} geometry={BOX} position={[x, 0.48, 0.213]} scale={[0.07, 0.14, 0.02]}>
            <meshStandardMaterial color={EYE} roughness={0.3} />
          </mesh>
        ))}
        {/* Yon qo'llar */}
        {[-1, 1].map((sd, i) => (
          <group key={sd} ref={(m) => { arms.current[i] = m; }} position={[sd * 0.39, 0.45, 0]}>
            <mesh geometry={BOX} position={[0, -0.05, 0]} scale={[0.12, 0.14, 0.16]} castShadow>
              <meshStandardMaterial color={mix(tint, "#000", 0.06)} roughness={0.8} />
            </mesh>
            {i === 1 && (
              <mesh ref={(m) => { prop.current.cup = m; }} geometry={CYL} position={[0, -0.02, 0.16]} scale={[0.1, 0.14, 0.1]} visible={false}>
                <meshStandardMaterial color="#ffffff" />
              </mesh>
            )}
          </group>
        ))}
        {/* O'yin pulti */}
        <mesh ref={(m) => { prop.current.pad = m; }} geometry={BOX} position={[0, 0.36, 0.34]} scale={[0.3, 0.06, 0.12]} visible={false}>
          <meshStandardMaterial color="#1c1e24" />
        </mesh>
        {/* Hisobotchi qog'ozlari */}
        <mesh ref={(m) => { prop.current.papers = m; }} geometry={BOX} position={[0, 0.5, 0.32]} scale={[0.34, 0.12, 0.26]} visible={false}>
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        {/* Rol nishoni: shapka (o'z rangi) + old nishon */}
        {isBoss ? (
          <group position={[0, 0.69, 0]}>
            <mesh geometry={BOX} scale={[0.5, 0.1, 0.34]}><meshStandardMaterial color="#f2c14e" metalness={0.6} roughness={0.3} /></mesh>
            {[-0.18, 0, 0.18].map((x) => <mesh key={x} geometry={BOX} position={[x, 0.1, 0]} scale={[0.09, 0.12, 0.09]}><meshStandardMaterial color="#f2c14e" metalness={0.6} roughness={0.3} /></mesh>)}
          </group>
        ) : agent.kind !== "tg" ? (
          <mesh geometry={BOX} position={[0, 0.69, -0.02]} scale={[0.46, 0.08, 0.32]} castShadow>
            <meshStandardMaterial color={agent.color} roughness={0.6} />
          </mesh>
        ) : (
          <group position={[0.2, 0.74, 0]}>
            <mesh geometry={BOX} scale={[0.03, 0.18, 0.03]}><meshStandardMaterial color="#30333b" /></mesh>
            <mesh geometry={SPHERE} position={[0, 0.11, 0]} scale={0.08}><meshStandardMaterial color="#2aabee" emissive="#2aabee" emissiveIntensity={0.6} /></mesh>
          </group>
        )}
        <mesh geometry={BOX} position={[0, 0.3, 0.215]} scale={[0.14, 0.08, 0.02]}>
          <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={0.25} />
        </mesh>
      </group>
      {/* Progress halqasi */}
      <mesh ref={ring} position={[0, 1.55, 0]} rotation={[-Math.PI / 2.4, 0, 0]} visible={false}>
        <torusGeometry args={[0.24, 0.035, 8, 32, Math.PI * 1.4]} />
        <meshBasicMaterial color={agent.activity === "review" ? "#ffb020" : "#5ea8ff"} toneMapped={false} />
      </mesh>
      <instancedMesh ref={confetti} args={[BOX, undefined, CONFETTI]} visible={false}>
        <meshBasicMaterial color="#ffd23f" toneMapped={false} />
      </instancedMesh>
      {showLabel && (
        <Html position={[0, isBoss ? 2.0 : 1.75, 0]} center distanceFactor={18} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="office-label" data-testid={`ai-office-label-${agent.id}`}
            style={{
              display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", padding: "3px 8px 3px 6px", borderRadius: 999,
              background: selected ? agent.color : "rgba(255,255,255,0.92)", color: selected ? "#fff" : "#2b2b2b", fontSize: 12, fontWeight: 700,
              boxShadow: "0 2px 8px rgba(40,30,20,.18)", border: `1px solid ${selected ? "transparent" : "rgba(0,0,0,.06)"}`, fontFamily: "inherit",
            }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: statusDot, boxShadow: `0 0 6px ${statusDot}` }} />
            {agent.name}
          </div>
        </Html>
      )}
    </group>
  );
});

const CONFETTI = 28;
const DUMMY = new THREE.Object3D();
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
