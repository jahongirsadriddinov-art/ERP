import type { AiUsageSummary } from "../api";
import { addDaysIso, todayTashkent } from "../scheduleHelpers";
import { Badge, fmtUsd } from "../ui";

// Xarajat ko'rinishi (oy jami + byudjet chizig'i, oxirgi 30 kun ustunlari, provayderlar). Faqat dasturchi
// panelida (firma UI'dan olib tashlangan). Bitta seriya — bir rang, hover'da qiymat.
export default function UsageView({ u, k }: { u: Partial<AiUsageSummary>; k: (s: string, o?: Record<string, unknown>) => string }) {
  const month = u.month;
  const budgetMicros = (month?.budgetUsd || 0) * 1e6;
  const pct = budgetMicros > 0 && month ? Math.min(100, (month.costUsdMicros / budgetMicros) * 100) : 0;
  const today = todayTashkent();
  const byDay = new Map((u.days || []).map((d) => [d.day, d.costUsdMicros]));
  const series = Array.from({ length: 30 }, (_, i) => addDaysIso(today, i - 29)).map((day) => ({ day, v: byDay.get(day) || 0 }));
  const max = Math.max(1, ...series.map((s) => s.v));
  const providers = Object.entries(u.byProvider || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const totals = u.totals;
  return (
    <div className="space-y-4">
      {month && (
        <div>
          <p className="text-xs text-muted-foreground">{k("month")}</p>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl font-extrabold tabular-nums">${fmtUsd(month.costUsdMicros)}</span>
            {month.budgetUsd > 0 && <span className="text-sm text-muted-foreground">{k("ofBudget", { budget: month.budgetUsd })}</span>}
            {month.exceeded && <Badge tone="red">{k("exceeded")}</Badge>}
          </div>
          {month.budgetUsd > 0 && (
            <div className="h-2 rounded-full bg-muted/50 mt-2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
              <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
      {u.days && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">{k("last30")}</p>
          {!totals?.costUsdMicros ? <p className="text-xs text-muted-foreground">{k("noUsage")}</p> : (
            <div className="flex items-end gap-[2px] h-24" role="img" aria-label={k("last30")}>
              {series.map((s) => (
                <div key={s.day} className="flex-1 h-full flex items-end group" title={k("dayTip", { day: s.day, cost: fmtUsd(s.v) })}>
                  <div className="w-full rounded-t-[4px] bg-primary/80 group-hover:bg-primary" style={{ height: `${s.v ? Math.max(4, (s.v / max) * 100) : 0}%` }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {totals && (
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[[k("sessions"), totals.sessions], [k("tokens"), (totals.tokensIn || 0) + (totals.tokensOut || 0)], [k("botMessages"), totals.botMessages]].map(([l, v]) => (
            <div key={String(l)} className="rounded-xl border border-border bg-card/60 py-2 min-w-0">
              <dd className="text-sm font-bold tabular-nums truncate">{Number(v || 0).toLocaleString()}</dd>
              <dt className="text-[10px] text-muted-foreground truncate px-1">{l}</dt>
            </div>
          ))}
        </dl>
      )}
      {providers.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">{k("byProvider")}</p>
          <table className="w-full text-xs">
            <tbody>
              {providers.map(([p, v]) => (
                <tr key={p} className="border-t border-border/50"><td className="py-1">{p}</td><td className="py-1 text-right tabular-nums">${fmtUsd(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
