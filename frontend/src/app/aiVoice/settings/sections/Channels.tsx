import "../../../i18n/aiVoiceNs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Up from "@hugeicons/core-free-icons/ArrowUp01Icon";
import Down from "@hugeicons/core-free-icons/ArrowDown01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Plus from "@hugeicons/core-free-icons/Add01Icon";
import Route from "@hugeicons/core-free-icons/Message01Icon";
import Bell from "@hugeicons/core-free-icons/Notification03Icon";
import Telegram from "@hugeicons/core-free-icons/TelegramIcon";
import type { SectionProps } from "../sectionProps";
import { adminApi, CHANNEL_NAMES, type AiChannelsStatus } from "../api";
import { addChannel, missingChannels, moveItem, removeChannel } from "../scheduleHelpers";
import { Badge, Card, Chip, Field, More, NumField, Skeleton } from "../ui";

// "Kimga qanday murojaat": murojaat tartibi (1 → 2 → …, javob bo'lmasa keyingisi; yuqoriga/pastga, takrorsiz),
// eslatmalar qayerga boradi, ulanishlar holati (faqat o'qish). Qo'ng'iroq raqamlari — "Qo'shimcha" ichida.
export default function Channels({ draft, update }: SectionProps) {
  const { t } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`aiVoice.admin.channels.${s}`, o as any) as string;
  const name = (c: string) => k(`names.${c}`);
  const u = (s: string) => t(`aiVoice.ui.channels.${s}`);
  const order = draft.fallbackOrder;
  const calls = draft.calls;
  const setCalls = (p: Partial<typeof calls>) => update((d) => ({ ...d, calls: { ...d.calls, ...p } }));
  const [backoffText, setBackoffText] = useState(calls.backoffMin.join(", "));
  useEffect(() => { setBackoffText(calls.backoffMin.join(", ")); }, [calls.backoffMin.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const [status, setStatus] = useState<AiChannelsStatus | null | false>(null);
  useEffect(() => { adminApi.getChannelsStatus().then((r) => setStatus(r.ok && r.data?.bot && r.data?.telegramAccount ? r.data : false)); }, []);

  return (
    <div className="space-y-4">
      <Card icon={Route} title={k("order")} hint={u("intro")} testId="ai-fallback">
        <ol>
          {order.map((c, i) => (
            <li key={c}>
            {i > 0 && <p aria-hidden className="pl-[22px] py-0.5 text-[10px] text-muted-foreground flex items-center gap-1.5"><span className="block w-px h-3 bg-border" />{u("thenNext")}</p>}
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card/60 pl-3 pr-1.5 py-1.5" data-testid={`ai-fallback-${c}`}>
              <span className="w-6 h-6 rounded-full bg-primary/12 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
              <span className="flex-1 min-w-0 text-sm font-medium truncate">{name(c)}</span>
              <button type="button" onClick={() => update((d) => ({ ...d, fallbackOrder: moveItem(d.fallbackOrder, i, -1) }))} disabled={i === 0}
                aria-label={k("up")} className="btn btn-ghost w-8 h-8 p-0 rounded-full disabled:opacity-30"><MorphIcon icon={Up} className="w-4 h-4" /></button>
              <button type="button" onClick={() => update((d) => ({ ...d, fallbackOrder: moveItem(d.fallbackOrder, i, 1) }))} disabled={i === order.length - 1}
                aria-label={k("down")} className="btn btn-ghost w-8 h-8 p-0 rounded-full disabled:opacity-30"><MorphIcon icon={Down} className="w-4 h-4" /></button>
              <button type="button" onClick={() => update((d) => ({ ...d, fallbackOrder: removeChannel(d.fallbackOrder, c) }))} disabled={order.length <= 1}
                aria-label={t("aiVoice.common.remove")} className="btn btn-ghost w-8 h-8 p-0 rounded-full text-red-600 disabled:opacity-30"><MorphIcon icon={X} className="w-4 h-4" /></button>
            </div>
            </li>
          ))}
        </ol>
        {missingChannels(order).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {missingChannels(order).map((c) => (
              <button key={c} type="button" onClick={() => update((d) => ({ ...d, fallbackOrder: addChannel(d.fallbackOrder, c) }))}
                className="h-8 px-3 rounded-full border border-dashed border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/50 inline-flex items-center gap-1">
                <MorphIcon icon={Plus} className="w-3.5 h-3.5" /> {name(c)}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card icon={Bell} title={u("remindersTitle")} hint={u("remindersHint")}>
        <div className="flex flex-wrap gap-2">
          {CHANNEL_NAMES.filter((c) => c !== "notify_manager").map((c) => {
            const on = draft.reminders.defaultChannels.includes(c);
            return (
              <Chip key={c} active={on} onClick={() => update((d) => ({
                ...d, reminders: { ...d.reminders, defaultChannels: on ? removeChannel(d.reminders.defaultChannels, c) : addChannel(d.reminders.defaultChannels, c) },
              }))}>{name(c)}</Chip>
            );
          })}
        </div>
      </Card>

      <More title={u("callsMore")} hint={t("aiVoice.ui.moreHint")} testId="ai-calls-more">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <NumField label={k("maxAttempts")} value={calls.maxAttemptsPerChannel} min={1} max={5} onChange={(v) => setCalls({ maxAttemptsPerChannel: v })} />
          <NumField label={k("ringTimeout")} value={calls.ringTimeoutSec} min={15} max={90} suffix={t("aiVoice.common.sec")} onChange={(v) => setCalls({ ringTimeoutSec: v })} />
          <NumField label={k("maxDuration")} value={calls.maxDurationSec} min={30} max={600} suffix={t("aiVoice.common.sec")} onChange={(v) => setCalls({ maxDurationSec: v })} />
          <NumField label={k("assistantMax")} value={calls.assistantMaxDurationSec} min={60} max={1800} suffix={t("aiVoice.common.sec")} onChange={(v) => setCalls({ assistantMaxDurationSec: v })} />
          <NumField label={k("concurrency")} value={calls.companyConcurrency} min={1} max={10} onChange={(v) => setCalls({ companyConcurrency: v })} />
          <NumField label={k("minGap")} value={calls.minGapSec} min={0} max={600} suffix={t("aiVoice.common.sec")} onChange={(v) => setCalls({ minGapSec: v })} />
          <Field label={k("backoff")} hint={k("backoffHint")}>
            <input type="text" inputMode="numeric" value={backoffText}
              onChange={(e) => {
                setBackoffText(e.target.value);
                const nums = e.target.value.split(/[,\s]+/).filter(Boolean).map(Number);
                if (nums.length && nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 120)) setCalls({ backoffMin: nums.slice(0, 5) });
              }}
              className="h-10 w-full rounded-xl border border-border bg-card/70 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 tabular-nums" />
          </Field>
        </div>
      </More>

      <Card icon={Telegram} title={u("statusTitle")}>
        {status === null ? <Skeleton h="h-24" /> : status === false ? (
          <p className="text-xs text-muted-foreground">{t("aiVoice.common.error")}</p>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <StatusRow label={k("bot")} value={status.bot.username ? `@${status.bot.username}` : undefined} ok={status.bot.configured} t={t} />
            <StatusRow label={k("webhook")} ok={status.bot.webhookSecretConfigured} t={t} />
            <StatusRow label={k("tgAccount")} value={status.telegramAccount.username ? `@${status.telegramAccount.username}` : undefined}
              ok={status.telegramAccount.status === "connected"} badge={k(`tgStatus.${status.telegramAccount.status}`)} t={t} />
            <StatusRow label={k("worker")} ok={status.telegramAccount.workerConnected} badge={status.telegramAccount.workerConnected ? k("online") : k("offline")}
              value={`${k("dailyCalls")}: ${status.telegramAccount.dailyCallCount}/${status.telegramAccount.dailyCap}`} t={t} />
          </dl>
        )}
      </Card>
    </div>
  );
}

function StatusRow({ label, value, ok, badge, t }: { label: string; value?: string; ok: boolean; badge?: string; t: (k: string) => string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-3 py-2.5 flex items-center gap-2 min-w-0">
      <div className="flex-1 min-w-0">
        <dt className="text-xs font-semibold truncate">{label}</dt>
        {value && <dd className="text-[11px] text-muted-foreground truncate">{value}</dd>}
      </div>
      <Badge tone={ok ? "green" : "gray"}>{badge || (ok ? t("aiVoice.common.configured") : t("aiVoice.common.notConfigured"))}</Badge>
    </div>
  );
}
