import * as THREE from "three";

// AI ofis — "jonli" ekranlar: har tur uchun BITTA kichik canvas tekstura (barcha monitorlar bo'lishib ishlatadi),
// kino filmi (oddiy multfilm sahnasi — mualliflik kontenti yo'q), PlayStation TV'dagi Pong o'yini, deraza osmoni.
// Hammasi bitta joyda yangilanadi (ScreenHub.tick) — monitorlar ~10 fps, kino ~15 fps, o'yin o'ynalayotganda ~30 fps.
// Sahna yashirin bo'lsa tick chaqirilmaydi (frameloop "never").

export type ScreenKind = "code" | "design" | "chart" | "social" | "terminal" | "map" | "call" | "plan" | "idle";
export const SCREEN_KINDS: ScreenKind[] = ["code", "design", "chart", "social", "terminal", "map", "call", "plan", "idle"];

/** Agent ishi turiga qarab monitor tasviri. */
export function screenKindOf(id: string, zone: string, kind?: string): ScreenKind {
  if (id === "manager") return "plan";
  if (zone === "call" || kind === "role" || kind === "tg") return "call";
  if (["designer", "botdesign", "office-designer"].includes(id)) return "design";
  if (["analytics", "reporter", "billing", "finance", "payments"].includes(id)) return "chart";
  if (["smm", "marketing", "landing", "support", "docs", "translator"].includes(id)) return "social";
  if (["devops", "security", "monitoring", "qa", "perf"].includes(id)) return "terminal";
  if (id === "gps") return "map";
  return kind === "content" ? "social" : "code";
}

const W = 192, H = 120;
const mk = (w = W, h = H) => {
  const c = typeof document !== "undefined" ? document.createElement("canvas") : ({} as HTMLCanvasElement);
  c.width = w; c.height = h;
  return c;
};
const CODE_LINES = [
  "import { Router } from 'express';", "export async function list(req, res) {", "  const items = await Project.find({", "    companyId: req.user.companyId,",
  "  }).lean();", "  res.json(items.map(toDto));", "}", "", "describe('smeta', () => {", "  it('hisoblaydi', () => {", "    expect(total(rows)).toBe(1200);", "  });",
  "});", "const [open, setOpen] = useState(false);", "return <Card title={t('obj.title')} />;", "await queue.add('call', { phone });",
];
const TERM_LINES = [
  "$ npm run build", "✓ 1342 modules transformed", "dist/index.js  412.3 kB", "$ npx vitest run", " ✓ 386 passed", "$ curl -s /api/health", "{ ok: true, db: 'up' }",
  "[deploy] render: live ✔", "[scan] 0 vulnerabilities", "[perf] p95 84 ms", "$ git push origin agent/qa", "[ci] e2e: 41 passed",
];

export class Pong {
  canvas = mk(320, 180);
  ctx = this.canvas.getContext?.("2d") as CanvasRenderingContext2D | null;
  ball = { x: 160, y: 90, vx: 150, vy: 90 };
  left = 70; right = 70;
  score: [number, number] = [0, 0];
  /** O'yinchi boshqaradi (chap raketka): -1 yuqoriga, +1 pastga; null — avtomatik (namoyish). */
  input: number | null = null;
  playing = false;
  reset(dir = 1) { this.ball = { x: 160, y: 90, vx: 150 * dir, vy: (Math.random() - 0.5) * 160 }; }
  update(dt: number) {
    const b = this.ball, P = 40;
    const ai = (y: number, sp: number) => { const c = y + P / 2, d = b.y - c; return y + Math.max(-sp * dt, Math.min(sp * dt, d)); };
    if (this.playing && this.input !== null) this.left += this.input * 210 * dt; else this.left = ai(this.left, 150);
    this.right = ai(this.right, this.playing ? 120 : 150);
    this.left = Math.max(0, Math.min(180 - P, this.left)); this.right = Math.max(0, Math.min(180 - P, this.right));
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < 4 || b.y > 176) { b.vy *= -1; b.y = Math.max(4, Math.min(176, b.y)); }
    if (b.x < 18 && b.x > 8 && b.y > this.left && b.y < this.left + P && b.vx < 0) { b.vx = -b.vx * 1.04; b.vy += (b.y - (this.left + P / 2)) * 4; }
    if (b.x > 302 && b.x < 312 && b.y > this.right && b.y < this.right + P && b.vx > 0) { b.vx = -b.vx * 1.04; b.vy += (b.y - (this.right + P / 2)) * 4; }
    if (b.x < -10) { this.score[1]++; this.reset(1); }
    if (b.x > 330) { this.score[0]++; this.reset(-1); }
    b.vx = Math.sign(b.vx) * Math.min(420, Math.abs(b.vx));
  }
  draw() {
    const g = this.ctx;
    if (!g) return;
    g.fillStyle = "#070b1a"; g.fillRect(0, 0, 320, 180);
    g.fillStyle = "#1b2a52"; for (let y = 0; y < 180; y += 14) g.fillRect(158, y, 4, 8);
    g.fillStyle = "#7cf3ff"; g.fillRect(10, this.left, 6, 40);
    g.fillStyle = "#ff7ab8"; g.fillRect(304, this.right, 6, 40);
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(this.ball.x, this.ball.y, 5, 0, Math.PI * 2); g.fill();
    g.font = "bold 22px monospace"; g.textAlign = "center"; g.fillStyle = "#c9d6ff";
    g.fillText(String(this.score[0]), 120, 28); g.fillText(String(this.score[1]), 200, 28);
    if (!this.playing) { g.font = "bold 11px sans-serif"; g.fillStyle = "#8fa3d9"; g.fillText("PONG — DEMO", 160, 170); }
  }
}

export class ScreenHub {
  canvases = {} as Record<ScreenKind, HTMLCanvasElement>;
  textures = {} as Record<ScreenKind, THREE.CanvasTexture>;
  movieCanvas = mk(384, 192);
  movie: THREE.CanvasTexture;
  pong = new Pong();
  tv: THREE.CanvasTexture;
  sky: THREE.CanvasTexture;
  used = new Set<ScreenKind>();
  private acc = 0; private accMovie = 0; private accTv = 0; private t = 0;
  constructor() {
    for (const k of SCREEN_KINDS) {
      this.canvases[k] = mk();
      this.textures[k] = this.tex(this.canvases[k]);
    }
    this.movie = this.tex(this.movieCanvas);
    this.tv = this.tex(this.pong.canvas);
    const sky = mk(128, 64);
    const g = sky.getContext?.("2d");
    if (g) {
      const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, "#6fb3ff"); gr.addColorStop(1, "#d8ecff");
      g.fillStyle = gr; g.fillRect(0, 0, 128, 64);
      g.fillStyle = "rgba(255,255,255,.9)";
      for (const [x, y, r] of [[20, 22, 9], [30, 20, 11], [40, 23, 8], [84, 34, 8], [94, 31, 10], [104, 35, 7]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    }
    this.sky = this.tex(sky);
    this.sky.wrapS = THREE.RepeatWrapping;
    for (const k of SCREEN_KINDS) this.drawScreen(k, 0);
    this.drawMovie(0); this.pong.draw();
  }
  private tex(c: HTMLCanvasElement) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    return t;
  }
  tick(dt: number) {
    this.t += dt; this.acc += dt; this.accMovie += dt; this.accTv += dt;
    this.sky.offset.x = (this.sky.offset.x + dt * 0.004) % 1;
    if (this.acc >= 0.1) {
      for (const k of this.used) { this.drawScreen(k, this.t); this.textures[k].needsUpdate = true; }
      this.acc = 0;
    }
    if (this.accMovie >= 1 / 15) { this.drawMovie(this.t); this.movie.needsUpdate = true; this.accMovie = 0; }
    const tvStep = this.pong.playing ? 1 / 40 : 1 / 15;
    if (this.accTv >= tvStep) { this.pong.update(this.accTv); this.pong.draw(); this.tv.needsUpdate = true; this.accTv = 0; }
  }
  dispose() {
    for (const k of SCREEN_KINDS) this.textures[k].dispose();
    this.movie.dispose(); this.tv.dispose(); this.sky.dispose();
  }

  private drawScreen(k: ScreenKind, t: number) {
    const g = this.canvases[k].getContext?.("2d");
    if (!g) return;
    const bar = (bg: string, title: string) => {
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(0, 0, W, 12);
      g.fillStyle = "#ff5f57"; g.fillRect(4, 4, 4, 4); g.fillStyle = "#febc2e"; g.fillRect(10, 4, 4, 4); g.fillStyle = "#28c840"; g.fillRect(16, 4, 4, 4);
      g.font = "7px sans-serif"; g.fillStyle = "rgba(255,255,255,.6)"; g.fillText(title, 26, 9);
    };
    g.textAlign = "left";
    if (k === "code" || k === "terminal") {
      const lines = k === "code" ? CODE_LINES : TERM_LINES;
      bar(k === "code" ? "#1e1e2e" : "#0b0f0c", k === "code" ? "editor — QurilishERP" : "terminal");
      if (k === "code") { g.fillStyle = "#181825"; g.fillRect(0, 12, 34, H); }
      const off = Math.floor(t * 3);
      g.font = "8px monospace";
      for (let i = 0; i < 11; i++) {
        const li = (off + i) % lines.length;
        const y = 22 + i * 9;
        if (k === "code") {
          g.fillStyle = "#585b70"; g.fillText(String(li + 1).padStart(3, " "), 4, y);
          const s = lines[li];
          g.fillStyle = s.startsWith("import") || s.startsWith("export") ? "#cba6f7" : s.includes("expect") ? "#a6e3a1" : s.includes("'") ? "#f9e2af" : "#cdd6f4";
          g.fillText(s.slice(0, 30), 38, y);
        } else {
          const s = lines[li];
          g.fillStyle = s.startsWith("$") ? "#7ee787" : s.includes("✓") || s.includes("✔") ? "#56d364" : "#c9d1d9";
          g.fillText(s.slice(0, 34), 4, y);
        }
      }
      if (Math.floor(t * 2) % 2) { g.fillStyle = "#cdd6f4"; g.fillRect(k === "code" ? 38 : 4, 22 + 10 * 9 + 2, 5, 8); }
    } else if (k === "design") {
      bar("#f4f1ec", "design — Figma");
      g.fillStyle = "#e6e1da"; g.fillRect(0, 12, 26, H); g.fillRect(W - 30, 12, 30, H);
      g.fillStyle = "#ffffff"; g.fillRect(40, 20, 110, 92);
      g.fillStyle = "#D97757"; g.fillRect(48, 28, 94, 14);
      const p = (Math.sin(t * 1.3) + 1) / 2;
      g.fillStyle = "#5b8def"; g.fillRect(48, 48, 40 + p * 50, 22);
      g.fillStyle = "#7bd389"; g.beginPath(); g.arc(70, 92, 10 + p * 4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#0d99ff"; g.lineWidth = 1; g.strokeRect(46, 46, 44 + p * 50, 26);
      g.fillStyle = "#0d99ff"; g.beginPath(); g.moveTo(92 + p * 50, 74); g.lineTo(100 + p * 50, 80); g.lineTo(95 + p * 50, 82); g.fill();
      for (let i = 0; i < 5; i++) { g.fillStyle = ["#D97757", "#5b8def", "#7bd389", "#f2c14e", "#b57edc"][i]; g.fillRect(W - 24, 20 + i * 14, 18, 10); }
    } else if (k === "chart" || k === "plan") {
      bar(k === "chart" ? "#0f172a" : "#1c1410", k === "chart" ? "hisobot — dashboard" : "Boshliq — reja");
      if (k === "plan") {
        g.font = "8px sans-serif";
        const items = ["Login API tezlashtirish", "Tugmalar dizayni", "3 ta SMM post", "Ombor agenti", "Haftalik hisobot"];
        items.forEach((s, i) => {
          const done = (Math.floor(t / 2) + i) % 5 < 2;
          g.fillStyle = done ? "#34c759" : "#D97757"; g.fillRect(8, 20 + i * 18, 8, 8);
          g.fillStyle = "#f5e9e2"; g.fillText(s, 22, 27 + i * 18);
        });
      } else {
        for (let i = 0; i < 9; i++) {
          const v = 18 + ((Math.sin(t * 0.8 + i * 0.9) + 1) / 2) * 50;
          g.fillStyle = i % 3 === 0 ? "#22c55e" : "#38bdf8"; g.fillRect(10 + i * 13, 108 - v, 9, v);
        }
        g.strokeStyle = "#f59e0b"; g.lineWidth = 1.5; g.beginPath();
        for (let x = 0; x <= 60; x++) { const y = 70 - Math.sin(x / 8 + t) * 14 - x * 0.4; if (x) g.lineTo(128 + x, y); else g.moveTo(128, y); }
        g.stroke();
        g.fillStyle = "#e2e8f0"; g.font = "bold 9px sans-serif"; g.fillText(`${(1240 + Math.floor(t * 7) % 90).toLocaleString()} mln`, 130, 26);
      }
    } else if (k === "social") {
      bar("#f6f7fb", "post — Telegram kanal");
      g.fillStyle = "#ffffff"; g.fillRect(14, 18, 116, 96);
      g.fillStyle = "#D97757"; g.fillRect(20, 24, 104, 44);
      g.fillStyle = "#fff"; g.font = "bold 9px sans-serif"; g.fillText("Smeta 5 daqiqada", 26, 50);
      const n = Math.floor(t * 8) % 60;
      g.fillStyle = "#334155"; g.font = "7px sans-serif"; g.fillText("QurilishERP bilan smetani tez".slice(0, Math.min(28, n)), 20, 80);
      g.fillStyle = "#94a3b8"; g.fillText("#qurilish #erp", 20, 92);
      g.fillStyle = "#e11d48"; g.fillText(`♥ ${120 + (Math.floor(t) % 40)}`, 20, 106);
      g.fillStyle = "#e2e8f0"; g.fillRect(136, 18, 50, 96);
      for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? "#dbeafe" : "#dcfce7"; g.fillRect(140, 24 + i * 22, 42, 16); }
    } else if (k === "map") {
      bar("#e8efe3", "GPS — xarita");
      g.strokeStyle = "#ffffff"; g.lineWidth = 6;
      g.beginPath(); g.moveTo(0, 70); g.lineTo(W, 50); g.moveTo(80, 12); g.lineTo(110, H); g.stroke();
      g.strokeStyle = "#5b8def"; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(20, 100); g.lineTo(80, 64); g.lineTo(150, 40); g.stroke(); g.setLineDash([]);
      const p = (t * 0.15) % 1;
      const x = 20 + p * 130, y = 100 - p * 60;
      g.fillStyle = "#ef4444"; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(239,68,68,.25)"; g.beginPath(); g.arc(x, y, 9 + Math.sin(t * 5) * 2, 0, Math.PI * 2); g.fill();
    } else if (k === "call") {
      bar("#0f2a26", "qo'ng'iroq — jonli");
      g.fillStyle = "#2dd4bf";
      for (let i = 0; i < 30; i++) { const h = 6 + Math.abs(Math.sin(t * 7 + i * 0.7) * Math.sin(t * 2.3 + i)) * 60; g.fillRect(8 + i * 6, 66 - h / 2, 4, h); }
      g.fillStyle = "#99f6e4"; g.font = "bold 9px sans-serif";
      const s = Math.floor(t) % 3600; g.fillText(`● ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`, 8, 112);
    } else {
      // Ekran saqlovchi — ERP logotipi suzib yuradi
      g.fillStyle = "#0e1424"; g.fillRect(0, 0, W, H);
      const x = 40 + Math.sin(t * 0.5) * 40, y = 46 + Math.cos(t * 0.37) * 26;
      g.fillStyle = "#D97757"; g.fillRect(x, y, 34, 24);
      g.fillStyle = "#1d1410"; g.fillRect(x + 9, y + 6, 4, 8); g.fillRect(x + 21, y + 6, 4, 8);
      g.fillStyle = "#e8e3dc"; g.font = "bold 10px sans-serif"; g.fillText("QurilishERP", x + 40, y + 16);
    }
  }

  private drawMovie(t: number) {
    const g = this.movieCanvas.getContext?.("2d");
    if (!g) return;
    const w = 384, h = 192;
    // Kun → shom sikli
    const day = (Math.sin(t * 0.08) + 1) / 2;
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, `hsl(${205 - (1 - day) * 180}, 70%, ${30 + day * 35}%)`);
    sky.addColorStop(1, `hsl(${30 + day * 170}, 75%, ${55 + day * 20}%)`);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = day > 0.4 ? "#ffe066" : "#fff4d6";
    g.beginPath(); g.arc(300, 50 + (1 - day) * 40, 18, 0, Math.PI * 2); g.fill();
    // Tog'lar (parallaks)
    const hills = (speed: number, base: number, amp: number, col: string) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) g.lineTo(x, base - Math.sin((x + t * speed) / 40) * amp - Math.sin((x + t * speed) / 17) * amp * 0.3);
      g.lineTo(w, h); g.fill();
    };
    hills(12, 120, 18, "#5e8c6a"); hills(30, 140, 12, "#3f7a52"); hills(70, 160, 6, "#2f5e3e");
    // Yo'l va mashina (sakrab boradi)
    g.fillStyle = "#3b3b45"; g.fillRect(0, 168, w, 24);
    g.fillStyle = "#f8f8f8"; for (let x = -(t * 120) % 40; x < w; x += 40) g.fillRect(x, 179, 20, 3);
    const bump = Math.abs(Math.sin(t * 6)) * 3;
    g.fillStyle = "#D97757"; g.fillRect(150, 146 - bump, 60, 18); g.fillRect(162, 134 - bump, 34, 14);
    g.fillStyle = "#1d1410"; g.fillRect(170, 138 - bump, 4, 7); g.fillRect(184, 138 - bump, 4, 7);
    g.fillStyle = "#222"; for (const x of [164, 198]) { g.beginPath(); g.arc(x, 166 - bump, 7, 0, Math.PI * 2); g.fill(); }
    // Qushlar
    g.strokeStyle = "#1f2937"; g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const bx = ((t * 30 + i * 90) % (w + 40)) - 20, by = 40 + i * 12 + Math.sin(t * 2 + i) * 4, f = Math.sin(t * 10 + i) * 3;
      g.beginPath(); g.moveTo(bx - 6, by - f); g.lineTo(bx, by); g.lineTo(bx + 6, by - f); g.stroke();
    }
    // Kino ramkasi (letterbox)
    g.fillStyle = "#000"; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
  }
}
