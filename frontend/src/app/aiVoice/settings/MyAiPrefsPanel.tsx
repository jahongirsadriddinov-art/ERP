import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Bell from "@hugeicons/core-free-icons/Notification03Icon";
import Phone from "@hugeicons/core-free-icons/AiPhone01Icon";
import Route from "@hugeicons/core-free-icons/Message01Icon";
import Moon from "@hugeicons/core-free-icons/Moon02Icon";
import Stop from "@hugeicons/core-free-icons/Cancel01Icon";
import Task from "@hugeicons/core-free-icons/Task01Icon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import BetaBadge from "../BetaBadge";
import { isNotReady, meApi, type ApiResult, type AiMePrefs, type AiMePrefsPatch, type AiReminder, type ChannelName } from "./api";
import { prefsLock, readCurrentUser, roleGroup, telegramCallNote, type PrefsArea, type PrefsLock } from "./aiAccess";
import RoleHelp from "./RoleHelp";
import { addChannel, isHHmm, normalizeHHmm, removeChannel } from "./scheduleHelpers";
import { Badge, Card, Chip, Notice, Skeleton, TimeField, Toggle, type Tone } from "./ui";

// AI ovozli yordamchi — har bir xodimning shaxsiy sozlamalari (/api/ai-voice/me, P3 backend): Telegram
// qo'ng'iroq roziligi, murojaat kanallari, shaxsiy tinch soatlar (server qo'llasa), voz kechish va eslatmalarim.
// Rozilik va voz kechishni FAQAT xodimning o'zi o'zgartiradi. Server hali tayyor bo'lmasa (501/404) — yumshoq xabar.
// Owner 2026-10-15: izoh rolga mos (direktor / o'rinbosar / prorab-brigadir / ishchi); o'chiq tugma YONIDA nega
// o'chiqligi yoziladi (AI firmada ishlamayapti, tarifda yo'q, "Hammasidan" voz kechilgan, saqlanmoqda).
const MY_CHANNELS: ChannelName[] = ["bot_message", "telegram_call", "inapp_call", "push"];
const CONSENT_TONE: Record<string, Tone> = { granted: "green", requested: "amber", revoked: "red", none: "gray" };
const looksLikePrefs = (v: any): v is AiMePrefs => !!v && typeof v === "object" && !!v.optOut && typeof v.callConsent === "string";

export default function MyAiPrefsPanel() {
  const { t, i18n } = useTranslation();
  const k = (s: string) => t(`aiVoice.prefs.${s}`);
  const [prefs, setPrefs] = useState<AiMePrefs | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notReady" | "error">("loading");
  const [reminders, setReminders] = useState<AiReminder[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    const [p, r] = await Promise.all([meApi.get(), meApi.reminders()]);
    if (p.ok && looksLikePrefs(p.data)) { setPrefs(p.data); setState("ready"); }
    else setState(isNotReady(p) || (p.ok && !looksLikePrefs(p.data)) ? "notReady" : "error");
    if (r.ok) setReminders(Array.isArray(r.data) ? r.data : Array.isArray((r.data as any)?.reminders) ? (r.data as any).reminders : []);
    else setReminders(isNotReady(r) ? null : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Optimistik saqlash: xato bo'lsa avvalgi holat qaytariladi. */
  const save = async (body: AiMePrefsPatch, optimistic: (p: AiMePrefs) => AiMePrefs) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs(optimistic(prefs));
    setBusy(true);
    const r = await meApi.patch(body);
    setBusy(false);
    if (r.ok) { if (looksLikePrefs(r.data)) setPrefs(r.data); toast.success(k("saved")); }
    else { setPrefs(before); toast.error(errText(r)); }
  };
  const errText = (r: ApiResult<unknown>) =>
    r.error === "ai_disabled" ? k("aiOff") : r.error === "tg_conflict" ? k("tgConflict") : isNotReady(r) ? t("aiVoice.common.notReady")
      : r.status === 0 ? t("aiVoice.common.network") : t("aiVoice.common.error");

  const me = readCurrentUser();
  const group = roleGroup(me.role, me.isOwner);
  const header = (
    <div className="surface no-lift border border-border rounded-2xl p-4 flex items-start gap-3">
      <div className="icon-chip w-11 h-11 rounded-xl flex-shrink-0"><MorphIcon icon={Bell} className="w-5 h-5" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold">{k("title")}</p><BetaBadge /></div>
        <p className="text-xs text-muted-foreground mt-1">{k("subtitle")}</p>
      </div>
    </div>
  );

  if (state === "loading") return <div data-testid="ai-prefs-panel"><Skeleton h="h-48" /></div>;
  if (state !== "ready" || !prefs) {
    return (
      <div className="space-y-3" data-testid="ai-prefs-panel">
        {header}
        <Notice tone={state === "notReady" ? "info" : "warn"}>{state === "notReady" ? k("notReady") : t("aiVoice.common.error")}</Notice>
        {state === "error" && <button type="button" onClick={load} className="h-10 px-4 rounded-xl border border-border text-sm font-semibold">{t("aiVoice.common.retry")}</button>}
      </div>
    );
  }

  const fmt = new Intl.DateTimeFormat(i18n.language === "ru" ? "ru-RU" : "uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
  const granted = prefs.callConsent === "granted";
  const quietSupported = "quietHours" in prefs;
  const quiet = prefs.quietHours;
  // AI firmada o'chiq — holat ko'rinadi, lekin o'zgartirib bo'lmaydi (server 403 qaytaradi)
  const aiOff = prefs.status?.aiActive === false;
  const lockOf = (a: PrefsArea) => prefsLock(prefs, a, busy);
  const why = (l: PrefsLock | null) => (l ? t(`aiVoice.prefs.why.${l}`) : undefined);
  const globalLock = lockOf("consent"); // aiOff/plan bo'lsa hamma joy uchun bir xil sabab
  const tgNote = telegramCallNote(prefs);

  return (
    <div className="space-y-4" data-testid="ai-prefs-panel">
      {header}
      <RoleHelp area="prefs" group={group} />
      {aiOff && (
        <div id="ai-prefs-why" role="status">
          <Notice tone="lock" testId="ai-prefs-off">
            <p className="font-semibold">{why(globalLock)}</p>
            <p className="mt-0.5">{t(`aiVoice.prefs.why.${group === "boss" || group === "deputy" ? "nextBoss" : "nextOther"}`)}</p>
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <Card icon={Phone} title={k("consent.title")} hint={k("consent.hint")}
            right={<Badge tone={CONSENT_TONE[prefs.callConsent] || "gray"}>{t(`aiVoice.prefs.consent.state.${prefs.callConsent}`)}</Badge>}>
            <button type="button" disabled={!!lockOf("consent")} data-testid="ai-consent-btn" title={why(lockOf("consent"))}
              aria-describedby={aiOff ? "ai-prefs-why" : undefined}
              onClick={() => save({ callConsent: granted ? "revoked" : "granted" }, (p) => ({ ...p, callConsent: granted ? "revoked" : "granted" }))}
              className={granted ? "h-10 px-4 rounded-xl border border-red-500/40 text-red-600 dark:text-red-400 text-sm font-bold hover:bg-red-500/10 disabled:opacity-60"
                : "btn btn-primary h-10 px-4 rounded-xl text-sm font-bold disabled:opacity-60"}>
              {granted ? k("consent.revoke") : k("consent.grant")}
            </button>
            <Why lock={lockOf("consent")} />
            {!aiOff && prefs.status?.telegramLinked === false && <p className="text-[11px] text-muted-foreground mt-2" data-testid="ai-consent-note">{k("why.consentNotLinked")}</p>}
          </Card>

          <Card icon={Route} title={k("channels.title")} hint={k("channels.hint")}>
            <div className="flex flex-wrap gap-2">
              {MY_CHANNELS.map((c) => {
                const on = !prefs.disabledChannels.includes(c);
                const next = on ? addChannel(prefs.disabledChannels, c) : removeChannel(prefs.disabledChannels, c);
                return (
                  <Chip key={c} active={on} disabled={!!lockOf("channels")} testId={`ai-my-ch-${c}`} title={why(lockOf("channels"))}
                    onClick={() => save({ disabledChannels: next }, (p) => ({ ...p, disabledChannels: next }))}>
                    {t(`aiVoice.admin.channels.names.${c}`)}
                  </Chip>
                );
              })}
            </div>
            <Why lock={lockOf("channels")} testId="ai-why-channels" />
            {!lockOf("channels") && tgNote && <p className="text-[11px] text-muted-foreground mt-2" data-testid="ai-tg-note">{k(`why.${tgNote}`)}</p>}
          </Card>

          {quietSupported && (
            <Card icon={Moon} title={k("quiet.title")} hint={k("quiet.hint")}>
              <Toggle checked={!!quiet} label={k("quiet.enable")} disabled={!!lockOf("quiet")}
                onChange={(v) => {
                  const q = v ? { from: "21:00", to: "07:00" } : null;
                  save({ quietHours: q }, (p) => ({ ...p, quietHours: q }));
                }} />
              {quiet && (
                <div className="grid grid-cols-2 gap-3 max-w-sm mt-2">
                  {(["from", "to"] as const).map((side) => (
                    <TimeField key={side} label={t(`aiVoice.admin.channels.${side}`)} value={quiet[side]} disabled={!!lockOf("quiet")}
                      onChange={(v) => {
                        const n = normalizeHHmm(v);
                        if (!n || !isHHmm(n) || n === quiet[side]) return;
                        const q = { ...quiet, [side]: n };
                        save({ quietHours: q }, (p) => ({ ...p, quietHours: q }));
                      }} />
                  ))}
                </div>
              )}
              <Why lock={lockOf("quiet")} />
            </Card>
          )}

          <Card icon={Stop} title={k("optOut.title")} hint={k("optOut.hint")}>
            <div className="divide-y divide-border/60">
              {(["calls", "reminders", "all"] as const).map((x) => {
                const l = lockOf(x === "all" ? "optOutAll" : "optOut");
                return (
                  <Toggle key={x} checked={prefs.optOut[x]} label={k(`optOut.${x}`)} disabled={!!l} testId={`ai-optout-${x}`}
                    hint={l && l !== "busy" && !aiOff ? <span className="inline-flex items-start gap-1"><MorphIcon icon={Lock} className="w-3 h-3 mt-0.5 flex-shrink-0" />{why(l)}</span> : undefined}
                    onChange={(v) => save({ optOut: { [x]: v } }, (p) => ({ ...p, optOut: { ...p.optOut, [x]: v } }))} />
                );
              })}
            </div>
            {aiOff && <Why lock={globalLock} />}
          </Card>
        </div>

        <Card icon={Task} title={k("reminders.title")}>
          {reminders === null ? <Notice>{t("aiVoice.common.notReady")}</Notice> : reminders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{k("reminders.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {reminders.map((r) => (
                <li key={r.id} className="rounded-xl border border-border bg-card/60 px-3 py-2.5 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium break-words">{r.text}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[11px] text-muted-foreground tabular-nums">{fmt.format(new Date(r.nextFireAt || r.dueAt))}</span>
                      <Badge tone="sky">{t(`aiVoice.prefs.reminders.freq.${r.recurrence?.freq || "none"}`)}</Badge>
                      {r.status !== "active" && <Badge>{t(`aiVoice.prefs.reminders.status.${r.status}`)}</Badge>}
                    </div>
                  </div>
                  {r.status === "active" && r.canCancel !== false && (
                    <button type="button" disabled={aiOff} title={aiOff ? why(globalLock) : undefined} aria-describedby={aiOff ? "ai-prefs-why" : undefined} className="h-8 px-2.5 rounded-lg border border-border text-xs font-semibold flex-shrink-0 hover:border-red-500/50 disabled:opacity-50"
                      onClick={async () => {
                        const res = await meApi.cancelReminder(r.id);
                        if (res.ok) { setReminders((l) => l?.map((x) => (x.id === r.id ? { ...x, status: "cancelled" } : x)) || null); toast.success(k("reminders.cancelled")); }
                        else toast.error(errText(res));
                      }}>
                      {k("reminders.cancel")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** O'chiq boshqaruv YONIDAGI sabab. busy (saqlanmoqda) — ko.rsatilmaydi. */
function Why({ lock, testId }: { lock: PrefsLock | null; testId?: string }) {
  const { t } = useTranslation();
  if (!lock || lock === "busy") return null;
  return (
    <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1.5" data-testid={testId} data-lock={lock}>
      <MorphIcon icon={Lock} className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
      <span>{t(`aiVoice.prefs.why.${lock}`)}</span>
    </p>
  );
}
