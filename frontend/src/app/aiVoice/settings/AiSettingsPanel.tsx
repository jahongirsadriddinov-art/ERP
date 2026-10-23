import "../../i18n/aiVoiceNs";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import AiPhone from "@hugeicons/core-free-icons/AiPhone01Icon";
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
import QuickSchedule from "./sections/QuickSchedule";
import QuickChannels from "./sections/QuickChannels";

// AI yordamchi — firma sozlamalari (egasi / direktor / o'rinbosar). Owner 2026-10-16: "soddalashtir" — BITTA
// ekran, 3 ta aniq blok: (1) AI holati — katta kalit + rost holat qatori, (2) Ish jadvali, (3) Kimga va qanday.
// Qolgan hammasi (xodimlar, ruxsatlar, tartib, tarix, sinov) — bitta "Qo'shimcha sozlamalar" ichida.
// AI miyasi va limit/xarajat bu yerda YO'Q — faqat dasturchi paneli. Bitta qoralama: "Saqlash" faqat o'zgargan
// qismlarni versiya bilan yuboradi (409 — eng so'nggi holat yuklanadi). Saqlangach server qayta so'raladi.
const Advanced = lazy(() => import("./sections/Advanced"));

type LoadState = "loading" | "ready" | "feature" | "forbidden" | "notReady" | "network" | "error";

export default function AiSettingsPanel() {
  const { t } = useTranslation();
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [draft, setDraft] = useState<AiSettingsData | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [shiftIdx, setShiftIdx] = useState(0);

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

  if (state === "loading") return <div data-testid="ai-settings-panel" className="space-y-4"><Skeleton h="h-36" /><Skeleton h="h-64" /></div>;
  if (state !== "ready" || !view || !draft) {
    const msg = state === "feature" ? t("aiVoice.admin.status.feature") : state === "forbidden" ? t("aiVoice.admin.status.forbidden")
      : state === "notReady" ? t("aiVoice.common.notReady") : state === "network" ? t("aiVoice.common.network") : t("aiVoice.common.error");
    const next = state === "feature" ? t(`aiVoice.ui.state.featureNext.${group === "boss" || group === "deputy" ? group : "other"}`) : "";
    return (
      <div className="space-y-3" data-testid="ai-settings-panel">
        <div className="surface no-lift border border-border rounded-2xl p-4 flex items-center gap-3">
          <div className="icon-chip w-11 h-11 rounded-xl flex-shrink-0"><MorphIcon icon={AiPhone} className="w-5 h-5" /></div>
          <div className="flex items-center gap-2 min-w-0"><p className="text-sm font-bold">{t("aiVoice.admin.title")}</p><BetaBadge /></div>
        </div>
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

  const sp = { view, draft, update, shiftIdx, setShiftIdx };
  return (
    <div className="space-y-4" data-testid="ai-settings-panel">
      <PowerCard view={view} draft={draft} group={group} onToggle={(v) => update((d) => ({ ...d, enabled: v }))} />
      <RoleHelp area="admin" group={group} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <QuickSchedule {...sp} />
        <QuickChannels {...sp} />
      </div>

      <Suspense fallback={<Skeleton h="h-16" />}><Advanced {...sp} /></Suspense>

      {serverErrors.length > 0 && (
        <Notice tone="warn"><ul className="space-y-0.5">{serverErrors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>
      )}
      <div aria-hidden className="h-2" data-testid="ai-settings-end" />

      {dirty && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+96px)] lg:bottom-4 z-20" data-testid="ai-save-bar">
          <div className="surface no-lift border border-primary/30 rounded-2xl p-3 flex items-center gap-2 shadow-lg">
            <p className="flex-1 min-w-0 text-xs sm:text-sm font-semibold leading-snug line-clamp-2">
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

/**
 * 1-blok "AI holati": katta kalit (qoralama) + ROST holat (saqlangan server holati bo'yicha). Ishlayapti — bitta
 * yashil qator; aks holda faqat bajarilmagan shartlar va har biriga rolga mos keyingi qadam.
 */
function PowerCard({ view, draft, group, onToggle }: {
  view: AiSettingsView; draft: AiSettingsData; group: RoleGroup; onToggle: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const s = (k: string) => t(`aiVoice.ui.state.${k}`);
  const who = group === "deputy" ? "deputy" : "boss";
  const blocks = companyBlocks(view);
  const label = companyAiLabel(blocks);
  const on = draft.enabled;
  const pending = draft.enabled !== view.settings.enabled ? (draft.enabled ? "pendingOn" : "pendingOff") : null;
  const checks: { key: CompanyBlock; label: string }[] = [
    { key: "plan", label: s("checkPlan") }, { key: "inactive", label: s("checkActive") },
    { key: "server", label: s("checkServer") }, { key: "company", label: s("checkCompany") },
  ];
  const tone = label === "on" ? "border-emerald-500/35 bg-emerald-500/[0.06]" : label === "blocked" ? "border-amber-500/35 bg-amber-500/[0.05]" : "border-border surface no-lift";

  return (
    <section className={`rounded-2xl border p-4 sm:p-5 liquid-transition ${tone}`} data-testid="ai-power">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 liquid-transition ${label === "on" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "icon-chip"}`}>
          <MorphIcon icon={AiPhone} className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-base font-bold leading-tight">{t("aiVoice.ui.simple.powerTitle")}</h2>
            <BetaBadge />
            <span data-testid="ai-status-badge" data-state={label}>
              <Badge tone={label === "on" ? "green" : label === "blocked" ? "amber" : "gray"}>{s(label)}</Badge>
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed hidden sm:block">{t("aiVoice.ui.intro")}</p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label={t("aiVoice.ui.simple.powerTitle")} data-testid="ai-enabled"
          onClick={() => onToggle(!on)}
          className={`relative w-14 h-8 rounded-full flex-shrink-0 liquid-transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${on ? "bg-emerald-500" : "bg-muted-foreground/30"}`}>
          <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow liquid-transition ${on ? "translate-x-6" : ""}`} />
        </button>
      </div>
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed sm:hidden">{t("aiVoice.ui.intro")}</p>

      <div className="mt-3 pt-3 border-t border-border/60" data-testid="ai-status" data-state={label} role="status">
        {!blocks.length ? (
          <p className="text-xs flex items-start gap-2"><MorphIcon icon={Ok} className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />{s("onLine")}</p>
        ) : (
          <>
          <p className="text-xs font-bold mb-2">{s("why")}</p>
          <ul className="space-y-2">
            {checks.filter((c) => blocks.includes(c.key)).map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-xs" data-testid={`ai-check-${c.key}`} data-ok="0">
                <MorphIcon icon={No} className="w-4 h-4 flex-shrink-0 mt-px text-red-600 dark:text-red-400" />
                <span className="min-w-0">
                  <span className="font-semibold">{c.label}</span>
                  <span className="block text-muted-foreground mt-0.5">
                    {c.key === "company" ? t(`aiVoice.ui.simple.companyOff.${who}`) : t(`aiVoice.ui.state.next.${c.key}.${who}`)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          </>
        )}
        {pending && <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mt-2" data-testid="ai-status-pending">{s(pending)}</p>}
      </div>
    </section>
  );
}
