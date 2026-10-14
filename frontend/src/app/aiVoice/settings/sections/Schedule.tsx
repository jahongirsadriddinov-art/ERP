import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Clock from "@hugeicons/core-free-icons/Time04Icon";
import Calendar from "@hugeicons/core-free-icons/Calendar03Icon";
import CalendarAdd from "@hugeicons/core-free-icons/Calendar01Icon";
import Users from "@hugeicons/core-free-icons/UserGroupIcon";
import Settings from "@hugeicons/core-free-icons/Settings02Icon";
import Plus from "@hugeicons/core-free-icons/Add01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import type { SectionProps } from "../sectionProps";
import { AI_ROLES, type AiShift, type IsoWeekday } from "../api";
import {
  addShiftDate, callTimeOf, dayStatus, isIsoDate, isoWeekdayOf, normalizeHHmm, removeShiftDate, sameDays, todayTashkent,
  toggleCalendarDay, toggleWeekday, upcomingDays, validateShift, WEEKDAY_PRESETS, WEEKDAYS, type DateKind, type DayStatus,
} from "../scheduleHelpers";
import { Card, Chip, Field, Notice, NumField, TextField, TimeField } from "../ui";

// Ish jadvali (owner decision): ish boshlanishi, AI so'rov vaqti, hafta kunlari, ishlanmaydigan va qo'shimcha
// ish sanalari (kalendar + ro'yxat), kechikish/kelmadi chegaralari. Egasi uchun iloji boricha oson.
const START_PRESETS = ["07:00", "07:30", "08:00", "08:30", "09:00"];
const LEAD_PRESETS = [0, 10, 15, 30, 60];

const DAY_TONE: Record<DayStatus, string> = {
  work: "border-primary/35 bg-primary/10 text-foreground",
  off: "border-border bg-muted/30 text-muted-foreground",
  skip: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  extra: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
};
const DOT: Record<DayStatus, string> = { work: "bg-primary", off: "bg-muted-foreground/40", skip: "bg-red-500", extra: "bg-emerald-500" };

export default function Schedule({ view, draft, update }: SectionProps) {
  const { t, i18n } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`aiVoice.admin.schedule.${s}`, o as any) as string;
  const [idx, setIdx] = useState(0);
  const shifts = draft.attendance.shifts;
  const i = Math.min(idx, Math.max(0, shifts.length - 1));
  const shift = shifts[i];
  const canEdit = view.editor.canEditSchedule;
  const today = todayTashkent();
  const days = useMemo(() => upcomingDays(today, 21), [today]);
  // Oy nomlari i18n'dan (uz-UZ Intl ba'zi brauzerlarda "M03" qaytaradi)
  const months = useMemo(() => k("months").split(","), [i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps
  const wd = (d: number) => k(`wd.${d}`);
  const label = (d: string) => {
    const y = d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : "";
    return `${Number(d.slice(8))} ${months[Number(d.slice(5, 7)) - 1] || d.slice(5, 7)}${y}, ${wd(isoWeekdayOf(d))}`;
  };

  if (!shift) return null;
  const setShift = (fn: (s: AiShift) => AiShift) =>
    update((d) => ({ ...d, attendance: { ...d.attendance, shifts: d.attendance.shifts.map((s, j) => (j === i ? fn(s) : s)) } }));
  const errors = validateShift(shift);

  const addShift = () => {
    let n = shifts.length + 1;
    while (shifts.some((s) => s.id === `shift${n}`)) n++;
    const base: AiShift = { ...shift, id: `shift${n}`, name: k("newShift"), skipDates: [...shift.skipDates], extraWorkDates: [...shift.extraWorkDates] };
    update((d) => ({ ...d, attendance: { ...d.attendance, shifts: [...d.attendance.shifts, base] } }));
    setIdx(shifts.length);
  };
  const removeShift = () => {
    update((d) => ({ ...d, attendance: { ...d.attendance, shifts: d.attendance.shifts.filter((_, j) => j !== i) } }));
    setIdx(0);
  };

  return (
    <div className="space-y-4" data-testid="ai-schedule">
      <Notice>{k("intro")}</Notice>
      {!canEdit && <Notice tone="lock" testId="ai-schedule-locked">{k("locked")}</Notice>}

      <fieldset disabled={!canEdit} className="space-y-4 min-w-0">
        {(shifts.length > 1 || canEdit) && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {shifts.map((s, j) => (
              <Chip key={s.id} active={j === i} onClick={() => setIdx(j)}>{s.name || s.id}</Chip>
            ))}
            {shifts.length < 10 && (
              <button type="button" onClick={addShift} className="h-9 px-3 rounded-full border border-dashed border-border text-[13px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/50 flex items-center gap-1 flex-shrink-0">
                <MorphIcon icon={Plus} className="w-4 h-4" /> {k("addShift")}
              </button>
            )}
          </div>
        )}

        <Card icon={Clock} title={k("workStart")}
          right={shifts.length > 1 ? (
            <button type="button" onClick={removeShift} title={k("removeShift")} aria-label={k("removeShift")} className="btn btn-ghost w-9 h-9 p-0 rounded-full text-red-600">
              <MorphIcon icon={Trash} className="w-4 h-4" />
            </button>
          ) : undefined}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3 min-w-0">
              {shifts.length > 1 && (
                <TextField label={k("shiftName")} value={shift.name} maxLength={60} onChange={(v) => setShift((s) => ({ ...s, name: v }))} />
              )}
              <TimeField big label={k("workStart")} value={shift.workStart} testId="ai-work-start"
                onChange={(v) => { const n = normalizeHHmm(v); if (n) setShift((s) => ({ ...s, workStart: n })); }} />
              <div className="flex flex-wrap gap-2">
                {START_PRESETS.map((p) => (
                  <Chip key={p} active={shift.workStart === p} onClick={() => setShift((s) => ({ ...s, workStart: p }))}>{p}</Chip>
                ))}
              </div>
            </div>
            <div className="space-y-3 min-w-0">
              <Field label={k("callLead")}>
                <div className="flex flex-wrap gap-2">
                  {LEAD_PRESETS.map((m) => (
                    <Chip key={m} active={shift.callLeadMin === m} onClick={() => setShift((s) => ({ ...s, callLeadMin: m }))}>
                      {m === 0 ? k("atStart") : k("before", { min: m })}
                    </Chip>
                  ))}
                </div>
              </Field>
              <div className="rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5 text-sm" data-testid="ai-call-time">
                {k("callAt", { time: callTimeOf(shift.workStart, shift.callLeadMin) })}
              </div>
            </div>
          </div>
        </Card>

        <Card icon={Calendar} title={k("workdays")}>
          <div className="grid grid-cols-7 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
            {WEEKDAYS.map((d) => (
              <button key={d} type="button" data-testid={`ai-wd-${d}`} aria-pressed={shift.workdays.includes(d)}
                onClick={() => setShift((s) => ({ ...s, workdays: toggleWeekday(s.workdays, d) }))}
                className={`h-11 sm:w-12 rounded-xl border text-sm font-bold liquid-transition ${shift.workdays.includes(d) ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card/60 text-muted-foreground hover:border-primary/50"}`}>
                {wd(d)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {WEEKDAY_PRESETS.map((p) => (
              <Chip key={p.key} active={sameDays(shift.workdays, p.days)} onClick={() => setShift((s) => ({ ...s, workdays: [...p.days] as IsoWeekday[] }))}>
                {k(`presets.${p.key}`)}
              </Chip>
            ))}
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold text-muted-foreground">{k("calendar")}</p>
            <p className="text-[11px] text-muted-foreground mb-2">{k("calendarHint")}</p>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="group" aria-label={k("calendar")}>
              {days.map((d) => {
                const st = dayStatus(shift, d);
                return (
                  <button key={d} type="button" data-testid={`ai-day-${d}`} data-status={st} title={`${label(d)} — ${k(`legend.${st}`)}`}
                    onClick={() => setShift((s) => toggleCalendarDay(s, d))}
                    className={`rounded-lg border py-1.5 flex flex-col items-center leading-tight liquid-transition hover:brightness-95 ${DAY_TONE[st]} ${d === today ? "ring-2 ring-primary/50" : ""}`}>
                    <span className="text-[10px] opacity-80">{wd(isoWeekdayOf(d))}</span>
                    <span className="text-sm font-bold tabular-nums">{Number(d.slice(8))}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {(["work", "off", "skip", "extra"] as DayStatus[]).map((st) => (
                <span key={st} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`w-2.5 h-2.5 rounded-full ${DOT[st]}`} /> {k(`legend.${st}`)}
                </span>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DateList kind="skip" shift={shift} today={today} label={label} onChange={setShift} />
          <DateList kind="extra" shift={shift} today={today} label={label} onChange={setShift} />
        </div>

        <Card icon={Users} title={k("roles")}>
          <div className="flex flex-wrap gap-2">
            {AI_ROLES.map((r) => (
              <Chip key={r} active={shift.roles.includes(r)}
                onClick={() => setShift((s) => ({ ...s, roles: s.roles.includes(r) ? s.roles.filter((x) => x !== r) : AI_ROLES.filter((x) => x === r || s.roles.includes(x)) }))}>
                {t(`aiVoice.admin.employees.roles.${r}`)}
              </Chip>
            ))}
          </div>
        </Card>

        <Card icon={Settings} title={k("more")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NumField label={k("lateAfter")} hint={k("lateAfterHint")} value={shift.lateAfterMin} min={0} max={240} suffix={t("aiVoice.common.min")}
              onChange={(v) => setShift((s) => ({ ...s, lateAfterMin: v }))} />
            <TimeField label={k("absentCutoff")} value={shift.absentCutoff}
              onChange={(v) => { const n = normalizeHHmm(v); if (n) setShift((s) => ({ ...s, absentCutoff: n })); }} />
            <NumField label={k("buttonWait")} value={shift.buttonWaitMin} min={1} max={120} suffix={t("aiVoice.common.min")}
              onChange={(v) => setShift((s) => ({ ...s, buttonWaitMin: v }))} />
            <NumField label={k("maxLate")} hint={k("maxLateHint")} value={shift.maxLateMin} min={0} max={360} suffix={t("aiVoice.common.min")} testId="ai-max-late"
              onChange={(v) => setShift((s) => ({ ...s, maxLateMin: v }))} />
          </div>
        </Card>
      </fieldset>

      {errors.length > 0 && (
        <Notice tone="warn" testId="ai-schedule-errors">
          <ul className="space-y-0.5">{errors.map((e) => <li key={e}>{t(`aiVoice.admin.errors.${e}`)}</li>)}</ul>
        </Notice>
      )}
    </div>
  );
}

function DateList({ kind, shift, today, label, onChange }: {
  kind: DateKind; shift: AiShift; today: string; label: (d: string) => string; onChange: (fn: (s: AiShift) => AiShift) => void;
}) {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.schedule.${s}`);
  const [val, setVal] = useState("");
  const list = kind === "skip" ? shift.skipDates : shift.extraWorkDates;
  const add = () => { if (isIsoDate(val)) { onChange((s) => addShiftDate(s, kind, val)); setVal(""); } };
  const tone = kind === "skip" ? "border-red-500/30 bg-red-500/[0.06]" : "border-emerald-500/30 bg-emerald-500/[0.06]";
  return (
    <Card icon={CalendarAdd} title={k(kind === "skip" ? "skipDates" : "extraDates")} hint={k(kind === "skip" ? "skipHint" : "extraHint")} testId={`ai-dates-${kind}`}>
      <div className="flex gap-2">
        <input type="date" value={val} min={today} aria-label={k("pickDate")} data-testid={`ai-date-input-${kind}`}
          onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          className="h-10 flex-1 min-w-0 rounded-xl border border-border bg-card/70 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <button type="button" onClick={add} disabled={!isIsoDate(val)} data-testid={`ai-date-add-${kind}`}
          className="h-10 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 flex items-center gap-1 flex-shrink-0">
          <MorphIcon icon={Plus} className="w-4 h-4" /> <span className="hidden sm:inline">{t("aiVoice.common.add")}</span>
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground mt-3">{k("noDates")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2 mt-3">
          {list.map((d) => (
            <li key={d} data-testid={`ai-date-${kind}-${d}`}
              className={`inline-flex items-center gap-1.5 pl-3 pr-1 h-8 rounded-full border text-[13px] font-semibold ${tone} ${d < today ? "opacity-55" : ""}`}>
              <span className="tabular-nums">{label(d)}</span>
              {d < today && <span className="text-[10px] font-normal">· {k("past")}</span>}
              <button type="button" onClick={() => onChange((s) => removeShiftDate(s, kind, d))} aria-label={`${t("aiVoice.common.remove")} ${d}`}
                className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-foreground/10">
                <MorphIcon icon={X} className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
