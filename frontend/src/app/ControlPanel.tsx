import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { toast } from "sonner";
import { API_BASE } from "./api";

// ─── Nazorat paneli (owner 2026-10-19) ────────────────────────────────────────────────────────────────────────
// Material o'g'irligi belgilari, narx o'zgarishlari, tugayotgan hujjatlar, servis kerak bo'lgan texnika va firma
// funksiyalarini yoqish/o'chirish. Ogohlantirishlar o'zi ham keladi (xabar; jiddiysi o'qilmasa — AI qo'ng'iroq).

type Theft = { kind: "over_smeta" | "unconfirmed" | "spike"; objectName: string; text: string; severity: "warning" | "critical" };
type Price = { material: string; unit: string; lastPrice: number; recentAvg: number; prevAvg: number | null; changePct: number | null; samples: number; lastDate: string };
type Doc = { id: string; title: string; expiresAt: string; stage: "expired" | "d1" | "d7" | "d30" | null; days: number };
type Eq = { id: string; name: string; nextServiceDate: string | null; daysToService: number | null; hoursToService: number | null };
type Summary = { theft: Theft[]; prices: Price[]; docs: Doc[]; equipment: Eq[] };

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("ru-RU"));

function Section({ title, count, children, delay = 0 }: { title: string; count?: number; children: React.ReactNode; delay?: number }) {
  return (
    <motion.section className="surface rounded-2xl p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.25 }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold">{title}</h3>
        {count !== undefined && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{count}</span>}
      </div>
      {children}
    </motion.section>
  );
}

export default function ControlPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/api/insights/summary`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setErr(true));
  }, []);

  if (err) return <p className="text-sm text-muted-foreground text-center py-10">{t("control.loadError")}</p>;
  if (!data) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-muted/50 animate-pulse" />)}</div>;
  const empty = (k: string) => <p className="text-xs text-muted-foreground">{t(k)}</p>;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pb-6">
      <Section title={t("control.theftTitle")} count={data.theft.length}>
        {data.theft.length === 0 ? empty("control.theftNone") : (
          <ul className="space-y-2">
            {data.theft.map((x, i) => (
              <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }}
                className={`text-xs rounded-xl px-3 py-2 ${x.severity === "critical" ? "bg-red-500/10 text-red-800 dark:text-red-200" : "bg-amber-500/10 text-amber-800 dark:text-amber-200"}`}>
                <b>{x.objectName}</b> · {t(`control.kind.${x.kind}`)}<br />{x.text}
              </motion.li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("control.pricesTitle")} count={data.prices.length} delay={0.05}>
        {data.prices.length === 0 ? empty("control.pricesNone") : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground text-left">
                <th className="py-1 px-1 font-medium">{t("control.material")}</th>
                <th className="py-1 px-1 font-medium text-right">{t("control.lastPrice")}</th>
                <th className="py-1 px-1 font-medium text-right">{t("control.change")}</th>
              </tr></thead>
              <tbody>
                {data.prices.map((p) => (
                  <tr key={p.material} className="border-t border-border/50">
                    <td className="py-1.5 px-1">{p.material}<span className="text-muted-foreground"> / {p.unit}</span></td>
                    <td className="py-1.5 px-1 text-right font-mono">{money(p.lastPrice)}</td>
                    <td className={`py-1.5 px-1 text-right font-mono font-semibold ${p.changePct === null ? "text-muted-foreground" : p.changePct > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"}`}>
                      {p.changePct === null ? "—" : `${p.changePct > 0 ? "+" : ""}${p.changePct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t("control.docsTitle")} count={data.docs.length} delay={0.1}>
        {data.docs.length === 0 ? empty("control.docsNone") : (
          <ul className="space-y-1.5">
            {data.docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{d.title}</span>
                <span className={`flex-shrink-0 font-semibold ${d.stage === "expired" ? "text-red-600 dark:text-red-400" : d.stage === "d1" || d.stage === "d7" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
                  {d.stage === "expired" ? t("control.expired") : t("control.daysLeft", { days: d.days })} · {String(d.expiresAt).slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("control.equipmentTitle")} count={data.equipment.length} delay={0.15}>
        {data.equipment.length === 0 ? empty("control.equipmentNone") : (
          <ul className="space-y-1.5">
            {data.equipment.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{e.name}</span>
                <span className="flex-shrink-0 text-amber-700 dark:text-amber-300 font-semibold">
                  {e.daysToService !== null ? (e.daysToService < 0 ? t("control.serviceOverdue") : t("control.serviceInDays", { days: e.daysToService })) : t("control.serviceInHours", { hours: Math.max(0, Math.round(e.hoursToService || 0)) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="lg:col-span-2"><FeatureToggles /></div>
    </div>
  );
}

/** Firma funksiyalari — rahbar yoqadi/o'chiradi (ishbay hisob standart o'chiq). */
export function FeatureToggles() {
  const { t } = useTranslation();
  const [f, setF] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/company/features`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setF(d)).catch(() => {});
  }, []);
  const toggle = async (k: string) => {
    if (!f) return;
    const next = { ...f, [k]: !f[k] };
    setF(next);
    const r = await fetch(`${API_BASE}/api/company/features`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [k]: next[k] }) }).catch(() => null);
    if (!r || !r.ok) { setF(f); toast.error(t("common.error")); return; }
    try { window.dispatchEvent(new CustomEvent("erp:features", { detail: next })); } catch { /* */ }
  };
  if (!f) return null;
  const KEYS = ["briefing", "theft", "prices", "docs", "equipment", "photoAi", "piecework"];
  return (
    <Section title={t("control.featuresTitle")} delay={0.2}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {KEYS.map((k) => (
          <button key={k} type="button" role="switch" aria-checked={!!f[k]} onClick={() => toggle(k)}
            className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-muted/40 liquid-transition">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t(`control.features.${k}`)}</span>
              <span className="block text-[11px] text-muted-foreground">{t(`control.featuresHint.${k}`)}</span>
            </span>
            <span className={`relative w-10 h-6 rounded-full flex-shrink-0 transition-colors ${f[k] ? "bg-primary" : "bg-muted"}`}>
              <motion.span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow" animate={{ left: f[k] ? 18 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 32 }} />
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
}
