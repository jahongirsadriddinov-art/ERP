import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { API_BASE } from "./api";
import { saveOrShareBlob } from "./platform";
import { canvasesToPdf } from "./lib/pdf";
import { TEMPLATES, DocType, SignDoc, Row, renderDoc, rowsTotal, money, docTextBlocks, TextBlock } from "./docTemplates";
import { FONTS, fontById, ensureFont } from "./lib/fonts";

// ─── Imzo maydoni (barmoq / sichqoncha / stilus) ─────────────────────────────
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const empty = useRef(true);
  useEffect(() => {
    const c = ref.current!; const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
    const ctx = c.getContext("2d")!; ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0b3d91";
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true;
    const [x, y] = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.beginPath(); ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const [x, y] = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.lineTo(x, y); ctx.stroke(); empty.current = false;
  };
  const up = () => { if (!drawing.current) return; drawing.current = false; onChange(empty.current ? null : ref.current!.toDataURL("image/png")); };
  const clear = () => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); empty.current = true; onChange(null); };
  return (
    <div className="space-y-1.5">
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className="w-full h-40 rounded-xl border-2 border-dashed border-border bg-white touch-none cursor-crosshair" />
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>Barmoq yoki sichqoncha bilan imzo chizing</span>
        <button type="button" onClick={clear} className="font-semibold text-primary hover:underline">Tozalash</button>
      </div>
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

// Imzo: chizish YOKI tayyor imzo rasmini yuklash; ixtiyoriy — pechat (muhr) rasmi.
export function SignatureInput({ onChange }: { onChange: (v: { image: string | null; stamp: string | null }) => void }) {
  const [mode, setMode] = useState<"draw" | "upload">("draw");
  const [drawn, setDrawn] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [stamp, setStamp] = useState<string | null>(null);
  const sigRef = useRef<HTMLInputElement>(null);
  const stampRef = useRef<HTMLInputElement>(null);
  const image = mode === "draw" ? drawn : uploaded;
  useEffect(() => { onChange({ image, stamp }); /* eslint-disable-next-line */ }, [image, stamp]);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>, kind: "sig" | "stamp") => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Faqat rasm (PNG/JPG) yuklang"); return; }
    try {
      const png = await fileToPng(file, kind === "sig" ? 700 : 420, true);
      if (kind === "sig") setUploaded(png); else setStamp(png);
    } catch { toast.error("Rasm juda katta yoki o'qilmadi"); }
  };
  const tab = (m: "draw" | "upload", label: string) => (
    <button type="button" onClick={() => setMode(m)}
      className={`flex-1 py-2 rounded-lg text-xs font-bold liquid-transition ${mode === m ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
  );
  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 rounded-xl bg-muted/60">{tab("draw", "✍️ Chizish")}{tab("upload", "🖼️ Imzo rasmini yuklash")}</div>
      {mode === "draw" ? <SignaturePad onChange={setDrawn} /> : (
        <div>
          <input ref={sigRef} type="file" accept="image/*" className="hidden" onChange={e => pick(e, "sig")} />
          <button type="button" onClick={() => sigRef.current?.click()}
            className="w-full h-40 rounded-xl border-2 border-dashed border-border bg-white flex items-center justify-center overflow-hidden hover:border-primary/50 liquid-transition">
            {uploaded ? <img src={uploaded} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-500 px-6 text-center">Oq qog'ozdagi imzo suratini tanlang — fon avtomatik olib tashlanadi</span>}
          </button>
          {uploaded && <button type="button" onClick={() => setUploaded(null)} className="mt-1 text-[11px] font-semibold text-primary hover:underline">Boshqa rasm</button>}
        </div>
      )}
      <div className="flex items-center gap-3 rounded-xl border border-border p-2.5">
        <div className="w-16 h-16 rounded-lg bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
          {stamp ? <img src={stamp} alt="" className="max-w-full max-h-full object-contain" /> : <span className="text-2xl opacity-40">🔵</span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">Pechat (muhr) — ixtiyoriy</p>
          <p className="text-[11px] text-muted-foreground">Muhr suratini yuklang, imzo yoniga qo'yiladi</p>
          <div className="flex gap-3 mt-1">
            <input ref={stampRef} type="file" accept="image/*" className="hidden" onChange={e => pick(e, "stamp")} />
            <button type="button" onClick={() => stampRef.current?.click()} className="text-[11px] font-bold text-primary hover:underline">{stamp ? "Almashtirish" : "Yuklash"}</button>
            {stamp && <button type="button" onClick={() => setStamp(null)} className="text-[11px] font-bold text-red-500 hover:underline">Olib tashlash</button>}
          </div>
        </div>
      </div>
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

// Hujjatdagi BARCHA matnni qo'lda tahrirlash — har bir blok alohida; o'zgartirilgani "↺" bilan asliga qaytadi
function DocTextEditor({ doc, texts, onChange }: { doc: SignDoc; texts: Record<string, string>; onChange: (t: Record<string, string>) => void }) {
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [open, setOpen] = useState(false);
  const key = JSON.stringify({ ...doc, data: { ...doc.data, texts: undefined } });
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const tmr = setTimeout(() => { docTextBlocks({ ...doc, data: { ...doc.data, texts: {} } }).then(b => { if (alive) setBlocks(b); }).catch(() => {}); }, 250);
    return () => { alive = false; clearTimeout(tmr); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);
  const edited = Object.keys(texts).length;
  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 liquid-transition">
        <span>
          <span className="block text-sm font-bold">✏️ Hujjat matnini tahrirlash</span>
          <span className="block text-[11px] text-muted-foreground">Sarlavha, bandlar, tomonlar — hammasini o'zingiz yozing{edited ? ` · ${edited} ta o'zgartirilgan` : ""}</span>
        </span>
        <span className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="p-3 pt-0 space-y-2.5">
          {blocks.length === 0 && <div className="h-20 rounded-xl bg-muted/40 animate-pulse" />}
          {blocks.map(b => {
            const val = typeof texts[b.id] === "string" ? texts[b.id] : b.def;
            const changed = typeof texts[b.id] === "string";
            return (
              <label key={b.id} className="block">
                <span className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-1">
                  <span className={changed ? "text-primary" : ""}>{b.label}{changed ? " •" : ""}</span>
                  {changed && <button type="button" onClick={() => { const n = { ...texts }; delete n[b.id]; onChange(n); }} className="text-primary hover:underline">↺ Asliga qaytarish</button>}
                </span>
                <textarea value={val} rows={Math.min(8, Math.max(1, Math.ceil(val.length / 60) + (val.match(/\n/g)?.length || 0)))}
                  onChange={e => { const v = e.target.value; const n = { ...texts }; if (v === b.def) delete n[b.id]; else n[b.id] = v; onChange(n); }}
                  className="w-full text-sm border border-border rounded-xl px-3 py-2 bg-input-background resize-y focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </label>
            );
          })}
        </div>
      )}
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

async function downloadPdf(doc: SignDoc) {
  const pages = await renderDoc(doc);
  const saved = await saveOrShareBlob(`${doc.number}.pdf`, canvasesToPdf(pages));
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
  const [editingId, setEditingId] = useState<string | null>(null);
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
      const r = await fetch(`${API_BASE}/api/sign-docs/${open.id}/sign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: sigName.trim(), image: sigImg, stamp: sigStamp || undefined }) });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || "Xatolik"); return; }
      toast.success("Imzolandi"); setOpen({ ...open, ...d, id: open.id }); setSigImg(null); setSigStamp(null); load();
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
    <div className="fixed inset-0 z-[120] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-3">
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
                <DocTextEditor doc={{ type: draftType, number: editingId ? (open?.number || "—") : "—", title: tpl.title, data: { ...draft, rows }, signatures: [] }}
                  texts={draft.texts || {}} onChange={texts => setDraft({ ...draft, texts })} />
                <button onClick={create} disabled={saving} className="w-full btn btn-primary py-3 rounded-2xl text-sm font-bold disabled:opacity-60">
                  {saving ? "Saqlanmoqda..." : editingId ? "💾 O'zgarishlarni saqlash" : "Hujjatni yaratish"}
                </button>
              </div>
              <div className="hidden lg:block">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Ko'rinishi</p>
                <DocPreview doc={{ type: draftType, number: editingId ? (open?.number || "—") : "—", title: tpl.title, data: { ...draft, rows }, signatures: [] }} />
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
                    <SignatureInput onChange={v => { setSigImg(v.image); setSigStamp(v.stamp); }} />
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
  const [busy, setBusy] = useState(false);
  const load = () => fetch(`${API_BASE}/api/public/sign/${token}`).then(async r => { if (!r.ok) throw new Error(); setDoc(await r.json()); }).catch(() => setErr("Hujjat topilmadi yoki havola eskirgan"));
  useEffect(() => { load(); }, [token]);
  const submit = async () => {
    if (!img || name.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/public/sign/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), image: img, stamp: stamp || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || "Xatolik"); return; }
      await load();
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
            <SignatureInput onChange={v => { setImg(v.image); setStamp(v.stamp); }} />
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
