import { cellCenter, cellIndex, entryCell, findPath, lineFree, pathLength, walkable, type Grid, type P, type Rect } from "./layout";

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
  /** Yo'lda turib qolgan vaqt (s) — boshqalar "yurib ketyaptimi yoki turibdimi" deb qaraydi. */
  idle: number;
  /** Chetga chiqqandan keyin shu vaqtgacha kutish. */
  pauseUntil: number;
  /** Chetga chiqib kimga yo'l beryapti (u o'tib ketguncha kutadi). */
  yieldTo: string | null; yieldUntil: number;
  /** Joyidan (1 m radiusdan) chiqmay turgan vaqt — tiqilinchni aniqlash uchun. */
  jam: number; anchor: P;
  /** Maqsadga yetmay shuncha metr oldin to'xtash (o'yinchi agent oldiga boradi). */
  stop: number;
}

export const SPEED = 2.6;
/** Ikki agent markazlari orasidagi eng kam masofa (katak diagonali 0.707 dan katta → bir katakka tushmaydi). */
export const SEP = 0.5;
/** Tiqilinchdan chiqish paytidagi eng kam masofa. */
const SQUEEZE = 0.42;
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
  /** Eshik zonalari (eshik bo'shlig'i ± 1.1 m): bir vaqtda faqat bir yo'nalishda o'tiladi — qarama-qarshi kelgan kutadi. */
  doors: Rect[] = [];
  constructor(grid: Grid, doors: Rect[] = []) { this.grid = grid; this.doors = doors; }

  private doorOf(p: P): number {
    for (let i = 0; i < this.doors.length; i++) { const d = this.doors[i]; if (p.x > d.x0 && p.x < d.x1 && p.z > d.z0 && p.z < d.z1) return i; }
    return -1;
  }
  /** Eshikdan qaysi tomonga o'tyapti: +1 — z o'sadigan tomonga. */
  private doorDir(w: Walker, i: number) { const d = this.doors[i]; return w.goal.z > (d.z0 + d.z1) / 2 ? 1 : -1; }

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
      wait: 0, retryAt: 0, arrivedAt: this.time, prio: prioOf(id), replanAfter: false, hold: false, player, stuck: 0, squeezeUntil: 0, bestD: 0, idle: 0, pauseUntil: 0, yieldTo: null, yieldUntil: 0, jam: 0, anchor: { x: goal.x, z: goal.z }, stop: 0,
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
    // Uzoq tiqilgan agent (> 7 s) — faqat "bir katakka ikki agent" qoidasi qoladi (yaqin o'tib ketadi)
    const sep = w.jam > 5 ? 0 : this.time < w.squeezeUntil ? SQUEEZE : SEP;
    // Eshik navbati: eshik zonasiga kirmoqchi, ichida esa teskari yo'nalishda o'tayotgan bor — tashqarida kutadi
    const di = this.doorOf(np);
    if (di >= 0 && this.doorOf(w.pos) !== di && w.stuck < 6) {
      const my = this.doorDir(w, di);
      for (const o of this.walkers.values()) {
        if (o === w || o.player || o.arrived || o.stuck > 1.5 || this.doorOf(o.pos) !== di) continue;
        if (this.doorDir(o, di) !== my) return o;
      }
    }
    for (const o of this.walkers.values()) {
      if (o === w || o.player) continue;
      const oc = cellIndex(o.pos);
      if (oc === ci && ci !== cur) return o;
      if (this.seated(o)) continue;
      const dn = dist(np, o.pos);
      if (dn < sep && dn < dist(w.pos, o.pos) - 1e-6) return o;
    }
    return null;
  }

  /**
   * O'yinchini boshqarish: (vx, vz) — m/s. Devor va mebeldan o'tmaydi, lekin ular bo'ylab SIRPANADI (to'xtab qolmaydi):
   * har kichik qadamda — to'g'ri, faqat x, faqat z, keyin ±25°/±50° burilgan yo'nalish (eshik burchagini aylanib o'tadi).
   * Odamlar (agentlar, oshpaz) — "arvoh": o'yinchini to'smaydi.
   */
  drive(id: string, vx: number, vz: number, dt: number) {
    const w = this.walkers.get(id);
    if (!w) return;
    w.path = []; w.arrived = true;
    const sp = Math.hypot(vx, vz);
    if (sp < 1e-3) { w.moving = false; return; }
    const free = (p: P) => walkable(this.grid, cellIndex(p)) || !walkable(this.grid, cellIndex(w.pos));
    const steps = Math.max(1, Math.ceil((sp * dt) / 0.08));
    const sx = (vx * dt) / steps, sz = (vz * dt) / steps;
    let moved = false;
    for (let k = 0; k < steps; k++) {
      const cands: P[] = [{ x: sx, z: sz }, { x: sx, z: 0 }, { x: 0, z: sz }];
      for (const a of [0.44, -0.44, 0.87, -0.87]) {
        const c = Math.cos(a), s = Math.sin(a);
        cands.push({ x: (sx * c - sz * s) * c, z: (sx * s + sz * c) * c });
      }
      let ok = false;
      for (const d of cands) {
        if (Math.abs(d.x) + Math.abs(d.z) < 1e-6) continue;
        const np = { x: w.pos.x + d.x, z: w.pos.z + d.z };
        if (!free(np)) continue;
        w.pos = np; ok = true; moved = true; break;
      }
      if (!ok) break;
    }
    w.moving = moved;
    w.rot = lerpAngle(w.rot, Math.atan2(vx, vz), Math.min(1, dt * 12));
  }

  /** Bir zumda ko'chirish ("Qayerga?" — teleport): nuqta yoki uning eng yaqin bo'sh katagiga. */
  teleport(id: string, p: P, face: number): boolean {
    const w = this.walkers.get(id);
    if (!w) return false;
    let q = p;
    if (!walkable(this.grid, cellIndex(p))) {
      const i = entryCell(this.grid, p, face);
      if (i < 0) return false;
      q = cellCenter(i);
    }
    w.pos = { ...q }; w.rot = face; w.path = []; w.pi = 0; w.arrived = true; w.moving = false;
    return true;
  }

  step(dt: number) {
    this.time += dt;
    for (const w of this.walkers.values()) {
      if (w.arrived || w.player) { w.jam = 0; w.anchor = w.pos; }
      else if (dist(w.pos, w.anchor) > 1) { w.anchor = w.pos; w.jam = 0; }
      else w.jam += dt;
      if (w.player && !w.path.length) { if (!w.arrived) w.arrived = true; continue; }
      if (w.hold) { w.moving = false; continue; }
      if (w.arrived) { w.moving = false; if (!w.player) w.rot = lerpAngle(w.rot, w.goal.face, Math.min(1, dt * 6)); continue; }
      if (!w.path.length) {
        w.moving = false; w.idle += dt;
        // Yo'l bergan agent — o'tib ketguncha (≤ 4 s) chetda kutadi
        if (w.yieldTo) {
          const o = this.walkers.get(w.yieldTo);
          if (o && !o.arrived && o.stuck < 1.5 && dist(o.pos, w.pos) < 1.8 && this.time < w.yieldUntil) continue;
          w.yieldTo = null;
        }
        if (this.time >= w.retryAt) this.plan(w);
        continue;
      }
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
      if (moved) { w.wait = 0; w.idle = 0; } else w.idle += dt;
      // Tiqilinch o'lchovi: maqsadga yaqinlashmasa (aylanib yursa ham) — o'sib boradi
      const dg = dist(w.pos, w.goal);
      if (dg < w.bestD - 0.4) { w.bestD = dg; w.stuck = 0; } else w.stuck += dt;
      if (w.pi >= w.path.length) {
        if (w.replanAfter) { w.replanAfter = false; w.path = []; w.pi = 0; w.retryAt = this.time + 0.6 + (w.prio % 5) * 0.1; }
        else if (w.player) { w.path = []; w.arrived = true; w.moving = false; }
        else { w.arrived = true; w.arrivedAt = this.time; w.moving = false; }
      }
    }
  }

  /** Tiqilinchni buzish: to'sib turgan agentni (turgan bo'lsa ham) yon katakka chetlatadi; u w o'tib ketgach o'z joyiga qaytadi. */
  private forceYield(by: Walker, w: Walker): boolean {
    if (by.player || by.hold || this.seated(by)) return false;
    const cols = this.grid.cols;
    const cur = cellIndex(by.pos);
    const wNext = [w.pos, ...w.path.slice(w.pi, w.pi + 3)];
    let best: P | null = null, bd = -Infinity;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (!dr && !dc) continue;
      const i = cur + dr * cols + dc;
      if (i < 0 || i >= this.grid.blocked.length || !walkable(this.grid, i)) continue;
      const c = cellCenter(i);
      if (!lineFree(this.grid, by.pos, c) || this.blockedBy(by, c)) continue;
      let dw = Infinity;
      for (const q of wNext) dw = Math.min(dw, dist(c, q));
      const score = Math.min(dw, 2) - Math.hypot(dr, dc) * 0.15;
      if (score > bd) { bd = score; best = c; }
    }
    if (!best || bd < 0.6) return false;
    by.path = [by.pos, best]; by.pi = 1; by.arrived = false; by.replanAfter = true;
    by.yieldTo = w.id; by.yieldUntil = this.time + 4; by.wait = 0;
    return true;
  }

  private onBlocked(w: Walker, by: Walker, dt: number) {
    w.wait += dt;
    // Uzoq tiqilinch (> 5 s) — to'sib turganni chetlatish (deadlock buzuvchi)
    if (w.jam > 3 && w.wait > 0.5 && by.yieldTo !== w.id && this.forceYield(by, w)) { w.wait = 0; return; }
    // "Yurib ketyapti" — maqsadiga yaqinlashyapti (aylanib raqs qilish hisob emas)
    const byStill = by.arrived || by.hold || by.stuck > 1.5;
    // 1) To'sgan agent yurib ketyapti — navbat kutiladi (aylanib "raqs" qilinmaydi)
    if (!byStill && w.wait < 2) return;
    // 2) Ikkalasi ham turib qolgan (bir-birini kutyapti): kichik ustuvorlikdagisi chetga chiqadi, kattasi kutadi
    const mutual = !by.arrived && !by.hold && by.stuck > 1.5 && by.yieldTo !== w.id;
    if (mutual && w.prio > by.prio && w.wait < 5) return;
    if (w.wait < WAIT_REPLAN + (w.prio % 4) * 0.1) return;
    w.wait = 0;
    const saved = { path: w.path, pi: w.pi };
    // 3) Turgan to'siq (yoki uzoq kutish) — yaqindagi agentlarni aylanib o'tish
    if (!mutual && (w.stuck < 8 || by.arrived || by.hold) && this.detour(w)) return;
    w.path = saved.path; w.pi = saved.pi;
    // Joyida turgan (yetib kelgan) agent tor joyni to'sgan va aylanib bo'lmaydi — yaqinroqdan siqilib o'tadi
    if ((by.arrived || by.hold) && w.stuck < 4) { w.squeezeUntil = this.time + 2; return; }
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
      for (const o of this.walkers.values()) if (o !== w && !o.player && !this.seated(o)) near = Math.min(near, dist(o.pos, c));
      // To'sgandan va uning yo'lidan uzoqroq, kam yuradigan katak
      const nextOfBy = by.path[by.pi] || by.pos;
      // Orqaga emas — yon tomonga (o'z yo'lidan uzoqlashmaslik)
      const myNext = w.path[w.pi] || w.goal;
      const back = Math.max(0, dist(c, myNext) - dist(w.pos, myNext));
      const score = Math.min(near, 2.5) - Math.hypot(dr, dc) * 0.1 + dist(c, by.pos) * 0.3 + Math.min(dist(c, nextOfBy), 2) * 0.4 - back * 0.9;
      if (score > bd) { bd = score; best = c; }
    }
    // Chetga chiqib, bir oz turib (yo'l bo'shashini kutib) — keyin yo'lni qayta quradi
    if (best) { w.path = [w.pos, best]; w.pi = 1; w.replanAfter = true; w.yieldTo = by.id; w.yieldUntil = this.time + 4; }
    else if (!mutual && this.detour(w)) return;
    if (!best || w.stuck > 8) w.squeezeUntil = this.time + 1.5;
  }
}
