import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import AiPhone from "@hugeicons/core-free-icons/AiPhone01Icon";
import Settings from "@hugeicons/core-free-icons/Settings02Icon";
import Calendar from "@hugeicons/core-free-icons/Calendar03Icon";
import Route from "@hugeicons/core-free-icons/Message01Icon";
import Users from "@hugeicons/core-free-icons/UserGroupIcon";
import Shield from "@hugeicons/core-free-icons/Shield01Icon";
import Brain from "@hugeicons/core-free-icons/AiBrain01Icon";
import Wallet from "@hugeicons/core-free-icons/Wallet01Icon";
import History from "@hugeicons/core-free-icons/File01Icon";
import Send from "@hugeicons/core-free-icons/SentIcon";
import Save from "@hugeicons/core-free-icons/FloppyDiskIcon";
import { adminApi, type AiSettingsData, type AiSettingsView } from "./api";
import { diffPatch, validateDraft } from "./scheduleHelpers";
import { Badge, Notice, Skeleton } from "./ui";
import General from "./sections/General";
import Schedule from "./sections/Schedule";

// AI ovozli yordamchi — firma sozlamalari (egasi / direktor / o'rinbosar). Bitta qoralama: bo'limlar uni
// o'zgartiradi, "Saqlash" faqat o'zgargan qismlarni PUT /admin/settings ga versiya bilan yuboradi
// (boshqa admin o'zgartirgan bo'lsa — 409, eng so'nggi holat yuklanadi). Xodimlar, audit, sinov — alohida so'rovlar.
const Channels = lazy(() => import("./sections/Channels"));
const Employees = lazy(() => import("./sections/Employees"));
const ToolsMatrix = lazy(() => import("./sections/ToolsMatrix"));
const Provider = lazy(() => import("./sections/Provider"));
const LimitsCost = lazy(() => import("./sections/LimitsCost"));
const AuditLog = lazy(() => import("./sections/AuditLog"));
const TestCall = lazy(() => import("./sections/TestCall"));

type Tab = "general" | "schedule" | "channels" | "employees" | "tools" | "provider" | "limits" | "audit" | "test";
const TABS: { key: Tab; icon: any }[] = [
  { key: "general", icon: Settings }, { key: "schedule", icon: Calendar }, { key: "channels", icon: Route },
  { key: "employees", icon: Users }, { key: "tools", icon: Shield }, { key: "provider", icon: Brain },
  { key: "limits", icon: Wallet }, { key: "audit", icon: History }, { key: "test", icon: Send },
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

  const apply = (v: AiSettingsView) => { setView(v); setDraft(v.settings); setState("ready"); };
  const load = useCallback(async () => {
    setState("loading");
    const r = await adminApi.getSettings();
    if (r.ok) return apply(r.data);
    setState(r.status === 0 ? "network" : r.error === "feature" ? "feature" : r.status === 403 ? "forbidden"
      : r.status === 501 || r.status === 404 ? "notReady" : "error");
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = useCallback((fn: (d: AiSettingsData) => AiSettingsData) => setDraft((d) => (d ? fn(d) : d)), []);
  const patch = useMemo(() => (view && draft ? diffPatch(view.settings, draft) : {}), [view, draft]);
  const dirty = Object.keys(patch).length > 0;
  const errors = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);

  const save = async () => {
    if (!view || !dirty) return;
    if (errors.length) { toast.error(t(`aiVoice.admin.errors.${errors[0]}`)); return; }
    setSaving(true);
    const r = await adminApi.putSettings(view.settings.version, patch);
    setSaving(false);
    if (r.ok) { apply(r.data); setServerErrors([]); toast.success(t("aiVoice.common.saved")); return; }
    if (r.status === 409 && r.errorData?.current) { apply(r.errorData.current); toast.error(t("aiVoice.admin.status.conflict")); return; }
    if (r.status === 400) { setServerErrors(Array.isArray(r.errorData?.errors) ? r.errorData.errors.slice(0, 6) : []); toast.error(t("aiVoice.admin.status.invalid")); return; }
    toast.error(r.status === 0 ? t("aiVoice.common.network") : t("aiVoice.common.error"));
  };

  if (state === "loading") return <Skeleton h="h-64" />;
  if (state !== "ready" || !view || !draft) {
    const msg = state === "feature" ? t("aiVoice.admin.status.feature") : state === "forbidden" ? t("aiVoice.admin.status.forbidden")
      : state === "notReady" ? t("aiVoice.common.notReady") : state === "network" ? t("aiVoice.common.network") : t("aiVoice.common.error");
    return (
      <div className="space-y-3" data-testid="ai-settings-panel">
        <Notice tone={state === "notReady" ? "info" : "warn"}>{msg}</Notice>
        {(state === "network" || state === "error") && (
          <button type="button" onClick={load} className="h-10 px-4 rounded-xl border border-border text-sm font-semibold">{t("aiVoice.common.retry")}</button>
        )}
      </div>
    );
  }

  const sp = { view, draft, update };
  const on = view.settings.enabled && view.status.aiVoiceEnabled;
  return (
    <div className="space-y-4" data-testid="ai-settings-panel">
      <div className="surface no-lift border border-border rounded-2xl p-4 flex items-start gap-3">
        <div className="icon-chip w-11 h-11 rounded-xl"><MorphIcon icon={AiPhone} className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold">{t("aiVoice.admin.title")}</p>
            <Badge tone={on ? "green" : "gray"}>{on ? t("aiVoice.admin.status.on") : t("aiVoice.admin.status.off")}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t("aiVoice.admin.subtitle")}</p>
        </div>
      </div>
      {!view.status.aiVoiceEnabled && <Notice testId="ai-server-off">{t("aiVoice.admin.status.serverOff")}</Notice>}
      {!view.status.companyActive && <Notice tone="warn">{t("aiVoice.admin.status.companyInactive")}</Notice>}

      <div className="md:grid md:grid-cols-[210px_minmax(0,1fr)] md:gap-4 md:items-start">
        <nav aria-label={t("aiVoice.admin.title")}
          className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 md:flex-col md:overflow-visible md:p-2 md:mx-0 md:border md:border-border md:rounded-2xl md:bg-card md:sticky md:top-4">
          {TABS.map(({ key, icon }) => (
            <button key={key} type="button" onClick={() => setTab(key)} data-testid={`ai-tab-${key}`} aria-current={tab === key ? "page" : undefined}
              className={`flex items-center gap-2 h-9 md:h-10 px-3.5 rounded-full md:rounded-xl text-[13px] font-semibold whitespace-nowrap flex-shrink-0 liquid-transition ${tab === key ? "bg-primary text-primary-foreground border border-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-border md:border-transparent bg-card/60 md:bg-transparent"}`}>
              <MorphIcon icon={icon} className="w-4 h-4" />{t(`aiVoice.admin.tabs.${key}`)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 mt-2 md:mt-0">
          <Suspense fallback={<Skeleton />}>
            {tab === "general" && <General {...sp} />}
            {tab === "schedule" && <Schedule {...sp} />}
            {tab === "channels" && <Channels {...sp} />}
            {tab === "employees" && <Employees canEditBoss={view.editor.canEditBossRows} />}
            {tab === "tools" && <ToolsMatrix {...sp} />}
            {tab === "provider" && <Provider {...sp} />}
            {tab === "limits" && <LimitsCost {...sp} />}
            {tab === "audit" && <AuditLog />}
            {tab === "test" && <TestCall view={view} draft={draft} />}
          </Suspense>
          {serverErrors.length > 0 && (
            <div className="mt-3"><Notice tone="warn"><ul className="space-y-0.5">{serverErrors.map((e) => <li key={e}>{e}</li>)}</ul></Notice></div>
          )}
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
