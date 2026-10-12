import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../api";

// "O'zim tanlayman" tarifi: muddat (1/3/12 oy) + kerakli funksiyalar → narx (yakuniy summani server hisoblaydi).
type Pricing = { months: number[]; baseMonthly: number; discounts: Record<string, number>; features: { key: string; label: string; monthly: number }[] };

const FEATURE_LABELS: Record<string, [string, string]> = {
  ai_assistant: ["AI yordamchi", "ИИ-помощник"], gps_tracking: ["GPS kuzatuv", "GPS-трекинг"], reports: ["Hisobotlar va grafiklar", "Отчёты и графики"],
  backup: ["Zaxira nusxa (backup)", "Резервная копия"], audit_log: ["Audit jurnali", "Журнал аудита"], multi_currency: ["Valyuta (USD/EUR)", "Валюты (USD/EUR)"],
  qr_tools: ["QR skaner/generator", "QR-сканер/генератор"], income: ["Kirimlar hisobi va foyda/zarar", "Учёт доходов и прибыль/убыток"],
};

export default function CustomPlanBuilder({ busy, onPay, initial }: { busy?: boolean; onPay: (months: number, features: string[]) => void; initial?: string[] }) {
  const { t, i18n } = useTranslation();
  const ru = i18n.language?.startsWith("ru");
  const [p, setP] = useState<Pricing | null>(null);
  const [months, setMonths] = useState(3);
  const [sel, setSel] = useState<string[]>(initial?.length ? initial : ["reports", "gps_tracking"]);
  useEffect(() => { fetch(`${API_BASE}/api/plans/custom`).then(r => r.ok ? r.json() : null).then(setP).catch(() => {}); }, []);

  const price = useMemo(() => {
    if (!p) return null;
    const monthly = p.baseMonthly + sel.reduce((a, k) => a + (p.features.find(f => f.key === k)?.monthly || 0), 0);
    const disc = p.discounts[String(months)] || 0;
    return { monthly, total: Math.round((monthly * months * (1 - disc)) / 1000) * 1000, disc };
  }, [p, sel, months]);

  if (!p) return <div className="h-40 rounded-2xl bg-muted/40 animate-pulse" />;
  const som = t("common.som", "so'm");
  const toggle = (k: string) => setSel(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k]);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1.5">{t("plan.period", "Muddat")}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {p.months.map(m => (
            <button key={m} type="button" onClick={() => setMonths(m)}
              className={`h-12 rounded-xl border-2 text-sm font-bold liquid-transition ${months === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}>
              {m} {t("plan.months", "oy")}
              {(p.discounts[String(m)] || 0) > 0 && <span className="block text-[10px] font-semibold text-emerald-600">−{Math.round(p.discounts[String(m)] * 100)}%</span>}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1.5">{t("plan.features", "Funksiyalar")}</p>
        <div className="rounded-xl border border-border divide-y divide-border">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-muted/30">
            <span className="text-sm font-semibold min-w-0">{t("plan.base", "Asosiy tizim: obyektlar, xodimlar, chiqimlar, chat, bot")}</span>
            <span className="text-xs font-bold whitespace-nowrap">{p.baseMonthly.toLocaleString()} {som}/{t("plan.mo", "oy")}</span>
          </div>
          {p.features.map(f => {
            const on = sel.includes(f.key);
            const label = FEATURE_LABELS[f.key]?.[ru ? 1 : 0] || f.label;
            return (
              <label key={f.key} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/30">
                <input type="checkbox" checked={on} onChange={() => toggle(f.key)} className="w-4 h-4 accent-[var(--primary)] flex-shrink-0" />
                <span className="text-sm flex-1 min-w-0">{label}</span>
                <span className={`text-xs font-bold whitespace-nowrap ${on ? "text-primary" : "text-muted-foreground"}`}>+{f.monthly.toLocaleString()} {som}</span>
              </label>
            );
          })}
        </div>
      </div>
      {price && (
        <div className="rounded-2xl border-2 border-primary/30 bg-primary/[0.05] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">{price.monthly.toLocaleString()} {som} × {months} {t("plan.months", "oy")}{price.disc > 0 ? ` − ${Math.round(price.disc * 100)}%` : ""}</p>
            <p className="text-2xl font-extrabold tabular-nums">{price.total.toLocaleString()} <span className="text-sm font-bold">{som}</span></p>
          </div>
          <button type="button" disabled={busy} onClick={() => onPay(months, sel)}
            className="h-12 px-6 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 disabled:opacity-60 liquid-transition">
            {busy ? "..." : t("plan.payCustom", "Shu tarifni to'lash")}
          </button>
        </div>
      )}
    </div>
  );
}
