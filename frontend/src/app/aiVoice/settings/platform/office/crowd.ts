import { cellCenter, cellIndex, findPath, lineFree, pathLength, walkable, type Grid, type P } from "./layout";

// AI ofis — agentlar "olomoni": har agent A* yo'li bo'ylab yuradi, bir-biriga urilmaydi.
//  • Har qadamda: yangi nuqta boshqa agent turgan katakka tushsa yoki SEP dan yaqinlashsa — agent kutadi;
//  • ~0.5 s kutgach — boshqalar turgan kataklarni vaqtincha to'siq qilib yo'lni qayta quradi (aylanib o'tadi);
//  • yo'l bo'lmasa (tor yo'lakda yuzma-yuz) — "kichik" ustuvorlikdagisi yon katakka chetlanadi, katta o'tib ketadi.
// O'rindiqda o'tirgan agent (katagi statik to'siq) boshqalarga xalaqit bermaydi — uning joyi allaqachon to'siq.
// Sof TS (three.js'siz) — crowd.test.ts da simulyatsiya qilinadi.

export interface Goal extends P { key: string; face: number }
export interface Walker {
  id: string; pos: P; rot: number; path: P[]; pi: number; key: string; goal: Goal;
  arrived: boolean; moving: boolean; wait: number; retryAt: number; arrivedAt: number; prio: number;
  /** Yon tomonga chetlangandan keyin yo'lni qayta qurish. */
  replanAfter: boolean;
  /** Suhbat paytida joyidan qimirlamaydi. */
  hold: boolean;
  /** O'yinchi (egasi) — yo'lni o'zi boshqaradi (drive). */
  player: boolean;
  /** Ketma-ket to'xtab qolgan vaqt (s) va "siqilib o'tish" muddati (SEP kamayadi, katak qoidasi qoladi). */
  stuck: number; squeezeUntil: number; bestD: number;
  /** Maqsadga yetmay shuncha metr oldin to'xtash (o'yinchi agent oldiga boradi). */
  stop: number;
}

export const SPEED = 2.6;
/** Ikki agent markazlari orasidagi eng kam masofa (katak diagonali 0.707 dan katta → bir katakka tushmaydi). */
export const SEP = 0.75;
/** Tiqilinchdan chiqish paytidagi eng kam masofa. */
const SQUEEZE = 0.55;
const WAIT_REPLAN = 0.45;

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
export function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
/** Yo'l oxiridan `stop` metrni kesib tashlaydi. */
function trim(path: P[], stop: number): P[] {
  if (stop <= 0 || path.length < 2) return path;
  const out = path.slice();
  let left = stop;
  while (out.length >= 2 && left > 0) {
    const a = out[out.length - 2], b = out[out.length - 1];
    const d = dist(a, b);
    if (d > left) { const t = (d - left) / d; out[out.length - 1] = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }; break; }
    left -= d; out.pop();
  }
  if (out.length < 2) out.push({ ...out[0] });
  return out;
}
const prioOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return h >>> 0; };

export class Crowd {
  grid: Grid;
  walkers = new Map<string, Walker>();
  time = 0;
  /** Yurish rejimida o'yinchi yaqinidagi agentlar (ismi ko'rinadi) — Player yangilaydi. */
  labels = new Set<string>();
  constructor(grid: Grid) { this.grid = grid; }

  setGrid(g: Grid) {
    if (g === this.grid) return;
    this.grid = g;
    for (const w of this.walkers.values()) if (!w.arrived && !w.player) this.plan(w);
  }
  get(id: string) { return this.walkers.get(id); }
  remove(id: string) { this.walkers.delete(id); }

  /** Agentni darhol maqsadiga qo'yadi (birinchi ko'rinish). */
  place(id: string, goal: Goal, player = false): Walker {
    const w: Walker = {
      id, pos: { x: goal.x, z: goal.z }, rot: goal.face, path: [], pi: 0, key: goal.key, goal, arrived: true, moving: false,
      wait: 0, retryAt: 0, arrivedAt: this.time, prio: prioOf(id), replanAfter: false, hold: false, player, stuck: 0, squeezeUntil: 0, bestD: 0, stop: 0,
    };
    this.walkers.set(id, w);
    return w;
  }

  /** Maqsad o'zgarsa (key bo'yicha) — yangi yo'l. */
  setGoal(id: string, goal: Goal, stop = 0): Walker {
    const w = this.walkers.get(id) || this.place(id, goal);
    if (w.key !== goal.key) { w.key = goal.key; w.goal = goal; w.stop = stop; w.replanAfter = false; this.plan(w); }
    else w.goal = goal;
    return w;
  }

  /** O'tirgan (o'rindiq katagi statik to'siq) va yetib kelgan agent — boshqalar uchun "mebel". */
  seated(w: Walker) { return w.arrived && !w.moving && !!this.grid.blocked[cellIndex(w.pos)]; }

  private others(w: Walker) { const out: Walker[] = []; for (const o of this.walkers.values()) if (o !== w) out.push(o); return out; }

  /** Yaqindagi (o'tirmagan) agentlar kataklari + qo'shnilari — vaqtinchalik to'siq. */
  private dynamicBlock(w: Walker): Set<number> {
    const s = new Set<number>();
    const cols = this.grid.cols;
    for (const o of this.others(w)) {
      if (this.seated(o) || dist(o.pos, w.pos) > 6) continue;
      const i = cellIndex(o.pos);
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const j = i + dr * cols + dc;
        if (j >= 0 && j < this.grid.blocked.length && dist(cellCenter(j), o.pos) < 0.8) s.add(j);
      }
    }
    s.delete(cellIndex(w.pos));
    return s;
  }

  plan(w: Walker, extra?: Set<number>): boolean {
    const p = findPath(this.grid, w.pos, w.goal, { fromFace: w.rot, toFace: w.goal.face, extra });
    if (!p) { if (!extra) { w.path = []; w.pi = 0; w.arrived = false; w.retryAt = this.time + 1.5; } return false; }
    w.path = trim(p, w.stop); w.pi = 1; w.arrived = false; w.wait = 0;
    if (!extra) { w.bestD = Infinity; }
    return true;
  }

  /** Aylanib o'tish yo'li (yaqindagi agentlar — vaqtinchalik to'siq). Eng qisqa yo'ldan juda uzun bo'lsa (boshqa xona orqali) — rad. */
  private detour(w: Walker): boolean {
    const base = findPath(this.grid, w.pos, w.goal, { fromFace: w.rot, toFace: w.goal.face });
    const alt = findPath(this.grid, w.pos, w.goal, { fromFace: w.rot, toFace: w.goal.face, extra: this.dynamicBlock(w) });
    if (!alt || !base || pathLength(alt) > pathLength(base) * 1.3 + 4) return false;
    w.path = trim(alt, w.stop); w.pi = 1; w.arrived = false; w.wait = 0;
    return true;
  }

  /** Nuqtaga o'tish mumkinmi — boshqa agent katagiga tushmaydi va SEP dan yaqinlashmaydi. */
  private blockedBy(w: Walker, np: P): Walker | null {
    const ci = cellIndex(np), cur = cellIndex(w.pos);
    const sep = this.time < w.squeezeUntil ? SQUEEZE : SEP;
    for (const o of this.walkers.values()) {
      if (o === w) continue;
      const oc = cellIndex(o.pos);
      if (oc === ci && ci !== cur) return o;
      if (this.seated(o)) continue;
      const dn = dist(np, o.pos);
      if (dn < sep && dn < dist(w.pos, o.pos) - 1e-6) return o;
    }
    return null;
  }

  /** O'yinchini boshqarish: (vx, vz) — m/s. Devor/mebel bo'ylab sirpanadi, agentlar orqali o'tmaydi. */
  drive(id: string, vx: number, vz: number, dt: number) {
    const w = this.walkers.get(id);
    if (!w) return;
    w.path = []; w.arrived = true;
    const sp = Math.hypot(vx, vz);
    if (sp < 1e-3) { w.moving = false; return; }
    const tries: P[] = [
      { x: w.pos.x + vx * dt, z: w.pos.z + vz * dt }, { x: w.pos.x + vx * dt, z: w.pos.z }, { x: w.pos.x, z: w.pos.z + vz * dt },
    ];
    w.moving = false;
    for (const np of tries) {
      if (np.x === w.pos.x && np.z === w.pos.z) continue;
      if (!walkable(this.grid, cellIndex(np)) || this.blockedBy(w, np)) continue;
      w.pos = np; w.moving = true; break;
    }
    w.rot = lerpAngle(w.rot, Math.atan2(vx, vz), Math.min(1, dt * 12));
  }

  step(dt: number) {
    this.time += dt;
    for (const w of this.walkers.values()) {
      if (w.player && !w.path.length) { if (!w.arrived) w.arrived = true; continue; }
      if (w.hold) { w.moving = false; continue; }
      if (w.arrived) { w.moving = false; if (!w.player) w.rot = lerpAngle(w.rot, w.goal.face, Math.min(1, dt * 6)); continue; }
      if (!w.path.length) { w.moving = false; if (this.time >= w.retryAt) this.plan(w); continue; }
      let left = SPEED * dt;
      let moved = false;
      while (left > 1e-6 && w.pi < w.path.length) {
        const tgt = w.path[w.pi];
        const dx = tgt.x - w.pos.x, dz = tgt.z - w.pos.z;
        const d = Math.hypot(dx, dz);
        const np = d <= left ? { x: tgt.x, z: tgt.z } : { x: w.pos.x + (dx / d) * left, z: w.pos.z + (dz / d) * left };
        const by = this.blockedBy(w, np);
        if (by) { this.onBlocked(w, by, dt); break; }
        if (d > 1e-6) w.rot = lerpAngle(w.rot, Math.atan2(dx, dz), Math.min(1, dt * 10));
        w.pos = np; moved = true;
        if (d <= left) { left -= d; w.pi++; } else left = 0;
      }
      w.moving = moved;
      if (moved) w.wait = 0;
      // Tiqilinch o'lchovi: maqsadga yaqinlashmasa (aylanib yursa ham) — o'sib boradi
      const dg = dist(w.pos, w.goal);
      if (dg < w.bestD - 0.4) { w.bestD = dg; w.stuck = 0; } else w.stuck += dt;
      if (w.pi >= w.path.length) {
        if (w.replanAfter) { w.replanAfter = false; if (!this.detour(w)) this.plan(w); }
        else if (w.player) { w.path = []; w.arrived = true; w.moving = false; }
        else { w.arrived = true; w.arrivedAt = this.time; w.moving = false; }
      }
    }
  }

  private onBlocked(w: Walker, by: Walker, dt: number) {
    w.wait += dt;
    // Ikki yuruvchi to'qnashsa — faqat kichik ustuvorlikdagisi yo'l beradi (ikkalasi birdan burilib "raqs" qilmaydi)
    if (w.prio > by.prio && !by.arrived && !by.hold && !by.player && w.stuck < 4) return;
    if (w.wait < WAIT_REPLAN + (w.prio % 4) * 0.12) return;
    w.wait = 0;
    const saved = { path: w.path, pi: w.pi };
    // 1) Aylanib o'tish: yaqindagi agentlar kataklari vaqtincha to'siq
    if (w.stuck < 6 && this.detour(w)) return;
    w.path = saved.path; w.pi = saved.pi;
    // 2) Yo'l yo'q (tor joyda yuzma-yuz): kichik ustuvorlikdagisi (yoki uzoq kutgani) chetga chiqadi
    const yields = by.arrived || by.hold || by.player || w.prio < by.prio || w.stuck > 4;
    if (!yields) return;
    const cols = this.grid.cols;
    const cur = cellIndex(w.pos);
    let best: P | null = null, bd = -Infinity;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (!dr && !dc) continue;
      const i = cur + dr * cols + dc;
      if (i < 0 || i >= this.grid.blocked.length || !walkable(this.grid, i)) continue;
      const c = cellCenter(i);
      if (!lineFree(this.grid, w.pos, c) || this.blockedBy(w, c)) continue;
      let near = Infinity;
      for (const o of this.walkers.values()) if (o !== w && !this.seated(o)) near = Math.min(near, dist(o.pos, c));
      const score = Math.min(near, 2.5) - Math.hypot(dr, dc) * 0.15 + dist(c, by.pos) * 0.3;
      if (score > bd) { bd = score; best = c; }
    }
    if (best) { w.path = [w.pos, best]; w.pi = 1; w.replanAfter = true; }
    // 3) Chetga ham chiqib bo'lmasa — qisqa muddat yaqinroq o'tishga ruxsat (bir katakka baribir tushmaydi)
    if (!best || w.stuck > 8) w.squeezeUntil = this.time + 1.5;
  }
}
