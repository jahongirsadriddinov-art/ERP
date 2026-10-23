import "../../../i18n/aiVoiceNs";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import Users from "@hugeicons/core-free-icons/UserGroupIcon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import Calendar from "@hugeicons/core-free-icons/Calendar03Icon";
import Chevron from "@hugeicons/core-free-icons/ArrowDown01Icon";
import { adminApi, CHANNEL_NAMES, type AiEmployeeRow, type AiScheduleOverride, type AiSettingsData, type ChannelName, type IsoWeekday } from "../api";
import { addChannel, removeChannel, toggleWeekday, WEEKDAY_PRESETS, WEEKDAYS } from "../scheduleHelpers";
import { normalizeOverride, overrideSummary, sameOverride, validateOverride } from "../employeeSchedule";
import { Badge, Card, Chip, Notice, Skeleton, TimeField, Toggle, type Tone } from "../ui";

// Xodimlar: Telegram bog'lanishi, AI qo'ng'iroq qila oladimi (callsAllowed — firma roziligi), voz kechish.
// Rahbar xodim uchun "qo'ng'iroq qilinmasin" (optOut.calls) qo'ya oladi (owner 2026-10-17). Admin har bir xodimga
// alohida ish jadvali (kunlar + ixtiyoriy boshlanish vaqti; "Firma jadvali" — standart) va o'chiriladigan
// kanallarni belgilaydi (PATCH darhol saqlanadi). Telefon raqamlari ko'rsatilmaydi. Ichki skroll yo'q —
// uzun ro'yxat "Yana ko'rsatish" bilan bo'laklab ochiladi (sahifa oxirigacha tabiiy skroll qilinadi).
const CONSENT_TONE: Record<string, Tone> = { granted: "green", requested: "amber", revoked: "red", none: "gray" };
const PAGE = 30;

export default function Employees({ canEditBoss, canEditSchedule = true, draft }: { canEditBoss: boolean; canEditSchedule?: boolean; draft?: AiSettingsData }) {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.employees.${s}`);
  const e = (s: string, o?: Record<string, unknown>) => t(`aiVoice.ui.emp.${s}`, o as any) as string;
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AiEmployeeRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const companyStart = draft?.attendance.shifts[0]?.workStart;

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      adminApi.getEmployees(q.trim()).then((r) => { if (r.ok) { setRows(Array.isArray(r.data?.employees) ? r.data.employees : []); setErr(false); setLimit(PAGE); } else { setErr(true); setRows([]); } });
    }, q ? 300 : 0);
    return () => clearTimeout(timer.current);
  }, [q]);

  const patchRow = async (row: AiEmployeeRow, body: Parameters<typeof adminApi.patchEmployee>[1], okMsg: string) => {
    setBusy(row.userId);
    const r = await adminApi.patchEmployee(row.userId, body);
    setBusy("");
    // Server maydonni bilmasa (eski backend) — jim e'tiborsiz qoldiradi; "saqlandi" deb aldamaymiz
    if (r.ok && r.data?.employee && body.scheduleOverride && !r.data.employee.scheduleOverride) { toast.error(e("notSupported")); return false; }
    if (r.ok && r.data?.employee) { setRows((p) => p?.map((x) => (x.userId === row.userId ? { ...x, ...r.data.employee } : x)) || null); toast.success(okMsg); return true; }
    toast.error(r.status === 400 && "scheduleOverride" in body ? e("notSupported") : r.status === 0 ? t("aiVoice.common.network") : t("aiVoice.common.error"));
    return false;
  };

  const toggleCh = (row: AiEmployeeRow, c: ChannelName) => {
    const next = row.disabledChannels.includes(c) ? removeChannel(row.disabledChannels, c) : addChannel(row.disabledChannels, c);
    patchRow(row, { disabledChannels: next }, k("saved"));
  };

  const wd = (d: number) => t(`aiVoice.admin.schedule.wd.${d}`);
  const shown = rows ? rows.slice(0, limit) : [];

  return (
    <Card icon={Users} title={t("aiVoice.ui.tabs.employees")} hint={e("hint2")} testId="ai-employees">
      <div className="relative mb-3">
        <MorphIcon icon={Search} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={k("search")} aria-label={k("search")}
          className="h-10 w-full rounded-xl border border-border bg-card/70 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      {rows === null ? <Skeleton h="h-32" /> : err ? <Notice tone="warn">{t("aiVoice.common.error")}</Notice> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{k("empty")}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {shown.map((r) => {
              const out = (["all", "calls", "reminders"] as const).filter((x) => r.optOut[x]);
              const locked = !canEditBoss && r.role === "direktor";
              const ov = normalizeOverride(r.scheduleOverride);
              const isOpen = open === r.userId;
              return (
                <li key={r.userId} className="rounded-2xl border border-border bg-card/70" data-testid={`ai-emp-${r.userId}`}>
                  <button type="button" onClick={() => setOpen(isOpen ? "" : r.userId)} aria-expanded={isOpen} data-testid={`ai-emp-toggle-${r.userId}`}
                    className="w-full text-left p-3 flex items-start gap-2 rounded-2xl hover:bg-muted/20 liquid-transition">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-bold truncate max-w-full">{r.name}</p>
                        <span className="text-[11px] text-muted-foreground">{t(`aiVoice.admin.employees.roles.${r.role}`, r.role)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        <Badge tone={ov ? "amber" : "gray"}><MorphIcon icon={Calendar} className="w-3 h-3" />{ov ? overrideSummary(ov, wd) : e("companyDefault")}</Badge>
                        <Badge tone={r.telegramLinked ? "sky" : "gray"}>{r.telegramLinked ? k("linked") : k("notLinked")}</Badge>
                        {typeof r.callsAllowed === "boolean" ? (
                          <span data-testid={`ai-emp-calls-${r.userId}`} data-ok={r.callsAllowed ? "1" : "0"}>
                            <Badge tone={r.callsAllowed ? "green" : "gray"}>{e(r.callsAllowed ? "callsOk" : "callsNo")}</Badge>
                          </span>
                        ) : (
                          <Badge tone={CONSENT_TONE[r.callConsent] || "gray"}>{t(`aiVoice.admin.employees.consent.${r.callConsent}`, r.callConsent)}</Badge>
                        )}
                        {out.length > 0 && (
                          <Badge tone="red"><MorphIcon icon={Lock} className="w-3 h-3" />{k("optedOut")}: {out.map((x) => t(`aiVoice.admin.employees.optOut.${x}`)).join(", ")}</Badge>
                        )}
                        {r.disabledChannels.length > 0 && <Badge tone="red">{k("channelsOff")}: {r.disabledChannels.length}</Badge>}
                      </div>
                    </div>
                    <span className="h-8 px-2.5 rounded-lg border border-border text-xs font-semibold inline-flex items-center gap-1 flex-shrink-0 text-muted-foreground">
                      {isOpen ? e("close") : e("edit")}
                      <MorphIcon icon={Chevron} className={`w-3.5 h-3.5 liquid-transition ${isOpen ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 space-y-4 border-t border-border/60 pt-3">
                      {/* O'chiq boshqaruvlar sababi bilan: o'rinbosar direktor qatorini, jadval ruxsati yo'q bo'lsa — jadvalni */}
                      {locked && <Notice tone="lock" testId={`ai-emp-locked-${r.userId}`}>{t("aiVoice.common.locked")}</Notice>}
                      {!locked && !canEditSchedule && <Notice tone="lock">{t("aiVoice.admin.schedule.locked")}</Notice>}
                      <div className="rounded-xl border border-border bg-card/60 px-3">
                        <Toggle testId={`ai-emp-optout-${r.userId}`} checked={!r.optOut.calls && !r.optOut.all} disabled={busy === r.userId || locked || r.optOut.all}
                          label={<span className="font-semibold">{e("allowCalls")}</span>} hint={e(r.optOut.all ? "allowCallsAll" : "allowCallsHint")}
                          onChange={(v) => patchRow(r, { optOut: { calls: !v } }, k("saved"))} />
                      </div>
                      <ScheduleEditor row={r} disabled={busy === r.userId || locked || !canEditSchedule} companyStart={companyStart} wd={wd} e={e}
                        onSave={(o) => patchRow(r, { scheduleOverride: o }, e("saved"))} />
                      <div>
                        <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">{k("channelsOff")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {CHANNEL_NAMES.map((c) => (
                            <Chip key={c} tone="danger" active={r.disabledChannels.includes(c)} disabled={busy === r.userId || locked} onClick={() => toggleCh(r, c)}>
                              <span className="text-xs">{t(`aiVoice.admin.channels.names.${c}`)}</span>
                            </Chip>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {rows.length > limit && (
            <button type="button" onClick={() => setLimit((n) => n + PAGE)} data-testid="ai-emp-more"
              className="mt-3 w-full h-10 rounded-xl border border-border text-sm font-semibold hover:border-primary/50">
              {e("showMore", { n: rows.length - limit })}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function ScheduleEditor({ row, disabled, companyStart, wd, e, onSave }: {
  row: AiEmployeeRow; disabled: boolean; companyStart?: string; wd: (d: number) => string;
  e: (s: string, o?: Record<string, unknown>) => string; onSave: (o: AiScheduleOverride | null) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const server = normalizeOverride(row.scheduleOverride);
  const [useCompany, setUseCompany] = useState(!server);
  const [days, setDays] = useState<IsoWeekday[]>(server?.weekdays || [1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState(server?.workStart || "");
  const next: AiScheduleOverride | null = useCompany ? null : normalizeOverride({ weekdays: days, workStart: start });
  const error = useCompany ? null : validateOverride({ weekdays: days, workStart: start });
  const changed = !sameOverride(server, next);

  return (
    <div data-testid={`ai-emp-schedule-${row.userId}`}>
      <p className="text-xs font-bold mb-1">{e("schedule")}</p>
      <div className="rounded-xl border border-border bg-card/60 px-3">
        <Toggle testId={`ai-emp-default-${row.userId}`} checked={useCompany} disabled={disabled} label={e("useCompany")} hint={e("useCompanyHint")}
          onChange={setUseCompany} />
      </div>
      {!useCompany && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">{e("workdays")}</p>
            <div className="grid grid-cols-7 gap-1.5 max-w-sm">
              {WEEKDAYS.map((d) => (
                <button key={d} type="button" disabled={disabled} aria-pressed={days.includes(d)} data-testid={`ai-emp-wd-${row.userId}-${d}`}
                  onClick={() => setDays((l) => toggleWeekday(l, d))}
                  className={`h-10 rounded-xl border text-xs font-bold liquid-transition disabled:opacity-50 ${days.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card/60 text-muted-foreground hover:border-primary/50"}`}>
                  {wd(d)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {WEEKDAY_PRESETS.map((p) => (
                <button key={p.key} type="button" disabled={disabled} onClick={() => setDays(p.days)}
                  className="h-7 px-2.5 rounded-full border border-dashed border-border text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/50">
                  {t(`aiVoice.admin.schedule.presets.${p.key}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-2 max-w-xs">
            <div className="flex-1">
              <TimeField label={e("start")} hint={companyStart ? `${e("startHint")} (${companyStart})` : e("startHint")} value={start} disabled={disabled}
                testId={`ai-emp-start-${row.userId}`} onChange={setStart} />
            </div>
            {start && (
              <button type="button" onClick={() => setStart("")} disabled={disabled} aria-label={e("clearTime")}
                className="h-10 px-3 mb-[22px] rounded-xl border border-border text-xs font-semibold">×</button>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{e(error)}</p>}
      {changed && (
        <button type="button" disabled={disabled || !!error} data-testid={`ai-emp-save-${row.userId}`}
          onClick={() => onSave(next)}
          className="btn btn-primary h-10 px-4 mt-3 rounded-xl text-sm font-bold disabled:opacity-60">
          {t("aiVoice.common.save")}
        </button>
      )}
    </div>
  );
}
