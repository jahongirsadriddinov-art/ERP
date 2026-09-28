// Elektron hujjat shablonlari (maydonlar) va ularni A4 sahifalarga (canvas) chizish.
export type DocType = "shartnoma" | "akt" | "nakladnoy";
export type Row = { name: string; unit: string; qty: string; price: string };
export type Sig = { side: "executor" | "customer"; name: string; image: string; signedAt: string };
export type DocData = Record<string, any> & { rows?: Row[] };
export interface SignDoc { id?: string; type: DocType; number: string; title: string; data: DocData; status?: string; signatures?: Sig[]; createdAt?: string }

export type Field = { key: string; label: string; kind?: "text" | "textarea" | "date" | "number"; placeholder?: string; full?: boolean };

export const TEMPLATES: Record<DocType, { title: string; icon: string; sides: [string, string]; fields: Field[]; hasRows: boolean }> = {
  shartnoma: {
    title: "Pudrat shartnomasi", icon: "📝", sides: ["Pudratchi", "Buyurtmachi"], hasRows: false,
    fields: [
      { key: "date", label: "Sana", kind: "date" },
      { key: "city", label: "Shahar", placeholder: "Toshkent" },
      { key: "customerName", label: "Buyurtmachi (F.I.O. / tashkilot)", full: true },
      { key: "customerDetails", label: "Buyurtmachi rekvizitlari (manzil, STIR, telefon)", kind: "textarea", full: true },
      { key: "contractorName", label: "Pudratchi (firma)", full: true },
      { key: "contractorDetails", label: "Pudratchi rekvizitlari (manzil, STIR, h/r, bank)", kind: "textarea", full: true },
      { key: "objectName", label: "Obyekt nomi va manzili", full: true },
      { key: "workDescription", label: "Bajariladigan ishlar", kind: "textarea", full: true },
      { key: "amount", label: "Shartnoma summasi (so'm)", kind: "number" },
      { key: "advancePercent", label: "Avans (%)", kind: "number", placeholder: "30" },
      { key: "startDate", label: "Boshlanish sanasi", kind: "date" },
      { key: "endDate", label: "Tugash sanasi", kind: "date" },
      { key: "extra", label: "Qo'shimcha shartlar", kind: "textarea", full: true },
    ],
  },
  akt: {
    title: "Bajarilgan ishlar dalolatnomasi", icon: "✅", sides: ["Pudratchi", "Buyurtmachi"], hasRows: true,
    fields: [
      { key: "date", label: "Sana", kind: "date" },
      { key: "contractRef", label: "Shartnoma № va sanasi", placeholder: "SH-2026-001, 01.09.2026" },
      { key: "customerName", label: "Buyurtmachi", full: true },
      { key: "contractorName", label: "Pudratchi (firma)", full: true },
      { key: "objectName", label: "Obyekt", full: true },
      { key: "period", label: "Hisobot davri", placeholder: "01.09.2026 — 30.09.2026" },
    ],
  },
  nakladnoy: {
    title: "Yuk xati (nakladnoy)", icon: "📦", sides: ["Topshirdi", "Qabul qildi"], hasRows: true,
    fields: [
      { key: "date", label: "Sana", kind: "date" },
      { key: "senderName", label: "Yuboruvchi (kimdan)", full: true },
      { key: "receiverName", label: "Qabul qiluvchi (kimga)", full: true },
      { key: "objectName", label: "Obyekt / yetkazish manzili", full: true },
      { key: "vehicle", label: "Transport (raqami, haydovchi)" },
      { key: "basis", label: "Asos (buyurtma / shartnoma)" },
    ],
  },
};

const num = (v: any) => { const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
export const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const d = (s?: string) => (s ? s.split("-").reverse().join(".") : "____________");
export const rowsTotal = (rows?: Row[]) => (rows || []).reduce((a, r) => a + num(r.qty) * num(r.price), 0);

// ── Canvas chizish ──────────────────────────────────────────────────────────
const W = 1240, H = 1754, M = 110; // A4 @150dpi, chetlari
const FONT = "Inter, 'Segoe UI', Arial, sans-serif";

class Pager {
  pages: HTMLCanvasElement[] = [];
  ctx!: CanvasRenderingContext2D;
  y = 0;
  constructor(private footer: string) { this.newPage(); }
  newPage() {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#94a3b8"; ctx.font = `20px ${FONT}`; ctx.textAlign = "center";
    ctx.fillText(`${this.footer} — ${this.pages.length + 1}-sahifa`, W / 2, H - 50);
    ctx.textAlign = "left"; ctx.fillStyle = "#0f172a";
    this.pages.push(c); this.ctx = ctx; this.y = M;
  }
  ensure(h: number) { if (this.y + h > H - 120) this.newPage(); }
  text(s: string, opts: { size?: number; bold?: boolean; align?: "left" | "center" | "right"; x?: number; width?: number; color?: string; gap?: number } = {}) {
    const size = opts.size ?? 26, x = opts.x ?? M, width = opts.width ?? W - 2 * M;
    const ctx = this.ctx;
    ctx.font = `${opts.bold ? "700" : "400"} ${size}px ${FONT}`;
    const lines: string[] = [];
    for (const para of String(s ?? "").split("\n")) {
      const words = para.split(/\s+/);
      let line = "";
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > width && line) { lines.push(line); line = w; } else line = test;
      }
      lines.push(line);
    }
    const lh = size * 1.45;
    for (const l of lines) {
      this.ensure(lh);
      this.ctx.font = `${opts.bold ? "700" : "400"} ${size}px ${FONT}`;
      this.ctx.fillStyle = opts.color || "#0f172a";
      this.ctx.textAlign = opts.align || "left";
      const tx = opts.align === "center" ? x + width / 2 : opts.align === "right" ? x + width : x;
      this.ctx.fillText(l, tx, this.y + size);
      this.y += lh;
    }
    this.ctx.textAlign = "left";
    this.y += opts.gap ?? 6;
  }
  line(color = "#cbd5e1") { this.ensure(10); this.ctx.strokeStyle = color; this.ctx.lineWidth = 2; this.ctx.beginPath(); this.ctx.moveTo(M, this.y); this.ctx.lineTo(W - M, this.y); this.ctx.stroke(); this.y += 16; }
}

function drawTable(p: Pager, rows: Row[]) {
  const cols = [{ t: "№", w: 60 }, { t: "Nomi", w: 470 }, { t: "O'lchov", w: 110 }, { t: "Miqdori", w: 120 }, { t: "Narxi", w: 130 }, { t: "Summasi", w: 130 }];
  const drawRow = (cells: string[], bold = false, fill?: string) => {
    const ctx = p.ctx; const size = 22; ctx.font = `${bold ? "700" : "400"} ${size}px ${FONT}`;
    // nom ustuni o'raladi
    const nameLines: string[] = []; let line = "";
    for (const w of cells[1].split(/\s+/)) { const test = line ? `${line} ${w}` : w; if (ctx.measureText(test).width > cols[1].w - 20 && line) { nameLines.push(line); line = w; } else line = test; }
    nameLines.push(line);
    const h = Math.max(1, nameLines.length) * 30 + 18;
    p.ensure(h);
    let x = M;
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(M, p.y, W - 2 * M, h); }
    ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1.5;
    cols.forEach((c, i) => {
      ctx.strokeRect(x, p.y, c.w, h);
      ctx.fillStyle = "#0f172a"; ctx.font = `${bold ? "700" : "400"} ${size}px ${FONT}`;
      if (i === 1) nameLines.forEach((l, k) => ctx.fillText(l, x + 10, p.y + 32 + k * 30));
      else { ctx.textAlign = i >= 3 ? "right" : "left"; ctx.fillText(cells[i], i >= 3 ? x + c.w - 10 : x + 10, p.y + 32); ctx.textAlign = "left"; }
      x += c.w;
    });
    p.y += h;
  };
  drawRow(cols.map(c => c.t), true, "#f1f5f9");
  rows.filter(r => r.name?.trim()).forEach((r, i) => {
    const sum = num(r.qty) * num(r.price);
    drawRow([String(i + 1), r.name, r.unit || "", String(r.qty || ""), num(r.price).toLocaleString("ru-RU"), sum.toLocaleString("ru-RU")]);
  });
  p.y += 12;
  p.text(`Jami: ${money(rowsTotal(rows))}`, { bold: true, align: "right", size: 26 });
}

function drawSignatures(p: Pager, sides: [string, string], names: [string, string], sigs: Sig[], images: Record<string, HTMLImageElement>) {
  p.ensure(300); p.y += 30;
  const colW = (W - 2 * M - 60) / 2;
  (["executor", "customer"] as const).forEach((side, i) => {
    const x = M + i * (colW + 60), y0 = p.y;
    const ctx = p.ctx;
    ctx.fillStyle = "#0f172a"; ctx.font = `700 24px ${FONT}`; ctx.fillText(sides[i], x, y0 + 24);
    ctx.font = `400 22px ${FONT}`; ctx.fillStyle = "#334155"; ctx.fillText(names[i] || "", x, y0 + 56);
    const sig = sigs.find(s => s.side === side);
    const img = sig ? images[side] : undefined;
    if (img) {
      const ratio = Math.min(colW / img.width, 130 / img.height);
      ctx.drawImage(img, x, y0 + 70, img.width * ratio, img.height * ratio);
    }
    ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y0 + 210); ctx.lineTo(x + colW, y0 + 210); ctx.stroke();
    ctx.font = `400 19px ${FONT}`; ctx.fillStyle = "#64748b";
    ctx.fillText(sig ? `Imzolandi: ${sig.name}, ${new Date(sig.signedAt).toLocaleString("ru-RU")}` : "(imzo)", x, y0 + 240);
  });
  p.y += 270;
}

const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

export async function renderDoc(doc: SignDoc): Promise<HTMLCanvasElement[]> {
  try { await (document as any).fonts?.ready; } catch { /* */ }
  const tpl = TEMPLATES[doc.type];
  const f = doc.data || {};
  const images: Record<string, HTMLImageElement> = {};
  for (const s of doc.signatures || []) { try { images[s.side] = await loadImg(s.image); } catch { /* */ } }
  const p = new Pager(`${tpl.title} № ${doc.number}`);
  p.text(`${tpl.title.toUpperCase()} № ${doc.number}`, { size: 36, bold: true, align: "center", gap: 14 });

  if (doc.type === "shartnoma") {
    p.text(`${f.city || "Toshkent"} sh.`, { size: 24 });
    p.y -= 34; p.text(d(f.date), { size: 24, align: "right", gap: 24 });
    p.text(`${f.customerName || "________________"} (keyingi o'rinlarda «Buyurtmachi») bir tomondan va ${f.contractorName || "________________"} (keyingi o'rinlarda «Pudratchi») ikkinchi tomondan ushbu shartnomani quyidagilar haqida tuzdilar:`, { gap: 18 });
    const sec = (t: string, body: string) => { p.text(t, { bold: true, size: 26, gap: 4 }); p.text(body, { gap: 14 }); };
    sec("1. Shartnoma predmeti", `1.1. Pudratchi Buyurtmachining topshirig'iga ko'ra quyidagi obyektda ishlarni bajarish majburiyatini oladi: ${f.objectName || "________________"}.\n1.2. Bajariladigan ishlar: ${f.workDescription || "________________"}.`);
    const amount = num(f.amount), adv = num(f.advancePercent);
    sec("2. Shartnoma summasi va to'lov tartibi", `2.1. Shartnomaning umumiy summasi: ${money(amount)}.\n2.2. Buyurtmachi ${adv ? `${adv}% (${money(amount * adv / 100)})` : "kelishilgan miqdorda"} avans to'laydi, qolgan qismi bajarilgan ishlar dalolatnomasi imzolangandan so'ng 10 bank kuni ichida to'lanadi.`);
    sec("3. Ishlarni bajarish muddati", `3.1. Ishlarni boshlash: ${d(f.startDate)}. Tugatish: ${d(f.endDate)}.`);
    sec("4. Tomonlarning majburiyatlari", "4.1. Pudratchi ishlarni qurilish me'yorlari (ShNQ) va xavfsizlik texnikasi talablariga muvofiq, sifatli va o'z vaqtida bajaradi.\n4.2. Buyurtmachi obyektga kirishni ta'minlaydi, bajarilgan ishlarni qabul qiladi va o'z vaqtida to'lovni amalga oshiradi.");
    sec("5. Javobgarlik", "5.1. Majburiyatlarni bajarmaganlik yoki lozim darajada bajarmaganlik uchun tomonlar O'zbekiston Respublikasi qonunchiligiga muvofiq javobgar bo'ladilar.\n5.2. Nizolar muzokaralar yo'li bilan, kelishilmagan taqdirda — sud tartibida hal etiladi.");
    if (f.extra) sec("6. Qo'shimcha shartlar", String(f.extra));
    sec("Tomonlarning rekvizitlari", `Buyurtmachi: ${f.customerName || ""}\n${f.customerDetails || ""}\n\nPudratchi: ${f.contractorName || ""}\n${f.contractorDetails || ""}`);
    drawSignatures(p, tpl.sides, [f.contractorName, f.customerName], doc.signatures || [], images);
  } else if (doc.type === "akt") {
    p.text(`Sana: ${d(f.date)}${f.contractRef ? `     Shartnoma: ${f.contractRef}` : ""}`, { size: 24, gap: 10 });
    p.text(`Buyurtmachi: ${f.customerName || "—"}\nPudratchi: ${f.contractorName || "—"}\nObyekt: ${f.objectName || "—"}\nHisobot davri: ${f.period || "—"}`, { gap: 18 });
    p.text("Biz, quyida imzo chekuvchilar, ushbu dalolatnomani quyidagi ishlar to'liq hajmda va sifatli bajarilgani haqida tuzdik:", { gap: 14 });
    drawTable(p, f.rows || []);
    p.text("Ishlar belgilangan muddatda, to'liq hajmda bajarildi. Buyurtmachining ishlar hajmi, sifati va muddatlari bo'yicha e'tirozlari yo'q.", { gap: 10 });
    drawSignatures(p, tpl.sides, [f.contractorName, f.customerName], doc.signatures || [], images);
  } else {
    p.text(`Sana: ${d(f.date)}`, { size: 24, gap: 10 });
    p.text(`Yuboruvchi: ${f.senderName || "—"}\nQabul qiluvchi: ${f.receiverName || "—"}\nManzil: ${f.objectName || "—"}${f.vehicle ? `\nTransport: ${f.vehicle}` : ""}${f.basis ? `\nAsos: ${f.basis}` : ""}`, { gap: 18 });
    drawTable(p, f.rows || []);
    p.text("Yuk to'liq miqdorda, shikastlanmagan holda topshirildi va qabul qilindi.", { gap: 10 });
    drawSignatures(p, tpl.sides, [f.senderName, f.receiverName], doc.signatures || [], images);
  }
  return p.pages;
}
