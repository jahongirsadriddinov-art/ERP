import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../api";

// "O'zim tanlayman" tarifi (owner 2026-10-22): FAQAT ro'yxatdan o'tishda tanlanadi. Bazaviy funksiyalar har tarifda bor
// (tanlanmaydi), bu yerda faqat QO'SHIMCHALAR belgilanadi. Narxni server hisoblaydi (config/customPlan.ts) — bu ko'rinish.
type Pricing = {
  months: number[]; baseMonthly: number; discounts: Record<string, number>;
  base?: { key: string; label: string }[]; features: { key: string; label: string; monthly: number }[];
};

const FEATURE_LABELS: Record<string, [string, string, string?]> = {
  ai_assistant: ["AI yordamchi", "ИИ-помощник", "Ovozli va matnli yordamchi, qo'ng'iroqlar, eslatmalar"],
  gps_tracking: ["GPS kuzatuv", "GPS-трекинг"], reports: ["Hisobotlar va grafiklar", "Отчёты и графики"],
  backup: ["Zaxira nusxa (backup)", "Резервная копия", "Ma'lumotlar har kuni alohida saqlanadi"],
  audit_log: ["Audit jurnali", "Журнал аудита", "Kim, qachon, nimani o'zgartirgani"],
  multi_currency: ["Valyuta (USD/EUR)", "Валюты (USD/EUR)", "Dollar/yevroda chiqim va kurs"],
  qr_tools: ["QR skaner/generator", "QR-сканер/генератор"],
};

export interface CustomPick { months: number; features: string[]; total: number; days: number }

export default function CustomPlanBuilder({ busy, onPay, initial, actionLabel }: {
  busy?: boolean; onPay: (months: number, features: string[], pick: CustomPick) => void; initial?: string[]; actionLabel?: string;
}) {
  const { t, i18n } = useTranslation();
  const ru = i18n.language?.startsWith("ru");
  const [p, setP] = useState<Pricing | null>(null);
  const [months, setMonths] = useState(3);
  const [sel, setSel] = useState<string[]>(initial?.length ? initial : []);
  useEffect(() => { fetch(`${API_BASE}/api/plans/custom`).then(r => r.ok ? r.json() : null).then(setP).catch(() => {}); }, []);

  const price = useMemo(() => {
    if (!p) return null;
    const chosen = sel.filter(k => p.features.some(f => f.key === k));
    const monthly = p.baseMonthly + chosen.reduce((a, k) => a + (p.features.find(f => f.key === k)?.monthly || 0), 0);
    const disc = p.discounts[String(months)] || 0;
    return { monthly, total: Math.round((monthly * months * (1 - disc)) / 1000) * 1000, disc, chosen };
  }, [p, sel, months]);

  if (!p) return <div className="h-40 rounded-2xl bg-muted/40 animate-pulse" />;
  const som = t("common.som", "so'm");
  const toggle = (k: string) => setSel(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k]);
  const label = (k: string, fallback: string) => FEATURE_LABELS[k]?.[ru ? 1 : 0] || fallback;

  return (
    <div className="space-y-4" data-testid="custom-plan">
      <div>
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-2">{t("plan.period", "Muddat")}</p>
        <div className="grid grid-cols-3 gap-2">
          {p.months.map(m => (
            <button key={m} type="button" onClick={() => setMonths(m)}
              className={`h-14 rounded-2xl border-2 text-sm font-bold liquid-transition ${months === m ? "border-primary bg-primary/10 text-primary shadow-sm shadow-primary/20" : "border-border hover:border-primary/40"}`}>
              {m} {t("plan.months", "oy")}
              {(p.discounts[String(m)] || 0) > 0 && <span className="block text-[11px] font-semibold text-emerald-600">−{Math.round(p.discounts[String(m)] * 100)}%</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-4 text-white shadow-lg shadow-primary/20" style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold">{t("plan.baseIncluded", "Har tarifda bor (asosiy)")}</p>
          <p className="text-sm font-extrabold whitespace-nowrap tabular-nums">{p.baseMonthly.toLocaleString()} {som}/{t("plan.mo", "oy")}</p>
        </div>
        <p className="text-xs text-white/80 mt-1">{t("plan.baseList", "Obyektlar, xodimlar, chiqim va kirimlar, chat, Telegram bot")}{p.base?.length ? `, ${p.base.map(b => label(b.key, b.label)).join(", ")}` : ""}</p>
      </div>

      <div>
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-2">{t("plan.addons", "Qo'shimcha funksiyalar")}</p>
        <div className="space-y-2">
          {p.features.map(f => {
            const on = sel.includes(f.key);
            const hint = FEATURE_LABELS[f.key]?.[2];
            return (
              <button key={f.key} type="button" onClick={() => toggle(f.key)} aria-pressed={on}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 text-left liquid-transition ${on ? "border-primary bg-primary/[0.07]" : "border-border hover:border-primary/40"}`}>
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${on ? "bg-primary text-white" : "border-2 border-border"}`}>{on ? "✓" : ""}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold">{label(f.key, f.label)}</span>
                  {hint && !ru && <span className="block text-xs text-muted-foreground">{hint}</span>}
                </span>
                <span className={`text-sm font-bold whitespace-nowrap tabular-nums ${on ? "text-primary" : "text-muted-foreground"}`}>+{f.monthly.toLocaleString()}</span>
              </button>
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
          <button type="button" disabled={busy} data-testid="custom-plan-pick"
            onClick={() => onPay(months, price.chosen, { months, features: price.chosen, total: price.total, days: months === 12 ? 365 : months * 30 })}
            className="h-12 px-6 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 disabled:opacity-60 liquid-transition">
            {busy ? "..." : actionLabel || t("plan.payCustom", "Shu tarifni to'lash")}
          </button>
        </div>
      )}
    </div>
  );
}
