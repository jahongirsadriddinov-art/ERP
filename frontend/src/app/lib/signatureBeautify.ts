// ─── Imzoni "tekislash" (qo'lda chizilgan imzoni chiroyli, aniq ko'rinishga keltirish) ─────────────
// Chizilgan chiziqlar (nuqtalar ketma-ketligi) asosida ishlaydi — rasmni emas, harakatni qayta chizadi:
//  1) titroq (qo'l qaltirashi) — nuqtalar teng oraliqda qayta olinadi va silliqlanadi;
//  2) qiyshiqlik — imzoning asosiy o'qi (PCA) topilib, gorizontalga buriladi (±30° gacha);
//  3) o'lcham — bo'sh joylar kesiladi, imzo maydonga markazlab joylanadi;
//  4) chiziq — egri (kvadratik Bezye) bilan, tezlikka qarab biroz o'zgaruvchan qalinlikda chiziladi.
// Natija sifat bahosi bilan qaytadi: imzo allaqachon tekis va toza bo'lsa — "o'zgartirish shart emas".

export type Pt = { x: number; y: number; t?: number };
export type Stroke = Pt[];

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function resample(s: Stroke, step: number): Stroke {
  if (s.length < 2) return s.slice();
  const out: Stroke = [s[0]];
  let acc = 0;
  for (let i = 1; i < s.length; i++) {
    let prev = s[i - 1];
    const cur = s[i];
    let d = dist(prev, cur);
    while (acc + d >= step) {
      const k = (step - acc) / d;
      const p = { x: prev.x + (cur.x - prev.x) * k, y: prev.y + (cur.y - prev.y) * k };
      out.push(p); prev = p; d = dist(prev, cur); acc = 0;
    }
    acc += d;
  }
  out.push(s[s.length - 1]);
  return out;
}

function smooth(s: Stroke, win: number): Stroke {
  if (s.length <= 3) return s.slice();
  return s.map((p, i) => {
    if (i === 0 || i === s.length - 1) return p;
    let sx = 0, sy = 0, n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(s.length - 1, i + win); j++) { sx += s[j].x; sy += s[j].y; n++; }
    return { x: sx / n, y: sy / n };
  });
}

/** Titroq o'lchovi: silliqlangan chiziqdan o'rtacha og'ish (px). */
function jitter(raw: Stroke[], sm: Stroke[]): number {
  let sum = 0, n = 0;
  raw.forEach((s, i) => {
    const r = resample(s, 3), m = sm[i];
    const len = Math.min(r.length, m.length);
    for (let k = 0; k < len; k++) { sum += dist(r[k], m[k]); n++; }
  });
  return n ? sum / n : 0;
}

// Chaikin — burchaklarni yumaloqlash (qo'lda yozuvga xos silliq egri chiziqlar)
function chaikin(s: Stroke, iters: number): Stroke {
  let pts = s;
  for (let k = 0; k < iters && pts.length > 2; k++) {
    const out: Stroke = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Yozuv og'ishi (slant): tik segmentlarning vertikaldan o'rtacha og'ishi, radian (+ = o'ngga). */
function estimateSlant(strokes: Stroke[]): number {
  let sum = 0, w = 0;
  for (const s of strokes) for (let i = 1; i < s.length; i++) {
    let dx = s[i].x - s[i - 1].x, dy = s[i].y - s[i - 1].y;
    if (Math.abs(dy) < Math.abs(dx) * 1.2) continue;
    if (dy > 0) { dx = -dx; dy = -dy; }
    const len = Math.hypot(dx, dy);
    sum += Math.atan2(dx, -dy) * len; w += len;
  }
  return w ? sum / w : 0;
}

export interface BeautifyResult { dataUrl: string; angleDeg: number; jitterPx: number; slantDeg: number; needsFix: boolean }

// Xusnixat: bir xil o'ngga og'ish (~11°), keng uchli ruchka effekti (pastga-yuqoriga chiziqlar qalinroq,
// yon chiziqlar ingichka), uchlari ingichkalashgan — chiroyli, "yozuvchi" imzo ko'rinishi.
export function beautifySignature(strokes: Stroke[], outW = 900, outH = 300, color = "#0b3d91"): BeautifyResult | null {
  const valid = strokes.filter(s => s.length > 1);
  if (!valid.length) return null;
  const smoothed = valid.map(s => smooth(resample(s, 3), 3));
  const all = smoothed.flat();
  // Asosiy o'q (PCA) — imzo odatda enli, shuning uchun asosiy o'q = yozuv chizig'i
  const cx = all.reduce((a, p) => a + p.x, 0) / all.length, cy = all.reduce((a, p) => a + p.y, 0) / all.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of all) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy); // radian
  if (Math.abs(angle) > Math.PI / 6) angle = 0;      // juda katta burchak — ehtimol ataylab (tik imzo), tegmaymiz
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  let rotated = smoothed.map(s => s.map(p => ({ x: cx + (p.x - cx) * cos - (p.y - cy) * sin, y: cy + (p.x - cx) * sin + (p.y - cy) * cos })));
  // Og'ishni bir xil qilish (shear)
  const slant = estimateSlant(rotated);
  const target = 0.19;
  const k = Math.max(-0.45, Math.min(0.45, Math.tan(target) - Math.tan(slant)));
  rotated = rotated.map(s => chaikin(s.map(p => ({ x: p.x + k * (cy - p.y), y: p.y })), 2));
  // Kesish va joylash
  const xs = rotated.flat().map(p => p.x), ys = rotated.flat().map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const pad = 28;
  const scale = Math.min((outW - 2 * pad) / bw, (outH - 2 * pad) / bh, 4);
  const ox = (outW - bw * scale) / 2 - minX * scale, oy = (outH - bh * scale) / 2 - minY * scale;
  const c = document.createElement("canvas"); c.width = outW; c.height = outH;
  const ctx = c.getContext("2d")!;
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = color;
  const baseW = Math.max(3, Math.min(6.5, 4.2 * Math.sqrt(scale)));
  const nib = -Math.PI / 4; // keng uchli ruchka burchagi
  for (const s of rotated) {
    const pts = s.map(p => ({ x: p.x * scale + ox, y: p.y * scale + oy }));
    const n = pts.length;
    if (n < 2) continue;
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1], b = pts[i];
      const theta = Math.atan2(b.y - a.y, b.x - a.x);
      const nibF = 0.38 + 0.9 * Math.abs(Math.sin(theta - nib));
      const taper = 0.35 + 0.65 * Math.min(1, i / 8, (n - i) / 8);
      ctx.lineWidth = baseW * nibF * taper;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  const angleDeg = Math.round((angle * 180) / Math.PI * 10) / 10;
  const slantDeg = Math.round((slant * 180) / Math.PI);
  const jitterPx = Math.round(jitter(valid, smoothed) * 10) / 10;
  return { dataUrl: c.toDataURL("image/png"), angleDeg, jitterPx, slantDeg, needsFix: true };
}
