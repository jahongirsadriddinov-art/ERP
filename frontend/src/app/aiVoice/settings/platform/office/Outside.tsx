import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BOUNDS } from "./layout";
import { skyDir, skyLook, sunPosition, type WeatherMode } from "./sky";
import { sound } from "./sound";

// AI ofis — tashqi dunyo (owner 2026-10-23): shahar kvartali — ko'chalar (yo'lak, piyodalar o'tish joyi, chiroqlar), to'xtagan va
// yurayotgan mashinalar, daraxtlar, park, turli balandlikdagi qo'shni binolar (ofislar, uylar), minorali kran bilan qurilish
// maydoni, uzoqda shahar silueti va tog'lar. Osmon, quyosh/oy va soyalar — Toshkent vaqti bo'yicha; ob-havo: quyosh, bulut,
// yomg'ir (tomchilar, ho'l yer, ko'lmak yaltirashi, ovoz), qor (asta oqaradigan tom va yer), tuman.
// Unumdorlik: hammasi instancing; yog'in — bitta Points (kompyuter 3000 / telefon 800); telefonda kamroq detal.

const rng = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const DUMMY = new THREE.Object3D();
const BOXG = new THREE.BoxGeometry(1, 1, 1);
const CYLG = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const CONEG = new THREE.ConeGeometry(0.5, 1, 7);
const ICOG = new THREE.IcosahedronGeometry(0.5, 0);
const SIDE = { x: BOUNDS.x1 + 4, z0: BOUNDS.z0 - 4, z1: BOUNDS.z1 + 4 };        // ichki piyodalar yo'lagi chegarasi
const ROAD = { x: SIDE.x + 10, z0: SIDE.z0 - 10, z1: SIDE.z1 + 10 };             // halqa yo'l tashqi cheti
const OUT = { x: ROAD.x + 4, z0: ROAD.z0 - 4, z1: ROAD.z1 + 4 };                 // tashqi yo'lak
const PARK = { x0: -70, x1: 8, z0: OUT.z1 + 6, z1: OUT.z1 + 60 };
const SITE = { x0: 52, x1: 92, z0: OUT.z1 + 4, z1: OUT.z1 + 44 };

/** Sahnaning tirik holati (rejim almashganda ham saqlanadi): namlik, qor qoplami. */
export const envState = { wet: 0, snow: 0 };

function setInst(mesh: THREE.InstancedMesh | null, items: { p: [number, number, number]; s: [number, number, number]; r?: number; c?: string }[]) {
  if (!mesh) return;
  const col = new THREE.Color();
  items.forEach((it, i) => {
    DUMMY.position.set(...it.p); DUMMY.scale.set(...it.s); DUMMY.rotation.set(0, it.r || 0, 0); DUMMY.updateMatrix();
    mesh.setMatrixAt(i, DUMMY.matrix);
    if (it.c) mesh.setColorAt(i, col.set(it.c));
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** Yo'l halqasi bo'ylab nuqta (t ∈ [0,1)) — ofis atrofida soat yo'nalishida. */
function ringPoint(t: number, off: number): { x: number; z: number; r: number } {
  const x0 = -off, x1 = off, z0 = SIDE.z0 - (off - SIDE.x), z1 = SIDE.z1 + (off - SIDE.x);
  const w = x1 - x0, h = z1 - z0, L = 2 * (w + h);
  let d = (((t % 1) + 1) % 1) * L;
  if (d < w) return { x: x0 + d, z: z0, r: Math.PI / 2 };
  d -= w; if (d < h) return { x: x1, z: z0 + d, r: 0 };
  d -= h; if (d < w) return { x: x1 - d, z: z1, r: -Math.PI / 2 };
  d -= w; return { x: x0, z: z1 - d, r: Math.PI };
}

/** Bino fasadi: kunduzi — oyna (ko'kish, osmon aksi), kechasi — chiroq yoqilgan derazalar (alohida emissive tekstura). */
function windowTextures(): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } | null {
  if (typeof document === "undefined") return null;
  const mkc = () => { const c = document.createElement("canvas"); c.width = 64; c.height = 128; return c; };
  const a = mkc(), b = mkc();
  const g = a.getContext("2d"), e = b.getContext("2d");
  if (!g || !e) return null;
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 64, 128);
  e.fillStyle = "#000"; e.fillRect(0, 0, 64, 128);
  const r = rng(7);
  for (let y = 4; y < 128; y += 12) for (let x = 4; x < 64; x += 12) {
    g.fillStyle = `hsl(${205 + r() * 15}, 25%, ${32 + r() * 18}%)`; g.fillRect(x, y, 7, 8);
    g.fillStyle = "rgba(255,255,255,.25)"; g.fillRect(x, y, 7, 2);
    if (r() < 0.55) { e.fillStyle = `hsl(${38 + r() * 14}, 90%, ${60 + r() * 20}%)`; e.fillRect(x, y, 7, 8); }
  }
  const t = (c: HTMLCanvasElement) => { const x = new THREE.CanvasTexture(c); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(3, 5); x.colorSpace = THREE.SRGBColorSpace; return x; };
  return { map: t(a), glow: t(b) };
}

export interface OutsideProps { mode: WeatherMode; hour: number; doy: number; compact: boolean; walk: boolean; focus: () => THREE.Vector3 }

export default function Outside({ mode, hour, doy, compact, walk, focus }: OutsideProps) {
  const { scene } = useThree();
  // ─── Osmon, quyosh, yorug'lik ───
  const sun = sunPosition(hour, doy);
  const look = skyLook(sun.elevation, mode);
  const dir = skyDir(sun.elevation, sun.azimuth);
  const moonDir: [number, number, number] = [-dir[0], Math.abs(dir[1]) * 0.8 + 0.25, -dir[2]];
  const sunLight = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const domeMat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }",
  }), []);
  useLayoutEffect(() => {
    domeMat.uniforms.top.value.set(look.top);
    domeMat.uniforms.horizon.value.set(look.horizon);
    scene.background = new THREE.Color(look.horizon);
    const [near, far] = mode === "fog" ? [18, 150] : mode === "snow" ? [90, 420] : mode === "rain" ? [110, 460] : mode === "cloudy" ? [200, 700] : [320, 900];
    scene.fog = new THREE.Fog(look.fog, near, far);
    return () => { scene.fog = null; scene.background = null; };
  }, [scene, domeMat, look.top, look.horizon, look.fog, mode]);
  useLayoutEffect(() => () => domeMat.dispose(), [domeMat]);

  // ─── Materiallar (namlik / qor / tun bilan o'zgaradi) ───
  const winTex = useMemo(windowTextures, []);
  const mats = useMemo(() => ({
    grass: new THREE.MeshStandardMaterial({ color: "#7b8f5c", roughness: 1 }),
    urban: new THREE.MeshStandardMaterial({ color: "#a29d94", roughness: 1 }),
    road: new THREE.MeshStandardMaterial({ color: "#3b3d42", roughness: 0.95 }),
    walk: new THREE.MeshStandardMaterial({ color: "#c9c4ba", roughness: 0.95 }),
    bld: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.75, map: winTex?.map || null, emissiveMap: winTex?.glow || null, emissive: new THREE.Color("#ffd38a"), emissiveIntensity: 0 }),
    roof: new THREE.MeshStandardMaterial({ color: "#7d7a76", roughness: 1 }),
    snowCap: new THREE.MeshStandardMaterial({ color: "#f4f7fb", roughness: 0.9 }),
    lamp: new THREE.MeshStandardMaterial({ color: "#fff3cf", emissive: new THREE.Color("#ffd27a"), emissiveIntensity: 0 }),
    pole: new THREE.MeshStandardMaterial({ color: "#3a3f4b", roughness: 0.6, metalness: 0.4 }),
    crown: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, flatShading: true }),
    trunk: new THREE.MeshStandardMaterial({ color: "#6b4a2f", roughness: 1 }),
    car: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4, metalness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: "#1d2733", roughness: 0.2, metalness: 0.5 }),
    stripe: new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.8 }),
    far: new THREE.MeshStandardMaterial({ color: "#7d8899", roughness: 1 }),
    mount: new THREE.MeshStandardMaterial({ color: "#6f7b8a", roughness: 1, flatShading: true }),
    cap: new THREE.MeshStandardMaterial({ color: "#f3f6fa", roughness: 1, flatShading: true }),
    crane: new THREE.MeshStandardMaterial({ color: "#f2b31a", roughness: 0.6, metalness: 0.2 }),
    dirt: new THREE.MeshStandardMaterial({ color: "#a08463", roughness: 1 }),
    concrete: new THREE.MeshStandardMaterial({ color: "#b8b3aa", roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ color: "#4f7fa8", roughness: 0.15, metalness: 0.3 }),
    cloud: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, transparent: true, opacity: 0.9, flatShading: true }),
  }), [winTex]);
  useLayoutEffect(() => () => { Object.values(mats).forEach((m) => m.dispose()); winTex?.map.dispose(); winTex?.glow.dispose(); }, [mats, winTex]);

  // ─── Statik shahar (bir marta) ───
  const city = useMemo(() => {
    const r = rng(20261023);
    const bld: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    const maxB = compact ? 34 : 80;
    const PAL = ["#e9dfcf", "#d8cbb8", "#c6b9a6", "#b8c2cc", "#9fb3c8", "#d9b9a0", "#cfcac2", "#a7b6c2"];
    const free = (x: number, z: number, w: number) => {
      const pad = w / 2 + 3;
      if (Math.abs(x) < OUT.x + pad && z > OUT.z0 - pad && z < OUT.z1 + pad) return false;
      if (x > PARK.x0 - pad && x < PARK.x1 + pad && z > PARK.z0 - pad && z < PARK.z1 + pad) return false;
      if (x > SITE.x0 - pad && x < SITE.x1 + pad && z > SITE.z0 - pad && z < SITE.z1 + pad) return false;
      return true;
    };
    for (let gx = -150; gx <= 150 && bld.length < maxB; gx += 22) for (let gz = -140; gz <= 150 && bld.length < maxB; gz += 22) {
      const w = 10 + r() * 9, d = 10 + r() * 9;
      const x = gx + (r() - 0.5) * 5, z = gz + (r() - 0.5) * 5;
      if (!free(x, z, Math.max(w, d))) continue;
      const far = Math.hypot(x, z);
      const h = 8 + r() * 18 + (far > 90 ? r() * 30 : 0);
      bld.push({ p: [x, h / 2, z], s: [w, h, d], c: PAL[Math.floor(r() * PAL.length)] });
    }
    const roofs = bld.map((b) => ({ p: [b.p[0], b.s[1] + 0.25, b.p[2]] as [number, number, number], s: [b.s[0] + 0.4, 0.5, b.s[2] + 0.4] as [number, number, number] }));
    // Siluet va tog'lar
    const sky: { p: [number, number, number]; s: [number, number, number] }[] = [];
    for (let i = 0; i < (compact ? 22 : 48); i++) {
      const a = (i / (compact ? 22 : 48)) * Math.PI * 2 + r() * 0.1, R = 210 + r() * 60, h = 25 + r() * 70;
      sky.push({ p: [Math.cos(a) * R, h / 2, Math.sin(a) * R], s: [12 + r() * 14, h, 12 + r() * 14] });
    }
    const mtn: { p: [number, number, number]; s: [number, number, number] }[] = [];
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + 0.15 + i * 0.16 + r() * 0.08; // shimoli-sharq (Chimyon tomonda)
      const R = 360 + r() * 90, h = 70 + r() * 90, w = 90 + r() * 70;
      mtn.push({ p: [Math.cos(a) * R, h / 2 - 2, Math.sin(a) * R], s: [w, h, w] });
    }
    // Daraxtlar: tashqi yo'lak bo'ylab + park
    const trees: { p: [number, number, number]; s: number }[] = [];
    const step = compact ? 14 : 9;
    for (let x = -OUT.x; x <= OUT.x; x += step) { trees.push({ p: [x, 0, OUT.z0 - 1.5], s: 0.9 + r() * 0.5 }); trees.push({ p: [x, 0, OUT.z1 + 1.5], s: 0.9 + r() * 0.5 }); }
    for (let z = OUT.z0; z <= OUT.z1; z += step) { trees.push({ p: [-OUT.x - 1.5, 0, z], s: 0.9 + r() * 0.5 }); trees.push({ p: [OUT.x + 1.5, 0, z], s: 0.9 + r() * 0.5 }); }
    for (let i = 0; i < (compact ? 14 : 36); i++) {
      const x = PARK.x0 + 4 + r() * (PARK.x1 - PARK.x0 - 8), z = PARK.z0 + 4 + r() * (PARK.z1 - PARK.z0 - 8);
      if (Math.hypot(x + 30, z - (PARK.z0 + 28)) < 9) continue; // ko'l
      trees.push({ p: [x, 0, z], s: 0.9 + r() * 0.9 });
    }
    // Ko'cha chiroqlari (ichki yo'lak bo'ylab)
    const lamps: { x: number; z: number; r: number }[] = [];
    for (let x = -SIDE.x + 4; x <= SIDE.x - 4; x += 12) { lamps.push({ x, z: SIDE.z0 - 0.6, r: 0 }); lamps.push({ x, z: SIDE.z1 + 0.6, r: Math.PI }); }
    for (let z = SIDE.z0 + 6; z <= SIDE.z1 - 6; z += 12) { lamps.push({ x: -SIDE.x - 0.6, z, r: Math.PI / 2 }); lamps.push({ x: SIDE.x + 0.6, z, r: -Math.PI / 2 }); }
    // To'xtagan mashinalar (yo'l chetida)
    const CARC = ["#d62839", "#f2f2f4", "#1d3557", "#2a9d8f", "#e9c46a", "#264653", "#8d99ae", "#111111"];
    const parked: { p: [number, number, number]; r: number; c: string }[] = [];
    for (let x = -ROAD.x + 6; x <= ROAD.x - 6; x += compact ? 13 : 7.5) if (r() < 0.7) parked.push({ p: [x, 0, ROAD.z1 - 1.4], r: Math.PI / 2, c: CARC[Math.floor(r() * CARC.length)] });
    for (let z = ROAD.z0 + 6; z <= ROAD.z1 - 6; z += compact ? 13 : 7.5) if (r() < 0.6) parked.push({ p: [ROAD.x - 1.4, 0, z], r: 0, c: CARC[Math.floor(r() * CARC.length)] });
    // Yo'l chiziqlari va piyodalar o'tish joylari
    const mid = (SIDE.x + ROAD.x) / 2;
    const dashes: { p: [number, number, number]; s: [number, number, number] }[] = [];
    for (let x = -mid; x <= mid; x += 4) { dashes.push({ p: [x, 0.012, SIDE.z0 - (mid - SIDE.x)], s: [2, 0.02, 0.18] }); dashes.push({ p: [x, 0.012, SIDE.z1 + (mid - SIDE.x)], s: [2, 0.02, 0.18] }); }
    for (let z = SIDE.z0 - (mid - SIDE.x); z <= SIDE.z1 + (mid - SIDE.x); z += 4) { dashes.push({ p: [-mid, 0.012, z], s: [0.18, 0.02, 2] }); dashes.push({ p: [mid, 0.012, z], s: [0.18, 0.02, 2] }); }
    for (const cx of [-12, 12]) for (let k = 0; k < 7; k++) {
      dashes.push({ p: [cx - 3 + k, 0.013, (SIDE.z1 + ROAD.z1) / 2], s: [0.55, 0.02, 9] });
      dashes.push({ p: [cx - 3 + k, 0.013, (SIDE.z0 + ROAD.z0) / 2], s: [0.55, 0.02, 9] });
    }
    for (let k = 0; k < 7; k++) { dashes.push({ p: [(SIDE.x + ROAD.x) / 2, 0.013, -3 + k], s: [9, 0.02, 0.55] }); dashes.push({ p: [-(SIDE.x + ROAD.x) / 2, 0.013, -3 + k], s: [9, 0.02, 0.55] }); }
    // Park: o'rindiqlar
    const benches: { p: [number, number, number]; s: [number, number, number]; r: number }[] = [];
    for (let i = 0; i < 8; i++) benches.push({ p: [PARK.x0 + 10 + i * 8, 0.25, PARK.z0 + 14 + (i % 2) * 22], s: [2, 0.5, 0.6], r: 0 });
    // Bulutlar
    const clouds: { p: [number, number, number]; s: [number, number, number] }[] = [];
    for (let i = 0; i < 16; i++) clouds.push({ p: [(r() - 0.5) * 400, 55 + r() * 35, (r() - 0.5) * 400], s: [30 + r() * 30, 7 + r() * 6, 18 + r() * 14] });
    return { bld, roofs, sky, mtn, trees, lamps, parked, dashes, benches, clouds };
  }, [compact]);

  const refs = {
    bld: useRef<THREE.InstancedMesh>(null), roof: useRef<THREE.InstancedMesh>(null), snowRoof: useRef<THREE.InstancedMesh>(null),
    sky: useRef<THREE.InstancedMesh>(null), mtn: useRef<THREE.InstancedMesh>(null), cap: useRef<THREE.InstancedMesh>(null),
    trunk: useRef<THREE.InstancedMesh>(null), crown: useRef<THREE.InstancedMesh>(null), pole: useRef<THREE.InstancedMesh>(null),
    head: useRef<THREE.InstancedMesh>(null), parked: useRef<THREE.InstancedMesh>(null), cabin: useRef<THREE.InstancedMesh>(null),
    dash: useRef<THREE.InstancedMesh>(null), bench: useRef<THREE.InstancedMesh>(null), cloud: useRef<THREE.InstancedMesh>(null),
    moving: useRef<THREE.InstancedMesh>(null), movingCab: useRef<THREE.InstancedMesh>(null),
  };
  useLayoutEffect(() => {
    setInst(refs.bld.current, city.bld);
    setInst(refs.roof.current, city.roofs);
    setInst(refs.snowRoof.current, city.roofs.map((r) => ({ p: [r.p[0], r.p[1] + 0.3, r.p[2]] as [number, number, number], s: [r.s[0], 0.001, r.s[2]] as [number, number, number] })));
    setInst(refs.sky.current, city.sky);
    setInst(refs.mtn.current, city.mtn);
    setInst(refs.cap.current, city.mtn.map((m) => ({ p: [m.p[0], m.p[1] + m.s[1] * 0.32, m.p[2]] as [number, number, number], s: [m.s[0] * 0.36, m.s[1] * 0.36, m.s[2] * 0.36] as [number, number, number] })));
    setInst(refs.trunk.current, city.trees.map((t) => ({ p: [t.p[0], 1.1 * t.s, t.p[2]], s: [0.35 * t.s, 2.2 * t.s, 0.35 * t.s] })));
    setInst(refs.crown.current, city.trees.map((t, i) => ({ p: [t.p[0], 3.2 * t.s, t.p[2]], s: [2.6 * t.s, 3.2 * t.s, 2.6 * t.s], r: i, c: ["#4f8a4b", "#5d9a52", "#457a44", "#6aa35a"][i % 4] })));
    setInst(refs.pole.current, city.lamps.map((l) => ({ p: [l.x, 2.6, l.z], s: [0.16, 5.2, 0.16] })));
    setInst(refs.head.current, city.lamps.map((l) => ({ p: [l.x + Math.sin(l.r) * 0.0, 5.15, l.z], s: [0.8, 0.18, 0.5], r: l.r })));
    setInst(refs.parked.current, city.parked.map((c) => ({ p: [c.p[0], 0.55, c.p[2]], s: [1.8, 0.8, 4.2], r: c.r, c: c.c })));
    setInst(refs.cabin.current, city.parked.map((c) => ({ p: [c.p[0], 1.15, c.p[2]], s: [1.6, 0.6, 2.2], r: c.r })));
    setInst(refs.dash.current, city.dashes);
    setInst(refs.bench.current, city.benches);
    setInst(refs.cloud.current, city.clouds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  // ─── Yurayotgan mashinalar, kran, yog'in, namlik/qor, tun chiroqlari ───
  const NCAR = compact ? 4 : 8;
  const carCols = useMemo(() => Array.from({ length: NCAR }, (_, i) => ["#d62839", "#f2f2f4", "#1d3557", "#2a9d8f", "#e9c46a", "#264653", "#8d99ae", "#f4a261"][i % 8]), [NCAR]);
  useLayoutEffect(() => {
    const m = refs.moving.current; if (!m) return;
    const col = new THREE.Color();
    carCols.forEach((c, i) => m.setColorAt(i, col.set(c)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carCols]);
  const jib = useRef<THREE.Group>(null);
  const precip = useRef<THREE.Points>(null);
  const N = mode === "rain" ? (compact ? 800 : 3000) : mode === "snow" ? (compact ? 600 : 2000) : 0;
  const pGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(Math.max(1, N) * 3);
    for (let i = 0; i < N; i++) { arr[i * 3] = (Math.random() - 0.5) * 120; arr[i * 3 + 1] = Math.random() * 30; arr[i * 3 + 2] = (Math.random() - 0.5) * 120; }
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [N]);
  const pMat = useMemo(() => {
    if (typeof document === "undefined") return new THREE.PointsMaterial();
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const g = c.getContext("2d")!;
    if (mode === "rain") { const gr = g.createLinearGradient(0, 0, 0, 32); gr.addColorStop(0, "rgba(200,215,235,0)"); gr.addColorStop(1, "rgba(200,215,235,0.9)"); g.fillStyle = gr; g.fillRect(15, 0, 2, 32); }
    else { g.fillStyle = "#fff"; g.beginPath(); g.arc(16, 16, 9, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    return new THREE.PointsMaterial({ map: t, size: mode === "rain" ? 1.3 : 0.6, transparent: true, depthWrite: false, sizeAttenuation: true, opacity: mode === "rain" ? 0.75 : 0.95 });
  }, [mode]);
  useLayoutEffect(() => () => { pGeo.dispose(); pMat.map?.dispose(); pMat.dispose(); }, [pGeo, pMat]);
  const stars = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = compact ? 300 : 700, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const th = Math.random() * Math.PI * 2, ph = Math.random() * 1.3; a[i * 3] = Math.cos(th) * Math.sin(ph) * 700; a[i * 3 + 1] = Math.cos(ph) * 700; a[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * 700; }
    g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    return g;
  }, [compact]);
  const starMat = useMemo(() => new THREE.PointsMaterial({ color: "#ffffff", size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }), []);
  useLayoutEffect(() => () => { stars.dispose(); starMat.dispose(); }, [stars, starMat]);

  const c0 = useMemo(() => ({
    grass: new THREE.Color("#7b8f5c"), urban: new THREE.Color("#a29d94"), road: new THREE.Color("#3b3d42"), walk: new THREE.Color("#c9c4ba"),
    crown: new THREE.Color("#ffffff"), snow: new THREE.Color("#eef2f7"), wetRoad: new THREE.Color("#22252a"), wetWalk: new THREE.Color("#8f8b84"), roof: new THREE.Color("#7d7a76"),
  }), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => { sound.setRain(mode === "rain"); return () => sound.setRain(false); }, [mode]);

  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const t = clock.elapsedTime;
    // Namlik va qor qoplami asta o'zgaradi
    envState.wet = THREE.MathUtils.clamp(envState.wet + (mode === "rain" ? dt / 20 : -dt / 90), 0, 1);
    envState.snow = THREE.MathUtils.clamp(envState.snow + (mode === "snow" ? dt / 60 : -dt / 150), 0, 1);
    const wet = envState.wet, sn = envState.snow;
    mats.road.color.copy(c0.road).lerp(c0.wetRoad, wet).lerp(c0.snow, sn * 0.85);
    mats.road.roughness = 0.95 - wet * 0.75; mats.road.metalness = wet * 0.35;
    mats.walk.color.copy(c0.walk).lerp(c0.wetWalk, wet * 0.6).lerp(c0.snow, sn * 0.95);
    mats.walk.roughness = 0.95 - wet * 0.6;
    mats.grass.color.copy(c0.grass).lerp(c0.snow, sn);
    mats.urban.color.copy(c0.urban).lerp(c0.snow, sn * 0.9);
    mats.crown.color.copy(c0.crown).lerp(tmp.set("#f4f7fb").multiplyScalar(1.6), sn * 0.55);
    // Tomdagi qor
    const sr = refs.snowRoof.current;
    if (sr) { sr.visible = sn > 0.02; sr.scale.y = 1; sr.position.y = 0; for (let i = 0; i < city.roofs.length; i++) { const r = city.roofs[i]; DUMMY.position.set(r.p[0], r.p[1] + 0.25 + sn * 0.2, r.p[2]); DUMMY.scale.set(r.s[0], Math.max(0.001, sn * 0.45), r.s[2]); DUMMY.rotation.set(0, 0, 0); DUMMY.updateMatrix(); sr.setMatrixAt(i, DUMMY.matrix); } sr.instanceMatrix.needsUpdate = true; }
    // Tun: derazalar, ko'cha chiroqlari, yulduzlar
    mats.bld.emissiveIntensity = look.night * 1.15 + look.dusk * 0.2;
    mats.lamp.emissiveIntensity = look.night > 0.3 || mode === "fog" ? 2.4 : 0.05;
    starMat.opacity = look.night * (mode === "sunny" ? 0.95 : 0.15);
    // Bulutlar suzadi
    const cl = refs.cloud.current;
    if (cl) {
      mats.cloud.opacity = mode === "sunny" ? 0.75 : 0.95;
      mats.cloud.color.set(mode === "sunny" ? "#ffffff" : mode === "cloudy" ? "#d6dae0" : "#8a929c").multiplyScalar(0.35 + (1 - look.night) * 0.65);
      cl.count = mode === "sunny" ? 7 : city.clouds.length;
      for (let i = 0; i < cl.count; i++) { const c = city.clouds[i]; DUMMY.position.set(((c.p[0] + t * 1.6 + 200) % 400) - 200, c.p[1], c.p[2]); DUMMY.scale.set(...c.s); DUMMY.rotation.set(0, i, 0); DUMMY.updateMatrix(); cl.setMatrixAt(i, DUMMY.matrix); }
      cl.instanceMatrix.needsUpdate = true;
    }
    // Yurayotgan mashinalar (halqa yo'lda, ikki yo'nalishda)
    const mv = refs.moving.current, mc = refs.movingCab.current;
    if (mv && mc) {
      for (let i = 0; i < NCAR; i++) {
        const lane = i % 2 ? SIDE.x + 3 : ROAD.x - 3.6;
        const dirn = i % 2 ? 1 : -1;
        const p = ringPoint(dirn * t * 0.012 + i / NCAR, lane);
        DUMMY.position.set(p.x, 0.55, p.z); DUMMY.rotation.set(0, p.r + (dirn < 0 ? Math.PI : 0), 0); DUMMY.scale.set(1.8, 0.8, 4.2); DUMMY.updateMatrix(); mv.setMatrixAt(i, DUMMY.matrix);
        DUMMY.position.y = 1.15; DUMMY.scale.set(1.6, 0.6, 2.2); DUMMY.updateMatrix(); mc.setMatrixAt(i, DUMMY.matrix);
      }
      mv.instanceMatrix.needsUpdate = true; mc.instanceMatrix.needsUpdate = true;
    }
    if (jib.current) jib.current.rotation.y = Math.sin(t * 0.06) * 1.2 + 0.4;
    // Yog'in — faqat ofis tashqarisida (ofisda tom bor deb hisoblanadi)
    const pts = precip.current;
    if (pts && N) {
      const f = focus();
      const arr = (pts.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      const R = walk ? 22 : 75, H = walk ? 16 : 34;
      const vy = mode === "rain" ? 22 : 1.4;
      for (let i = 0; i < N; i++) {
        let x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
        y -= vy * dt;
        if (mode === "snow") { x += Math.sin(t * 0.8 + i) * dt * 0.6; z += Math.cos(t * 0.6 + i * 0.7) * dt * 0.4; } else x += dt * 2.2;
        if (y < 0 || Math.abs(x - f.x) > R || Math.abs(z - f.z) > R) { x = f.x + (Math.random() * 2 - 1) * R; z = f.z + (Math.random() * 2 - 1) * R; y = H * (0.6 + Math.random() * 0.4); }
        const inside = x > BOUNDS.x0 - 0.5 && x < BOUNDS.x1 + 0.5 && z > BOUNDS.z0 - 0.5 && z < BOUNDS.z1 + 0.5 && y < 3.2;
        arr[i * 3] = x; arr[i * 3 + 1] = inside ? -50 : y; arr[i * 3 + 2] = z;
        if (inside) arr[i * 3 + 1] = H + Math.random() * 4;
      }
      (pts.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
    // Yorug'lik — quyosh/oy
    const L = sunLight.current;
    if (L) {
      const night = look.night;
      const d = night > 0.5 ? moonDir : dir;
      L.position.set(d[0] * 80, Math.max(8, d[1] * 80), d[2] * 80);
      L.target.position.set(0, 0, (BOUNDS.z0 + BOUNDS.z1) / 2);
      L.target.updateMatrixWorld();
      L.intensity = night > 0.5 ? 0.22 : look.sunIntensity;
      L.color.set(night > 0.5 ? "#9fb4ff" : look.sunColor);
    }
    if (hemi.current) { hemi.current.intensity = look.hemi; hemi.current.color.set(look.top).lerp(tmp.set("#ffffff"), 0.6); }
    if (amb.current) amb.current.intensity = 0.15 + look.night * 0.55; // ofis ichidagi chiroqlar tunda
  });

  const B = BOUNDS;
  const cz = (B.z0 + B.z1) / 2;
  const sunPos = useMemo(() => new THREE.Vector3(...dir).multiplyScalar(600), [dir[0], dir[1], dir[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const moonPos = useMemo(() => new THREE.Vector3(...moonDir).multiplyScalar(600), [moonDir[0], moonDir[1], moonDir[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {/* Yorug'lik */}
      <hemisphereLight ref={hemi} args={["#ffffff", "#8a7f72", 1]} />
      <ambientLight ref={amb} color="#ffd9a8" intensity={0.15} />
      <directionalLight ref={sunLight} castShadow={!compact} shadow-mapSize={[1536, 1536]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-34} shadow-camera-right={34} shadow-camera-top={30} shadow-camera-bottom={-30} shadow-camera-near={5} shadow-camera-far={200} />
      {/* Osmon gumbazi, quyosh, oy, yulduzlar */}
      <mesh material={domeMat} frustumCulled={false}><sphereGeometry args={[800, 24, 12]} /></mesh>
      {sun.elevation > -0.05 && <mesh position={sunPos}><sphereGeometry args={[18, 16, 8]} /><meshBasicMaterial color={look.sunColor} fog={false} toneMapped={false} /></mesh>}
      {look.night > 0.4 && <mesh position={moonPos}><sphereGeometry args={[10, 16, 8]} /><meshBasicMaterial color="#e8ecf4" fog={false} toneMapped={false} /></mesh>}
      <points geometry={stars} material={starMat} frustumCulled={false} />
      <instancedMesh ref={refs.cloud} args={[ICOG, mats.cloud, 16]} frustumCulled={false} />
      {/* Yer: maysa, shahar, park, qurilish maydoni, yo'llar */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, cz]} material={mats.grass} receiveShadow><planeGeometry args={[1200, 1200]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, cz]} material={mats.urban} receiveShadow><planeGeometry args={[330, 320]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(PARK.x0 + PARK.x1) / 2, -0.045, (PARK.z0 + PARK.z1) / 2]} material={mats.grass} receiveShadow><planeGeometry args={[PARK.x1 - PARK.x0, PARK.z1 - PARK.z0]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-30, -0.04, PARK.z0 + 28]} material={mats.water}><circleGeometry args={[8, 24]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(SITE.x0 + SITE.x1) / 2, -0.045, (SITE.z0 + SITE.z1) / 2]} material={mats.dirt}><planeGeometry args={[SITE.x1 - SITE.x0, SITE.z1 - SITE.z0]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, (OUT.z0 + OUT.z1) / 2]} material={mats.walk} receiveShadow><planeGeometry args={[OUT.x * 2, OUT.z1 - OUT.z0]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, (ROAD.z0 + ROAD.z1) / 2]} material={mats.road} receiveShadow><planeGeometry args={[ROAD.x * 2, ROAD.z1 - ROAD.z0]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, (SIDE.z0 + SIDE.z1) / 2]} material={mats.walk} receiveShadow><planeGeometry args={[SIDE.x * 2, SIDE.z1 - SIDE.z0]} /></mesh>
      <instancedMesh ref={refs.dash} args={[BOXG, mats.stripe, city.dashes.length]} receiveShadow />
      {/* Ko'cha chiroqlari, daraxtlar, mashinalar, o'rindiqlar */}
      <instancedMesh ref={refs.pole} args={[CYLG, mats.pole, city.lamps.length]} castShadow={!compact} />
      <instancedMesh ref={refs.head} args={[BOXG, mats.lamp, city.lamps.length]} />
      <instancedMesh ref={refs.trunk} args={[CYLG, mats.trunk, city.trees.length]} castShadow={!compact} />
      <instancedMesh ref={refs.crown} args={[ICOG, mats.crown, city.trees.length]} castShadow={!compact} />
      <instancedMesh ref={refs.parked} args={[BOXG, mats.car, city.parked.length]} castShadow={!compact} />
      <instancedMesh ref={refs.cabin} args={[BOXG, mats.glass, city.parked.length]} />
      <instancedMesh ref={refs.moving} args={[BOXG, mats.car, NCAR]} castShadow={!compact} frustumCulled={false} />
      <instancedMesh ref={refs.movingCab} args={[BOXG, mats.glass, NCAR]} frustumCulled={false} />
      <instancedMesh ref={refs.bench} args={[BOXG, mats.trunk, city.benches.length]} />
      {/* Binolar, tomlar (qor bilan), siluet, tog'lar */}
      <instancedMesh ref={refs.bld} args={[BOXG, mats.bld, city.bld.length]} castShadow={!compact} receiveShadow />
      <instancedMesh ref={refs.roof} args={[BOXG, mats.roof, city.roofs.length]} />
      <instancedMesh ref={refs.snowRoof} args={[BOXG, mats.snowCap, city.roofs.length]} visible={false} />
      <instancedMesh ref={refs.sky} args={[BOXG, mats.far, city.sky.length]} />
      <instancedMesh ref={refs.mtn} args={[CONEG, mats.mount, city.mtn.length]} />
      <instancedMesh ref={refs.cap} args={[CONEG, mats.cap, city.mtn.length]} />
      {/* Qurilish maydoni: to'siq, karkas, minorali kran */}
      <ConstructionSite mats={mats} jib={jib} compact={compact} />
      {/* Yog'in */}
      {N > 0 && <points ref={precip} geometry={pGeo} material={pMat} frustumCulled={false} />}
    </group>
  );
}

function ConstructionSite({ mats, jib, compact }: { mats: Record<string, THREE.Material>; jib: React.RefObject<THREE.Group | null>; compact: boolean }) {
  const cols = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number] }[] = [];
    const x0 = SITE.x0 + 8, z0 = SITE.z0 + 10;
    for (let f = 0; f < 4; f++) {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) out.push({ p: [x0 + i * 6, f * 3.4 + 1.7, z0 + j * 6], s: [0.5, 3.4, 0.5] });
      out.push({ p: [x0 + 9, f * 3.4 + 3.45, z0 + 6], s: [19, 0.3, 13] });
    }
    // To'siq
    for (let x = SITE.x0; x < SITE.x1; x += 2.2) { out.push({ p: [x + 1.1, 1, SITE.z0], s: [2.1, 2, 0.08] }); out.push({ p: [x + 1.1, 1, SITE.z1], s: [2.1, 2, 0.08] }); }
    for (let z = SITE.z0; z < SITE.z1; z += 2.2) { out.push({ p: [SITE.x0, 1, z + 1.1], s: [0.08, 2, 2.1] }); out.push({ p: [SITE.x1, 1, z + 1.1], s: [0.08, 2, 2.1] }); }
    return out;
  }, []);
  useLayoutEffect(() => { setInst(cols.current, items); }, [items]);
  const mx = SITE.x1 - 10, mz = SITE.z0 + 30, H = 42;
  return (
    <group>
      <instancedMesh ref={cols} args={[BOXG, mats.concrete, items.length]} castShadow={!compact} />
      {/* Minorali kran */}
      <mesh geometry={BOXG} material={mats.crane} position={[mx, H / 2, mz]} scale={[1.6, H, 1.6]} castShadow={!compact} />
      <mesh geometry={BOXG} material={mats.concrete} position={[mx, 0.6, mz]} scale={[5, 1.2, 5]} />
      <group ref={jib} position={[mx, H, mz]}>
        <mesh geometry={BOXG} material={mats.crane} position={[-14, 0.6, 0]} scale={[34, 1.2, 1.2]} />
        <mesh geometry={BOXG} material={mats.crane} position={[7, 0.6, 0]} scale={[10, 1, 1]} />
        <mesh geometry={BOXG} material={mats.concrete} position={[10.5, -0.6, 0]} scale={[3, 2.4, 2.2]} />
        <mesh geometry={BOXG} material={mats.glass} position={[1.6, -1, 0]} scale={[2.2, 1.8, 1.8]} />
        <mesh geometry={BOXG} material={mats.crane} position={[0, 4, 0]} scale={[0.8, 7, 0.8]} />
        <mesh geometry={BOXG} material={mats.pole} position={[-24, -9, 0]} scale={[0.06, 18, 0.06]} />
        <mesh geometry={BOXG} material={mats.concrete} position={[-24, -18.5, 0]} scale={[2.4, 1, 1.2]} />
      </group>
    </group>
  );
}
