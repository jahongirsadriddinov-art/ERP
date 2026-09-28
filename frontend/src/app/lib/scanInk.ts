// ─── Skaner: qog'ozdagi imzo yoki pechatni suratdan avtomatik ajratib olish ────────────────────
// Kamera/galereya surati → mahalliy fon (qog'oz, soya, notekis yorug'lik) hisoblanadi → siyoh (qorong'i yoki
// rangli) piksellar topiladi → faqat imzo/pechat joylashgan qism kesib olinadi → fon shaffof qilinadi.
//  • imzo: qorong'i siyoh, toza to'q ko'k rangga keltiriladi;
//  • pechat: rangli (ko'k/binafsha/qizil) siyoh — asl rangi saqlanib, biroz to'yintiriladi.

export type InkKind = "signature" | "stamp";

async function loadBitmap(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function percentile(sorted: number[], p: number) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]; }

export async function scanInk(file: File, kind: InkKind): Promise<string> {
  const img = await loadBitmap(file);
  const maxSide = 1400;
  const r = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * r)), h = Math.max(1, Math.round(img.height * r));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h), px = src.data;

  // Kulrang + to'yinganlik
  const gray = new Float32Array(w * h), sat = new Float32Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const R = px[i], G = px[i + 1], B = px[i + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    gray[j] = 0.299 * R + 0.587 * G + 0.114 * B;
    sat[j] = mx > 0 ? (mx - mn) / mx : 0;
  }
  // Mahalliy fon — integral tasvir orqali katta oynadagi o'rtacha yorqinlik
  const rad = Math.max(12, Math.round(Math.min(w, h) / 18));
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row; }
  }
  const strength = new Float32Array(w * h); // 0..1 — shu piksel siyoh ekanligi darajasi
  const border = Math.round(Math.min(w, h) * 0.015);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      if (x < border || y < border || x >= w - border || y >= h - border) continue;
      const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1);
      const sum = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const d = mean - gray[j]; // fonga nisbatan qorong'ilik
      let s = 0;
      if (kind === "signature") s = Math.min(1, Math.max(0, (d - 18) / 45));
      else s = Math.max(Math.min(1, Math.max(0, (sat[j] - 0.22) / 0.25)) * (d > 4 ? 1 : 0.4), Math.min(1, Math.max(0, (d - 40) / 50)));
      strength[j] = s;
    }
  }
  // Siyoh joylashgan chegaralar (shovqinga chidamli — foizlik chegaralar)
  const xs: number[] = [], ys: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (strength[y * w + x] > 0.5) { xs.push(x); ys.push(y); }
  if (xs.length < 60) throw new Error("NOT_FOUND");
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const lo = kind === "signature" ? 0.004 : 0.01, hi = 1 - lo;
  let bx0 = percentile(xs, lo), bx1 = percentile(xs, hi), by0 = percentile(ys, lo), by1 = percentile(ys, hi);
  const padX = Math.round((bx1 - bx0) * 0.06) + 4, padY = Math.round((by1 - by0) * 0.08) + 4;
  bx0 = Math.max(0, bx0 - padX); by0 = Math.max(0, by0 - padY); bx1 = Math.min(w - 1, bx1 + padX); by1 = Math.min(h - 1, by1 + padY);
  const cw = bx1 - bx0 + 1, ch = by1 - by0 + 1;

  const out = document.createElement("canvas"); out.width = cw; out.height = ch;
  const octx = out.getContext("2d")!;
  const od = octx.createImageData(cw, ch), op = od.data;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const j = (y + by0) * w + (x + bx0), o = (y * cw + x) * 4, i = j * 4;
    const s = strength[j];
    if (s <= 0.05) continue;
    if (kind === "signature") { op[o] = 11; op[o + 1] = 42; op[o + 2] = 120; }
    else {
      // Rangni biroz to'yintirish (pechat aniqroq ko'rinsin)
      const R = px[i], G = px[i + 1], B = px[i + 2], avg = (R + G + B) / 3;
      op[o] = Math.max(0, Math.min(255, avg + (R - avg) * 1.35 - 20));
      op[o + 1] = Math.max(0, Math.min(255, avg + (G - avg) * 1.35 - 20));
      op[o + 2] = Math.max(0, Math.min(255, avg + (B - avg) * 1.35 - 20));
    }
    op[o + 3] = Math.round(Math.min(1, s * 1.25) * 255);
  }
  octx.putImageData(od, 0, 0);

  // Hajmni cheklash (server limiti ~380 KB)
  let maxW = kind === "signature" ? 900 : 520;
  for (let attempt = 0; attempt < 5; attempt++) {
    const k = Math.min(1, maxW / Math.max(cw, ch));
    const f = document.createElement("canvas"); f.width = Math.max(1, Math.round(cw * k)); f.height = Math.max(1, Math.round(ch * k));
    const fctx = f.getContext("2d")!; fctx.imageSmoothingQuality = "high"; fctx.drawImage(out, 0, 0, f.width, f.height);
    const url = f.toDataURL("image/png");
    if (url.length <= 380_000) return url;
    maxW = Math.round(maxW * 0.75);
  }
  throw new Error("TOO_BIG");
}
