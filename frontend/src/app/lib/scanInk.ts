// ─── Skaner: qog'ozdagi imzo yoki pechatni suratdan avtomatik ajratib olish ────────────────────
// 1) Mahalliy fon (qog'oz, soya, notekis yorug'lik) hisoblanib, siyoh piksellari topiladi
//    (imzo — fonga nisbatan qorong'i; pechat — rangli ko'k/binafsha/qizil siyoh).
// 2) Uzun to'g'ri chiziqlar (qog'oz chiziqlari, jadval/ekran ramkalari) olib tashlanadi.
// 3) Siyoh bog'langan bo'laklarga ajratiladi, yaqin bo'laklar guruhlanadi; bosma matnga o'xshash mayda
//    bo'laklar va chetga tegib turganlari chetlanadi. Eng "imzoga o'xshash" (katta, egri, markazga yaqin)
//    guruh tanlanadi — natijada FAQAT imzo/pechatning o'zi kesib olinadi, qolgani shaffof.
// 4) Foydalanuvchi xohlasa — hududni qo'lda belgilaydi (crop), tanlov shu hudud ichida qayta bajariladi.

export type InkKind = "signature" | "stamp";
export type CropBox = { x: number; y: number; w: number; h: number }; // 0..1 nisbatlarda
export interface ScanResult { dataUrl: string; preview: string; box: CropBox }

async function loadImage(src: File | string): Promise<HTMLImageElement> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    return await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  } finally { if (typeof src !== "string") setTimeout(() => URL.revokeObjectURL(url), 1500); }
}

/** Suratni ish o'lchamiga keltiradi va (qo'lda belgilash oynasi uchun) ko'rinish nusxasini qaytaradi. */
export async function prepareScanImage(file: File): Promise<string> {
  const img = await loadImage(file);
  const r = Math.min(1, 1400 / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

export async function scanInk(source: File | string, kind: InkKind, crop?: CropBox): Promise<ScanResult> {
  const preview = typeof source === "string" ? source : await prepareScanImage(source);
  const img = await loadImage(preview);
  const W0 = img.width, H0 = img.height;
  const cx0 = crop ? Math.round(crop.x * W0) : 0, cy0 = crop ? Math.round(crop.y * H0) : 0;
  const w = crop ? Math.max(8, Math.round(crop.w * W0)) : W0, h = crop ? Math.max(8, Math.round(crop.h * H0)) : H0;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, cx0, cy0, w, h, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const N = w * h;

  // ── 1) siyoh kuchi ──
  const gray = new Float32Array(N), sat = new Float32Array(N);
  for (let i = 0, j = 0; j < N; i += 4, j++) {
    const R = px[i], G = px[i + 1], B = px[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    gray[j] = 0.299 * R + 0.587 * G + 0.114 * B; sat[j] = mx > 0 ? (mx - mn) / mx : 0;
  }
  const rad = Math.max(10, Math.round(Math.min(w, h) / 16));
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += gray[y * w + x]; integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row; } }
  const strength = new Float32Array(N);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1);
      const mean = (integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const j = y * w + x, d = mean - gray[j];
      strength[j] = kind === "signature"
        ? Math.min(1, Math.max(0, (d - 16) / 40))
        : Math.max(Math.min(1, Math.max(0, (sat[j] - 0.2) / 0.22)) * (d > 3 ? 1 : 0.3), 0);
    }
  }
  const mask = new Uint8Array(N);
  for (let j = 0; j < N; j++) mask[j] = strength[j] > 0.45 ? 1 : 0;

  // ── 2) uzun to'g'ri chiziqlarni olib tashlash (gorizontal/vertikal) ──
  const longH = Math.max(40, Math.round(w * 0.22)), longV = Math.max(40, Math.round(h * 0.22));
  const kill = new Uint8Array(N);
  for (let y = 0; y < h; y++) { let s = -1; for (let x = 0; x <= w; x++) { const on = x < w && mask[y * w + x]; if (on && s < 0) s = x; if (!on && s >= 0) { if (x - s >= longH) for (let k = s; k < x; k++) kill[y * w + k] = 1; s = -1; } } }
  for (let x = 0; x < w; x++) { let s = -1; for (let y = 0; y <= h; y++) { const on = y < h && mask[y * w + x]; if (on && s < 0) s = y; if (!on && s >= 0) { if (y - s >= longV) for (let k = s; k < y; k++) kill[k * w + x] = 1; s = -1; } } }
  for (let j = 0; j < N; j++) if (kill[j]) mask[j] = 0;

  // ── 3) bog'langan bo'laklar ──
  const label = new Int32Array(N).fill(-1);
  type Comp = { n: number; x0: number; y0: number; x1: number; y1: number; edge: boolean };
  const comps: Comp[] = [];
  const stack = new Int32Array(N);
  for (let j = 0; j < N; j++) {
    if (!mask[j] || label[j] >= 0) continue;
    const id = comps.length, cp: Comp = { n: 0, x0: w, y0: h, x1: 0, y1: 0, edge: false };
    let sp = 0; stack[sp++] = j; label[j] = id;
    while (sp) {
      const q = stack[--sp], qx = q % w, qy = (q - qx) / w;
      cp.n++; if (qx < cp.x0) cp.x0 = qx; if (qx > cp.x1) cp.x1 = qx; if (qy < cp.y0) cp.y0 = qy; if (qy > cp.y1) cp.y1 = qy;
      if (qx === 0 || qy === 0 || qx === w - 1 || qy === h - 1) cp.edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nj = ny * w + nx;
        if (mask[nj] && label[nj] < 0) { label[nj] = id; stack[sp++] = nj; }
      }
    }
    comps.push(cp);
  }
  const minArea = Math.max(12, N * 0.00008);
  const diagImg = Math.hypot(w, h);
  const keep = comps.map((cp, i) => ({ ...cp, i })).filter(cp => cp.n >= minArea && !(cp.edge && !crop));
  if (!keep.length) throw new Error("NOT_FOUND");

  // Guruhlash: kengaytirilgan chegaralari kesishgan bo'laklar bir guruh
  const gap = diagImg * (kind === "signature" ? 0.035 : 0.025);
  const parent = keep.map((_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (let a = 0; a < keep.length; a++) for (let b = a + 1; b < keep.length; b++) {
    const A = keep[a], B = keep[b];
    if (A.x0 - gap <= B.x1 && B.x0 - gap <= A.x1 && A.y0 - gap <= B.y1 && B.y0 - gap <= A.y1) parent[find(a)] = find(b);
  }
  const groups = new Map<number, typeof keep>();
  keep.forEach((cp, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(cp); });

  let best: typeof keep | null = null, bestScore = -1;
  for (const g of groups.values()) {
    const x0 = Math.min(...g.map(c => c.x0)), x1 = Math.max(...g.map(c => c.x1)), y0 = Math.min(...g.map(c => c.y0)), y1 = Math.max(...g.map(c => c.y1));
    const gw = x1 - x0 + 1, gh = y1 - y0 + 1;
    const ink = g.reduce((a, c) => a + c.n, 0);
    // Katta, egri, uzun bo'laklar — imzo; ko'plab bir xil mayda bo'laklar — bosma matn
    let score = g.reduce((a, c) => a + c.n * Math.sqrt(Math.hypot(c.x1 - c.x0 + 1, c.y1 - c.y0 + 1)), 0);
    const biggest = Math.max(...g.map(c => c.n));
    if (kind === "signature" && g.length > 8 && biggest / ink < 0.25) score *= 0.3; // ko'p mayda bir xil bo'lak — bosma matn
    const mcx = (x0 + x1) / 2 / w - 0.5, mcy = (y0 + y1) / 2 / h - 0.5;
    score *= 1 - Math.min(0.6, Math.hypot(mcx, mcy)); // markazga yaqinroq afzal
    if (kind === "stamp") { const ar = gw / gh; score *= ar > 0.5 && ar < 2 ? 1.3 : 0.6; }
    if (gw < 12 || gh < 8) score *= 0.2;
    if (score > bestScore) { bestScore = score; best = g; }
  }
  if (!best) throw new Error("NOT_FOUND");
  const ids = new Set(best.map(c => c.i));
  let bx0 = Math.min(...best.map(c => c.x0)), bx1 = Math.max(...best.map(c => c.x1)), by0 = Math.min(...best.map(c => c.y0)), by1 = Math.max(...best.map(c => c.y1));
  // Guruhga yaqin mayda nuqtalarni ham (i, j nuqtalari, pechat ichidagi harflar) qo'shamiz
  const pad = Math.round(Math.max(bx1 - bx0, by1 - by0) * 0.04) + 3;
  comps.forEach((cp, i) => { if (cp.n >= 3 && cp.x0 >= bx0 - pad && cp.x1 <= bx1 + pad && cp.y0 >= by0 - pad && cp.y1 <= by1 + pad) ids.add(i); });
  bx0 = Math.max(0, bx0 - pad); by0 = Math.max(0, by0 - pad); bx1 = Math.min(w - 1, bx1 + pad); by1 = Math.min(h - 1, by1 + pad);
  const cw = bx1 - bx0 + 1, ch = by1 - by0 + 1;

  // ── 4) natija: faqat tanlangan guruh piksellari (yumshoq chekka bilan) ──
  const out = document.createElement("canvas"); out.width = cw; out.height = ch;
  const octx = out.getContext("2d")!;
  const od = octx.createImageData(cw, ch), op = od.data;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const j = (y + by0) * w + (x + bx0);
    // Siyoh chekkasidagi yarim-shaffof piksellar — qo'shni piksel tanlangan guruhda bo'lsa
    let inGroup = label[j] >= 0 && ids.has(label[j]);
    if (!inGroup && strength[j] > 0.12) {
      for (let dy = -1; dy <= 1 && !inGroup; dy++) for (let dx = -1; dx <= 1 && !inGroup; dx++) {
        const nx = x + bx0 + dx, ny = y + by0 + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) { const l = label[ny * w + nx]; if (l >= 0 && ids.has(l)) inGroup = true; }
      }
    }
    if (!inGroup) continue;
    const s = strength[j], o = (y * cw + x) * 4, i = j * 4;
    if (kind === "signature") { op[o] = 11; op[o + 1] = 42; op[o + 2] = 120; }
    else {
      const R = px[i], G = px[i + 1], B = px[i + 2], avg = (R + G + B) / 3;
      op[o] = Math.max(0, Math.min(255, avg + (R - avg) * 1.4 - 25));
      op[o + 1] = Math.max(0, Math.min(255, avg + (G - avg) * 1.4 - 25));
      op[o + 2] = Math.max(0, Math.min(255, avg + (B - avg) * 1.4 - 25));
    }
    op[o + 3] = Math.round(Math.min(1, s * 1.3) * 255);
  }
  octx.putImageData(od, 0, 0);

  const box: CropBox = { x: (cx0 + bx0) / W0, y: (cy0 + by0) / H0, w: cw / W0, h: ch / H0 };
  let maxW = kind === "signature" ? 900 : 520;
  for (let attempt = 0; attempt < 5; attempt++) {
    const k = Math.min(1, maxW / Math.max(cw, ch));
    const f = document.createElement("canvas"); f.width = Math.max(1, Math.round(cw * k)); f.height = Math.max(1, Math.round(ch * k));
    const fctx = f.getContext("2d")!; fctx.imageSmoothingQuality = "high"; fctx.drawImage(out, 0, 0, f.width, f.height);
    const url = f.toDataURL("image/png");
    if (url.length <= 380_000) return { dataUrl: url, preview, box };
    maxW = Math.round(maxW * 0.75);
  }
  throw new Error("TOO_BIG");
}
