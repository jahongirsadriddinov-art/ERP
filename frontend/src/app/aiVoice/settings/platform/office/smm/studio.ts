// SMM studiyasi (owner 2026-10-23): rasm va videolar KOD bilan, brauzerda (<canvas>) yaratiladi.
//  • Shablon rasm: brend gradienti, aksent, belgi, sarlavha, qisqa matn, logotip; AI rasm bo'lsa — fon sifatida.
//  • Video: sahnalar ketma-ketligi (kinetik tipografiya, silliq o'tishlar, telefon maketida HAQIQIY ERP skrinshotlari —
//    public/smm/shots, demo ma'lumotlar), 30 fps, easing; MediaRecorder bilan yoziladi (MP4/H.264 bo'lsa — shu, aks holda WebM).
// Pure qismlar (sahnalar, vaqt jadvali, matn bo'lish, skrinshot tanlash) — studio.test.ts.

export type Aspect = "1:1" | "4:5" | "9:16";
export const SIZE: Record<Aspect, [number, number]> = { "1:1": [1080, 1080], "4:5": [1080, 1350], "9:16": [1080, 1920] };
export type VideoType = "promo" | "problem" | "tip";
export type SceneKind = "hook" | "problem" | "solution" | "device" | "points" | "cta";
export interface Scene { kind: SceneKind; title: string; text?: string; points?: string[]; shot?: string; dur: number }
export interface StudioItem { title: string; text: string; topic?: string; category?: string; scenes?: { title: string; text: string }[]; hashtags?: string[] }

export const SHOTS = ["dashboard", "finance", "gps", "chat", "reports", "object"] as const;
export type Shot = typeof SHOTS[number];
const BASE = (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) || "/";
export const shotUrl = (s: string) => `${BASE.replace(/\/$/, "")}/smm/shots/${s}.jpg`;

const SHOT_HINTS: [RegExp, Shot][] = [
  [/gps|joylash|xarita|davomat|qayerda|kuzatuv|геолок|карт|посещ/i, "gps"],
  [/chiqim|kirim|kassa|moliya|pul|chek|valyuta|summa|расход|финанс|касс/i, "finance"],
  [/chat|xabar|guruh|e'lon|сообщ|чат/i, "chat"],
  [/hisobot|tahlil|excel|pdf|plan-fakt|отчёт|отчет|аналит/i, "reports"],
  [/obyekt|smeta|material|byudjet|qurilish maydon|объект|смет|материал/i, "object"],
];
/** Mavzuga mos skrinshot (kalit so'zlar bo'yicha), aks holda bosh sahifa. */
export function pickShot(text: string, skip: string[] = []): Shot {
  for (const [re, s] of SHOT_HINTS) if (re.test(text) && !skip.includes(s)) return s;
  return (SHOTS.find((s) => !skip.includes(s)) || "dashboard") as Shot;
}

export const ease = {
  outCubic: (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3),
  inOutCubic: (x: number) => { const v = Math.min(1, Math.max(0, x)); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; },
  outBack: (x: number) => { const v = Math.min(1, Math.max(0, x)); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2); },
};

const firstSentence = (s: string, max = 110) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  const m = /^(.{20,}?[.!?])\s/.exec(t);
  const out = (m ? m[1] : t);
  return out.length > max ? `${out.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : out;
};

/** Post → video sahnalari (3–6 ta). Turi: promo (imkoniyatlar), problem («muammo → yechim»), tip (qisqa maslahat). */
export function buildScenes(it: StudioItem, type: VideoType): Scene[] {
  const sc = (it.scenes || []).filter((s) => s.title || s.text).slice(0, 5);
  const topic = `${it.topic || ""} ${it.title} ${it.text}`;
  const used: string[] = [];
  const shot = (txt: string) => { const s = pickShot(txt, used); used.push(s); return s; };
  const scenes: Scene[] = [];
  if (type === "problem") {
    const prob = sc[0] || { title: it.title, text: firstSentence(it.text) };
    scenes.push({ kind: "hook", title: it.title || prob.title, dur: 2.6 });
    scenes.push({ kind: "problem", title: prob.title || "Muammo", text: prob.text, dur: 3.2 });
    const sol = sc[1] || { title: "Yechim: QurilishERP", text: "" };
    scenes.push({ kind: "solution", title: sol.title, text: sol.text, dur: 3 });
    scenes.push({ kind: "device", title: sc[2]?.title || "Ilovada shunday ko'rinadi", text: sc[2]?.text, shot: shot(`${sol.title} ${sol.text} ${topic}`), dur: 3.8 });
  } else if (type === "tip") {
    scenes.push({ kind: "hook", title: it.title, dur: 2.6 });
    const pts = (sc.length ? sc.map((s) => s.title || s.text) : it.text.split(/(?<=[.!?])\s+/).slice(0, 3)).filter(Boolean).slice(0, 4);
    scenes.push({ kind: "points", title: "Maslahat", points: pts.map((p) => firstSentence(p, 60)), dur: 2 + pts.length * 0.9 });
    scenes.push({ kind: "device", title: "QurilishERP'da", text: firstSentence(it.text, 80), shot: shot(topic), dur: 3.4 });
  } else {
    scenes.push({ kind: "hook", title: it.title, dur: 2.6 });
    const list = sc.length ? sc : [{ title: firstSentence(it.text, 60), text: "" }];
    for (const s of list.slice(0, 3)) scenes.push({ kind: "device", title: s.title, text: s.text, shot: shot(`${s.title} ${s.text} ${topic}`), dur: 3.4 });
  }
  scenes.push({ kind: "cta", title: "QurilishERP", text: "Qurilish firmalari uchun ERP — bepul sinab ko'ring", dur: 2.8 });
  return scenes;
}

export const TRANSITION = 0.45;
export const totalDuration = (scenes: Scene[]) => scenes.reduce((s, x) => s + x.dur, 0);
/** t (s) vaqtidagi faol sahna(lar): o'tish paytida ikkitasi (oldingisi so'nib, keyingisi kirib keladi). */
export function sceneAt(scenes: Scene[], t: number): { i: number; local: number; next?: { i: number; mix: number } } {
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    const end = acc + scenes[i].dur;
    if (t < end || i === scenes.length - 1) {
      const local = Math.max(0, t - acc);
      const left = end - t;
      if (i < scenes.length - 1 && left < TRANSITION) return { i, local, next: { i: i + 1, mix: ease.inOutCubic(1 - left / TRANSITION) } };
      return { i, local };
    }
    acc = end;
  }
  return { i: 0, local: 0 };
}

/** Matnni kenglik bo'yicha qatorlarga bo'lish (measure — ctx.measureText yoki testda soxta). */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number, maxLines = 5): string[] {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (measure(test) > maxWidth && cur) { lines.push(cur); cur = w; } else cur = test;
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;:!?]?$/, "")}…`;
  return lines;
}

// ───────────── Chizish ─────────────
const C = { navy0: "#0d2142", navy: "#1B3A6B", teal: "#0e7490", amber: "#B45309", gold: "#F59E0B", cream: "#FFF7ED", ink: "#0f172a" };
const PALETTES = [[C.navy0, C.navy, C.amber], ["#102a43", "#0f5b78", C.teal], ["#2a1606", "#7c2d12", C.amber]];
let FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export function setStudioFont(f: string) { if (f) FONT = f; }
const font = (w: number, px: number) => `${w} ${Math.round(px)}px ${FONT}`;

type Ctx = CanvasRenderingContext2D;
export interface Assets { shots: Map<string, HTMLImageElement | ImageBitmap>; bg?: HTMLImageElement | ImageBitmap | null }

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function background(ctx: Ctx, w: number, h: number, t: number, variant = 0) {
  const p = PALETTES[Math.abs(variant) % PALETTES.length];
  const sh = Math.sin(t * 0.35) * 0.08;
  const g = ctx.createLinearGradient(0, 0, w * (1 + sh), h);
  g.addColorStop(0, p[0]); g.addColorStop(0.55, p[1]); g.addColorStop(1, p[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // suzib yuruvchi doiralar (parallaks)
  const blobs = [[0.85, 0.12, 0.42, 0.07], [0.1, 0.86, 0.36, 0.06], [0.7, 0.72, 0.22, 0.05]];
  blobs.forEach(([x, y, r, a], i) => {
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.arc(w * x + Math.sin(t * 0.6 + i) * w * 0.02, h * y + Math.cos(t * 0.5 + i) * h * 0.015, w * r, 0, Math.PI * 2);
    ctx.fill();
  });
  // nozik setka (qurilish chizmasi)
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 2;
  const step = w / 12;
  for (let x = step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}

function logo(ctx: Ctx, x: number, y: number, s: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  rr(ctx, x, y, s, s, s * 0.24); ctx.fillStyle = C.gold; ctx.fill();
  // uycha / bino belgisi
  ctx.fillStyle = C.navy;
  ctx.beginPath(); ctx.moveTo(x + s * 0.2, y + s * 0.48); ctx.lineTo(x + s * 0.5, y + s * 0.22); ctx.lineTo(x + s * 0.8, y + s * 0.48); ctx.closePath(); ctx.fill();
  ctx.fillRect(x + s * 0.28, y + s * 0.48, s * 0.44, s * 0.3);
  ctx.fillStyle = C.gold; ctx.fillRect(x + s * 0.44, y + s * 0.58, s * 0.12, s * 0.2);
  ctx.restore();
}

/** Kinetik matn: so'zlar ketma-ket pastdan suzib chiqadi. */
function kinetic(ctx: Ctx, lines: string[], x: number, y: number, size: number, lh: number, t: number, color = "#fff", weight = 800) {
  ctx.font = font(weight, size);
  ctx.textBaseline = "top";
  let k = 0;
  lines.forEach((line, li) => {
    let cx = x;
    for (const word of line.split(" ")) {
      const p = ease.outCubic((t - k * 0.07) / 0.5);
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.fillStyle = color;
      ctx.fillText(word, cx, y + li * lh + (1 - p) * size * 0.6);
      ctx.restore();
      cx += ctx.measureText(`${word} `).width;
      k++;
    }
  });
}

function phone(ctx: Ctx, img: HTMLImageElement | ImageBitmap | undefined, cx: number, cy: number, ph: number, t: number) {
  const pw = ph * 0.47;
  const x = cx - pw / 2, y = cy - ph / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = ph * 0.06; ctx.shadowOffsetY = ph * 0.02;
  rr(ctx, x, y, pw, ph, pw * 0.13); ctx.fillStyle = "#0b0b0f"; ctx.fill();
  ctx.restore();
  const b = pw * 0.035;
  ctx.save();
  rr(ctx, x + b, y + b, pw - 2 * b, ph - 2 * b, pw * 0.1);
  ctx.clip();
  ctx.fillStyle = "#f5f1ea"; ctx.fillRect(x + b, y + b, pw - 2 * b, ph - 2 * b);
  if (img) {
    const iw = (img as any).width, ih = (img as any).height;
    const sw = pw - 2 * b;
    const scale = sw / iw;
    const dh = ih * scale;
    const over = Math.max(0, dh - (ph - 2 * b));
    const scroll = over * ease.inOutCubic(Math.min(1, Math.max(0, (t - 0.6) / 2.6))) * 0.5;
    ctx.drawImage(img as CanvasImageSource, x + b, y + b - scroll, sw, dh);
  }
  ctx.restore();
  // dinamik orol (notch)
  rr(ctx, cx - pw * 0.14, y + b + ph * 0.012, pw * 0.28, ph * 0.028, ph * 0.014); ctx.fillStyle = "#0b0b0f"; ctx.fill();
}

function tag(ctx: Ctx, text: string, x: number, y: number, size: number, alpha = 1, bg = C.gold, fg = C.ink) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = font(800, size);
  const w = ctx.measureText(text).width + size * 1.4;
  rr(ctx, x, y, w, size * 1.9, size * 0.95); ctx.fillStyle = bg; ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.fillText(text, x + size * 0.7, y + size * 0.97);
  ctx.restore();
  return w;
}

const KIND_TAG: Partial<Record<SceneKind, string>> = { problem: "MUAMMO", solution: "YECHIM", points: "MASLAHAT" };

/** Bitta sahnani chizish (local — sahna ichidagi vaqt, s). alpha/offset — o'tish uchun. */
export function drawScene(ctx: Ctx, w: number, h: number, s: Scene, local: number, a: Assets, idx: number, alpha = 1, offsetY = 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, offsetY);
  const pad = w * 0.08;
  const measure = (str: string) => ctx.measureText(str).width;
  const vertical = h > w * 1.4;
  if (s.kind === "device") {
    ctx.font = font(800, w * 0.062);
    const lines = wrapLines(s.title, w - pad * 2, measure, 2);
    kinetic(ctx, lines, pad, h * (vertical ? 0.07 : 0.06), w * 0.062, w * 0.074, local);
    if (s.text) {
      ctx.font = font(500, w * 0.034);
      const sub = wrapLines(s.text, w - pad * 2, measure, 2);
      ctx.save(); ctx.globalAlpha *= ease.outCubic((local - 0.4) / 0.6);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      sub.forEach((l, i) => ctx.fillText(l, pad, h * (vertical ? 0.07 : 0.06) + lines.length * w * 0.074 + w * 0.02 + i * w * 0.046));
      ctx.restore();
    }
    const ph = vertical ? h * 0.66 : h * 0.62;
    const enter = ease.outBack((local - 0.15) / 0.8);
    const cx = w / 2 + (1 - enter) * w * 0.7;
    phone(ctx, s.shot ? a.shots.get(s.shot) : undefined, cx, h - ph / 2 - h * 0.05 + Math.sin(local * 1.4) * h * 0.004, ph, local);
  } else if (s.kind === "points") {
    tag(ctx, KIND_TAG.points!, pad, h * 0.16, w * 0.03, ease.outCubic(local / 0.4));
    (s.points || []).forEach((p, i) => {
      const k = ease.outCubic((local - 0.3 - i * 0.45) / 0.5);
      const y = h * 0.28 + i * h * 0.13;
      ctx.save(); ctx.globalAlpha *= k; ctx.translate((1 - k) * -w * 0.1, 0);
      ctx.beginPath(); ctx.arc(pad + w * 0.035, y + w * 0.035, w * 0.035, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill();
      ctx.strokeStyle = C.ink; ctx.lineWidth = w * 0.008; ctx.lineCap = "round"; ctx.beginPath();
      ctx.moveTo(pad + w * 0.02, y + w * 0.036); ctx.lineTo(pad + w * 0.032, y + w * 0.048); ctx.lineTo(pad + w * 0.052, y + w * 0.022); ctx.stroke();
      ctx.font = font(700, w * 0.05); ctx.fillStyle = "#fff"; ctx.textBaseline = "top";
      wrapLines(p, w - pad * 2 - w * 0.11, measure, 2).forEach((l, j) => ctx.fillText(l, pad + w * 0.11, y + j * w * 0.062));
      ctx.restore();
    });
  } else if (s.kind === "cta") {
    const k = ease.outBack(local / 0.7);
    const ls = w * 0.2;
    ctx.save(); ctx.translate(w / 2, h * 0.38); ctx.scale(k, k); logo(ctx, -ls / 2, -ls / 2, ls); ctx.restore();
    ctx.textAlign = "center";
    ctx.font = font(900, w * 0.085); ctx.fillStyle = "#fff"; ctx.textBaseline = "top";
    ctx.save(); ctx.globalAlpha *= ease.outCubic((local - 0.3) / 0.5); ctx.fillText(s.title, w / 2, h * 0.38 + ls * 0.7); ctx.restore();
    ctx.font = font(600, w * 0.038); ctx.fillStyle = "rgba(255,255,255,0.88)";
    const lines = wrapLines(s.text || "", w - pad * 2, measure, 3);
    ctx.save(); ctx.globalAlpha *= ease.outCubic((local - 0.6) / 0.5);
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h * 0.38 + ls * 0.7 + w * 0.12 + i * w * 0.052));
    ctx.restore();
    ctx.textAlign = "left";
    const bw = w * 0.56, bh = w * 0.11, by = h * 0.38 + ls * 0.7 + w * 0.15 + lines.length * w * 0.052;
    const pulse = 1 + Math.sin(local * 5) * 0.015;
    ctx.save(); ctx.globalAlpha *= ease.outCubic((local - 0.9) / 0.5); ctx.translate(w / 2, by + bh / 2); ctx.scale(pulse, pulse);
    rr(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fillStyle = C.gold; ctx.fill();
    ctx.font = font(800, w * 0.04); ctx.fillStyle = C.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("@qurilish_erp_bot", 0, 0);
    ctx.restore();
  } else {
    // hook / problem / solution — katta kinetik sarlavha
    const label = KIND_TAG[s.kind];
    let y = vertical ? h * 0.3 : h * 0.22;
    if (label) { tag(ctx, label, pad, y - w * 0.11, w * 0.03, ease.outCubic(local / 0.4), s.kind === "problem" ? "#ef4444" : C.gold, s.kind === "problem" ? "#fff" : C.ink); }
    else { ctx.save(); ctx.globalAlpha *= ease.outCubic(local / 0.4); ctx.fillStyle = C.gold; ctx.fillRect(pad, y - w * 0.05, w * 0.16 * ease.outCubic(local / 0.6), w * 0.012); ctx.restore(); }
    const size = w * (s.title.length > 40 ? 0.075 : 0.092);
    ctx.font = font(900, size);
    const lines = wrapLines(s.title, w - pad * 2, measure, 5);
    kinetic(ctx, lines, pad, y, size, size * 1.18, local, "#fff", 900);
    y += lines.length * size * 1.18 + w * 0.04;
    if (s.text) {
      ctx.font = font(500, w * 0.042);
      ctx.save(); ctx.globalAlpha *= ease.outCubic((local - 0.6) / 0.6); ctx.fillStyle = "rgba(255,255,255,0.88)";
      wrapLines(s.text, w - pad * 2, measure, 4).forEach((l, i) => ctx.fillText(l, pad, y + i * w * 0.058));
      ctx.restore();
    }
  }
  ctx.restore();
  void idx;
}

/** Video kadri: fon + sahna(lar) + (vertikalda) story progress chiziqlari + logotip. */
export function drawFrame(ctx: Ctx, w: number, h: number, scenes: Scene[], t: number, a: Assets) {
  const at = sceneAt(scenes, t);
  background(ctx, w, h, t, 0);
  if (a.bg) {
    ctx.save(); ctx.globalAlpha = 0.18; coverImage(ctx, a.bg, 0, 0, w, h, 1 + t * 0.01); ctx.restore();
  }
  if (at.next) {
    drawScene(ctx, w, h, scenes[at.i], at.local, a, at.i, 1 - at.next.mix, -at.next.mix * h * 0.04);
    drawScene(ctx, w, h, scenes[at.next.i], Math.max(0, at.next.mix * TRANSITION - 0.05), a, at.next.i, at.next.mix, (1 - at.next.mix) * h * 0.05);
  } else {
    drawScene(ctx, w, h, scenes[at.i], at.local, a, at.i);
  }
  if (h > w * 1.4) {
    const n = scenes.length, gap = w * 0.008, bw = (w * 0.9 - gap * (n - 1)) / n;
    let acc = 0;
    scenes.forEach((s, i) => {
      const p = Math.min(1, Math.max(0, (t - acc) / s.dur));
      acc += s.dur;
      const x = w * 0.05 + i * (bw + gap);
      rr(ctx, x, h * 0.02, bw, w * 0.006, w * 0.003); ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.fill();
      if (p > 0) { rr(ctx, x, h * 0.02, bw * p, w * 0.006, w * 0.003); ctx.fillStyle = "#fff"; ctx.fill(); }
    });
  }
  if (scenes[at.i].kind !== "cta") {
    logo(ctx, w * 0.08, h - w * 0.13, w * 0.065);
    ctx.font = font(800, w * 0.032); ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
    ctx.fillText("QurilishERP", w * 0.08 + w * 0.085, h - w * 0.13 + w * 0.0325);
  }
}

function coverImage(ctx: Ctx, img: HTMLImageElement | ImageBitmap, x: number, y: number, w: number, h: number, zoom = 1) {
  const iw = (img as any).width, ih = (img as any).height;
  const s = Math.max(w / iw, h / ih) * zoom;
  ctx.drawImage(img as CanvasImageSource, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
}

export interface StillOpts { aspect: Aspect; title: string; subtitle?: string; badge?: string; variant?: number; bg?: HTMLImageElement | ImageBitmap | null; shot?: HTMLImageElement | ImageBitmap | null; footer?: string }
/** Shablon rasm (post / karusel slaydi / story) — oxirgi (to'liq ko'ringan) holatda. */
export function drawStill(ctx: Ctx, o: StillOpts) {
  const [w, h] = SIZE[o.aspect];
  const pad = w * 0.08;
  const vertical = h > w * 1.4;
  background(ctx, w, h, 0, o.variant || 0);
  const measure = (s: string) => ctx.measureText(s).width;
  let top = vertical ? h * 0.24 : h * 0.16;
  if (o.bg) {
    // AI rasm: yuqori qism rasm, pastda gradient bilan matn
    const ih = vertical ? h * 0.52 : h * 0.56;
    coverImage(ctx, o.bg, 0, 0, w, ih);
    const g = ctx.createLinearGradient(0, ih * 0.55, 0, ih);
    g.addColorStop(0, "rgba(13,33,66,0)"); g.addColorStop(1, PALETTES[(o.variant || 0) % PALETTES.length][1]);
    ctx.fillStyle = g; ctx.fillRect(0, ih * 0.55, w, ih * 0.45 + 2);
    top = ih + w * 0.02;
  }
  if (o.badge) tag(ctx, o.badge.toUpperCase(), pad, top - (o.bg ? 0 : w * 0.11), w * 0.028);
  else { ctx.fillStyle = C.gold; ctx.fillRect(pad, top - w * 0.05, w * 0.16, w * 0.012); }
  if (o.bg && o.badge) top += w * 0.09;
  const size = w * (o.bg ? 0.068 : o.title.length > 44 ? 0.074 : 0.088);
  ctx.font = font(900, size);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#fff";
  const lines = wrapLines(o.title, w - pad * 2 - (o.shot && !vertical ? w * 0.36 : 0), measure, o.bg ? 3 : 5);
  lines.forEach((l, i) => ctx.fillText(l, pad, top + i * size * 1.16));
  let y = top + lines.length * size * 1.16 + w * 0.035;
  if (o.subtitle) {
    ctx.font = font(500, w * 0.038);
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    wrapLines(o.subtitle, w - pad * 2 - (o.shot && !vertical ? w * 0.36 : 0), measure, o.bg ? 2 : 4).forEach((l, i) => ctx.fillText(l, pad, y + i * w * 0.053));
  }
  if (o.shot && !o.bg) {
    const ph = vertical ? h * 0.42 : h * 0.5;
    phone(ctx, o.shot, vertical ? w / 2 : w - pad - ph * 0.235, vertical ? h - ph / 2 - h * 0.1 : h * 0.58, ph, 0);
    y += 0;
  }
  logo(ctx, pad, h - pad - w * 0.06, w * 0.06);
  ctx.font = font(800, w * 0.03); ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
  ctx.fillText(o.footer || "QurilishERP · qurilish firmalari uchun ERP", pad + w * 0.08, h - pad - w * 0.03);
}

// ───────────── Brauzer: yuklash, rasm, video yozish ─────────────
export async function loadImage(src: string | Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
export async function loadShots(names: string[]): Promise<Map<string, HTMLImageElement>> {
  const m = new Map<string, HTMLImageElement>();
  await Promise.all([...new Set(names)].map(async (n) => { const i = await loadImage(shotUrl(n)); if (i) m.set(n, i); }));
  return m;
}
function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
const toBlob = (c: HTMLCanvasElement, type = "image/jpeg", q = 0.9) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), type, q));
function initFont() {
  try { const f = getComputedStyle(document.body).fontFamily; if (f) setStudioFont(f); } catch { /* */ }
}

/** Shablon rasm → JPEG Blob. */
export async function renderStill(o: StillOpts): Promise<{ blob: Blob; w: number; h: number }> {
  initFont();
  const [w, h] = SIZE[o.aspect];
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d")!;
  drawStill(ctx, o);
  return { blob: await toBlob(c), w, h };
}

/** Karusel: muqova + har slayd + CTA (JPEG). */
export async function renderCarousel(it: StudioItem, bg: HTMLImageElement | null, badge: string): Promise<Blob[]> {
  const out: Blob[] = [];
  const shots = await loadShots([pickShot(`${it.topic} ${it.title} ${it.text}`)]);
  out.push((await renderStill({ aspect: "4:5", title: it.title, subtitle: (it.scenes?.[0]?.text) || "", badge, bg })).blob);
  const sc = (it.scenes || []).slice(0, 4);
  for (let i = 0; i < sc.length; i++) {
    out.push((await renderStill({ aspect: "4:5", title: sc[i].title || it.title, subtitle: sc[i].text, badge: `${i + 1}/${sc.length}`, variant: i + 1, shot: i === sc.length - 1 ? [...shots.values()][0] : null })).blob);
  }
  out.push((await renderStill({ aspect: "4:5", title: "QurilishERP", subtitle: "Qurilish firmalari uchun ERP — bepul sinab ko'ring: @qurilish_erp_bot", badge: "Sinab ko'ring", variant: 2 })).blob);
  return out.slice(0, 10);
}

export const VIDEO_MIMES = ["video/mp4;codecs=avc1.42E01F,mp4a.40.2", "video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
export function pickVideoMime(isSupported: (m: string) => boolean = (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)): string | null {
  return VIDEO_MIMES.find((m) => { try { return isSupported(m); } catch { return false; } }) || null;
}

export interface RecordOpts { aspect: Aspect; audio?: Blob | null; bg?: HTMLImageElement | null; onProgress?: (p: number) => void; signal?: AbortSignal; lite?: boolean }
/** Sahnalarni <canvas>da chizib MediaRecorder bilan yozadi (real vaqtda — tab ochiq tursin). */
export async function recordVideo(scenes: Scene[], o: RecordOpts): Promise<{ blob: Blob; mime: string; mp4: boolean; w: number; h: number; duration: number }> {
  initFont();
  const mime = pickVideoMime();
  if (!mime) throw new Error("no_recorder");
  let [w, h] = SIZE[o.aspect];
  if (o.lite) { w = Math.round(w * 2 / 3); h = Math.round(h * 2 / 3); }
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d")!;
  const shots = await loadShots(scenes.map((s) => s.shot).filter(Boolean) as string[]);
  const assets: Assets = { shots, bg: o.bg || null };
  const total = totalDuration(scenes);
  drawFrame(ctx, w, h, scenes, 0, assets);
  const stream = c.captureStream(30);
  let audioCtx: AudioContext | null = null;
  if (o.audio) {
    try {
      audioCtx = new AudioContext();
      const buf = await audioCtx.decodeAudioData(await o.audio.arrayBuffer());
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.8, audioCtx.currentTime + 0.6);
      gain.gain.setValueAtTime(0.8, audioCtx.currentTime + Math.max(0.7, total - 1.2));
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + total);
      const dest = audioCtx.createMediaStreamDestination();
      src.connect(gain).connect(dest);
      dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      src.start();
    } catch { /* musiqasiz */ }
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: o.lite ? 3_500_000 : 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
  rec.start(500);
  const t0 = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (o.signal?.aborted) { reject(new Error("aborted")); return; }
      const t = (performance.now() - t0) / 1000;
      drawFrame(ctx, w, h, scenes, Math.min(t, total), assets);
      o.onProgress?.(Math.min(1, t / total));
      if (t >= total + 0.15) { resolve(); return; }
      // yashirin tabda rAF to'xtaydi — setTimeout zaxira
      if (document.hidden) setTimeout(tick, 33); else requestAnimationFrame(tick);
    };
    tick();
  }).finally(() => { if (rec.state !== "inactive") rec.stop(); stream.getTracks().forEach((tr) => tr.stop()); audioCtx?.close().catch(() => undefined); });
  await stopped;
  const type = mime.split(";")[0];
  return { blob: new Blob(chunks, { type }), mime: type, mp4: type === "video/mp4", w, h, duration: total };
}
