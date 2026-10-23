import "../../../i18n/aiVoiceNs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Route from "@hugeicons/core-free-icons/UserMultiple02Icon";
import Telegram from "@hugeicons/core-free-icons/TelegramIcon";
import Call from "@hugeicons/core-free-icons/Call02Icon";
import Phone from "@hugeicons/core-free-icons/SmartPhone01Icon";
import Ok from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Alert from "@hugeicons/core-free-icons/Alert02Icon";
import Shield from "@hugeicons/core-free-icons/Shield01Icon";
import { adminApi, AI_ROLES, type AiChannelsStatus, type ChannelName } from "../api";
import type { ShiftProps } from "../sectionProps";
import { shiftIndex, shiftUpdater } from "../sectionProps";
import { normalizeHHmm, setChannelEnabled } from "../scheduleHelpers";
import { Card, Chip, TimeField, Toggle } from "../ui";

// 3-blok "Kimga va qanday" (owner 2026-10-16): uchta oddiy kalit — Telegram xabar, Telegram qo'ng'iroq,
// ilovada qo'ng'iroq (fallbackOrder'ga qo'shiladi/olib tashlanadi, standart joyiga). Telegram qo'ng'irog'i
// uchun ROST holat: AI akkaunti va qo'ng'iroq xizmati ulanganmi. Tartibni o'zgartirish — "Qo'shimcha"da.
// Owner 2026-10-17: kompaniya roziligi (calls.companyConsent) va tinch soatlar ham shu yerda — bir joyda.
const MAIN: { c: ChannelName; icon: any }[] = [
  { c: "bot_message", icon: Telegram }, { c: "telegram_call", icon: Call }, { c: "inapp_call", icon: Phone },
];

export default function QuickChannels({ view, draft, update, shiftIdx }: ShiftProps) {
  const { t } = useTranslation();
  const u = (s: string) => t(`aiVoice.ui.simple.${s}`);
  const order = draft.fallbackOrder;
  const [status, setStatus] = useState<AiChannelsStatus | null>(null);
  useEffect(() => {
    let live = true;
    adminApi.getChannelsStatus().then((r) => { if (live && r.ok && r.data?.telegramAccount) setStatus(r.data); });
    return () => { live = false; };
  }, []);
  const tgReady = status ? status.telegramAccount.status === "connected" && status.telegramAccount.workerConnected : null;

  const i = shiftIndex(draft, shiftIdx);
  const shift = draft.attendance.shifts[i];
  const setShift = shiftUpdater(update, i);
  const canEditRoles = view.editor.canEditSchedule;

  const consent = draft.calls.companyConsent !== false;
  const quiet = draft.calls.quietHours;
  const setQuiet = (q: { from: string; to: string }) => update((d) => ({ ...d, calls: { ...d.calls, quietHours: q } }));

  return (
    <Card icon={Route} title={u("channelsTitle")} hint={u("channelsHint")} testId="ai-quick-channels">
      {"companyConsent" in draft.calls && (
        <div className={`rounded-xl border px-3 mb-3 liquid-transition ${consent ? "border-border bg-card/60" : "border-amber-500/35 bg-amber-500/[0.05]"}`}>
          <Toggle testId="ai-company-consent" icon={Shield} checked={consent}
            label={<span className="font-semibold">{u("consentTitle")}</span>} hint={u(consent ? "consentOn" : "consentOff")}
            onChange={(v) => update((d) => ({ ...d, calls: { ...d.calls, companyConsent: v } }))} />
        </div>
      )}
      <div className="rounded-xl border border-border bg-card/60 px-3 divide-y divide-border/60">
        {MAIN.map(({ c, icon }) => {
          const on = order.includes(c);
          const last = on && order.length <= 1;
          return (
            <div key={c} className="py-0.5">
              <Toggle testId={`ai-ch-${c}`} icon={icon} checked={on} disabled={last} title={last ? u("lastOne") : undefined}
                label={<span className="font-semibold">{u(`ch.${c}.title`)}</span>} hint={u(`ch.${c}.hint`)}
                onChange={(v) => update((d) => ({ ...d, fallbackOrder: setChannelEnabled(d.fallbackOrder, c, v) }))} />
              {c === "telegram_call" && on && tgReady !== null && (
                <p data-testid="ai-tg-ready" data-ok={tgReady ? "1" : "0"}
                  className={`ml-12 mb-2 text-[11px] flex items-start gap-1.5 ${tgReady ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                  <MorphIcon icon={tgReady ? Ok : Alert} className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                  <span>{u(tgReady ? "tgReady" : "tgNotReady")}</span>
                </p>
              )}
              {c === "telegram_call" && on && (
                <p className="ml-12 mb-2 text-[11px] text-muted-foreground" data-testid="ai-tg-one-call">{u("tgOneAtATime")}</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 text-[11px] text-muted-foreground leading-relaxed" data-testid="ai-order-line">
        <span className="font-semibold">{u("order")}: </span>
        {order.map((c, j) => (
          <span key={c}>{j > 0 && <span aria-hidden className="mx-1 opacity-60">→</span>}{t(`aiVoice.admin.channels.names.${c}`)}</span>
        ))}
      </p>

      {quiet && (
        <div className="mt-4" data-testid="ai-quiet">
          <p className="text-xs font-semibold text-muted-foreground">{u("quietTitle")}</p>
          <p className="text-[11px] text-muted-foreground mb-2">{u("quietHint")}</p>
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <TimeField label={u("quietFrom")} value={quiet.from} testId="ai-quiet-from"
              onChange={(v) => { const n = normalizeHHmm(v); if (n) setQuiet({ ...quiet, from: n }); }} />
            <TimeField label={u("quietTo")} value={quiet.to} testId="ai-quiet-to"
              onChange={(v) => { const n = normalizeHHmm(v); if (n) setQuiet({ ...quiet, to: n }); }} />
          </div>
        </div>
      )}

      {shift && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">{u("who")}</p>
          <div className="flex flex-wrap gap-2">
            {AI_ROLES.map((r) => (
              <Chip key={r} active={shift.roles.includes(r)} disabled={!canEditRoles} testId={`ai-role-${r}`}
                onClick={() => setShift((s) => ({ ...s, roles: s.roles.includes(r) ? s.roles.filter((x) => x !== r) : AI_ROLES.filter((x) => x === r || s.roles.includes(x)) }))}>
                {t(`aiVoice.admin.employees.roles.${r}`)}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
