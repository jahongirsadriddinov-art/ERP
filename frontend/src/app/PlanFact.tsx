import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { API_BASE } from "./api";

// ─── Plan-fakt (owner 2026-10-19: "asosiysi") ────────────────────────────────────────────────────────────────
// Obyekt bo'yicha: bajarilish, muddat, byudjet va material — reja bilan solishtirish va shu sur'atdagi prognoz.
// Pul ko'rsatkichlarini faqat rahbar ko'radi (backend prorabga yubormaydi).

export interface PlanFact {
  objectId: string; name: string;
  status: "ok" | "risk" | "late" | "over_budget" | "no_plan";
  budget: number | null; spent: number; pendingSpend: number; spentPct: number | null;
  progressPct: number; progressSource: "manual" | "ai_photo" | "materials" | "none";
  materialPct: number | null; timePct: number | null;
  startDate: string | null; endDate: string | null;
  forecastCost: number | null; forecastOverrun: number | null; forecastEnd: string | null; delayDays: number | null;
  materials: { needed: number; sent: number; items: number; behind: Array<{ name: string; unit: string; needed: number; sent: number }> };
  notes: string[];
}

const TONE: Record<PlanFact["status"], { bar: string; chip: string }> = {
  ok: { bar: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  risk: { bar: "bg-amber-500", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  late: { bar: "bg-orange-500", chip: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  over_budget: { bar: "bg-red-500", chip: "bg-red-500/12 text-red-700 dark:text-red-300" },
  no_plan: { bar: "bg-muted-foreground", chip: "bg-muted text-muted-foreground" },
};

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString("uz-UZ").replace(/,/g, " ")} so'm`);

/** Silliq to'ladigan chiziq (owner: "smooth animatsiya"). marker — rejadagi joy (masalan o'tgan vaqt). */
function Bar({ value, tone, marker, label, right }: { value: number | null; tone: string; marker?: number | null; label: string; right: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold font-mono">{right}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
        <motion.div className={`absolute inset-y-0 left-0 rounded-full ${tone}`} initial={{ width: 0 }} animate={{ width: `${v}%` }}
          transition={{ type: "spring", stiffness: 90, damping: 20, mass: 0.8 }} />
        {marker !== null && marker !== undefined && (
          <motion.div className="absolute inset-y-0 w-0.5 bg-foreground/70" initial={{ left: 0, opacity: 0 }}
            animate={{ left: `${Math.max(0, Math.min(100, marker))}%`, opacity: 1 }} transition={{ delay: 0.25, type: "spring", stiffness: 120, damping: 22 }} />
        )}
      </div>
    </div>
  );
}

export function PlanFactCard({ objectId, canEdit }: { objectId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const [pf, setPf] = useState<PlanFact | null>(null);
  const [err, setErr] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ startDate: "", endDate: "", progress: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/objects/${objectId}/plan-fact`);
      if (!r.ok) throw new Error();
      const d: PlanFact = await r.json();
      setPf(d); setErr(false);
      setForm({ startDate: d.startDate || "", endDate: d.endDate || "", progress: d.progressSource === "manual" ? String(d.progressPct) : "" });
    } catch { setErr(true); }
  }, [objectId]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/objects/${objectId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: form.startDate || null, endDate: form.endDate || null, progressManual: form.progress === "" ? null : Number(form.progress) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d?.error || t("common.error")); return; }
      toast.success(t("planFact.saved"));
      setEditing(false);
      void load();
    } finally { setSaving(false); }
  };

  if (err) return <p className="text-sm text-muted-foreground text-center py-10">{t("planFact.loadError")}</p>;
  if (!pf) return <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-xl bg-muted/50 animate-pulse" />)}</div>;
  const tone = TONE[pf.status];
  return (
    <motion.div className="p-4 space-y-4 max-w-3xl w-full mx-auto overflow-y-auto" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${tone.chip}`}>{t(`planFact.status.${pf.status}`)}</span>
        {canEdit && (
          <button type="button" onClick={() => setEditing((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
            {editing ? t("common.cancel") : t("planFact.editPlan")}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div key="edit" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="surface rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs text-muted-foreground">{t("planFact.startDate")}
                <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground" />
              </label>
              <label className="text-xs text-muted-foreground">{t("planFact.endDate")}
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground" />
              </label>
              <label className="text-xs text-muted-foreground">{t("planFact.manualProgress")}
                <input type="number" min={0} max={100} value={form.progress} placeholder={t("planFact.auto")} onChange={(e) => setForm({ ...form, progress: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground" />
              </label>
              <div className="sm:col-span-3 flex justify-end">
                <button type="button" disabled={saving} onClick={save} className="btn btn-primary h-10 px-5 rounded-xl text-sm font-semibold disabled:opacity-60">{t("common.save")}</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="surface rounded-2xl p-4 space-y-4">
        <Bar value={pf.progressPct} tone={tone.bar} marker={pf.timePct} label={`${t("planFact.progress")} · ${t(`planFact.source.${pf.progressSource}`)}`}
          right={`${pf.progressPct}%${pf.timePct !== null ? ` / ${t("planFact.time")} ${pf.timePct}%` : ""}`} />
        {pf.spentPct !== null && (
          <Bar value={pf.spentPct} tone={pf.spentPct > pf.progressPct + 10 ? "bg-red-500" : "bg-primary"} marker={pf.progressPct}
            label={t("planFact.budget")} right={`${money(pf.spent)} / ${money(pf.budget)}`} />
        )}
        {pf.materialPct !== null && (
          <Bar value={pf.materialPct} tone="bg-sky-500" label={t("planFact.materials")} right={`${pf.materialPct}%`} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {pf.forecastEnd && (
          <div className="surface rounded-2xl p-3">
            <p className="text-[11px] text-muted-foreground">{t("planFact.forecastEnd")}</p>
            <p className="text-sm font-bold font-mono">{pf.forecastEnd}</p>
            {pf.delayDays !== null && <p className={`text-[11px] ${pf.delayDays > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"}`}>
              {pf.delayDays > 0 ? t("planFact.lateBy", { days: pf.delayDays }) : t("planFact.earlyBy", { days: Math.abs(pf.delayDays) })}</p>}
          </div>
        )}
        {pf.forecastCost !== null && pf.budget !== null && (
          <div className="surface rounded-2xl p-3">
            <p className="text-[11px] text-muted-foreground">{t("planFact.forecastCost")}</p>
            <p className="text-sm font-bold font-mono">{money(pf.forecastCost)}</p>
            {pf.forecastOverrun !== null && <p className={`text-[11px] ${pf.forecastOverrun > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"}`}>
              {pf.forecastOverrun > 0 ? t("planFact.overBy", { sum: money(pf.forecastOverrun) }) : t("planFact.underBy", { sum: money(-pf.forecastOverrun) })}</p>}
          </div>
        )}
        {pf.pendingSpend > 0 && (
          <div className="surface rounded-2xl p-3">
            <p className="text-[11px] text-muted-foreground">{t("planFact.pendingSpend")}</p>
            <p className="text-sm font-bold font-mono">{money(pf.pendingSpend)}</p>
          </div>
        )}
      </div>

      {pf.notes.length > 0 && (
        <ul className="space-y-1.5">
          {pf.notes.map((n, i) => (
            <motion.li key={n} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}
              className="text-xs rounded-xl px-3 py-2 bg-amber-500/10 text-amber-800 dark:text-amber-200">⚠️ {n}</motion.li>
          ))}
        </ul>
      )}

      {pf.materials.behind.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2">{t("planFact.behindMaterials")}</p>
          <div className="space-y-2">
            {pf.materials.behind.map((m) => (
              <Bar key={m.name} value={m.needed ? (m.sent / m.needed) * 100 : 0} tone="bg-orange-500" label={m.name}
                right={`${Math.round(m.sent)} / ${Math.round(m.needed)} ${m.unit}`} />
            ))}
          </div>
        </div>
      )}
      {pf.status === "no_plan" && <p className="text-xs text-muted-foreground">{t("planFact.noPlanHint")}</p>}
    </motion.div>
  );
}

/** Rahbar/prorab bosh sahifasi: barcha faol obyektlar holati — eng xavflilari tepada. */
export function PlanFactOverview({ onOpen }: { onOpen?: (objectId: string) => void }) {
  const { t } = useTranslation();
  const [list, setList] = useState<PlanFact[] | null>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/objects/plan-fact`).then((r) => (r.ok ? r.json() : [])).then((d) => setList(Array.isArray(d) ? d : [])).catch(() => setList([]));
  }, []);
  if (!list || !list.length) return null;
  const rank: Record<PlanFact["status"], number> = { over_budget: 0, late: 1, risk: 2, ok: 3, no_plan: 4 };
  const sorted = [...list].sort((a, b) => rank[a.status] - rank[b.status]);
  return (
    <section className="surface rounded-2xl p-4" data-testid="plan-fact-overview">
      <p className="text-sm font-bold mb-3">{t("planFact.overviewTitle")}</p>
      <div className="space-y-3">
        {sorted.slice(0, 8).map((p, i) => (
          <motion.button type="button" key={p.objectId} onClick={() => onOpen?.(p.objectId)}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i, duration: 0.22 }}
            className="w-full text-left rounded-xl p-2 -m-2 hover:bg-muted/40 liquid-transition">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-sm font-semibold truncate">{p.name}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${TONE[p.status].chip}`}>{t(`planFact.status.${p.status}`)}</span>
            </div>
            <Bar value={p.progressPct} tone={TONE[p.status].bar} marker={p.timePct} label={p.notes[0] || t("planFact.progress")} right={`${p.progressPct}%`} />
          </motion.button>
        ))}
      </div>
    </section>
  );
}
