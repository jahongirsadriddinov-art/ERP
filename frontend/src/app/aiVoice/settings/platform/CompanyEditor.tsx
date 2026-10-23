import "../../../i18n/aiVoiceNs";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Brain from "@hugeicons/core-free-icons/AiBrain01Icon";
import Wallet from "@hugeicons/core-free-icons/Wallet01Icon";
import { isNotReady, platformApi, type PlatformCompanyView } from "../api";
import { Badge, Notice, NumField, SelectField, Skeleton, TextField, Toggle, fmtUsd } from "../ui";
import { companyPatch, draftOf, validateLimits, type PlatformDraft } from "./helpers";

// Bitta firma (faqat dasturchi): AI kaliti, AI miyasi (matn provayderi + zaxira + chuqurlik), ovoz provayderi va
// modellar, limitlar. To'liq sozlama GET /platform/companies/:id dan (versiya bilan) olinadi, PATCH {version, patch}
// bilan saqlanadi; boshqa joyda o'zgargan bo'lsa (409) — eng so'nggi holat yuklanadi. API kalitlari FAQAT serverda.
export default function CompanyEditor({ companyId, onSaved }: { companyId: string; onSaved: (v: PlatformCompanyView) => void }) {
  const { t } = useTranslation();
  const p = (s: string) => t(`aiVoice.admin.provider.${s}`);
  const l = (s: string) => t(`aiVoice.admin.limits.${s}`);
  const pk = (s: string) => t(`aiVoice.platform.${s}`);
  const [view, setView] = useState<PlatformCompanyView | null | false | "nr">(null);
  const [d, setD] = useState<PlatformDraft>(() => draftOf(null));
  const [busy, setBusy] = useState(false);

  const apply = useCallback((v: PlatformCompanyView) => { setView(v); setD(draftOf(v.settings)); }, []);
  const load = useCallback(() => {
    setView(null);
    platformApi.getCompany(companyId).then((r) => {
      // 404 {error:"not_found"} — firma yo'q (xato); tanasiz 404/501 — yo'l serverda hali yo'q (yumshoq xabar)
      if (r.ok && r.data?.settings) apply(r.data); else setView(r.status === 501 || (r.status === 404 && r.error === "http_404") ? "nr" : false);
    });
  }, [companyId, apply]);
  useEffect(() => { load(); }, [load]);

  if (view === null) return <Skeleton h="h-40" />;
  if (view === "nr") return <Notice>{pk("notReady")}</Notice>;
  if (view === false) return (
    <div className="space-y-2">
      <Notice tone="warn">{t("aiVoice.common.error")}</Notice>
      <button type="button" onClick={load} className="h-10 px-4 rounded-xl border border-border text-sm font-semibold">{t("aiVoice.common.retry")}</button>
    </div>
  );

  const server = draftOf(view.settings);
  const patch = companyPatch(server, d);
  const dirty = Object.keys(patch).length > 0;
  const valid = validateLimits(d.limits);
  const { brain, limits: L, provider: prov } = d;
  const setBrain = (b: Partial<PlatformDraft["brain"]>) => setD((x) => ({ ...x, brain: { ...x.brain, ...b } }));
  const setL = (b: Partial<PlatformDraft["limits"]>) => setD((x) => ({ ...x, limits: { ...x.limits, ...b } }));
  const setProv = (b: Partial<PlatformDraft["provider"]>) => setD((x) => ({ ...x, provider: { ...x.provider, ...b } }));
  const keyBadge = (name: "gemini" | "openrouter" | "claude") => (
    <Badge key={name} tone={view.providers?.[name] ? "green" : "gray"}>{p(name)}: {view.providers?.[name] ? t("aiVoice.common.configured") : t("aiVoice.common.notConfigured")}</Badge>
  );

  const save = async () => {
    setBusy(true);
    const r = await platformApi.patchCompany(companyId, view.settings.version, patch);
    setBusy(false);
    if (r.ok && r.data?.settings) { apply(r.data); onSaved(r.data); toast.success(pk("saved")); return; }
    if (r.status === 409 && r.errorData?.current?.settings) { apply(r.errorData.current); onSaved(r.errorData.current); toast.error(pk("conflict")); return; }
    if (r.status === 400 && Array.isArray(r.errorData?.errors)) { toast.error(String(r.errorData.errors[0] || t("aiVoice.admin.status.invalid"))); return; }
    toast.error(isNotReady(r) ? pk("notReady") : r.status === 0 ? t("aiVoice.common.network") : t("aiVoice.common.error"));
  };

  return (
    <div className="space-y-4" data-testid={`ai-pf-editor-${companyId}`}>
      <div className="rounded-xl border border-border bg-card/60 px-3">
        <Toggle testId={`ai-pf-editor-enabled-${companyId}`} checked={d.enabled} label={<span className="font-semibold">{pk("allowed")}</span>}
          hint={view.status.planHasFeature === false ? pk("planWarn") : pk("enabledHint")} onChange={(v) => setD((x) => ({ ...x, enabled: v }))} />
      </div>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {pk("month")}: <b className="text-foreground">${fmtUsd(view.month.costUsdMicros)}</b>{view.month.budgetUsd > 0 ? ` / $${view.month.budgetUsd}` : ""}
        {view.month.exceeded && <> · <span className="text-red-600 dark:text-red-400 font-semibold">{l("exceeded")}</span></>}
      </p>

      <section>
        <p className="text-xs font-bold flex items-center gap-1.5 mb-2"><MorphIcon icon={Brain} className="w-4 h-4" />{pk("brain")}</p>
        <div className="flex flex-wrap gap-1.5 mb-3">{(["gemini", "openrouter", "claude"] as const).map(keyBadge)}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SelectField label={p("brain")} value={brain.provider} onChange={(v) => setBrain({ provider: v })}
            options={[{ value: "gemini", label: p("gemini") }, { value: "claude", label: p("claude") }]} />
          <SelectField label={p("fallback")} value={brain.fallback} onChange={(v) => setBrain({ fallback: v })}
            options={[{ value: "openrouter", label: p("openrouter") }, { value: "none", label: p("none") }]} />
          <SelectField label={p("effort")} value={brain.effort} onChange={(v) => setBrain({ effort: v })}
            options={(["low", "medium", "high"] as const).map((v) => ({ value: v, label: t(`aiVoice.admin.provider.efforts.${v}`) }))} />
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField label={`${p("voice")} — ${p("primary")}`} value={prov.primary} onChange={(v) => setProv({ primary: v })}
            options={[{ value: "gemini_live", label: p("live") }, { value: "gemini_cascade", label: p("cascade") }]} />
          <SelectField label={`${p("voice")} — ${p("fallback")}`} value={prov.fallback} onChange={(v) => setProv({ fallback: v })}
            options={[{ value: "gemini_cascade", label: p("cascade") }, { value: "none", label: p("none") }]} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 mb-2">{p("models")} — {p("modelsHint")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(["liveModel", "textModel", "ttsModel", "transcribeModel"] as const).map((m) => (
            <TextField key={m} label={m} value={prov[m] || ""} maxLength={64} placeholder="—"
              onChange={(v) => setProv({ [m]: v.replace(/[^A-Za-z0-9._-]/g, "") })} />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">{p("keysNote")}</p>
      </section>

      <section>
        <p className="text-xs font-bold flex items-center gap-1.5 mb-2"><MorphIcon icon={Wallet} className="w-4 h-4" />{pk("limits")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <NumField label={l("budget")} value={L.monthlyBudgetUsd} min={0} max={10000} suffix="$" testId={`ai-pf-budget-${companyId}`} onChange={(v) => setL({ monthlyBudgetUsd: v })} />
          <NumField label={l("sessionsPerHour")} value={L.userSessionsPerHour} min={0} max={60} onChange={(v) => setL({ userSessionsPerHour: v })} />
          <NumField label={l("minutesPerDay")} value={L.companyMinutesPerDay} min={0} max={10000} onChange={(v) => setL({ companyMinutesPerDay: v })} />
          <NumField label={l("botMsgs")} value={L.botMsgsPer10Min} min={1} max={200} onChange={(v) => setL({ botMsgsPer10Min: v })} />
          <NumField label={l("toolCalls")} value={L.toolCallsPerSession} min={1} max={100} onChange={(v) => setL({ toolCallsPerSession: v })} />
        </div>
        <Toggle checked={L.hardStop} label={l("hardStop")} hint={l("hardStopHint")} onChange={(v) => setL({ hardStop: v })} />
        <div className="mt-1"><Badge tone="green">{l("recordAudio")}</Badge></div>
      </section>

      {!valid && <p className="text-xs text-red-600 dark:text-red-400">{pk("invalid")}</p>}
      {dirty && (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => setD(server)}
            className="h-10 px-3 rounded-xl border border-border text-sm font-semibold">{t("aiVoice.common.cancel")}</button>
          <button type="button" disabled={busy || !valid} data-testid={`ai-pf-save-${companyId}`} onClick={save}
            className="btn btn-primary h-10 px-4 rounded-xl text-sm font-bold disabled:opacity-60">{busy ? t("aiVoice.common.saving") : t("aiVoice.common.save")}</button>
        </div>
      )}
    </div>
  );
}
