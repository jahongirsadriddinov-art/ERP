import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OfficeAgent } from "./officeApi";
import { assignIdle, BOUNDS, buildGrid, computeLayout, type Desk } from "./layout";
import { Crowd } from "./crowd";
import { ScreenHub } from "./screens";
import { Building, Cinema, Cook, DeskSet, GameCorner, Kitchen, Lounge, ManagerRoomFurniture, OwnerOffice, Plants, Rooms } from "./props";
import { Agent, Player } from "./actors";
import type { WalkBridge } from "./walk";

// AI ofis — 3D sahna (three.js + @react-three/fiber, faqat shu lazy chunk'da). Xonalar ish turi bo'yicha (layout.ts), agentlar
// A* + to'qnashmaslik bilan yuradi (crowd.ts), monitor/kino/TV — umumiy canvas teksturalar (screens.ts).
// Ko'rinish rejimi: kamera ofisni kadrga to'liq sig'diradi (yuklanganda va o'lcham o'zgarganda), aylantirish/yaqinlashtirish
// chegaralangan. Yurish rejimi: o'yinchi (Player) va uning kamerasi. Sahifa yashirin yoki sahna ekrandan tashqarida —
// chizish to'xtaydi; WebGL konteksti yo'qolsa — onContextLost.

export interface SceneWalk { bridge: WalkBridge; talkingId: string | null; holding: boolean }
export interface OfficeSceneProps {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showAllLabels: boolean;
  compact: boolean;
  dark: boolean;
  /** O'zgarsa — kamera qayta moslanadi ("ko'rinishni tiklash"). */
  resetKey: number;
  zoneNames: Record<string, string>;
  youLabel: string;
  walk?: SceneWalk | null;
  onContextLost?: () => void;
  onHub?: (hub: ScreenHub | null) => void;
}

export default function OfficeScene({ agents, selectedId, onSelect, showAllLabels, compact, dark, resetKey, zoneNames, youLabel, walk, onContextLost, onHub }: OfficeSceneProps) {
  const layoutKey = agents.map((a) => `${a.id}:${a.team}:${a.kind}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => computeLayout(agents.map((a) => ({ id: a.id, team: a.team, kind: a.kind }))), [layoutKey]);
  const grid = useMemo(() => buildGrid(layout.obstacles), [layout]);
  const crowdRef = useRef<Crowd | null>(null);
  if (!crowdRef.current) crowdRef.current = new Crowd(grid);
  const crowd = crowdRef.current;
  crowd.setGrid(grid);
  const hub = useMemo(() => new ScreenHub(), []);
  useEffect(() => { onHub?.(hub); return () => { onHub?.(null); hub.dispose(); }; }, [hub, onHub]);
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
    return () => { document.removeEventListener("visibilitychange", onVis); io?.disconnect(); document.body.style.cursor = ""; };
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
  // Boshliq band stollarni aylanadi (stul yonida, ustunlar orasida turadi); Hisobotchi stul orqasida turib qog'oz yig'adi
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const managerTour = useMemo(() => busyChairs.slice(0, 6).map((d) => ({ x: d.chair.x + 0.85, z: d.chair.z, face: d.dir > 0 ? Math.PI / 2 : -Math.PI / 2 })), [busyKey]);
  const othersKey = agents.filter((a) => a.id !== "reporter" && a.id !== "manager" && layout.desks.has(a.id)).map((a) => a.id).join("|");
  const reporterTour = useMemo(() => {
    const ids = othersKey.split("|").filter(Boolean);
    return ids.filter((_, i) => i % Math.max(1, Math.floor(ids.length / 5)) === 0).slice(0, 5)
      .map((id) => { const d = layout.desks.get(id)!; return { x: d.chair.x, z: d.chair.z - d.dir * 0.95, face: d.dir > 0 ? 0 : Math.PI }; });
  }, [othersKey, layout]);
  const onAir = agents.some((a) => a.activity === "call");

  return (
    <div ref={wrap} className="absolute inset-0" data-testid="ai-office-canvas-wrap">
      <Canvas
        shadows={!compact}
        dpr={compact ? [1, 1.25] : [1, 1.5]}
        frameloop={active ? "always" : "never"}
        camera={{ position: [0, 40, 30], fov: compact ? 42 : 36, near: 0.3, far: 250 }}
        gl={{ antialias: !compact, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
        onPointerMissed={() => { if (!walk) onSelect(null); }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); onContextLost?.(); });
        }}
        data-testid="ai-office-canvas"
      >
        <Ticker crowd={crowd} hub={hub} />
        <Lights dark={dark} compact={compact} />
        <Building hub={hub} />
        <Rooms rooms={layout.rooms} walls={layout.walls} names={zoneNames} onAir={onAir} small={compact && !walk} />
        <ManagerRoomFurniture />
        <OwnerOffice hub={hub} />
        <DeskSet desks={[...layout.desks.values()]} agents={agents} hub={hub} />
        <Kitchen />
        <Cook />
        <GameCorner hub={hub} />
        <Cinema hub={hub} />
        <Lounge />
        <Plants />
        {agents.map((a) => {
          const desk = layout.desks.get(a.id);
          if (!desk) return null;
          const pi = poiOf.get(a.id);
          const tour = a.id === "manager" && a.activity === "idle" && managerTour.length ? managerTour
            : a.id === "reporter" && a.activity === "task" && a.since && Date.now() - Date.parse(a.since) < 25_000 ? reporterTour : undefined;
          return (
            <Agent key={a.id} agent={a} desk={desk} poi={pi !== undefined ? layout.pois[pi] : undefined} tour={tour} crowd={crowd}
              selected={selectedId === a.id} talking={walk?.talkingId === a.id}
              showLabel={showAllLabels || a.busy || selectedId === a.id || a.activity === "review" || (!!a.task && a.task.status !== "queued")}
              bubbles={!compact || !!walk}
              onSelect={onSelect} />
          );
        })}
        {walk ? <Player crowd={crowd} grid={grid} bridge={walk.bridge} agents={agents} holding={walk.holding} youLabel={youLabel} />
          : <Controls compact={compact} resetKey={resetKey} />}
      </Canvas>
    </div>
  );
}

/** Bitta joyda: olomon qadami (agentlar harakati) va ekran teksturalari — agentlar kadridan oldin. */
function Ticker({ crowd, hub }: { crowd: Crowd; hub: ScreenHub }) {
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    crowd.step(d);
    hub.tick(d);
  }, -1);
  return null;
}

function Lights({ dark, compact }: { dark: boolean; compact: boolean }) {
  return (
    <>
      <hemisphereLight args={[dark ? "#e8ecff" : "#fff7ee", dark ? "#9a8f86" : "#d6cabd", dark ? 1.0 : 1.15]} />
      <directionalLight position={[16, 30, 14]} intensity={dark ? 1.4 : 1.7} color="#fff1e2" castShadow={!compact}
        shadow-mapSize={[1536, 1536]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-28} shadow-camera-right={28} shadow-camera-top={24} shadow-camera-bottom={-24} shadow-camera-near={5} shadow-camera-far={90} />
      <directionalLight position={[-20, 14, 20]} intensity={0.35} color="#cfe0ff" />
    </>
  );
}

// ───────────── Kamera: ofisni kadrga to'liq sig'dirish ─────────────
const CORNERS = [BOUNDS.x0 - 0.6, BOUNDS.x1 + 0.6].flatMap((x) => [BOUNDS.z0 - 0.6, BOUNDS.z1 + 0.6].flatMap((z) => [0, 2.9].map((y) => new THREE.Vector3(x, y, z))));
export interface Fit { target: THREE.Vector3; dist: number; az: number; polar: number }

/** Berilgan yo'nalishda ofisning 8 burchagi kadrga (chetidan ozgina joy qoldirib) sig'adigan eng yaqin masofa + markazlash. */
function fitDir(camera: THREE.PerspectiveCamera, aspect: number, az: number, polar: number): Fit {
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az));
  const target = new THREE.Vector3((BOUNDS.x0 + BOUNDS.x1) / 2, 0, (BOUNDS.z0 + BOUNDS.z1) / 2);
  const v = new THREE.Vector3();
  const place = (d: number) => { camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target); camera.updateMatrixWorld(); };
  const bbox = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of CORNERS) { v.copy(c).project(camera); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    return { x0, x1, y0, y1 };
  };
  let d = 60;
  for (let iter = 0; iter < 4; iter++) {
    let lo = 4, hi = 400;
    for (let i = 0; i < 32; i++) {
      d = (lo + hi) / 2;
      place(d);
      const b = bbox();
      if (b.x0 >= -0.97 && b.x1 <= 0.97 && b.y0 >= -0.95 && b.y1 <= 0.95) hi = d; else lo = d;
    }
    d = hi;
    place(d);
    const b = bbox();
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    if (Math.abs(cx) < 0.01 && Math.abs(cy) < 0.01) break;
    // Markazlash: nishonni ekran o'qlari bo'yicha (polda) siljitish
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * d, halfW = halfH * aspect;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).setY(0).normalize();
    target.addScaledVector(right, cx * halfW).addScaledVector(up, (cy * halfH) / Math.max(0.35, Math.cos(polar)));
  }
  place(d);
  return { target, dist: d, az, polar };
}

/** Ikki yo'nalishdan (old tomondan / yon tomondan) qaysi biri ofisni kattaroq ko'rsatsa — o'sha (tik telefon ekranida — yon tomondan). */
export function fitView(camera: THREE.PerspectiveCamera, aspect: number): Fit {
  const side = fitDir(camera, aspect, Math.PI / 2, 0.55);
  const front = fitDir(camera, aspect, 0, 0.62);
  if (side.dist < front.dist * 0.92) return fitDir(camera, aspect, Math.PI / 2, 0.55);
  return front;
}

function Controls({ compact, resetKey }: { compact: boolean; resetKey: number }) {
  const ref = useRef<any>(null);
  const { camera, size } = useThree();
  const [fit, setFit] = useState<Fit | null>(null);
  const fitted = useRef("");
  useEffect(() => {
    if (!size.width || !size.height) return;
    const key = `${compact}:${Math.round((size.width / size.height) * 40)}:${resetKey}`;
    if (fitted.current === key) return;
    fitted.current = key;
    const f = fitView(camera as THREE.PerspectiveCamera, size.width / size.height);
    setFit(f);
    if (ref.current) { ref.current.target.copy(f.target); ref.current.update(); }
  }, [camera, size.width, size.height, compact, resetKey]);
  return (
    <OrbitControls ref={ref} makeDefault enableDamping dampingFactor={0.08} target={fit?.target}
      minDistance={fit ? fit.dist * 0.22 : 8} maxDistance={fit ? fit.dist * 1.35 : 90}
      minPolarAngle={0.15} maxPolarAngle={1.2}
      minAzimuthAngle={fit ? fit.az - 1.1 : -Infinity} maxAzimuthAngle={fit ? fit.az + 1.1 : Infinity}
      screenSpacePanning={false}
      onChange={() => {
        const t = ref.current?.target as THREE.Vector3 | undefined;
        if (t) { t.x = THREE.MathUtils.clamp(t.x, BOUNDS.x0 + 2, BOUNDS.x1 - 2); t.z = THREE.MathUtils.clamp(t.z, BOUNDS.z0 + 2, BOUNDS.z1 - 2); t.y = 0; }
      }} />
  );
}
