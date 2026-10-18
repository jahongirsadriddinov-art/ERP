import { useTranslation } from "react-i18next";
import Calendar from "@hugeicons/core-free-icons/Calendar03Icon";
import type { IsoWeekday } from "../api";
import type { ShiftProps } from "../sectionProps";
import { shiftIndex, shiftUpdater } from "../sectionProps";
import { callTimeOf, normalizeHHmm, sameDays, todayTashkent, toggleWeekday, validateShift, WEEKDAY_PRESETS, WEEKDAYS } from "../scheduleHelpers";
import { Card, Chip, Notice, NumField, TimeField, Toggle } from "../ui";
import DateList, { useDateLabel } from "./DateList";

// 2-blok "Ish vaqti" (owner 2026-10-17: bog'liq narsalar bir joyda): ertalabki so'rov kaliti, ish boshlanishi,
// "kechikdi" chegarasi va "kelmadi" vaqti, hafta kunlari va bayramlar. Smenalar, kalendar — "Qo'shimcha"da.
const START_PRESETS = ["07:00", "07:30", "08:00", "08:30", "09:00"];

export default function QuickSchedule({ view, draft, update, shiftIdx, setShiftIdx }: ShiftProps) {
  const { t } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`aiVoice.admin.schedule.${s}`, o as any) as string;
  const u = (s: string) => t(`aiVoice.ui.simple.${s}`);
  const shifts = draft.attendance.shifts;
  const i = shiftIndex(draft, shiftIdx);
  const shift = shifts[i];
  const today = todayTashkent();
  const label = useDateLabel(today);
  const canEdit = view.editor.canEditSchedule;
  if (!shift) return null;
  const setShift = shiftUpdater(update, i);
  const errors = validateShift(shift);
  const asking = draft.attendance.enabled;

  return (
    <Card icon={Calendar} title={u("workTimeTitle")} hint={u("workTimeHint")} testId="ai-schedule">
      <div className="rounded-xl border border-border bg-card/60 px-3 mb-4">
        <Toggle testId="ai-attendance" checked={asking} label={<span className="font-semibold">{u("askMorning")}</span>}
          hint={asking ? <span data-testid="ai-call-time">{k("callAt", { time: callTimeOf(shift.workStart, shift.callLeadMin) })}</span> : u("askMorningOff")}
          onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, enabled: v } }))} />
      </div>
      {!canEdit && <div className="mb-4"><Notice tone="lock" testId="ai-schedule-locked">{k("locked")}</Notice></div>}

      <fieldset disabled={!canEdit} className={`space-y-5 min-w-0 liquid-transition ${asking ? "" : "opacity-70"}`}>
        {shifts.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide" role="group" aria-label={k("shift")}>
            {shifts.map((s, j) => <Chip key={s.id} active={j === i} onClick={() => setShiftIdx(j)}>{s.name || s.id}</Chip>)}
          </div>
        )}

        {/* Vaqt maydoni va tayyor vaqtlar — doim ustma-ust (ikki ustunli kartada yonma-yon sig'maydi) */}
        <div className="space-y-2.5">
          <div className="max-w-[14rem]">
            <TimeField big label={k("workStart")} value={shift.workStart} testId="ai-work-start"
              onChange={(v) => { const n = normalizeHHmm(v); if (n) setShift((s) => ({ ...s, workStart: n })); }} />
          </div>
          <div className="flex flex-wrap gap-2">
            {START_PRESETS.map((p) => <Chip key={p} active={shift.workStart === p} onClick={() => setShift((s) => ({ ...s, workStart: p }))}>{p}</Chip>)}
          </div>
          {/* Ish boshlanishiga bog'liq chegaralar — shu yerning o'zida */}
          <div className="grid grid-cols-2 gap-3 pt-1" data-testid="ai-late-rules">
            <NumField label={u("lateAfter")} hint={u("lateAfterHint")} value={shift.lateAfterMin} min={0} max={240} suffix={t("aiVoice.common.min")}
              testId="ai-late-after" onChange={(v) => setShift((s) => ({ ...s, lateAfterMin: v }))} />
            <TimeField label={u("absentAt")} hint={u("absentAtHint")} value={shift.absentCutoff} testId="ai-absent-cutoff"
              onChange={(v) => { const n = normalizeHHmm(v); if (n) setShift((s) => ({ ...s, absentCutoff: n })); }} />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">{k("workdays")}</p>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((d) => {
              const on = shift.workdays.includes(d);
              return (
                <button key={d} type="button" data-testid={`ai-wd-${d}`} aria-pressed={on}
                  onClick={() => setShift((s) => ({ ...s, workdays: toggleWeekday(s.workdays, d) }))}
                  className={`h-11 rounded-xl border text-sm font-bold liquid-transition ${on ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card/60 text-muted-foreground hover:border-primary/50"}`}>
                  {k(`wd.${d}`)}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-2.5">
            {WEEKDAY_PRESETS.map((p) => (
              <Chip key={p.key} active={sameDays(shift.workdays, p.days)} onClick={() => setShift((s) => ({ ...s, workdays: [...p.days] as IsoWeekday[] }))}>
                {k(`presets.${p.key}`)}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground">{u("holidays")}</p>
          <p className="text-[11px] text-muted-foreground mb-2">{u("holidaysHint")}</p>
          <DateList kind="skip" shift={shift} today={today} label={label} onChange={setShift} />
        </div>
      </fieldset>

      {errors.length > 0 && (
        <div className="mt-4">
          <Notice tone="warn" testId="ai-schedule-errors">
            <ul className="space-y-0.5">{errors.map((e) => <li key={e}>{t(`aiVoice.admin.errors.${e}`)}</li>)}</ul>
          </Notice>
        </div>
      )}
    </Card>
  );
}
