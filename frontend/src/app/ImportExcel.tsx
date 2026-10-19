import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { API_BASE } from "./api";
import { saveOrShareBlob } from "./platform";

// ─── Excel'dan import (owner 2026-10-19) ─────────────────────────────────────────────────────────────────────
// Xodimlar / obyektlar / materiallar: shablon → fayl → ko'rib chiqish (xatolar qatorma-qator) → saqlash.
type Kind = "employees" | "objects" | "materials";
type Preview = { valid: number; errors: Array<{ row: number; error: string }>; preview?: any[] };

export default function ImportExcel() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>("employees");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const template = async () => {
    const r = await fetch(`${API_BASE}/api/import/template/${kind}`).catch(() => null);
    if (!r?.ok) { toast.error(t("common.error")); return; }
    await saveOrShareBlob(`import-${kind}.xlsx`, await r.blob());
  };
  const send = async (commit: boolean, f = file) => {
    if (!f) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", f, f.name);
    const r = await fetch(`${API_BASE}/api/import/${kind}${commit ? "?commit=1" : ""}`, { method: "POST", body: fd }).catch(() => null);
    setBusy(false);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) { toast.error(d?.error || t("common.error")); return; }
    if (commit) {
      toast.success(t("importX.done", { count: d.created }));
      setPreview({ valid: 0, errors: d.errors || [] });
      setFile(null);
      try { window.dispatchEvent(new CustomEvent("erp:data-imported", { detail: { kind } })); } catch { /* */ }
    } else setPreview(d);
  };

  return (
    <motion.section className="surface rounded-2xl p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.25 }}>
      <h3 className="text-sm font-bold mb-1">{t("importX.title")}</h3>
      <p className="text-[11px] text-muted-foreground mb-3">{t("importX.hint")}</p>
      <div className="relative flex p-0.5 rounded-full bg-muted/60 mb-3 w-fit" role="tablist">
        {(["employees", "objects", "materials"] as Kind[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setPreview(null); setFile(null); }}
            className={`relative z-10 text-xs font-semibold px-3 py-1.5 rounded-full ${kind === k ? "text-white" : "text-muted-foreground"}`}>
            {kind === k && <motion.span layoutId="importKindPill" className="absolute inset-0 -z-10 rounded-full bg-primary" transition={{ type: "spring", stiffness: 480, damping: 34 }} />}
            {t(`importX.kind.${k}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={template} className="btn btn-outline text-xs px-3 py-2 rounded-xl">{t("importX.template")}</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ""; setFile(f); setPreview(null); if (f) void send(false, f); }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-primary text-xs px-3 py-2 rounded-xl disabled:opacity-60">
          {file ? file.name.slice(0, 28) : t("importX.choose")}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {preview && (
          <motion.div key="p" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 space-y-2">
              {file && <p className="text-xs"><b className="text-emerald-700 dark:text-emerald-300">{t("importX.validRows", { count: preview.valid })}</b>{preview.errors.length ? ` · ${t("importX.errorRows", { count: preview.errors.length })}` : ""}</p>}
              {preview.errors.length > 0 && (
                <ul className="max-h-40 overflow-y-auto text-[11px] space-y-0.5 rounded-xl bg-red-500/[0.06] p-2">
                  {preview.errors.map((e, i) => <li key={i} className="text-red-700 dark:text-red-300">{t("importX.row", { row: e.row })}: {e.error}</li>)}
                </ul>
              )}
              {file && preview.valid > 0 && (
                <button type="button" onClick={() => send(true)} disabled={busy} className="btn btn-primary w-full py-2 text-sm rounded-xl disabled:opacity-60">
                  {t("importX.confirm", { count: preview.valid })}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
