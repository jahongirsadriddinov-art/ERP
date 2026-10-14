import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Users from "@hugeicons/core-free-icons/UserGroupIcon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import { adminApi, CHANNEL_NAMES, type AiEmployeeRow, type ChannelName } from "../api";
import { addChannel, removeChannel } from "../scheduleHelpers";
import { Badge, Card, Chip, Notice, Skeleton, type Tone } from "../ui";

// Xodimlar: Telegram bog'lanishi, rozilik va voz kechish holati (FAQAT ko'rish — B9), admin faqat
// ayrim kanallarni o'chira oladi (PATCH darhol saqlanadi). Telefon raqamlari ko'rsatilmaydi.
const CONSENT_TONE: Record<string, Tone> = { granted: "green", requested: "amber", revoked: "red", none: "gray" };

export default function Employees({ canEditBoss }: { canEditBoss: boolean }) {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.employees.${s}`);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AiEmployeeRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      adminApi.getEmployees(q.trim()).then((r) => { if (r.ok) { setRows(r.data.employees); setErr(false); } else { setErr(true); setRows([]); } });
    }, q ? 300 : 0);
    return () => clearTimeout(timer.current);
  }, [q]);

  const toggle = async (row: AiEmployeeRow, c: ChannelName) => {
    const next = row.disabledChannels.includes(c) ? removeChannel(row.disabledChannels, c) : addChannel(row.disabledChannels, c);
    setBusy(row.userId);
    const r = await adminApi.patchEmployee(row.userId, { disabledChannels: next });
    setBusy("");
    if (r.ok) { setRows((p) => p?.map((x) => (x.userId === row.userId ? r.data.employee : x)) || null); toast.success(k("saved")); }
    else toast.error(t("aiVoice.common.error"));
  };

  return (
    <Card icon={Users} title={t("aiVoice.admin.tabs.employees")} hint={k("hint")} testId="ai-employees">
      <div className="relative mb-3">
        <MorphIcon icon={Search} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={k("search")} aria-label={k("search")}
          className="h-10 w-full rounded-xl border border-border bg-card/70 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      {rows === null ? <Skeleton h="h-32" /> : err ? <Notice tone="warn">{t("aiVoice.common.error")}</Notice> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{k("empty")}</p>
      ) : (
        <ul className="space-y-2 md:max-h-[560px] md:overflow-y-auto md:overscroll-contain md:pr-1">
          {rows.map((r) => {
            const out = (["all", "calls", "reminders"] as const).filter((x) => r.optOut[x]);
            const locked = !canEditBoss && (r.role === "direktor");
            return (
              <li key={r.userId} className="rounded-2xl border border-border bg-card/70 p-3" data-testid={`ai-emp-${r.userId}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-sm font-bold truncate max-w-full">{r.name}</p>
                  <span className="text-[11px] text-muted-foreground">{t(`aiVoice.admin.employees.roles.${r.role}`, r.role)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <Badge tone={r.telegramLinked ? "sky" : "gray"}>{r.telegramLinked ? k("linked") : k("notLinked")}</Badge>
                  <Badge tone={CONSENT_TONE[r.callConsent] || "gray"}>{t(`aiVoice.admin.employees.consent.${r.callConsent}`, r.callConsent)}</Badge>
                  {out.length > 0 && (
                    <Badge tone="red"><MorphIcon icon={Lock} className="w-3 h-3" />{k("optedOut")}: {out.map((x) => t(`aiVoice.admin.employees.optOut.${x}`)).join(", ")}</Badge>
                  )}
                </div>
                <div className="mt-2.5">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">{k("channelsOff")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CHANNEL_NAMES.map((c) => (
                      <Chip key={c} tone="danger" active={r.disabledChannels.includes(c)} disabled={busy === r.userId || locked} onClick={() => toggle(r, c)}>
                        <span className="text-xs">{t(`aiVoice.admin.channels.names.${c}`)}</span>
                      </Chip>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
