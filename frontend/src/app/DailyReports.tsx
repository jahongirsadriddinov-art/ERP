import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { API_BASE } from "./api";

// ─── Kunlik hisobotlar (owner 2026-10-19: "ovozli hisobot") ────────────────────────────────────────────────
// Botda ovoz bilan yuborilgan yoki shu yerda yozilgan hisobotlar; AI tartibga soladi, saqlashdan oldin ko'rsatiladi.
type Report = { id?: string; date?: string; userName?: string; objectName?: string; summary: string; workDone: string[]; materialsUsed: Array<{ name: string; qty: number; unit: string }>; workersCount?: number; issues: Array<{ text: string; severity: string }>; source?: string };

function ReportCard({ r }: { r: Report }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 text-xs">
      <p className="text-sm">{r.summary}</p>
      {r.workDone.length > 0 && <p className="text-muted-foreground">🔨 {r.workDone.join("; ")}</p>}
      {r.materialsUsed.length > 0 && <p className="text-muted-foreground">📦 {r.materialsUsed.map((m) => `${m.name} ${m.qty} ${m.unit}`).join(", ")}</p>}
      {r.workersCount !== undefined && r.workersCount !== null && <p className="text-muted-foreground">👷 {t("reportsX.workers")}: {r.workersCount}</p>}
      {r.issues.map((i, k) => <p key={k} className={i.severity === "low" ? "text-amber-700 dark:text-amber-300" : "text-red-600 dark:text-red-400"}>⚠️ {i.text}</p>)}
    </div>
  );
}

export function DailyReports({ objectId, canWrite }: { objectId: string; canWrite: boolean }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Report[] | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetch(`${API_BASE}/api/daily-reports?objectId=${objectId}`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => setItems([]));
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [objectId]);

  const parse = async () => {
    setBusy(true);
    const r = await fetch(`${API_BASE}/api/daily-reports/parse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).catch(() => null);
    setBusy(false);
    const d = await r?.json().catch(() => null);
    if (r?.ok) setDraft(d); else toast.error(d?.error || t("common.error"));
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const r = await fetch(`${API_BASE}/api/daily-reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objectId, report: draft }) }).catch(() => null);
    setBusy(false);
    if (r && (r.ok || r.status === 202)) { toast.success(t("reportsX.saved")); setDraft(null); setText(""); void load(); }
    else toast.error((await r?.json().catch(() => null))?.error || t("common.error"));
  };

  return (
    <section className="max-w-3xl w-full mx-auto px-4 pb-6 space-y-3">
      <h3 className="text-sm font-bold">{t("reportsX.title")}</h3>
      {canWrite && (
        <div className="surface rounded-2xl p-3 space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 3000))} rows={3} placeholder={t("reportsX.placeholder")}
            className="w-full text-sm rounded-xl border border-border bg-background/60 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">{t("reportsX.botHint")}</p>
            <button type="button" onClick={parse} disabled={busy || text.trim().length < 5} className="btn btn-primary text-xs px-4 py-2 rounded-xl flex-shrink-0 disabled:opacity-50">{t("reportsX.analyze")}</button>
          </div>
          <AnimatePresence initial={false}>
            {draft && (
              <motion.div key="d" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="rounded-xl bg-primary/[0.06] p-3 space-y-2">
                  <ReportCard r={draft} />
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setDraft(null)} className="text-xs px-3 py-1.5 rounded-lg border border-border">{t("common.cancel")}</button>
                    <button type="button" onClick={save} disabled={busy} className="btn btn-primary text-xs px-4 py-1.5 rounded-lg disabled:opacity-50">{t("common.save")}</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      {items === null ? <div className="h-16 rounded-2xl bg-muted/50 animate-pulse" /> : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("reportsX.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r, i) => (
            <motion.li key={r.id || i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(0.3, 0.03 * i) }} className="surface rounded-xl p-3">
              <p className="text-[11px] text-muted-foreground mb-1">{r.date} · {r.userName}{r.source === "bot" ? " · Telegram" : ""}</p>
              <ReportCard r={r} />
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
