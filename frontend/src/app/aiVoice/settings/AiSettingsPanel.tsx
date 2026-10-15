import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import AiPhone from "@hugeicons/core-free-icons/AiPhone01Icon";
import Settings from "@hugeicons/core-free-icons/Settings02Icon";
import Calendar from "@hugeicons/core-free-icons/Calendar03Icon";
import Route from "@hugeicons/core-free-icons/Message01Icon";
import Users from "@hugeicons/core-free-icons/UserGroupIcon";
import Shield from "@hugeicons/core-free-icons/Shield01Icon";
import History from "@hugeicons/core-free-icons/File01Icon";
import Send from "@hugeicons/core-free-icons/SentIcon";
import Save from "@hugeicons/core-free-icons/FloppyDiskIcon";
import Ok from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import No from "@hugeicons/core-free-icons/CancelCircleIcon";
import BetaBadge from "../BetaBadge";
import { refreshAiStatus } from "../aiStatus";
import { adminApi, type AiSettingsData, type AiSettingsView } from "./api";
import { companyAiLabel, companyBlocks, readCurrentUser, roleGroup, type CompanyBlock, type RoleGroup } from "./aiAccess";
import RoleHelp from "./RoleHelp";
import { diffPatch, validateDraft } from "./scheduleHelpers";
import { Badge, Notice, Skeleton } from "./ui";
import General from "./sections/General";
import Schedule from "./sections/Schedule";

// AI yordamchi — firma sozlamalari (egasi / direktor / o'rinbosar). Soddalashtirilgan: 7 ta tushunarli bo'lim,
// kam ishlatiladiganlari "Qo'shimcha" ichida. AI miyasi va limit/xarajat bu yerda YO'Q — ularni faqat dasturchi
// (Dasturchi paneli → AI) boshqaradi. Bitta qoralama: "Saqlash" faqat o'zgargan qismlarni versiya bilan yuboradi
// (boshqa admin o'zgartirgan bo'lsa — 409, eng so'nggi holat yuklanadi). Xodimlar, tarix, sinov — alohida so'rovlar.
// Holat ROST ko'rsatiladi (owner 2026-10-15 b): saqlangandan keyin server qayta so'raladi; "O'chiq" faqat firma
// kaliti o'chiq bo'lsa — server/tarif/obuna sababi alohida, har biriga rolga mos keyingi qadam bilan.
const Channels = lazy(() => import("./sections/Channels"));
const Employees = lazy(() => import("./sections/Employees"));
const ToolsMatrix = lazy(() => import("./sections/ToolsMatrix"));
const HistorySection = lazy(() => import("./sections/History"));
const TestCall = lazy(() => import("./sections/TestCall"));

type Tab = "general" | "schedule" | "channels" | "employees" | "tools" | "history" | "test";
const TABS: { key: Tab; icon: any }[] = [
  { key: "general", icon: Settings }, { key: "schedule", icon: Calendar }, { key: "channels", icon: Route },
  { key: "employees", icon: Users }, { key: "tools", icon: Shield }, { key: "history", icon: History }, { key: "test", icon: Send },
];

type LoadState = "loading" | "ready" | "feature" | "forbidden" | "notReady" | "network" | "error";

export default function AiSettingsPanel() {
  const { t } = useTranslation();
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [draft, setDraft] = useState<AiSettingsData | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [tab, setTab] = useState<Tab>("general");
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const topRef = useRef<HTMLDivElement>(null);

  const apply = (v: AiSettingsView) => { setView(v); setDraft(v.settings); setState("ready"); };
  const load = useCallback(async () => {
    setState("loading");
    const r = await adminApi.getSettings();
    if (r.ok) return apply(r.data);
    setState(r.status === 0 ? "network" : r.error === "feature" ? "feature" : r.status === 403 ? "forbidden"
      : r.status === 501 || r.status === 404 ? "notReady" : "error");
  }, []);
  useEffect(() => { load(); }, [load]);
  /** Saqlangandan keyin: serverdan qayta o'qish (holat rost bo'lsin) + umumiy AI holati keshini yangilash. */
  const resync = useCallback(async () => {
    const r = await adminApi.getSettings();
    if (r.ok) { setView(r.data); setDraft((d) => (d && d.version === r.data.settings.version ? d : r.data.settings)); }
    void refreshAiStatus({ force: true });
  }, []);

  const update = useCallback((fn: (d: AiSettingsData) => AiSettingsData) => setDraft((d) => (d ? fn(d) : d)), []);
  const patch = useMemo(() => (view && draft ? diffPatch(view.settings, draft) : {}), [view, draft]);
  const dirty = Object.keys(patch).length > 0;
  const errors = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);

  // Bo'lim almashganda kontent boshiga qaytish (faqat sarlavha ekrandan chiqib ketgan bo'lsa)
  const pick = (k: Tab) => {
    setTab(k);
    const el = topRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const save = async () => {
    if (!view || !dirty) return;
    if (errors.length) { toast.error(t(`aiVoice.admin.errors.${errors[0]}`)); return; }
    setSaving(true);
    const r = await adminApi.putSettings(view.settings.version, patch);
    setSaving(false);
    if (r.ok) { apply(r.data); setServerErrors([]); toast.success(t("aiVoice.common.saved")); void resync(); return; }
    if (r.status === 409 && r.errorData?.current) { apply(r.errorData.current); toast.error(t("aiVoice.admin.status.conflict")); return; }
    if (r.status === 400) { setServerErrors(Array.isArray(r.errorData?.errors) ? r.errorData.errors.slice(0, 6) : []); toast.error(t("aiVoice.admin.status.invalid")); return; }
    toast.error(r.status === 0 ? t("aiVoice.common.network") : t("aiVoice.common.error"));
  };

  const me = readCurrentUser();
  const group: RoleGroup = view ? (view.editor.canEditBossRows ? "boss" : "deputy") : roleGroup(me.role, me.isOwner);
  const blocks = view ? companyBlocks(view) : [];
  const label = view ? companyAiLabel(blocks) : null;

  const header = (
    <div className="surface no-lift border border-border rounded-2xl p-4 flex items-start gap-3">
      <div className="icon-chip w-11 h-11 rounded-xl flex-shrink-0"><MorphIcon icon={AiPhone} className="w-5 h-5" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold">{t("aiVoice.admin.title")}</p>
          <BetaBadge />
          {label && (
            <span data-testid="ai-status-badge" data-state={label}>
              <Badge tone={label === "on" ? "green" : label === "blocked" ? "amber" : "gray"}>{t(`aiVoice.ui.state.${label}`)}</Badge>
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t("aiVoice.ui.intro")}</p>
      </div>
    </div>
  );

  if (state === "loading") return <div data-testid="ai-settings-panel"><Skeleton h="h-64" /></div>;
  if (state !== "ready" || !view || !draft) {
    const msg = state === "feature" ? t("aiVoice.admin.status.feature") : state === "forbidden" ? t("aiVoice.admin.status.forbidden")
      : state === "notReady" ? t("aiVoice.common.notReady") : state === "network" ? t("aiVoice.common.network") : t("aiVoice.common.error");
    const next = state === "feature" ? t(`aiVoice.ui.state.featureNext.${group === "boss" || group === "deputy" ? group : "other"}`) : "";
    return (
      <div className="space-y-3" data-testid="ai-settings-panel">
        {header}
        <Notice tone={state === "notReady" ? "info" : "warn"} testId={`ai-state-${state}`}>
          <p>{msg}</p>
          {next && <p className="mt-1 font-semibold">{next}</p>}
        </Notice>
        {(state === "network" || state === "error") && (
          <button type="button" onClick={load} className="h-10 px-4 rounded-xl border border-border text-sm font-semibold">{t("aiVoice.common.retry")}</button>
        )}
      </div>
    );
  }

  const sp = { view, draft, update };
  const pending = draft.enabled !== view.settings.enabled;
  return (
    <div className="space-y-4" data-testid="ai-settings-panel" ref={topRef}>
      {header}
      <StatusCard view={view} blocks={blocks} group={group} pending={pending ? (draft.enabled ? "on" : "off") : null} />
      <RoleHelp area="admin" group={group} />

      <div className="md:grid md:grid-cols-[220px_minmax(0,1fr)] md:gap-4 md:items-start">
        {/* Telefon: gorizontal yopishqoq lenta; kompyuter: yopishqoq yon menyu, o'z skrolli bilan (sahifaga o'tmaydi) */}
        <nav aria-label={t("aiVoice.admin.title")} data-testid="ai-settings-nav"
          className="sticky top-[72px] z-10 -mx-4 px-4 py-2 bg-background/85 backdrop-blur-md border-b border-border/60
            md:top-[84px] lg:top-0 md:mx-0 md:p-2 md:bg-card md:backdrop-blur-none md:border md:border-border md:rounded-2xl
            md:max-h-[calc(100dvh-7rem)] lg:max-h-[calc(100dvh-10rem)] md:overflow-y-auto md:overscroll-contain [scrollbar-width:thin]">
          <div className="flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-hide md:flex-col md:gap-0.5 md:overflow-visible">
            {TABS.map(({ key, icon }) => {
              const active = tab === key;
              return (
                <button key={key} type="button" onClick={() => pick(key)} data-testid={`ai-tab-${key}`} aria-current={active ? "page" : undefined}
                  className={`group flex items-center gap-2.5 h-9 md:h-auto md:min-h-[52px] px-3.5 md:px-3 md:py-2 rounded-full md:rounded-xl text-[13px] font-semibold whitespace-nowrap md:whitespace-normal flex-shrink-0 text-left liquid-transition border
                    ${active ? "bg-primary text-primary-foreground border-primary md:bg-primary/10 md:text-primary md:border-primary/30" : "border-border bg-card/70 text-muted-foreground hover:text-foreground md:border-transparent md:bg-transparent md:hover:bg-muted/40"}`}>
                  <MorphIcon icon={icon} className="w-4 h-4 flex-shrink-0" />
                  <span className="min-w-0">
                    <span className="block leading-tight">{t(`aiVoice.ui.tabs.${key}`)}</span>
                    <span className={`hidden md:block text-[11px] font-normal leading-tight mt-0.5 ${active ? "text-primary/75" : "text-muted-foreground"}`}>{t(`aiVoice.ui.tabHints.${key}`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0 mt-3 md:mt-0" data-testid="ai-settings-content">
          <Suspense fallback={<Skeleton />}>
            {tab === "general" && <General {...sp} />}
            {tab === "schedule" && <Schedule {...sp} />}
            {tab === "channels" && <Channels {...sp} />}
            {tab === "employees" && <Employees canEditBoss={view.editor.canEditBossRows} canEditSchedule={view.editor.canEditSchedule} draft={draft} />}
            {tab === "tools" && <ToolsMatrix {...sp} />}
            {tab === "history" && <HistorySection canArchives={view.editor.canDownloadArchives ?? view.editor.canEditBossRows} />}
            {tab === "test" && <TestCall view={view} draft={draft} />}
          </Suspense>
          {serverErrors.length > 0 && (
            <div className="mt-3"><Notice tone="warn"><ul className="space-y-0.5">{serverErrors.map((e) => <li key={e}>{e}</li>)}</ul></Notice></div>
          )}
          <div aria-hidden className="h-2" data-testid="ai-settings-end" />
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+96px)] lg:bottom-4 z-20" data-testid="ai-save-bar">
          <div className="surface no-lift border border-primary/30 rounded-2xl p-3 flex items-center gap-2 shadow-lg">
            <p className="flex-1 min-w-0 text-xs sm:text-sm font-semibold truncate">
              {errors.length ? t(`aiVoice.admin.errors.${errors[0]}`) : t("aiVoice.common.unsaved")}
            </p>
            <button type="button" onClick={() => { setDraft(view.settings); setServerErrors([]); }} disabled={saving}
              className="h-10 px-3 rounded-xl border border-border text-sm font-semibold flex-shrink-0">{t("aiVoice.common.cancel")}</button>
            <button type="button" onClick={save} disabled={saving || errors.length > 0} data-testid="ai-save"
              className="btn btn-primary h-10 px-4 rounded-xl text-sm font-bold inline-flex items-center gap-1.5 flex-shrink-0 disabled:opacity-60">
              <MorphIcon icon={Save} className="w-4 h-4" />{saving ? t("aiVoice.common.saving") : t("aiVoice.common.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** AI holati: ishlayapti — bitta yashil qator; aks holda 4 ta tekshiruv (✓/✗) va har bir ✗ uchun keyingi qadam. */
function StatusCard({ view, blocks, group, pending }: {
  view: AiSettingsView; blocks: CompanyBlock[]; group: RoleGroup; pending: "on" | "off" | null;
}) {
  const { t } = useTranslation();
  const s = (k: string) => t(`aiVoice.ui.state.${k}`);
  const who = group === "deputy" ? "deputy" : "boss";
  const pend = pending && <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mt-1.5" data-testid="ai-status-pending">{s(pending === "on" ? "pendingOn" : "pendingOff")}</p>;
  if (!blocks.length) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3.5 py-2.5" data-testid="ai-status" data-state="on">
        <p className="text-xs flex items-center gap-2"><MorphIcon icon={Ok} className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />{s("onLine")}</p>
        {pend}
      </div>
    );
  }
  const rows: { key: CompanyBlock; label: string; ok: boolean }[] = [
    { key: "plan", label: s("checkPlan"), ok: view.status.planHasFeature !== false },
    { key: "inactive", label: s("checkActive"), ok: view.status.companyActive !== false },
    { key: "server", label: s("checkServer"), ok: view.status.aiVoiceEnabled !== false },
    { key: "company", label: s("checkCompany"), ok: !!view.settings.enabled },
  ];
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] px-3.5 py-3" data-testid="ai-status" data-state={companyAiLabel(blocks)}>
      <p className="text-xs font-bold">{s("why")}</p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-2 text-xs" data-testid={`ai-check-${r.key}`} data-ok={r.ok ? "1" : "0"}>
            <MorphIcon icon={r.ok ? Ok : No} className={`w-4 h-4 flex-shrink-0 mt-px ${r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} />
            <span className="min-w-0">
              <span className={r.ok ? "text-muted-foreground" : "font-semibold"}>{r.label}</span>
              {!r.ok && <span className="block text-muted-foreground mt-0.5">{t(`aiVoice.ui.state.next.${r.key}.${who}`)}</span>}
            </span>
          </li>
        ))}
      </ul>
      {pend}
    </div>
  );
}
