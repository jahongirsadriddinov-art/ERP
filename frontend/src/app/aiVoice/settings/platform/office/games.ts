// AI ofis — mini-o'yinlar (owner 2026-10-23): PlayStation TV'da va "Mening ofisim" kompyuterida. Har o'yin bitta kichik canvas'ga
// chiziladi (TV teksturasi ham shu canvas). Odam o'ynamasa — "namoyish" (oddiy AI o'ynaydi; agentlar PlayStation'da o'ynayotgandek).
// Boshqaruv: yo'nalish (strelka/WASD/surish/D-pad), A (Space/Enter/tugma), teginish (x,y 0..1). Rekordlar — shu dasturchi uchun
// localStorage'da. Sof mantiq (2048 surish, ilon qadami, qator tozalash, X-O AI) — games.test.ts.

export type GameId = "pong" | "snake" | "blocks" | "g2048" | "breakout" | "racer" | "ttt";
export const GAME_IDS: GameId[] = ["pong", "snake", "blocks", "g2048", "breakout", "racer", "ttt"];
export type Dir = "up" | "down" | "left" | "right";
export interface GameInput { x: number; y: number; dir: Dir | null; a: boolean; tap: { x: number; y: number } | null }
export interface MiniGame {
  id: GameId; canvas: HTMLCanvasElement; score: number; over: boolean;
  /** Odam o'ynayaptimi (aks holda — namoyish). */
  playing: boolean;
  reset(): void;
  update(dt: number, inp: GameInput | null): void;
  draw(): void;
  onHit?: (() => void) | null;
}

const mk = (w: number, h: number) => {
  const c = typeof document !== "undefined" ? document.createElement("canvas") : ({ width: w, height: h, getContext: () => null } as unknown as HTMLCanvasElement);
  c.width = w; c.height = h;
  return c;
};
const ctx = (c: HTMLCanvasElement) => (c.getContext?.("2d") as CanvasRenderingContext2D | null) || null;
const BG = "#070b1a";
function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size = 12, color = "#c9d6ff", align: CanvasTextAlign = "center") {
  g.font = `bold ${size}px monospace`; g.textAlign = align; g.fillStyle = color; g.fillText(s, x, y);
}
const rnd = (n: number) => Math.floor(Math.random() * n);

// ───────────── Rekordlar ─────────────
const uid = () => { try { return JSON.parse(localStorage.getItem("currentUser") || "{}").id || "dev"; } catch { return "dev"; } };
export const hiscore = {
  get(id: GameId): number { try { return Number(localStorage.getItem(`aiOffice.hi.${uid()}.${id}`)) || 0; } catch { return 0; } },
  set(id: GameId, v: number) { try { if (v > hiscore.get(id)) localStorage.setItem(`aiOffice.hi.${uid()}.${id}`, String(Math.floor(v))); } catch { /* */ } },
};

// ───────────── Sof mantiq (testlanadi) ─────────────
/** 2048: bitta qatorni chapga surish. */
export function slide2048(row: number[]): { row: number[]; gained: number } {
  const v = row.filter((x) => x);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] === v[i + 1]) { out.push(v[i] * 2); gained += v[i] * 2; i++; } else out.push(v[i]);
  }
  while (out.length < row.length) out.push(0);
  return { row: out, gained };
}
/** 2048: butun taxtani yo'nalish bo'yicha surish. */
export function move2048(b: number[][], d: Dir): { board: number[][]; gained: number; moved: boolean } {
  const n = b.length;
  const get = (r: number, c: number) => (d === "left" ? b[r][c] : d === "right" ? b[r][n - 1 - c] : d === "up" ? b[c][r] : b[n - 1 - c][r]);
  const out = b.map((r) => r.slice());
  let gained = 0, moved = false;
  for (let r = 0; r < n; r++) {
    const line = Array.from({ length: n }, (_, c) => get(r, c));
    const s = slide2048(line);
    gained += s.gained;
    for (let c = 0; c < n; c++) {
      const [rr, cc] = d === "left" ? [r, c] : d === "right" ? [r, n - 1 - c] : d === "up" ? [c, r] : [n - 1 - c, r];
      if (out[rr][cc] !== s.row[c]) moved = true;
      out[rr][cc] = s.row[c];
    }
  }
  return { board: out, gained, moved };
}
export interface SnakeState { body: { x: number; y: number }[]; dir: Dir; food: { x: number; y: number }; w: number; h: number }
const DV: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
/** Ilon: bir qadam. Devor yoki o'ziga urilsa — dead. */
export function snakeStep(s: SnakeState, want: Dir | null): { state: SnakeState; dead: boolean; ate: boolean } {
  const dir = want && want !== OPP[s.dir] ? want : s.dir;
  const [dx, dy] = DV[dir];
  const head = { x: s.body[0].x + dx, y: s.body[0].y + dy };
  const ate = head.x === s.food.x && head.y === s.food.y;
  const body = [head, ...s.body];
  if (!ate) body.pop();
  const dead = head.x < 0 || head.y < 0 || head.x >= s.w || head.y >= s.h || body.slice(1).some((p) => p.x === head.x && p.y === head.y);
  return { state: { ...s, body, dir }, dead, ate };
}
/** Bloklar: to'lgan qatorlarni olib tashlaydi (tepadan bo'sh qator qo'shiladi). */
export function clearLines(board: number[][]): { board: number[][]; lines: number } {
  const w = board[0].length;
  const keep = board.filter((r) => r.some((c) => !c));
  const lines = board.length - keep.length;
  return { board: [...Array.from({ length: lines }, () => new Array(w).fill(0)), ...keep], lines };
}
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
/** X-O: g'olib (1 — X, 2 — O), 3 — durang, 0 — davom etmoqda. */
export function tttWinner(b: number[]): number {
  for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  return b.every((x) => x) ? 3 : 0;
}
/** X-O: eng yaxshi yurish (minimaks). */
export function tttBest(b: number[], me: number): number {
  const other = me === 1 ? 2 : 1;
  const score = (bb: number[], turn: number, depth: number): number => {
    const w = tttWinner(bb);
    if (w === me) return 10 - depth;
    if (w === other) return depth - 10;
    if (w === 3) return 0;
    let best = turn === me ? -Infinity : Infinity;
    for (let i = 0; i < 9; i++) if (!bb[i]) {
      bb[i] = turn;
      const v = score(bb, turn === 1 ? 2 : 1, depth + 1);
      bb[i] = 0;
      best = turn === me ? Math.max(best, v) : Math.min(best, v);
    }
    return best;
  };
  let bi = -1, bv = -Infinity;
  for (let i = 0; i < 9; i++) if (!b[i]) {
    b[i] = me;
    const v = score(b, other, 1);
    b[i] = 0;
    if (v > bv) { bv = v; bi = i; }
  }
  return bi;
}

// ───────────── O'yinlar ─────────────
abstract class Base implements MiniGame {
  abstract id: GameId;
  canvas: HTMLCanvasElement; g: CanvasRenderingContext2D | null;
  score = 0; over = false; playing = false; onHit: (() => void) | null = null;
  constructor(w = 320, h = 192) { this.canvas = mk(w, h); this.g = ctx(this.canvas); }
  abstract reset(): void;
  abstract update(dt: number, inp: GameInput | null): void;
  abstract draw(): void;
  protected end() { this.over = true; if (this.playing) hiscore.set(this.id, this.score); }
  protected hud(title: string) {
    const g = this.g; if (!g) return;
    text(g, `${this.score}`, this.canvas.width - 6, 14, 12, "#ffffff", "right");
    if (!this.playing) text(g, `${title} — DEMO`, this.canvas.width / 2, this.canvas.height - 6, 10, "#8fa3d9");
    if (this.over) { g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, 0, this.canvas.width, this.canvas.height); text(g, "GAME OVER", this.canvas.width / 2, this.canvas.height / 2, 18, "#ffd23f"); text(g, "A — qayta", this.canvas.width / 2, this.canvas.height / 2 + 18, 11); }
  }
}

export class Pong extends Base {
  id: GameId = "pong";
  ball = { x: 160, y: 90, vx: 150, vy: 90 };
  left = 70; right = 70;
  sc: [number, number] = [0, 0];
  /** Eski API (TV/kompyuter): -1 yuqoriga, +1 pastga; null — avtomatik. */
  input: number | null = null;
  get score2() { return this.sc; }
  constructor() { super(320, 180); }
  reset(dir = 1) { this.ball = { x: 160, y: 90, vx: 150 * dir, vy: (Math.random() - 0.5) * 160 }; this.over = false; }
  update(dt: number, inp: GameInput | null) {
    const b = this.ball, P = 40;
    const ai = (y: number, sp: number) => { const c = y + P / 2, d = b.y - c; return y + Math.max(-sp * dt, Math.min(sp * dt, d)); };
    const human = inp ? inp.y : this.playing ? this.input : null;
    if (human !== null && human !== undefined) this.left += human * 210 * dt; else this.left = ai(this.left, 150);
    this.right = ai(this.right, this.playing ? 120 : 150);
    this.left = Math.max(0, Math.min(180 - P, this.left)); this.right = Math.max(0, Math.min(180 - P, this.right));
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < 4 || b.y > 176) { b.vy *= -1; b.y = Math.max(4, Math.min(176, b.y)); }
    if (b.x < 18 && b.x > 8 && b.y > this.left && b.y < this.left + P && b.vx < 0) { b.vx = -b.vx * 1.04; b.vy += (b.y - (this.left + P / 2)) * 4; if (this.playing) this.onHit?.(); }
    if (b.x > 302 && b.x < 312 && b.y > this.right && b.y < this.right + P && b.vx > 0) { b.vx = -b.vx * 1.04; b.vy += (b.y - (this.right + P / 2)) * 4; if (this.playing) this.onHit?.(); }
    if (b.x < -10) { this.sc[1]++; this.reset(1); }
    if (b.x > 330) { this.sc[0]++; this.score = this.sc[0]; if (this.playing) hiscore.set("pong", this.score); this.reset(-1); }
    b.vx = Math.sign(b.vx) * Math.min(420, Math.abs(b.vx));
  }
  draw() {
    const g = this.g; if (!g) return;
    g.fillStyle = BG; g.fillRect(0, 0, 320, 180);
    g.fillStyle = "#1b2a52"; for (let y = 0; y < 180; y += 14) g.fillRect(158, y, 4, 8);
    g.fillStyle = "#7cf3ff"; g.fillRect(10, this.left, 6, 40);
    g.fillStyle = "#ff7ab8"; g.fillRect(304, this.right, 6, 40);
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(this.ball.x, this.ball.y, 5, 0, Math.PI * 2); g.fill();
    text(g, String(this.sc[0]), 120, 28, 22); text(g, String(this.sc[1]), 200, 28, 22);
    if (!this.playing) text(g, "PONG — DEMO", 160, 170, 11, "#8fa3d9");
  }
}

class Snake extends Base {
  id: GameId = "snake";
  s!: SnakeState; acc = 0; want: Dir | null = null;
  constructor() { super(320, 192); this.reset(); }
  reset() { this.s = { body: [{ x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }], dir: "right", food: { x: 14, y: 6 }, w: 20, h: 12 }; this.score = 0; this.over = false; this.acc = 0; }
  private food() { do { this.s.food = { x: rnd(this.s.w), y: rnd(this.s.h) }; } while (this.s.body.some((p) => p.x === this.s.food.x && p.y === this.s.food.y)); }
  update(dt: number, inp: GameInput | null) {
    if (this.over) { if (inp?.a || inp?.dir || !this.playing) { this.acc += dt; if (this.acc > (this.playing ? 0 : 1.5)) this.reset(); } return; }
    if (inp?.dir) this.want = inp.dir;
    this.acc += dt;
    if (this.acc < Math.max(0.06, 0.13 - this.score * 0.002)) return;
    this.acc = 0;
    let want = this.want;
    if (!inp) {
      // Namoyish: ovqat tomon, xavfsiz yo'nalish
      const h = this.s.body[0], f = this.s.food;
      const opts: Dir[] = (["left", "right", "up", "down"] as Dir[]).sort((a, b) => {
        const da = Math.abs(h.x + DV[a][0] - f.x) + Math.abs(h.y + DV[a][1] - f.y), db = Math.abs(h.x + DV[b][0] - f.x) + Math.abs(h.y + DV[b][1] - f.y);
        return da - db;
      });
      want = opts.find((d) => d !== OPP[this.s.dir] && !snakeStep(this.s, d).dead) || this.s.dir;
    }
    const r = snakeStep(this.s, want);
    this.s = r.state; this.want = null;
    if (r.dead) { this.end(); return; }
    if (r.ate) { this.score++; this.food(); if (this.playing) this.onHit?.(); }
  }
  draw() {
    const g = this.g; if (!g) return;
    const C = 16;
    g.fillStyle = BG; g.fillRect(0, 0, 320, 192);
    g.fillStyle = "#ff5f57"; g.fillRect(this.s.food.x * C + 3, this.s.food.y * C + 3, C - 6, C - 6);
    this.s.body.forEach((p, i) => { g.fillStyle = i ? "#3fbf6f" : "#7cf37c"; g.fillRect(p.x * C + 1, p.y * C + 1, C - 2, C - 2); });
    this.hud("SNAKE");
  }
}

const SHAPES = [[[1, 1, 1, 1]], [[1, 1], [1, 1]], [[0, 1, 0], [1, 1, 1]], [[1, 0, 0], [1, 1, 1]], [[0, 0, 1], [1, 1, 1]], [[1, 1, 0], [0, 1, 1]], [[0, 1, 1], [1, 1, 0]]];
const COLORS = ["#000", "#5ea8ff", "#ffd23f", "#b57edc", "#f2a541", "#5b8def", "#ff5f57", "#7bd389"];
class Blocks extends Base {
  id: GameId = "blocks";
  W = 10; H = 18; board: number[][] = []; p = { m: [[1]], x: 0, y: 0, c: 1 }; acc = 0;
  constructor() { super(320, 192); this.reset(); }
  reset() { this.board = Array.from({ length: this.H }, () => new Array(this.W).fill(0)); this.score = 0; this.over = false; this.spawn(); }
  private spawn() { const i = rnd(SHAPES.length); this.p = { m: SHAPES[i].map((r) => r.slice()), x: 3, y: 0, c: i + 1 }; if (this.hit(this.p.m, this.p.x, this.p.y)) this.end(); }
  private hit(m: number[][], x: number, y: number) {
    return m.some((r, i) => r.some((v, j) => v && (y + i >= this.H || x + j < 0 || x + j >= this.W || (y + i >= 0 && this.board[y + i][x + j]))));
  }
  private rot() { const m = this.p.m; const r = m[0].map((_, j) => m.map((row) => row[j]).reverse()); if (!this.hit(r, this.p.x, this.p.y)) this.p.m = r; }
  private lock() {
    this.p.m.forEach((r, i) => r.forEach((v, j) => { if (v && this.p.y + i >= 0) this.board[this.p.y + i][this.p.x + j] = this.p.c; }));
    const c = clearLines(this.board);
    this.board = c.board;
    if (c.lines) { this.score += [0, 100, 300, 500, 800][c.lines]; if (this.playing) this.onHit?.(); }
    this.spawn();
  }
  update(dt: number, inp: GameInput | null) {
    if (this.over) { this.acc += dt; if ((inp?.a && this.playing) || (!this.playing && this.acc > 2)) this.reset(); return; }
    if (inp?.dir === "left" && !this.hit(this.p.m, this.p.x - 1, this.p.y)) this.p.x--;
    if (inp?.dir === "right" && !this.hit(this.p.m, this.p.x + 1, this.p.y)) this.p.x++;
    if (inp?.dir === "up" || inp?.a) this.rot();
    if (inp?.dir === "down") { while (!this.hit(this.p.m, this.p.x, this.p.y + 1)) this.p.y++; this.lock(); return; }
    if (!inp && Math.random() < dt * 2) { const r = Math.random(); if (r < 0.3) this.rot(); else if (r < 0.65 && !this.hit(this.p.m, this.p.x - 1, this.p.y)) this.p.x--; else if (!this.hit(this.p.m, this.p.x + 1, this.p.y)) this.p.x++; }
    this.acc += dt * (inp && inp.y > 0.5 ? 8 : 1);
    if (this.acc < Math.max(0.12, 0.6 - this.score / 4000)) return;
    this.acc = 0;
    if (this.hit(this.p.m, this.p.x, this.p.y + 1)) this.lock(); else this.p.y++;
  }
  draw() {
    const g = this.g; if (!g) return;
    const C = 10, ox = 110, oy = 6;
    g.fillStyle = BG; g.fillRect(0, 0, 320, 192);
    g.fillStyle = "#111a33"; g.fillRect(ox, oy, this.W * C, this.H * C);
    this.board.forEach((r, i) => r.forEach((v, j) => { if (v) { g.fillStyle = COLORS[v]; g.fillRect(ox + j * C, oy + i * C, C - 1, C - 1); } }));
    this.p.m.forEach((r, i) => r.forEach((v, j) => { if (v) { g.fillStyle = COLORS[this.p.c]; g.fillRect(ox + (this.p.x + j) * C, oy + (this.p.y + i) * C, C - 1, C - 1); } }));
    this.hud("BLOCKS");
  }
}

class G2048 extends Base {
  id: GameId = "g2048";
  b: number[][] = []; acc = 0;
  constructor() { super(320, 192); this.reset(); }
  reset() { this.b = Array.from({ length: 4 }, () => [0, 0, 0, 0]); this.score = 0; this.over = false; this.add(); this.add(); }
  private add() { const e: [number, number][] = []; this.b.forEach((r, i) => r.forEach((v, j) => { if (!v) e.push([i, j]); })); if (!e.length) return; const [i, j] = e[rnd(e.length)]; this.b[i][j] = Math.random() < 0.9 ? 2 : 4; }
  private go(d: Dir) {
    const m = move2048(this.b, d);
    if (!m.moved) return;
    this.b = m.board; this.score += m.gained; this.add();
    if (m.gained && this.playing) this.onHit?.();
    if ((["up", "down", "left", "right"] as Dir[]).every((x) => !move2048(this.b, x).moved)) this.end();
  }
  update(dt: number, inp: GameInput | null) {
    if (this.over) { this.acc += dt; if ((inp?.a && this.playing) || (!this.playing && this.acc > 2)) { this.acc = 0; this.reset(); } return; }
    if (inp?.dir) this.go(inp.dir);
    if (!inp) { this.acc += dt; if (this.acc > 0.45) { this.acc = 0; const order: Dir[] = ["down", "left", "right", "up"]; for (const d of order) if (move2048(this.b, d).moved) { this.go(d); break; } } }
  }
  draw() {
    const g = this.g; if (!g) return;
    g.fillStyle = "#1f1a14"; g.fillRect(0, 0, 320, 192);
    const C = 42, ox = 76, oy = 8;
    this.b.forEach((r, i) => r.forEach((v, j) => {
      g.fillStyle = v ? `hsl(${30 + Math.log2(v) * 18}, 70%, ${70 - Math.log2(v) * 3}%)` : "#3a3128";
      g.fillRect(ox + j * C, oy + i * C, C - 4, C - 4);
      if (v) text(g, String(v), ox + j * C + (C - 4) / 2, oy + i * C + 25, v > 512 ? 12 : 15, "#1f1a14");
    }));
    this.hud("2048");
  }
}

class Breakout extends Base {
  id: GameId = "breakout";
  px = 140; ball = { x: 160, y: 140, vx: 110, vy: -130 }; bricks: number[][] = []; lives = 3;
  constructor() { super(320, 192); this.reset(); }
  reset() { this.bricks = Array.from({ length: 5 }, () => new Array(10).fill(1)); this.score = 0; this.over = false; this.lives = 3; this.serve(); }
  private serve() { this.ball = { x: this.px + 25, y: 160, vx: (Math.random() - 0.5) * 200, vy: -140 }; }
  update(dt: number, inp: GameInput | null) {
    if (this.over) { if ((inp?.a && this.playing) || !this.playing) this.reset(); return; }
    const b = this.ball;
    if (inp) this.px += (inp.x || (inp.dir === "left" ? -1 : inp.dir === "right" ? 1 : 0)) * 260 * dt;
    else this.px += Math.max(-200 * dt, Math.min(200 * dt, b.x - (this.px + 25)));
    this.px = Math.max(0, Math.min(270, this.px));
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < 4 || b.x > 316) b.vx *= -1;
    if (b.y < 4) b.vy = Math.abs(b.vy);
    if (b.y > 172 && b.y < 180 && b.x > this.px && b.x < this.px + 50 && b.vy > 0) { b.vy = -Math.abs(b.vy) * 1.02; b.vx += (b.x - (this.px + 25)) * 4; if (this.playing) this.onHit?.(); }
    if (b.y > 196) { this.lives--; if (this.lives <= 0) this.end(); else this.serve(); }
    const bw = 30, bh = 10;
    const i = Math.floor((b.y - 20) / (bh + 2)), j = Math.floor((b.x - 10) / (bw + 0));
    if (i >= 0 && i < 5 && j >= 0 && j < 10 && this.bricks[i][j]) { this.bricks[i][j] = 0; b.vy *= -1; this.score += 10; if (this.playing) this.onHit?.(); }
    if (this.bricks.every((r) => r.every((x) => !x))) this.bricks = Array.from({ length: 5 }, () => new Array(10).fill(1));
  }
  draw() {
    const g = this.g; if (!g) return;
    g.fillStyle = BG; g.fillRect(0, 0, 320, 192);
    this.bricks.forEach((r, i) => r.forEach((v, j) => { if (v) { g.fillStyle = `hsl(${i * 50}, 70%, 60%)`; g.fillRect(10 + j * 30, 20 + i * 12, 28, 10); } }));
    g.fillStyle = "#7cf3ff"; g.fillRect(this.px, 176, 50, 6);
    g.fillStyle = "#fff"; g.beginPath(); g.arc(this.ball.x, this.ball.y, 4, 0, Math.PI * 2); g.fill();
    text(g, "♥".repeat(Math.max(0, this.lives)), 6, 14, 12, "#ff5f57", "left");
    this.hud("BREAKOUT");
  }
}

class Racer extends Base {
  id: GameId = "racer";
  lane = 1; x = 160; cars: { lane: number; y: number; c: string }[] = []; speed = 120; dist = 0; acc = 0; road = 0;
  constructor() { super(320, 192); this.reset(); }
  reset() { this.lane = 1; this.cars = []; this.speed = 120; this.dist = 0; this.score = 0; this.over = false; }
  update(dt: number, inp: GameInput | null) {
    if (this.over) { this.acc += dt; if ((inp?.a && this.playing) || (!this.playing && this.acc > 1.5)) { this.acc = 0; this.reset(); } return; }
    if (inp?.dir === "left") this.lane = Math.max(0, this.lane - 1);
    if (inp?.dir === "right") this.lane = Math.min(2, this.lane + 1);
    if (inp && !inp.dir && Math.abs(inp.x) > 0.6) { this.acc += dt; if (this.acc > 0.25) { this.acc = 0; this.lane = Math.max(0, Math.min(2, this.lane + Math.sign(inp.x))); } }
    if (!inp) { const danger = this.cars.find((c) => c.lane === this.lane && c.y > 60 && c.y < 160); if (danger) this.lane = [0, 1, 2].find((l) => !this.cars.some((c) => c.lane === l && c.y > 40 && c.y < 170)) ?? this.lane; }
    const tx = 100 + this.lane * 60;
    this.x += (tx - this.x) * Math.min(1, dt * 12);
    this.speed += dt * 4; this.dist += this.speed * dt; this.road = (this.road + this.speed * dt) % 32;
    this.score = Math.floor(this.dist / 10);
    if (Math.random() < dt * (0.8 + this.speed / 300)) this.cars.push({ lane: rnd(3), y: -30, c: ["#ff5f57", "#ffd23f", "#b57edc", "#5b8def"][rnd(4)] });
    for (const c of this.cars) c.y += this.speed * 0.7 * dt;
    this.cars = this.cars.filter((c) => c.y < 220);
    if (this.cars.some((c) => Math.abs(100 + c.lane * 60 - this.x) < 26 && c.y > 140 && c.y < 186)) { this.end(); if (this.playing) this.onHit?.(); }
  }
  draw() {
    const g = this.g; if (!g) return;
    g.fillStyle = "#2f5e3e"; g.fillRect(0, 0, 320, 192);
    g.fillStyle = "#3b3b45"; g.fillRect(70, 0, 180, 192);
    g.fillStyle = "#f8f8f8"; for (let y = -32 + this.road; y < 192; y += 32) { g.fillRect(128, y, 4, 16); g.fillRect(188, y, 4, 16); }
    for (const c of this.cars) { g.fillStyle = c.c; g.fillRect(100 + c.lane * 60 - 14, c.y, 28, 40); }
    g.fillStyle = "#D97757"; g.fillRect(this.x - 14, 148, 28, 40);
    g.fillStyle = "#1d1410"; g.fillRect(this.x - 8, 156, 4, 7); g.fillRect(this.x + 4, 156, 4, 7);
    this.hud("RACER");
  }
}

class TicTacToe extends Base {
  id: GameId = "ttt";
  b = new Array(9).fill(0); cur = 4; turn = 1; acc = 0; wins = 0; msg = "";
  constructor() { super(320, 192); this.reset(); }
  reset() { this.b = new Array(9).fill(0); this.turn = 1; this.over = false; this.msg = ""; this.acc = 0; }
  private place(i: number) {
    if (this.b[i] || this.over) return;
    this.b[i] = this.turn; this.turn = this.turn === 1 ? 2 : 1;
    const w = tttWinner(this.b);
    if (w) {
      this.over = true;
      if (this.playing && w === 1) { this.wins++; this.score = this.wins; hiscore.set("ttt", this.wins); }
      this.msg = w === 3 ? "DURANG" : w === 1 ? (this.playing ? "SIZ YUTDINGIZ!" : "X YUTDI") : "AGENT YUTDI";
    }
  }
  update(dt: number, inp: GameInput | null) {
    this.acc += dt;
    if (this.over) { if ((inp?.a || inp?.tap) && this.playing) this.reset(); else if (!this.playing && this.acc > 2) this.reset(); return; }
    if (this.playing && this.turn === 1 && inp) {
      if (inp.dir) { const [dx, dy] = DV[inp.dir]; const x = Math.max(0, Math.min(2, (this.cur % 3) + dx)), y = Math.max(0, Math.min(2, Math.floor(this.cur / 3) + dy)); this.cur = y * 3 + x; }
      if (inp.tap) { const ox = 160 - 81, oy = 15; const x = Math.floor((inp.tap.x * 320 - ox) / 54), y = Math.floor((inp.tap.y * 192 - oy) / 54); if (x >= 0 && x < 3 && y >= 0 && y < 3) { this.cur = y * 3 + x; this.place(this.cur); this.acc = 0; } }
      if (inp.a) { this.place(this.cur); this.acc = 0; }
      return;
    }
    // Agent (O) — biroz o'ylab; ba'zan xato qiladi (yutish mumkin bo'lsin)
    if (this.acc > 0.6) {
      this.acc = 0;
      const free = this.b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      const i = Math.random() < 0.8 ? tttBest(this.b, this.turn) : free[rnd(free.length)];
      this.place(i);
    }
  }
  draw() {
    const g = this.g; if (!g) return;
    g.fillStyle = BG; g.fillRect(0, 0, 320, 192);
    const ox = 160 - 81, oy = 15, C = 54;
    g.strokeStyle = "#3b4f8f"; g.lineWidth = 3;
    for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(ox + i * C, oy); g.lineTo(ox + i * C, oy + 3 * C); g.stroke(); g.beginPath(); g.moveTo(ox, oy + i * C); g.lineTo(ox + 3 * C, oy + i * C); g.stroke(); }
    this.b.forEach((v, i) => { if (v) text(g, v === 1 ? "X" : "O", ox + (i % 3) * C + C / 2, oy + Math.floor(i / 3) * C + 38, 30, v === 1 ? "#7cf3ff" : "#D97757"); });
    if (this.playing && !this.over) { g.strokeStyle = "#ffd23f"; g.strokeRect(ox + (this.cur % 3) * C + 3, oy + Math.floor(this.cur / 3) * C + 3, C - 6, C - 6); }
    text(g, `Yutuq: ${this.wins}`, 6, 14, 11, "#ffffff", "left");
    if (this.msg) text(g, this.msg, 160, 186, 13, "#ffd23f");
    else if (!this.playing) text(g, "X-O vs AGENT — DEMO", 160, 186, 10, "#8fa3d9");
  }
}

export function createGame(id: GameId): MiniGame {
  switch (id) {
    case "pong": return new Pong();
    case "snake": return new Snake();
    case "blocks": return new Blocks();
    case "g2048": return new G2048();
    case "breakout": return new Breakout();
    case "racer": return new Racer();
    default: return new TicTacToe();
  }
}
