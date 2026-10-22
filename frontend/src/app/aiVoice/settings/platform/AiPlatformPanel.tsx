import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import AiPhone from "@hugeicons/core-free-icons/AiPhone01Icon";
import Building from "@hugeicons/core-free-icons/Building03Icon";
import Chart from "@hugeicons/core-free-icons/ChartBarLineIcon";
import Telegram from "@hugeicons/core-free-icons/TelegramIcon";
import Users from "@hugeicons/core-free-icons/UserMultiple02Icon";
import Archive from "@hugeicons/core-free-icons/Archive02Icon";
import History from "@hugeicons/core-free-icons/File01Icon";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Chevron from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Back from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import Pulse from "@hugeicons/core-free-icons/Activity01Icon";
import Refresh from "@hugeicons/core-free-icons/Refresh01Icon";
import Alert from "@hugeicons/core-free-icons/Alert02Icon";
import BetaBadge from "../../BetaBadge";
import {
  AI_UNMET_REASONS, isNotReady, platformApi, type AiUnmetPage, type AiUnmetReason, type AiUsageSummary, type PlatformCompany, type PlatformCompanyView, type PlatformOverview,
  type PlatformTgStatus, type PlatformUsage, type PlatformUsageRow,
} from "../api";
import { todayTashkent } from "../scheduleHelpers";
import { Badge, Card, Chip, Notice, Skeleton, fmtUsd, type Tone } from "../ui";
import { filterCompanies, normalizeCompanies, rangeOfDays, usageRows } from "./helpers";
import UsageView from "./UsageView";
import AuditLog from "../sections/AuditLog";
import Archives from "../sections/Archives";
import CompanyEditor from "./CompanyEditor";
import { oneOf, usePersistentState } from "../../../lib/persistentState";

// Dasturchi paneli → AI: butun platforma boshqaruvi (faqat dasturchi). Holat (server kaliti, kalitlar, navbat,
// worker), firmalar (AI kaliti, AI miyasi, limitlar, oylik xarajat), xarajat (firma kesimida + tafsilot), Telegram
// hisobi (P6 paneli), suhbatlar arxivi va audit — barcha firmalar bo'yicha. /api/ai-voice/platform/* yo'li
// serverda hali bo'lmasa (tanasiz 404/501) — yumshoq xabar; sahifa yiqilmaydi.
const TelegramAccountPanel = lazy(() => import("../TelegramAccountPanel"));
// Firma Telegram akkauntlari — alohida bo'lim (owner 2026-10-19)
const CompanyTgAccounts = lazy(() => import("../CompanyTgAccounts"));

type Tab = "overview" | "companies" | "usage" | "telegram" | "tgAccounts" | "archives" | "audit" | "unmet";
const TABS: { key: Tab; icon: any }[] = [
  { key: "overview", icon: Pulse }, { key: "companies", icon: Building }, { key: "usage", icon: Chart },
  { key: "telegram", icon: Telegram }, { key: "tgAccounts", icon: Users }, { key: "archives", icon: Archive }, { key: "audit", icon: History },
  { key: "unmet", icon: Alert },
];
const fetchArchives = () => platformApi.getArchives();
const fetchAudit = (p: { page: number; limit: number; status?: string }) => platformApi.getAudit(p);
type Loadable<T> = T | null | false | "nr";
const settle = <T,>(r: { ok: boolean; status: number; data: T }): Loadable<T> => (r.ok && r.data ? r.data : isNotReady(r as any) ? "nr" : false);

export default function AiPlatformPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = usePersistentState<Tab>("aiPlatform.tab", "overview", oneOf(TABS.map((x) => x.key)));
  return (
    <div className="space-y-4" data-testid="ai-platform-panel">
      <div className="surface no-lift border border-border rounded-2xl p-4 flex items-start gap-3">
        <div className="icon-chip w-11 h-11 rounded-xl flex-shrink-0"><MorphIcon icon={AiPhone} className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold">{t("aiVoice.platform.title")}</p><BetaBadge /></div>
          <p className="text-xs text-muted-foreground mt-1">{t("aiVoice.platform.subtitle")}</p>
        </div>
      </div>
      <div role="tablist" className="flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-hide pb-1 -mx-1 px-1">
        {TABS.map(({ key, icon }) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`ai-pf-tab-${key}`}
            className={`h-9 px-3.5 rounded-full border text-[13px] font-semibold whitespace-nowrap inline-flex items-center gap-1.5 flex-shrink-0 liquid-transition ${tab === key ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card/60 text-muted-foreground hover:text-foreground"}`}>
            <MorphIcon icon={icon} className="w-4 h-4" />{key === "overview" ? t("aiVoice.platform.ov.tab") : t(`aiVoice.platform.tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "companies" && <Companies />}
      {tab === "usage" && <Usage />}
      {tab === "telegram" && <Suspense fallback={<Skeleton />}><TelegramAccountPanel /></Suspense>}
      {tab === "tgAccounts" && <Suspense fallback={<Skeleton />}><CompanyTgAccounts /></Suspense>}
      {tab === "archives" && <ArchivesTab />}
      {tab === "unmet" && <UnmetTab />}
      {tab === "audit" && <AuditLog fetcher={fetchAudit} title={t("aiVoice.platform.tabs.audit")} testId="ai-pf-audit" />}
    </div>
  );
}

// ───────────── Holat ─────────────
function Overview() {
  const { t } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`aiVoice.platform.ov.${s}`, o as any) as string;
  const [ov, setOv] = useState<Loadable<PlatformOverview>>(null);
  const [tg, setTg] = useState<Loadable<PlatformTgStatus>>(null);
  const load = useCallback(() => {
    setOv(null); setTg(null);
    platformApi.getOverview().then((r) => setOv(settle(r)));
    platformApi.getTelegram().then((r) => setTg(settle(r)));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (ov === null) return <Skeleton />;
  if (ov === "nr") return <Notice testId="ai-pf-notready">{t("aiVoice.platform.notReady")}</Notice>;
  if (ov === false) return <Retry onRetry={load} />;
  const acc = tg && tg !== "nr" ? tg.account : null;
  const workerOn = !!(tg && tg !== "nr" && (tg.worker?.connectedHere || acc?.workerConnected));
  const Row = ({ label, value, tone, hint, testId }: { label: string; value: ReactNode; tone?: Tone; hint?: string; testId?: string }) => (
    <div className="rounded-xl border border-border bg-card/60 px-3 py-2.5 min-w-0" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground truncate">{label}</span>
        {tone ? <Badge tone={tone}>{value}</Badge> : <span className="text-sm font-bold tabular-nums truncate">{value}</span>}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">{hint}</p>}
    </div>
  );
  return (
    <div className="space-y-4" data-testid="ai-pf-overview">
      <Card icon={Pulse} title={k("tab")} right={
        <button type="button" onClick={load} aria-label={k("refresh")} title={k("refresh")} className="h-8 w-8 rounded-lg border border-border inline-flex items-center justify-center hover:border-primary/50">
          <MorphIcon icon={Refresh} className="w-4 h-4" />
        </button>
      }>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Row testId="ai-pf-server" label={k("server")} value={ov.aiVoiceEnabled ? k("serverOn") : k("serverOff")} tone={ov.aiVoiceEnabled ? "green" : "red"}
            hint={ov.aiVoiceEnabled ? undefined : k("serverOffHint")} />
          <Row label={k("queue")} value={ov.queue?.running ? k("queueOn") : k("queueOff")} tone={ov.queue?.running ? "green" : "gray"} />
          <Row label={k("enabledCompanies")} value={ov.enabledCompanies ?? 0} />
          <Row label={k("monthCost")} value={`$${fmtUsd(ov.month?.costUsdMicros || 0)}`} />
          <Row label={k("archives")} value={ov.archives?.total ?? 0} hint={ov.archives ? k("keepDays", { n: ov.archives.keepInDbDays }) : undefined} />
          <Row testId="ai-pf-worker" label={k("worker")} value={tg === null ? "…" : workerOn ? k("workerOn") : k("workerOff")} tone={tg === null ? "gray" : workerOn ? "green" : "amber"}
            hint={workerOn ? (acc?.workerVersion ? `v${acc.workerVersion}` : undefined) : k("workerHint")} />
        </div>
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">{k("providers")}</p>
          <div className="flex flex-wrap gap-1.5">
            {(["gemini", "openrouter", "claude"] as const).map((n) => (
              <Badge key={n} tone={ov.providers?.[n] ? "green" : "gray"}>{t(`aiVoice.admin.provider.${n}`)}: {ov.providers?.[n] ? t("aiVoice.common.configured") : t("aiVoice.common.notConfigured")}</Badge>
            ))}
          </div>
        </div>
        {acc && (
          <p className="text-[11px] text-muted-foreground mt-3">
            {k("account")}: <b className="text-foreground">{acc.username ? `@${acc.username}` : acc.phoneMasked || "—"}</b> · {acc.status || "—"}
            {typeof acc.dailyCap === "number" ? ` · ${acc.dailyCallCount ?? 0}/${acc.dailyCap}` : ""}
          </p>
        )}
      </Card>
    </div>
  );
}

function Retry({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Notice tone="warn">{t("aiVoice.common.error")}</Notice>
      <button type="button" onClick={onRetry} className="h-10 px-4 rounded-xl border border-border text-sm font-semibold">{t("aiVoice.common.retry")}</button>
    </div>
  );
}

// ───────────── Firmalar ─────────────
const PAGE = 100;

function Companies() {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.platform.${s}`);
  const [list, setList] = useState<Loadable<PlatformCompany[]>>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchPage = useCallback(async (query: string, pg: number) => {
    const r = await platformApi.getCompanies({ q: query.trim() || undefined, page: pg, limit: PAGE });
    if (!r.ok) { if (pg === 1) setList(isNotReady(r) ? "nr" : false); else toast.error(t("aiVoice.common.error")); return; }
    const items = normalizeCompanies(r.data);
    const tot = Number((r.data as any)?.total);
    setTotal(Number.isFinite(tot) ? tot : items.length);
    setPage(pg);
    setList((l) => (pg > 1 && Array.isArray(l) ? [...l, ...items.filter((x) => !l.some((y) => y.id === x.id))] : items));
  }, [t]);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void fetchPage(q, 1); }, q ? 300 : 0);
    return () => clearTimeout(timer.current);
  }, [q, fetchPage]);

  const patchRow = (id: string, v: PlatformCompanyView) => setList((l) => (Array.isArray(l) ? l.map((x) => (x.id === id ? {
    ...x, aiEnabled: !!v.settings.enabled, planHasFeature: v.status?.planHasFeature ?? x.planHasFeature,
    usage: { ...x.usage, monthCostUsdMicros: v.month?.costUsdMicros ?? x.usage.monthCostUsdMicros, budgetUsd: v.month?.budgetUsd ?? x.usage.budgetUsd, exceeded: v.month?.exceeded ?? x.usage.exceeded },
  } : x)) : l));

  /** Tez yoqish/o'chirish: versiya kerak — avval to'liq sozlama, keyin PATCH (409 bo'lsa bir marta qayta). */
  const toggle = async (c: PlatformCompany) => {
    setBusy(c.id);
    const fail = (r: { status: number }) => toast.error(isNotReady(r as any) ? k("notReady") : r.status === 0 ? t("aiVoice.common.network") : t("aiVoice.common.error"));
    try {
      const g = await platformApi.getCompany(c.id);
      if (!g.ok || !g.data?.settings) return fail(g);
      let r = await platformApi.patchCompany(c.id, g.data.settings.version, { enabled: !c.aiEnabled });
      if (r.status === 409 && r.errorData?.current?.settings) r = await platformApi.patchCompany(c.id, r.errorData.current.settings.version, { enabled: !c.aiEnabled });
      if (!r.ok || !r.data?.settings) return fail(r);
      patchRow(c.id, r.data);
      toast.success(k("saved"));
    } finally {
      setBusy("");
    }
  };

  if (list === null) return <Skeleton />;
  if (list === "nr") return <Notice testId="ai-pf-notready">{k("notReady")}</Notice>;
  if (list === false) return <Retry onRetry={() => { setList(null); void fetchPage(q, 1); }} />;
  const shown = filterCompanies(list, "");
  return (
    <Card icon={Building} title={k("tabs.companies")} hint={k("enabledHint")} testId="ai-pf-companies">
      <div className="relative mb-3">
        <MorphIcon icon={Search} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={k("search")} aria-label={k("search")}
          className="h-10 w-full rounded-xl border border-border bg-card/70 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      {shown.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">{k("empty")}</p> : (
        <ul className="space-y-2">
          {shown.map((c) => {
            const isOpen = open === c.id;
            const budget = c.usage.budgetUsd || 0;
            const pct = budget > 0 ? Math.min(100, (c.usage.monthCostUsdMicros / (budget * 1e6)) * 100) : 0;
            return (
              <li key={c.id} className="rounded-2xl border border-border bg-card/70" data-testid={`ai-pf-company-${c.id}`}>
                <div className="p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{c.name}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <Badge tone={c.aiEnabled ? "green" : "gray"}>{c.aiEnabled ? k("on") : k("off")}</Badge>
                      {c.planHasFeature === false && <Badge tone="amber">{k("noFeature")}</Badge>}
                      {c.status && c.status !== "ACTIVE" && <Badge tone="red">{c.status}</Badge>}
                      {c.usage.exceeded && <Badge tone="red">{t("aiVoice.admin.limits.exceeded")}</Badge>}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5 tabular-nums">
                      {k("month")}: <b className="text-foreground">${fmtUsd(c.usage.monthCostUsdMicros)}</b>{budget > 0 ? ` / $${budget}` : ""}
                    </p>
                    {budget > 0 && (
                      <div className="h-1.5 rounded-full bg-muted/50 mt-1.5 overflow-hidden max-w-xs">
                        <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <button type="button" role="switch" aria-checked={c.aiEnabled} aria-label={`${k("allowed")}: ${c.name}`} title={c.planHasFeature === false ? k("planWarn") : k("allowedHint")}
                      disabled={busy === c.id} data-testid={`ai-pf-enable-${c.id}`} onClick={() => toggle(c)}
                      className={`relative w-11 h-6 rounded-full liquid-transition disabled:opacity-60 ${c.aiEnabled ? "bg-primary" : "bg-muted-foreground/30"}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow liquid-transition ${c.aiEnabled ? "translate-x-5" : ""}`} />
                    </button>
                    <button type="button" onClick={() => setOpen(isOpen ? "" : c.id)} aria-expanded={isOpen} data-testid={`ai-pf-edit-${c.id}`}
                      className="h-8 px-2.5 rounded-lg border border-border text-xs font-semibold inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      {isOpen ? k("close") : k("edit")}<MorphIcon icon={Chevron} className={`w-3.5 h-3.5 liquid-transition ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="px-3 pb-3 pt-3 border-t border-border/60">
                    <CompanyEditor companyId={c.id} onSaved={(v) => patchRow(c.id, v)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.length < total && (
        <button type="button" onClick={() => void fetchPage(q, page + 1)} data-testid="ai-pf-more"
          className="mt-3 w-full h-10 rounded-xl border border-border text-sm font-semibold hover:border-primary/50">{k("loadMore")}</button>
      )}
    </Card>
  );
}

// ───────────── Xarajat ─────────────
const PERIODS = [7, 30, 90] as const;

function Usage() {
  const { t } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`aiVoice.admin.limits.${s}`, o as any) as string;
  const pk = (s: string, o?: Record<string, unknown>) => t(`aiVoice.platform.${s}`, o as any) as string;
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [u, setU] = useState<Loadable<PlatformUsage>>(null);
  const [sel, setSel] = useState<PlatformUsageRow | null>(null);
  const [detail, setDetail] = useState<Loadable<AiUsageSummary>>(null);
  useEffect(() => {
    setU(null);
    platformApi.getUsage(rangeOfDays(days, todayTashkent())).then((r) => setU(settle(r)));
  }, [days]);
  useEffect(() => {
    if (!sel) return;
    setDetail(null);
    platformApi.getCompanyUsage(sel.companyId, rangeOfDays(days, todayTashkent())).then((r) => setDetail(settle(r)));
  }, [sel, days]);
  const rows = u && u !== "nr" ? usageRows(u) : [];
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {PERIODS.map((d) => <Chip key={d} active={days === d} onClick={() => setDays(d)}>{d} {pk("days")}</Chip>)}
      </div>
      {sel ? (
        <Card icon={Chart} title={pk("usageOf", { name: sel.name || sel.companyId })} testId="ai-pf-usage-detail" right={
          <button type="button" onClick={() => setSel(null)} className="h-8 px-2.5 rounded-lg border border-border text-xs font-semibold inline-flex items-center gap-1">
            <MorphIcon icon={Back} className="w-3.5 h-3.5" />{pk("backToAll")}
          </button>
        }>
          {detail === null ? <Skeleton /> : detail === "nr" ? <Notice>{pk("notReady")}</Notice> : detail === false ? <Notice tone="warn">{t("aiVoice.common.error")}</Notice> : <UsageView u={detail} k={k} />}
        </Card>
      ) : u === null ? <Skeleton /> : u === "nr" ? <Notice>{pk("notReady")}</Notice> : u === false ? <Notice tone="warn">{t("aiVoice.common.error")}</Notice> : (
        <Card icon={Chart} title={pk("allCompanies")} hint={rows.length ? pk("pickCompany") : undefined} testId="ai-pf-usage">
          <p className="text-xs text-muted-foreground mb-3">{pk("total")}: <b className="text-foreground tabular-nums">${fmtUsd(u.totals?.costUsdMicros || 0)}</b> · {pk("sessions")}: <b className="text-foreground tabular-nums">{u.totals?.sessions ?? 0}</b></p>
          {rows.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">{k("noUsage")}</p> : (
            <div className="overflow-x-auto overscroll-x-contain -mx-1 px-1">
              <table className="w-full text-sm min-w-[320px]">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-left font-semibold pb-2">{pk("company")}</th>
                    <th className="text-right font-semibold pb-2">{pk("sessions")}</th>
                    <th className="text-right font-semibold pb-2">{pk("cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.companyId} className="border-t border-border/50 hover:bg-muted/30 cursor-pointer" onClick={() => setSel(r)} data-testid={`ai-pf-usage-${r.companyId}`}>
                      <td className="py-1.5 pr-2 truncate max-w-[12rem]"><button type="button" className="text-left hover:text-primary truncate max-w-full">{r.name || r.companyId}</button></td>
                      <td className="py-1.5 text-right tabular-nums">{r.sessions ?? "—"}</td>
                      <td className="py-1.5 text-right tabular-nums font-semibold">${fmtUsd(r.costUsdMicros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ───────────── "AI qila olmadi" (owner 2026-10-22) ─────────────
const UNMET_TONE: Record<AiUnmetReason, Tone> = {
  refusal: "red", unknown_tool: "amber", bad_args: "amber", tool_error: "red", tool_denied: "amber", rounds: "amber", provider_failed: "gray", cant_reply: "sky",
};
function UnmetTab() {
  const { t, i18n } = useTranslation();
  const k = (s: string) => t(`aiVoice.platform.unmet.${s}`);
  const [reason, setReason] = useState<AiUnmetReason | "">("");
  const [limit, setLimit] = useState(50);
  const [data, setData] = useState<Loadable<AiUnmetPage>>(null);
  const load = useCallback(() => {
    setData(null);
    platformApi.getUnmet({ limit, ...(reason ? { reason } : {}) }).then((r) => setData(settle(r)));
  }, [limit, reason]);
  useEffect(() => { load(); }, [load]);
  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(i18n.language?.startsWith("ru") ? "ru-RU" : "uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
  };
  const page = data && data !== "nr" ? data : null;
  return (
    <Card icon={Alert} title={k("title")} hint={k("hint")} testId="ai-pf-unmet" right={
      <button type="button" onClick={load} aria-label="refresh" className="h-8 w-8 rounded-lg border border-border inline-flex items-center justify-center hover:border-primary/50">
        <MorphIcon icon={Refresh} className="w-4 h-4" />
      </button>
    }>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-1 px-1">
        <Chip active={!reason} onClick={() => setReason("")}>{k("all")}{page ? ` · ${page.total}` : ""}</Chip>
        {AI_UNMET_REASONS.map((r) => (
          <Chip key={r} active={reason === r} onClick={() => setReason(r)} testId={`ai-pf-unmet-${r}`}>
            {k(`reasons.${r}`)}{page?.byReason7d?.[r] ? ` · ${page.byReason7d[r]}` : ""}
          </Chip>
        ))}
      </div>
      {data === null ? <Skeleton /> : data === "nr" ? <Notice>{t("aiVoice.platform.notReady")}</Notice> : data === false ? <Notice tone="warn">{t("aiVoice.common.error")}</Notice>
        : !page?.items.length ? <p className="text-sm text-muted-foreground py-6 text-center" data-testid="ai-pf-unmet-empty">{k("empty")}</p> : (
          <ul className="space-y-2">
            {page.items.map((it) => (
              <li key={it.id} className="rounded-xl border border-border p-3 space-y-1.5" data-testid="ai-pf-unmet-item">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Badge tone={UNMET_TONE[it.reason] || "gray"}>{k(`reasons.${it.reason}`)}</Badge>
                  <span className="tabular-nums">{fmt(it.createdAt)}</span>
                  <span>·</span><span className="truncate max-w-[40vw]">{it.companyName || it.companyId}</span>
                  {it.userName && <><span>·</span><span className="truncate max-w-[30vw]">{it.userName}{it.userRole ? ` (${it.userRole})` : ""}</span></>}
                  <span>·</span><span>{it.channel}</span>
                </div>
                <p className="text-sm break-words"><b className="text-muted-foreground font-semibold">{k("user")}:</b> {it.userText || "—"}</p>
                <p className="text-sm break-words text-muted-foreground"><b className="font-semibold">{k("ai")}:</b> {it.aiReply || "—"}</p>
                {it.toolName && <p className="text-xs font-mono break-words text-muted-foreground">🔧 {it.toolName}{it.toolMessage ? `: ${it.toolMessage}` : ""}</p>}
              </li>
            ))}
          </ul>
        )}
      {page && page.items.length < page.total && limit < 200 && (
        <button type="button" onClick={() => setLimit((l) => Math.min(200, l + 50))} className="mt-3 h-9 px-3.5 rounded-xl border border-border text-xs font-semibold">
          {t("aiVoice.platform.loadMore")}
        </button>
      )}
    </Card>
  );
}

// ───────────── Arxivlar ─────────────
function ArchivesTab() {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.platform.ov.${s}`);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await platformApi.runArchive();
    setBusy(false);
    if (r.ok) toast.success(k("runArchiveOk"));
    else toast.error(r.status === 503 ? k("runArchiveOff") : r.status === 0 ? t("aiVoice.common.network") : t("aiVoice.common.error"));
  };
  return (
    <div className="space-y-3">
      <button type="button" onClick={run} disabled={busy} data-testid="ai-pf-run-archive"
        className="h-9 px-3.5 rounded-xl border border-border text-xs font-semibold inline-flex items-center gap-1.5 hover:border-primary/50 disabled:opacity-60">
        <MorphIcon icon={Archive} className="w-4 h-4" />{busy ? "…" : k("runArchive")}
      </button>
      <Archives fetcher={fetchArchives} urlOf={platformApi.archiveUrl} showCompany testId="ai-pf-archives" />
    </div>
  );
}
