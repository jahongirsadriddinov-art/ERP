import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { API_BASE } from "./api";
import { saveOrShareBlob } from "./platform";
import { canvasesToPdf } from "./lib/pdf";
import { TEMPLATES, DocType, SignDoc, Row, renderDoc, rowsTotal, money, docLayout, docNumberOf } from "./docTemplates";
import { FONTS, fontById, ensureFont } from "./lib/fonts";
import { beautifySignature, BeautifyResult, Stroke } from "./lib/signatureBeautify";
import { scanInk, CropBox } from "./lib/scanInk";
import { EscClose } from "./App";

// ─── Imzo maydoni (barmoq / sichqoncha / stilus) ─────────────────────────────
// Chizilgan har bir harakat (nuqtalar) saqlanadi — "✨ Tekislash" shu asosida imzoni qayta, tekis va toza
// chizadi. Foydalanuvchi o'zi tanlaydi: tekislangan variant yoki o'zi chizgani (qanday bo'lsa shunday).
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef<Stroke[]>([]);
  const [raw, setRaw] = useState<string | null>(null);
  const [fixed, setFixed] = useState<BeautifyResult | null>(null);
  const [choice, setChoice] = useState<"fixed" | "raw">("fixed");
  useEffect(() => {
    const c = ref.current!; const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
    const ctx = c.getContext("2d")!; ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0b3d91";
  }, []);
  // Tanlangan variant tashqariga beriladi
  useEffect(() => {
    onChange(!raw ? null : choice === "fixed" && fixed?.needsFix ? fixed.dataUrl : raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, fixed, choice]);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true;
    const [x, y] = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.beginPath(); ctx.moveTo(x, y);
    strokes.current.push([{ x, y }]);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const [x, y] = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.lineTo(x, y); ctx.stroke();
    strokes.current[strokes.current.length - 1]?.push({ x, y });
  };
  const up = () => {
    if (!drawing.current) return; drawing.current = false;
    const hasInk = strokes.current.some(s => s.length > 1);
    if (!hasInk) return;
    setRaw(ref.current!.toDataURL("image/png"));
    try { setFixed(beautifySignature(strokes.current)); } catch { setFixed(null); }
  };
  const clear = () => {
    const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    strokes.current = []; setRaw(null); setFixed(null); setChoice("fixed");
  };
  const opt = (key: "fixed" | "raw", title: string, src: string) => (
    <button type="button" onClick={() => setChoice(key)}
      className={`flex-1 min-w-0 rounded-xl border-2 p-1.5 text-left liquid-transition ${choice === key ? "border-primary bg-primary/[0.06]" : "border-border hover:border-primary/40"}`}>
      <span className="block h-14 bg-white rounded-lg overflow-hidden"><img src={src} alt="" className="w-full h-full object-contain" /></span>
      <span className="block text-[11px] font-bold mt-1 truncate">{choice === key ? "● " : "○ "}{title}</span>
    </button>
  );
  return (
    <div className="space-y-2">
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className="w-full h-40 rounded-xl border-2 border-dashed border-border bg-white touch-none cursor-crosshair" />
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>Barmoq yoki sichqoncha bilan imzo chizing</span>
        <button type="button" onClick={clear} className="font-semibold text-primary hover:underline">Tozalash</button>
      </div>
      {raw && fixed && (fixed.needsFix ? (
        <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-2.5 space-y-2">
          <p className="text-[11px] font-semibold">✨ Imzo tekislandi {Math.abs(fixed.angleDeg) >= 3 ? `(qiyshiqlik ${Math.abs(fixed.angleDeg)}° to'g'rilandi)` : "(xusnixat bo'yicha chiroyli, bir tekis qiyalikda qayta yozildi)"} — qaysi biri qo'yilsin?</p>
          <div className="flex gap-2">{opt("fixed", "✨ Tekislangan", fixed.dataUrl)}{opt("raw", "✍️ O'zim chizganim", raw)}</div>
        </div>
      ) : (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">✓ Imzo tekis va aniq — o'zgartirish shart emas</p>
      ))}
    </div>
  );
}

// Yuklangan rasmni (imzo / pechat) kichraytirib PNG data URL qiladi. `removeWhite` — oq fonni shaffof qiladi
// (qog'ozga qo'yilgan imzo/muhr surati hujjat ustida toza ko'rinsin).
async function fileToPng(file: File, max: number, removeWhite: boolean): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    let side = max;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = Math.min(1, side / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * r)); c.height = Math.max(1, Math.round(img.height * r));
      const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0, c.width, c.height);
      if (removeWhite) {
        const d = ctx.getImageData(0, 0, c.width, c.height); const px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
          if (lum > 225) px[i + 3] = 0; else if (lum > 190) px[i + 3] = Math.round(px[i + 3] * (225 - lum) / 35);
        }
        ctx.putImageData(d, 0, 0);
      }
      const out = c.toDataURL("image/png");
      if (out.length <= 380_000) return out;
      side = Math.round(side * 0.75);
    }
    throw new Error("TOO_BIG");
  } finally { URL.revokeObjectURL(url); }
}

export type StampPos = { x: number; y: number; size: number }; // imzo blokiga nisbatan: markaz (0..1) va kenglik (blok kengligiga nisbatan)
export const DEFAULT_STAMP_POS: StampPos = { x: 0.83, y: 0.49, size: 0.31 };

// Pechatni imzo bloki ustida sudrab joylashtirish va o'lchamini o'zgartirish (PDF'dagi ko'rinish bilan bir xil nisbatda)
function StampPlacer({ image, stamp, pos, onChange }: { image: string | null; stamp: string; pos: StampPos; onChange: (p: StampPos) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !box.current) return;
    const r = box.current.getBoundingClientRect();
    onChange({ ...pos, x: clamp((e.clientX - r.left - drag.current.dx) / r.width, 0, 1), y: clamp((e.clientY - r.top - drag.current.dy) / r.height, 0, 1) });
  };
  return (
    <div className="rounded-xl border border-border p-2.5 space-y-2">
      <p className="text-xs font-semibold">🔵 Pechat joyi va o'lchami <span className="font-normal text-muted-foreground">— sudrab joylang</span></p>
      {/* Blok nisbati: 480 × 215 (PDF'dagi imzo ustuni) */}
      <div ref={box} className="relative w-full bg-white rounded-lg ring-1 ring-black/10 overflow-hidden touch-none select-none" style={{ aspectRatio: "480 / 215" }}
        onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <span className="absolute left-0 top-[4%] text-[10px] font-bold text-slate-700 px-1">Imzo</span>
        {image && <img src={image} alt="" className="absolute left-0 object-contain object-left pointer-events-none" style={{ top: "29%", height: "44%", maxWidth: "70%" }} />}
        <div className="absolute left-0 right-0 border-t border-slate-800" style={{ top: "77%" }} />
        <img src={stamp} alt="" draggable={false}
          onPointerDown={e => {
            const r = box.current!.getBoundingClientRect();
            drag.current = { dx: e.clientX - r.left - pos.x * r.width, dy: e.clientY - r.top - pos.y * r.height };
            (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
          }}
          className="absolute cursor-grab active:cursor-grabbing opacity-90 hover:ring-2 hover:ring-sky-400/60 rounded-full"
          style={{ width: `${pos.size * 100}%`, left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, transform: "translate(-50%, -50%)" }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Kichik</span>
        <input type="range" min={15} max={70} value={Math.round(pos.size * 100)} onChange={e => onChange({ ...pos, size: Number(e.target.value) / 100 })} className="flex-1 accent-primary" aria-label="Pechat o'lchami" />
        <span className="text-[11px] text-muted-foreground">Katta</span>
        <button type="button" onClick={() => onChange(DEFAULT_STAMP_POS)} className="text-[11px] font-semibold text-primary hover:underline">↺</button>
      </div>
    </div>
  );
}

// Skaner hududini qo'lda belgilash: rasm ustida ramkani sudrash / burchaklardan o'lchamini o'zgartirish
function CropEditor({ src, initial, title, onDone, onCancel }: { src: string; initial: CropBox; title: string; onDone: (b: CropBox) => void; onCancel: () => void }) {
  const [b, setB] = useState<CropBox>(initial);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "nw" | "ne" | "sw" | "se"; sx: number; sy: number; start: CropBox } | null>(null);
  const clamp = (v: number, a: number, z: number) => Math.min(z, Math.max(a, v));
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height, s = d.start, MIN = 0.04;
    if (d.mode === "move") { setB({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) }); return; }
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    if (d.mode.includes("w")) x0 = clamp(x0 + dx, 0, x1 - MIN); else x1 = clamp(x1 + dx, x0 + MIN, 1);
    if (d.mode.includes("n")) y0 = clamp(y0 + dy, 0, y1 - MIN); else y1 = clamp(y1 + dy, y0 + MIN, 1);
    setB({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  };
  const start = (mode: "move" | "nw" | "ne" | "sw" | "se") => (e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: b };
    wrap.current?.setPointerCapture(e.pointerId);
  };
  const handle = (m: "nw" | "ne" | "sw" | "se", pos: React.CSSProperties) => (
    <span onPointerDown={start(m)} className="absolute w-6 h-6 -m-3 rounded-full bg-white border-2 border-sky-500 shadow touch-none" style={pos} />
  );
  return createPortal(
    <div className="fixed inset-0 z-[400] bg-black/85 flex flex-col items-center justify-center p-3 gap-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
      <EscClose onClose={onCancel} />
      <p className="text-white text-sm font-semibold text-center">{title}</p>
      <div ref={wrap} className="relative max-w-full touch-none select-none" style={{ maxHeight: "70vh" }}
        onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <img src={src} alt="" draggable={false} className="block max-w-full max-h-[70vh] object-contain pointer-events-none" />
        <div onPointerDown={start("move")} className="absolute border-2 border-sky-400 cursor-move touch-none"
          style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}>
          {handle("nw", { left: 0, top: 0 })}{handle("ne", { right: 0, top: 0 })}{handle("sw", { left: 0, bottom: 0 })}{handle("se", { right: 0, bottom: 0 })}
        </div>
      </div>
      <div className="flex gap-2 w-full max-w-sm">
        <button type="button" onClick={onCancel} className="flex-1 h-11 rounded-xl bg-white/10 text-white text-sm font-semibold">Bekor qilish</button>
        <button type="button" onClick={() => onDone(b)} className="flex-1 h-11 rounded-xl bg-sky-500 text-white text-sm font-bold">✂️ Shu hududdan olish</button>
      </div>
    </div>,
    document.body
  );
}

// Imzo: chizish (tekislash bilan) YOKI qog'ozdagi imzoni skanerlash (kamera/rasm — faqat imzoning o'zi
// avtomatik ajratib olinadi); ixtiyoriy — pechat (skaner bilan avtomatik ajratiladi, joyi/o'lchami sozlanadi).
// Ikkala tomon (firma va mijoz) uchun bir xil.
export function SignatureInput({ onChange }: { onChange: (v: { image: string | null; stamp: string | null; date: string; stampPos: StampPos }) => void }) {
  const [date, setDate] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const [mode, setMode] = useState<"draw" | "scan">("draw");
  const [drawn, setDrawn] = useState<string | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);
  const [stamp, setStamp] = useState<string | null>(null);
  const [stampPos, setStampPos] = useState<StampPos>(DEFAULT_STAMP_POS);
  const [busy, setBusy] = useState<"" | "sig" | "stamp">("");
  // Oxirgi skaner (qo'lda hudud belgilash uchun): manba surat va aniqlangan hudud
  const [lastScan, setLastScan] = useState<{ sig?: { preview: string; box: CropBox }; stamp?: { preview: string; box: CropBox } }>({});
  const [cropFor, setCropFor] = useState<"" | "sig" | "stamp">("");
  const sigCam = useRef<HTMLInputElement>(null), sigFile = useRef<HTMLInputElement>(null);
  const stCam = useRef<HTMLInputElement>(null), stFile = useRef<HTMLInputElement>(null);
  const image = mode === "draw" ? drawn : scanned;
  useEffect(() => { onChange({ image, stamp, date, stampPos }); /* eslint-disable-next-line */ }, [image, stamp, date, stampPos]);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>, kind: "sig" | "stamp") => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Faqat rasm (PNG/JPG) yuklang"); return; }
    await runScan(file, kind);
  };
  const runScan = async (src: File | string, kind: "sig" | "stamp", crop?: CropBox) => {
    setBusy(kind);
    try {
      const r = await scanInk(src, kind === "sig" ? "signature" : "stamp", crop);
      if (kind === "sig") setScanned(r.dataUrl); else { setStamp(r.dataUrl); if (!crop) setStampPos(DEFAULT_STAMP_POS); }
      setLastScan(prev => ({ ...prev, [kind]: { preview: r.preview, box: r.box } }));
      toast.success(kind === "sig" ? "Imzo aniqlandi va ajratib olindi" : "Pechat aniqlandi va ajratib olindi");
    } catch (err) {
      toast.error((err as Error)?.message === "NOT_FOUND" ? (kind === "sig" ? "Suratda imzo topilmadi — yaqinroqdan, yorug' joyda oling" : "Suratda pechat topilmadi — yaqinroqdan, yorug' joyda oling") : "Rasm juda katta yoki o'qilmadi");
    } finally { setBusy(""); }
  };
  const tab = (m: "draw" | "scan", label: string) => (
    <button type="button" onClick={() => setMode(m)}
      className={`flex-1 py-2 rounded-lg text-xs font-bold liquid-transition ${mode === m ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
  );
  const btn = "flex-1 h-10 rounded-xl border border-border text-xs font-bold hover:border-primary/50 hover:bg-primary/[0.05] liquid-transition disabled:opacity-50";
  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 rounded-xl bg-muted/60">{tab("draw", "✍️ Chizish")}{tab("scan", "📷 Skaner (qog'ozdan)")}</div>
      {mode === "draw" ? <SignaturePad onChange={setDrawn} /> : (
        <div className="space-y-2">
          <input ref={sigCam} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => pick(e, "sig")} />
          <input ref={sigFile} type="file" accept="image/*" className="hidden" onChange={e => pick(e, "sig")} />
          <div className="w-full h-40 rounded-xl border-2 border-dashed border-border bg-white flex items-center justify-center overflow-hidden">
            {busy === "sig" ? <span className="text-xs text-slate-500">Imzo aniqlanmoqda...</span>
              : scanned ? <img src={scanned} alt="" className="max-h-full max-w-full object-contain" />
              : <span className="text-xs text-slate-500 px-6 text-center">Qog'ozdagi imzoni suratga oling — imzoning o'zi avtomatik topilib, fon olib tashlanadi</span>}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => sigCam.current?.click()} className={btn}>📷 Kamera bilan</button>
            <button type="button" disabled={!!busy} onClick={() => sigFile.current?.click()} className={btn}>🖼️ Rasmdan</button>
          </div>
          {lastScan.sig && <button type="button" onClick={() => setCropFor("sig")} className="w-full text-[11px] font-bold text-primary hover:underline">✂️ Aniq olinmadimi? Imzo turgan joyni o'zingiz belgilang</button>}
        </div>
      )}
      <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
        <span className="text-xs font-semibold">📅 Imzo sanasi</span>
        <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}
          className="text-sm bg-transparent border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40" />
      </label>
      <div className="flex items-center gap-3 rounded-xl border border-border p-2.5">
        <div className="w-16 h-16 rounded-lg bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
          {busy === "stamp" ? <span className="text-[10px] text-slate-500">...</span> : stamp ? <img src={stamp} alt="" className="max-w-full max-h-full object-contain" /> : <span className="text-2xl opacity-40">🔵</span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">Pechat (muhr) — ixtiyoriy</p>
          <p className="text-[11px] text-muted-foreground">Muhrni suratga oling — o'zi aniqlab, kesib oladi</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            <input ref={stCam} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => pick(e, "stamp")} />
            <input ref={stFile} type="file" accept="image/*" className="hidden" onChange={e => pick(e, "stamp")} />
            <button type="button" disabled={!!busy} onClick={() => stCam.current?.click()} className="text-[11px] font-bold text-primary hover:underline">📷 Skanerlash</button>
            <button type="button" disabled={!!busy} onClick={() => stFile.current?.click()} className="text-[11px] font-bold text-primary hover:underline">🖼️ Rasmdan</button>
            {lastScan.stamp && <button type="button" onClick={() => setCropFor("stamp")} className="text-[11px] font-bold text-primary hover:underline">✂️ Qo'lda belgilash</button>}
            {stamp && <button type="button" onClick={() => setStamp(null)} className="text-[11px] font-bold text-red-500 hover:underline">Olib tashlash</button>}
          </div>
        </div>
      </div>
      {stamp && <StampPlacer image={image} stamp={stamp} pos={stampPos} onChange={setStampPos} />}
      {cropFor && lastScan[cropFor] && (() => {
        const ls = lastScan[cropFor]!;
        const g = 0.04, b = ls.box;
        const init = { x: Math.max(0, b.x - g), y: Math.max(0, b.y - g), w: Math.min(1 - Math.max(0, b.x - g), b.w + 2 * g), h: Math.min(1 - Math.max(0, b.y - g), b.h + 2 * g) };
        return <CropEditor src={ls.preview} initial={init} title={cropFor === "sig" ? "Ramkani faqat imzo atrofiga qo'ying" : "Ramkani faqat pechat atrofiga qo'ying"}
          onCancel={() => setCropFor("")} onDone={box => { const k = cropFor; setCropFor(""); runScan(ls.preview, k, box); }} />;
      })()}
    </div>
  );
}

// Hujjat shrifti — hujjatlar bo'limida alohida tanlanadi (sayt shriftidan mustaqil)
function DocFontPicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  useEffect(() => { FONTS.forEach(f => ensureFont(f.id)); }, []);
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Hujjat shrifti</p>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:thin]">
        {FONTS.map(f => {
          const active = fontById(value).id === f.id;
          return (
            <button key={f.id} type="button" onClick={() => onChange(f.id)}
              className={`flex-shrink-0 rounded-xl border-2 px-3 py-2 text-left liquid-transition ${active ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}>
              <span data-font-preview className="block text-base leading-tight whitespace-nowrap" style={{ fontFamily: f.family }}>Shartnoma Аа</span>
              <span className="block text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">{f.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sahifaning O'ZIDA tahrirlash (WYSIWYG) ──────────────────────────────────
// Hujjat oq qog'oz ko'rinishida chiziladi (PDF bilan bir xil tuzilish/shrift); istalgan matnga bosib,
// shu joyning o'zida yozish mumkin. O'zgartirilgan blok "↺" bilan asliga qaytadi.
const PX = (px: number) => `${(px / 12.4).toFixed(3)}cqw`; // 1240px kenglikdagi A4 → konteyner kengligiga mutanosib

function EditableText({ value, def, placeholder, style, onCommit }:
  { value: string; def: string; placeholder?: string; style: React.CSSProperties; onCommit: (v: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerText !== value) el.innerText = value;
  }, [value]);
  const changed = value !== def;
  return (
    <div className="group/et relative">
      <div ref={ref} data-font-preview contentEditable suppressContentEditableWarning spellCheck={false} data-ph={placeholder || ""}
        onBlur={e => { const v = e.currentTarget.innerText.replace(/\n+$/, ""); onCommit(v === def ? null : v); }}
        onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); e.nativeEvent.stopPropagation(); (e.currentTarget as HTMLElement).blur(); } }}
        className={`doc-editable outline-none rounded-[3px] whitespace-pre-wrap break-words cursor-text transition-colors ${changed ? "bg-amber-300/15" : ""}`}
        style={style} />
      {changed && (
        <button type="button" title="Asliga qaytarish" onMouseDown={e => e.preventDefault()} onClick={() => onCommit(null)}
          className="absolute -right-1 -top-2 translate-x-full w-6 h-6 rounded-full bg-white border border-slate-300 text-slate-500 text-xs shadow opacity-100 sm:opacity-0 sm:group-hover/et:opacity-100 hover:text-sky-600 transition-opacity">↺</button>
      )}
    </div>
  );
}

function DocPaperEditor({ doc, onText }: { doc: SignDoc; onText: (id: string, v: string | null) => void }) {
  const font = fontById(doc.data?.font);
  useEffect(() => { ensureFont(doc.data?.font); }, [doc.data?.font]);
  const layout = docLayout(doc);
  const tpl = TEMPLATES[doc.type];
  const texts: Record<string, string> = doc.data?.texts || {};
  const base: React.CSSProperties = { fontFamily: font.family, color: "#0f172a" };
  const items: React.ReactNode[] = [];
  for (let i = 0; i < layout.length; i++) {
    const it = layout[i];
    if (it.kind === "text") {
      const st = (o: typeof it.opts): React.CSSProperties => ({
        ...base, fontSize: PX(o.size ?? 26), lineHeight: 1.45, fontWeight: o.bold ? 700 : 400,
        textAlign: o.align || "left", color: o.color || "#0f172a", marginBottom: PX(o.gap ?? 6),
      });
      const next = layout[i + 1];
      if (next && next.kind === "text" && next.opts.sameLine) {
        items.push(
          <div key={it.id} className="flex items-start justify-between gap-4">
            <div className="flex-1"><EditableText value={it.value} def={it.def} style={st(it.opts)} onCommit={v => onText(it.id, v)} /></div>
            <div className="flex-1"><EditableText value={next.value} def={next.def} style={st(next.opts)} onCommit={v => onText(next.id, v)} /></div>
          </div>
        );
        i++;
        continue;
      }
      items.push(<EditableText key={it.id} value={it.value} def={it.def} placeholder={it.id === "note" ? "+ Qo'shimcha izoh yozish uchun bosing" : ""}
        style={st(it.opts)} onCommit={v => onText(it.id, v)} />);
    } else if (it.kind === "table") {
      const rows = it.rows.filter(r => r.name?.trim());
      const cell: React.CSSProperties = { ...base, fontSize: PX(22), border: "1px solid #94a3b8", padding: `${PX(8)} ${PX(10)}` };
      items.push(
        <div key="table" style={{ marginBottom: PX(12) }}>
          <table className="w-full border-collapse" data-font-preview style={base}>
            <thead><tr style={{ background: "#f1f5f9" }}>
              {["№", "Nomi", "O'lchov", "Miqdori", "Narxi", "Summasi"].map(h => <th key={h} data-font-preview style={{ ...cell, fontWeight: 700, textAlign: "left" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td data-font-preview colSpan={6} style={{ ...cell, color: "#94a3b8", textAlign: "center" }}>Qatorlarni yuqoridagi "Ishlar / materiallar" bo'limida qo'shing</td></tr>}
              {rows.map((r, k) => {
                const q = Number(String(r.qty).replace(",", ".")) || 0, pr = Number(String(r.price).replace(/\s/g, "").replace(",", ".")) || 0;
                return (
                  <tr key={k}>
                    {[String(k + 1), r.name, r.unit, r.qty, pr.toLocaleString("ru-RU"), (q * pr).toLocaleString("ru-RU")].map((c, j) =>
                      <td key={j} data-font-preview style={{ ...cell, textAlign: j >= 3 ? "right" : "left" }}>{c}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p data-font-preview style={{ ...base, fontSize: PX(26), fontWeight: 700, textAlign: "right", marginTop: PX(10) }}>Jami: {money(rowsTotal(it.rows))}</p>
        </div>
      );
    } else {
      items.push(
        <div key="sigs" className="grid grid-cols-2" style={{ gap: PX(60), marginTop: PX(24) }}>
          {[0, 1].map(k => {
            const id = k === 0 ? "side1" : "side2";
            return (
              <div key={k}>
                <EditableText value={typeof texts[id] === "string" ? texts[id] : tpl.sides[k]} def={tpl.sides[k]} onCommit={v => onText(id, v)}
                  style={{ ...base, fontSize: PX(24), fontWeight: 700 }} />
                <p data-font-preview style={{ ...base, fontSize: PX(22), color: "#334155" }}>{it.names[k] || " "}</p>
                <div style={{ height: PX(100) }} />
                <div style={{ borderTop: "1.5px solid #0f172a" }} />
                <p data-font-preview style={{ ...base, fontSize: PX(18), color: "#64748b", marginTop: PX(6) }}>(imzo)</p>
              </div>
            );
          })}
        </div>
      );
    }
  }
  return (
    <div className="rounded-2xl bg-white shadow-xl ring-1 ring-black/10 overflow-hidden" style={{ containerType: "inline-size" } as React.CSSProperties}>
      <div style={{ padding: `${PX(110)} ${PX(110)} ${PX(90)}` }}>{items}</div>
      <p data-font-preview className="text-center" style={{ ...base, fontSize: PX(20), color: "#94a3b8", paddingBottom: PX(30) }}>{tpl.title} № {docNumberOf(doc)}</p>
    </div>
  );
}

// ─── Sahifa ko'rinishi (canvas → rasm) ───────────────────────────────────────
function DocPreview({ doc }: { doc: SignDoc }) {
  const [imgs, setImgs] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    renderDoc(doc).then(pages => { if (alive) setImgs(pages.map(p => p.toDataURL("image/jpeg", 0.85))); }).catch(() => {});
    return () => { alive = false; };
  }, [JSON.stringify(doc)]);
  return (
    <div className="space-y-3">
      {imgs.length === 0 && <div className="h-64 rounded-xl bg-muted/40 animate-pulse" />}
      {imgs.map((src, i) => <img key={i} src={src} alt="" className="w-full rounded-xl border border-border shadow-sm bg-white" />)}
    </div>
  );
}

// To'liq imzolangan hujjat PDF'i serverga yuboriladi — server uni Telegram botga (rahbarlarga) jo'natadi.
async function sendSignedPdf(doc: SignDoc, url: string) {
  try {
    const pages = await renderDoc(doc);
    const blob = canvasesToPdf(pages);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdf: btoa(bin) }) });
  } catch { /* bot'ga yuborilmasa ham imzo saqlangan */ }
}

async function downloadPdf(doc: SignDoc) {
  const pages = await renderDoc(doc);
  const saved = await saveOrShareBlob(`${docNumberOf(doc).replace(/[\/:*?"<>|]/g, "-")}.pdf`, canvasesToPdf(pages));
  if (!saved.ok) toast.error("PDF saqlanmadi");
}

const STATUS: Record<string, [string, string]> = {
  draft: ["Imzolanmagan", "bg-muted text-muted-foreground"],
  partially_signed: ["Bir tomon imzoladi", "bg-amber-500/15 text-amber-600 dark:text-amber-400"],
  signed: ["Imzolangan", "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"],
};

// ─── Asosiy oyna ─────────────────────────────────────────────────────────────
export default function ESignDocs({ onClose, companyName, currentUserName, projects }:
  { onClose: () => void; companyName: string; currentUserName: string; projects: { id: string; name: string; location?: string }[] }) {
  const [view, setView] = useState<"list" | "new" | "open">("list");
  // view === "new" && editingId — mavjud (imzolanmagan) hujjatni tahrirlash
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftType, setDraftType] = useState<DocType>("shartnoma");
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [rows, setRows] = useState<Row[]>([{ name: "", unit: "", qty: "", price: "" }]);
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<any | null>(null);
  const [sigName, setSigName] = useState(currentUserName);
  const [sigImg, setSigImg] = useState<string | null>(null);
  const [sigStamp, setSigStamp] = useState<string | null>(null);
  const [sigDate, setSigDate] = useState("");
  const [sigStampPos, setSigStampPos] = useState<StampPos>(DEFAULT_STAMP_POS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [paperTab, setPaperTab] = useState<"edit" | "preview">("edit");
  const setText = (id: string, v: string | null) => setDraft(d => { const t = { ...(d.texts || {}) }; if (v === null) delete t[id]; else t[id] = v; return { ...d, texts: t }; });
  const [signing, setSigning] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/sign-docs`); if (r.ok) setList(await r.json()); } catch { /* */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startNew = (t: DocType) => {
    const today = new Date().toISOString().slice(0, 10);
    setDraftType(t);
    setDraft(t === "nakladnoy" ? { date: today, senderName: companyName } : { date: today, city: "Toshkent", contractorName: companyName });
    setRows([{ name: "", unit: "", qty: "", price: "" }]);
    setProjectId("");
    setEditingId(null);
    setView("new");
  };
  const startEdit = () => {
    if (!open) return;
    const { rows: r, ...rest } = open.data || {};
    setDraftType(open.type); setDraft(rest); setRows(r?.length ? r : [{ name: "", unit: "", qty: "", price: "" }]);
    setProjectId(open.projectId || ""); setEditingId(open.id); setView("new");
  };
  const pickProject = (id: string) => {
    setProjectId(id);
    const p = projects.find(x => x.id === id);
    if (p) setDraft(d => ({ ...d, objectName: [p.name, p.location].filter(Boolean).join(", ") }));
  };
  const create = async () => {
    setSaving(true);
    try {
      const data = { ...draft, ...(TEMPLATES[draftType].hasRows ? { rows: rows.filter(r => r.name.trim()) } : {}) };
      const r = editingId
        ? await fetch(`${API_BASE}/api/sign-docs/${editingId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, projectId: projectId || undefined }) })
        : await fetch(`${API_BASE}/api/sign-docs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: draftType, data, projectId: projectId || undefined }) });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || "Xatolik"); return; }
      toast.success(editingId ? "Hujjat saqlandi" : `Hujjat yaratildi: ${d.number}`);
      await load();
      openDoc(d.id || d._id);
    } finally { setSaving(false); }
  };
  const openDoc = async (id: string) => {
    const r = await fetch(`${API_BASE}/api/sign-docs/${id}`);
    if (!r.ok) { toast.error("Hujjat ochilmadi"); return; }
    setOpen(await r.json()); setSigImg(null); setView("open");
  };
  const sign = async () => {
    if (!open || !sigImg || !sigName.trim()) return;
    setSigning(true);
    try {
      const r = await fetch(`${API_BASE}/api/sign-docs/${open.id}/sign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: sigName.trim(), image: sigImg, stamp: sigStamp || undefined, stampPos: sigStamp ? sigStampPos : undefined, date: sigDate || undefined }) });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || "Xatolik"); return; }
      toast.success("Imzolandi"); const merged = { ...open, ...d, id: open.id }; setOpen(merged); setSigImg(null); setSigStamp(null); load();
      if (merged.status === "signed") sendSignedPdf(merged, `${API_BASE}/api/sign-docs/${open.id}/pdf`);
    } finally { setSigning(false); }
  };
  const share = async () => {
    const r = await fetch(`${API_BASE}/api/sign-docs/${open.id}/share`, { method: "POST" });
    const d = await r.json();
    if (!r.ok || !d.url) { toast.error("Havola yaratilmadi"); return; }
    try { await navigator.clipboard.writeText(d.url); toast.success("Havola nusxalandi — mijozga yuboring (Telegram, SMS)"); }
    catch { toast.message(d.url); }
  };
  const remove = async (id: string) => {
    const r = await fetch(`${API_BASE}/api/sign-docs/${id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(d.error || "O'chirib bo'lmadi"); return; }
    toast.success("O'chirildi"); setView("list"); load();
  };

  const input = "w-full text-sm border border-border rounded-xl px-3 py-2 bg-input-background focus:outline-none focus:ring-2 focus:ring-primary/40";
  const tpl = TEMPLATES[draftType];
  const executorSigned = open?.signatures?.some((s: any) => s.side === "executor");

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-card border border-border w-full sm:max-w-5xl h-[94dvh] sm:h-[90vh] rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          {view !== "list" && <button onClick={() => setView("list")} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center text-lg" aria-label="Orqaga">‹</button>}
          <div className="flex-1 min-w-0">
            <p className="font-bold truncate">{view === "new" ? (editingId ? `Tahrirlash: ${tpl.title}` : `Yangi: ${tpl.title}`) : view === "open" && open ? `${open.title} № ${open.number}` : "Elektron hujjatlar va imzo"}</p>
            <p className="text-xs text-muted-foreground truncate">Shartnoma, dalolatnoma va yuk xatini yarating, telefonda imzolang, PDF oling</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Yopish">✕</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {view === "list" && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(Object.keys(TEMPLATES) as DocType[]).map(t => (
                  <button key={t} onClick={() => startNew(t)}
                    className="text-left rounded-2xl border border-border p-4 hover:border-primary/50 hover:bg-primary/[0.04] liquid-transition">
                    <span className="text-2xl">{TEMPLATES[t].icon}</span>
                    <p className="font-semibold mt-2">{TEMPLATES[t].title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">+ Yangi yaratish</p>
                  </button>
                ))}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Hujjatlar</p>
                {loading ? <div className="h-24 rounded-xl bg-muted/40 animate-pulse" /> : list.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">Hali hujjat yo'q — yuqoridan shablon tanlang</p>
                ) : (
                  <div className="space-y-2">
                    {list.map(d => (
                      <button key={d.id} onClick={() => openDoc(d.id)} className="w-full flex items-center gap-3 rounded-2xl border border-border px-4 py-3 text-left hover:border-primary/40 liquid-transition">
                        <span className="text-xl">{TEMPLATES[d.type as DocType]?.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{d.title} № {d.number}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{new Date(d.createdAt).toLocaleDateString("ru-RU")} · {d.createdByName || ""}</p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${STATUS[d.status]?.[1]}`}>{STATUS[d.status]?.[0]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {view === "new" && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              <div className="space-y-3 lg:col-span-2 min-w-0">
                {projects.length > 0 && (
                  <label className="block text-xs text-muted-foreground">Obyekt (ixtiyoriy — nomi avtomatik to'ladi)
                    <select className={`${input} mt-1`} value={projectId} onChange={e => pickProject(e.target.value)}>
                      <option value="">—</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {tpl.fields.map(f => (
                    <label key={f.key} className={`block text-xs text-muted-foreground ${f.full || f.kind === "textarea" ? "col-span-2" : ""}`}>{f.label}
                      {f.kind === "textarea"
                        ? <textarea rows={3} className={`${input} mt-1 resize-none`} placeholder={f.placeholder} value={draft[f.key] || ""} onChange={e => setDraft({ ...draft, [f.key]: e.target.value })} />
                        : <input type={f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text"} className={`${input} mt-1`} placeholder={f.placeholder} value={draft[f.key] || ""} onChange={e => setDraft({ ...draft, [f.key]: e.target.value })} />}
                    </label>
                  ))}
                </div>
                {tpl.hasRows && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ishlar / materiallar</p>
                    {rows.map((r, i) => (
                      <div key={i} className="grid grid-cols-12 gap-1.5">
                        <input className={`${input} col-span-5`} placeholder="Nomi" value={r.name} onChange={e => setRows(rows.map((x, k) => k === i ? { ...x, name: e.target.value } : x))} />
                        <input className={`${input} col-span-2`} placeholder="O'lchov" value={r.unit} onChange={e => setRows(rows.map((x, k) => k === i ? { ...x, unit: e.target.value } : x))} />
                        <input className={`${input} col-span-2`} placeholder="Miqdor" inputMode="decimal" value={r.qty} onChange={e => setRows(rows.map((x, k) => k === i ? { ...x, qty: e.target.value } : x))} />
                        <input className={`${input} col-span-2`} placeholder="Narx" inputMode="decimal" value={r.price} onChange={e => setRows(rows.map((x, k) => k === i ? { ...x, price: e.target.value } : x))} />
                        <button type="button" onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : rows)} className="col-span-1 rounded-xl hover:bg-muted text-muted-foreground" aria-label="O'chirish">✕</button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => setRows([...rows, { name: "", unit: "", qty: "", price: "" }])} className="text-xs font-semibold text-primary hover:underline">+ Qator qo'shish</button>
                      <span className="text-sm font-bold font-mono">Jami: {money(rowsTotal(rows))}</span>
                    </div>
                  </div>
                )}
                <DocFontPicker value={draft.font} onChange={id => setDraft({ ...draft, font: id })} />
                <button onClick={create} disabled={saving} className="w-full btn btn-primary py-3 rounded-2xl text-sm font-bold disabled:opacity-60">
                  {saving ? "Saqlanmoqda..." : editingId ? "💾 O'zgarishlarni saqlash" : "Hujjatni yaratish"}
                </button>
              </div>
              <div className="min-w-0 lg:col-span-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex gap-1 p-1 rounded-xl bg-muted/60">
                    <button type="button" onClick={() => setPaperTab("edit")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${paperTab === "edit" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>✏️ Hujjatda tahrirlash</button>
                    <button type="button" onClick={() => setPaperTab("preview")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${paperTab === "preview" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>📄 Sahifalar (PDF)</button>
                  </div>
                  {paperTab === "edit" && <span className="text-[11px] text-muted-foreground hidden sm:inline">Istalgan matnga bosib yozing</span>}
                </div>
                {paperTab === "edit"
                  ? <DocPaperEditor doc={{ type: draftType, number: editingId ? (open?.number || "—") : "—", title: tpl.title, data: { ...draft, rows }, signatures: [] }} onText={setText} />
                  : <DocPreview doc={{ type: draftType, number: editingId ? (open?.number || "—") : "—", title: tpl.title, data: { ...draft, rows }, signatures: [] }} />}
              </div>
            </div>
          )}

          {view === "open" && open && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              <div className="lg:col-span-3"><DocPreview doc={open} /></div>
              <div className="lg:col-span-2 space-y-4">
                <span className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS[open.status]?.[1]}`}>{STATUS[open.status]?.[0]}</span>
                {!(open.signatures?.length) && (
                  <button onClick={startEdit} className="w-full rounded-xl border border-primary/30 bg-primary/[0.06] text-primary py-2.5 text-sm font-bold hover:bg-primary/10">✏️ Matn, shrift va maydonlarni tahrirlash</button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => downloadPdf(open)} className="rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-muted">⬇ PDF</button>
                  <button onClick={share} className="rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-muted">🔗 Mijozga havola</button>
                </div>
                {!executorSigned ? (
                  <div className="rounded-2xl border border-border p-4 space-y-3">
                    <p className="font-semibold text-sm">{TEMPLATES[open.type as DocType].sides[0]} sifatida imzolash</p>
                    <input className={input} value={sigName} onChange={e => setSigName(e.target.value)} placeholder="F.I.O." />
                    <SignatureInput onChange={v => { setSigImg(v.image); setSigStamp(v.stamp); setSigDate(v.date); setSigStampPos(v.stampPos); }} />
                    <button onClick={sign} disabled={!sigImg || !sigName.trim() || signing} className="w-full btn btn-primary py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">
                      {signing ? "..." : "✍️ Imzolash"}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">✓ Sizning tomoningiz imzolagan</p>
                )}
                {!open.signatures?.some((s: any) => s.side === "customer") && (
                  <p className="text-xs text-muted-foreground leading-relaxed">Mijoz imzosi uchun "Mijozga havola" ni bosing va havolani yuboring — mijoz tizimga kirmasdan telefonida imzolaydi. Imzolaganda sizga botda xabar keladi.</p>
                )}
                {open.status !== "signed" && (
                  <button onClick={() => remove(open.id)} className="text-xs text-red-500 hover:underline">Hujjatni o'chirish</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Mijoz uchun ochiq imzolash sahifasi (/sign/:token, login'siz) ───────────
export function PublicSignPage({ token }: { token: string }) {
  const [doc, setDoc] = useState<SignDoc | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [img, setImg] = useState<string | null>(null);
  const [stamp, setStamp] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [stampPos, setStampPos] = useState<StampPos>(DEFAULT_STAMP_POS);
  const [busy, setBusy] = useState(false);
  const load = (): Promise<SignDoc | null> => fetch(`${API_BASE}/api/public/sign/${token}`).then(async r => { if (!r.ok) throw new Error(); const d = await r.json(); setDoc(d); return d; }).catch(() => { setErr("Hujjat topilmadi yoki havola eskirgan"); return null; });
  useEffect(() => { load(); }, [token]);
  const submit = async () => {
    if (!img || name.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/public/sign/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), image: img, stamp: stamp || undefined, stampPos: stamp ? stampPos : undefined, date: date || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || "Xatolik"); return; }
      const fresh = await load();
      if (fresh?.status === "signed") sendSignedPdf(fresh, `${API_BASE}/api/public/sign/${token}/pdf`);
    } finally { setBusy(false); }
  };
  const customerSigned = doc?.signatures?.some(s => s.side === "customer");
  return (
    <main className="h-[100dvh] overflow-y-auto overscroll-contain bg-background px-4 py-6" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}>
      <div className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-xl font-bold">{doc ? `${doc.title} № ${doc.number}` : "Hujjat"}</h1>
        {err && <p className="text-sm text-red-500">{err}</p>}
        {doc && <DocPreview doc={doc} />}
        {doc && !customerSigned && (
          <div className="rounded-2xl border border-border p-4 space-y-3 bg-card">
            <p className="font-semibold">{TEMPLATES[doc.type].sides[1]} sifatida imzolash</p>
            <input className="w-full text-sm border border-border rounded-xl px-3 py-2 bg-input-background" placeholder="F.I.O." value={name} onChange={e => setName(e.target.value)} />
            <SignatureInput onChange={v => { setImg(v.image); setStamp(v.stamp); setDate(v.date); setStampPos(v.stampPos); }} />
            <p className="text-[11px] text-muted-foreground">Imzolash orqali hujjat mazmuniga roziligingizni tasdiqlaysiz.</p>
            <button onClick={submit} disabled={!img || name.trim().length < 2 || busy} className="w-full btn btn-primary py-3 rounded-xl font-bold disabled:opacity-50">{busy ? "..." : "✍️ Imzolash"}</button>
          </div>
        )}
        {doc && customerSigned && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
            ✓ Hujjat imzolandi. <button onClick={() => downloadPdf(doc)} className="font-semibold underline">PDF yuklab olish</button>
          </div>
        )}
      </div>
    </main>
  );
}
