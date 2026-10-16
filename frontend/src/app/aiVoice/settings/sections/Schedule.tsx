import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Clock from "@hugeicons/core-free-icons/Time04Icon";
import Calendar from "@hugeicons/core-free-icons/Calendar03Icon";
import CalendarAdd from "@hugeicons/core-free-icons/Calendar01Icon";
import Settings from "@hugeicons/core-free-icons/Settings02Icon";
import Plus from "@hugeicons/core-free-icons/Add01Icon";
import Trash from "@hugeicons/core-free-icons/Delete02Icon";
import type { ShiftProps } from "../sectionProps";
import { shiftIndex, shiftUpdater } from "../sectionProps";
import type { AiShift } from "../api";
import { callTimeOf, dayStatus, isoWeekdayOf, normalizeHHmm, todayTashkent, toggleCalendarDay, upcomingDays, type DayStatus } from "../scheduleHelpers";
import { Card, Chip, Notice, NumField, TextField, TimeField } from "../ui";
import DateList, { useDateLabel } from "./DateList";

// "Jadval tafsilotlari" (Qo'shimcha sozlamalar ichida): smenalar, AI qachon so'rashi, 3 haftalik kalendar,
// qo'shimcha ish kunlari, kechikish/kelmadi chegaralari. Ish boshlanishi, hafta kunlari va bayramlar —
// asosiy ekrandagi "Ish jadvali" blokida (QuickSchedule), shu yerda takrorlanmaydi.
const LEAD_PRESETS = [0, 10, 15, 30, 60];

const DAY_TONE: Record<DayStatus, string> = {
  work: "border-primary/35 bg-primary/10 text-foreground",
  off: "border-border bg-muted/30 text-muted-foreground",
  skip: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  extra: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
};
const DOT: Record<DayStatus, string> = { work: "bg-primary", off: "bg-muted-foreground/40", skip: "bg-red-500", extra: "bg-emerald-500" };

export default function Schedule({ view, draft, update, shiftIdx, setShiftIdx }: ShiftProps) {
  const { t } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`aiVoice.admin.schedule.${s}`, o as any) as string;
  const shifts = draft.attendance.shifts;
  const i = shiftIndex(draft, shiftIdx);
  const shift = shifts[i];
  const canEdit = view.editor.canEditSchedule;
  const today = todayTashkent();
  const days = useMemo(() => upcomingDays(today, 21), [today]);
  const label = useDateLabel(today);
  const wd = (d: number) => k(`wd.${d}`);

  if (!shift) return null;
  const setShift = shiftUpdater(update, i);

  const addShift = () => {
    let n = shifts.length + 1;
    while (shifts.some((s) => s.id === `shift${n}`)) n++;
    const base: AiShift = { ...shift, id: `shift${n}`, name: k("newShift"), skipDates: [...shift.skipDates], extraWorkDates: [...shift.extraWorkDates] };
    update((d) => ({ ...d, attendance: { ...d.attendance, shifts: [...d.attendance.shifts, base] } }));
    setShiftIdx(shifts.length);
  };
  const removeShift = () => {
    update((d) => ({ ...d, attendance: { ...d.attendance, shifts: d.attendance.shifts.filter((_, j) => j !== i) } }));
    setShiftIdx(0);
  };

  return (
    <div className="space-y-4" data-testid="ai-schedule-details">
      <Notice>{k("intro")}</Notice>
      {!canEdit && <Notice tone="lock">{k("locked")}</Notice>}

      <fieldset disabled={!canEdit} className="space-y-4 min-w-0">
        {(shifts.length > 1 || canEdit) && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {shifts.map((s, j) => (
              <Chip key={s.id} active={j === i} onClick={() => setShiftIdx(j)}>{s.name || s.id}</Chip>
            ))}
            {shifts.length < 10 && (
              <button type="button" onClick={addShift} className="h-9 px-3 rounded-full border border-dashed border-border text-[13px] font-semibold text-muted-foreground hover:text-foreground hover:border-primary/50 flex items-center gap-1 flex-shrink-0">
                <MorphIcon icon={Plus} className="w-4 h-4" /> {k("addShift")}
              </button>
            )}
          </div>
        )}

        <Card icon={Clock} title={k("callLead")}
          right={shifts.length > 1 ? (
            <button type="button" onClick={removeShift} title={k("removeShift")} aria-label={k("removeShift")} className="btn btn-ghost w-9 h-9 p-0 rounded-full text-red-600">
              <MorphIcon icon={Trash} className="w-4 h-4" />
            </button>
          ) : undefined}>
          <div className="space-y-3">
            {shifts.length > 1 && (
              <TextField label={k("shiftName")} value={shift.name} maxLength={60} onChange={(v) => setShift((s) => ({ ...s, name: v }))} />
            )}
            <div className="flex flex-wrap gap-2">
              {LEAD_PRESETS.map((m) => (
                <Chip key={m} active={shift.callLeadMin === m} onClick={() => setShift((s) => ({ ...s, callLeadMin: m }))}>
                  {m === 0 ? k("atStart") : k("before", { min: m })}
                </Chip>
              ))}
            </div>
            <div className="rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5 text-sm">
              {k("callAt", { time: callTimeOf(shift.workStart, shift.callLeadMin) })}
            </div>
          </div>
        </Card>

        <Card icon={Calendar} title={k("calendar")} hint={k("calendarHint")}>
          <div>
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

        <Card icon={CalendarAdd} title={k("extraDates")} hint={k("extraHint")}>
          <DateList kind="extra" shift={shift} today={today} label={label} onChange={setShift} />
        </Card>

        <Card icon={Settings} title={t("aiVoice.ui.simple.lateTitle")}>
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

    </div>
  );
}

