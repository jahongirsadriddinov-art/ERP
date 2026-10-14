import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Wallet from "@hugeicons/core-free-icons/Wallet01Icon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import Chart from "@hugeicons/core-free-icons/ChartBarLineIcon";
import type { SectionProps } from "../sectionProps";
import { adminApi, type AiSettingsData, type AiUsageSummary } from "../api";
import { addDaysIso, todayTashkent } from "../scheduleHelpers";
import { Badge, Card, fmtUsd, NumField, Skeleton, Toggle } from "../ui";

// Limitlar va xarajat: cheklovlar, oylik byudjet (hardStop), maxfiylik muddatlari va /usage bo'yicha
// oylik jami + oxirgi 30 kun ustunli diagrammasi (bitta seriya — bir rang, hover'da qiymat, jadval ham bor).
export default function LimitsCost({ draft, update }: SectionProps) {
  const { t } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`aiVoice.admin.limits.${s}`, o as any) as string;
  const L = draft.limits;
  const setL = (p: Partial<AiSettingsData["limits"]>) => update((d) => ({ ...d, limits: { ...d.limits, ...p } }));
  const setP = (p: Partial<AiSettingsData["privacy"]>) => update((d) => ({ ...d, privacy: { ...d.privacy, ...p } }));
  const [usage, setUsage] = useState<AiUsageSummary | null | false>(null);
  useEffect(() => { adminApi.getUsage().then((r) => setUsage(r.ok ? r.data : false)); }, []);

  return (
    <div className="space-y-4">
      <Card icon={Chart} title={k("usage")} testId="ai-usage">
        {usage === null ? <Skeleton h="h-32" /> : usage === false ? <p className="text-xs text-muted-foreground">{t("aiVoice.common.error")}</p> : <UsageView u={usage} k={k} />}
      </Card>
      <Card icon={Wallet} title={k("title")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumField label={k("budget")} value={L.monthlyBudgetUsd} min={0} max={10000} step={1} suffix="$" testId="ai-budget" onChange={(v) => setL({ monthlyBudgetUsd: v })} />
          <NumField label={k("sessionsPerHour")} value={L.userSessionsPerHour} min={0} max={60} onChange={(v) => setL({ userSessionsPerHour: v })} />
          <NumField label={k("minutesPerDay")} value={L.companyMinutesPerDay} min={0} max={10000} onChange={(v) => setL({ companyMinutesPerDay: v })} />
          <NumField label={k("botMsgs")} value={L.botMsgsPer10Min} min={1} max={200} onChange={(v) => setL({ botMsgsPer10Min: v })} />
          <NumField label={k("toolCalls")} value={L.toolCallsPerSession} min={1} max={100} onChange={(v) => setL({ toolCallsPerSession: v })} />
        </div>
        <div className="mt-2"><Toggle checked={L.hardStop} label={k("hardStop")} hint={k("hardStopHint")} onChange={(v) => setL({ hardStop: v })} /></div>
      </Card>
      <Card icon={Lock} title={k("privacy")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumField label={k("transcriptDays")} value={draft.privacy.transcriptRetentionDays} min={1} max={365} onChange={(v) => setP({ transcriptRetentionDays: v })} />
          <NumField label={k("auditDays")} value={draft.privacy.auditRetentionDays} min={30} max={3650} onChange={(v) => setP({ auditRetentionDays: v })} />
        </div>
        <div className="mt-3"><Badge tone="green">{k("recordAudio")}</Badge></div>
      </Card>
    </div>
  );
}

function UsageView({ u, k }: { u: AiUsageSummary; k: (s: string, o?: Record<string, unknown>) => string }) {
  const budgetMicros = u.month.budgetUsd * 1e6;
  const pct = budgetMicros > 0 ? Math.min(100, (u.month.costUsdMicros / budgetMicros) * 100) : 0;
  const today = todayTashkent();
  const byDay = new Map(u.days.map((d) => [d.day, d.costUsdMicros]));
  const series = Array.from({ length: 30 }, (_, i) => addDaysIso(today, i - 29)).map((day) => ({ day, v: byDay.get(day) || 0 }));
  const max = Math.max(1, ...series.map((s) => s.v));
  const providers = Object.entries(u.byProvider).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">{k("month")}</p>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-3xl font-extrabold tabular-nums">${fmtUsd(u.month.costUsdMicros)}</span>
          <span className="text-sm text-muted-foreground">{k("ofBudget", { budget: u.month.budgetUsd })}</span>
          {u.month.exceeded && <Badge tone="red">{k("exceeded")}</Badge>}
        </div>
        <div className="h-2 rounded-full bg-muted/50 mt-2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2">{k("last30")}</p>
        {u.totals.costUsdMicros === 0 ? <p className="text-xs text-muted-foreground">{k("noUsage")}</p> : (
          <div className="flex items-end gap-[2px] h-24" role="img" aria-label={k("last30")}>
            {series.map((s) => (
              <div key={s.day} className="flex-1 h-full flex items-end group relative" title={k("dayTip", { day: s.day, cost: fmtUsd(s.v) })}>
                <div className="w-full rounded-t-[4px] bg-primary/80 group-hover:bg-primary" style={{ height: `${s.v ? Math.max(4, (s.v / max) * 100) : 0}%` }} />
              </div>
            ))}
          </div>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[[k("sessions"), u.totals.sessions], [k("tokens"), u.totals.tokensIn + u.totals.tokensOut], [k("botMessages"), u.totals.botMessages]].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border border-border bg-card/60 py-2 min-w-0">
            <dd className="text-sm font-bold tabular-nums truncate">{Number(v).toLocaleString()}</dd>
            <dt className="text-[10px] text-muted-foreground truncate px-1">{l}</dt>
          </div>
        ))}
      </dl>
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
