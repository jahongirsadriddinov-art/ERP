import "../../../i18n/aiVoiceNs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Plus from "@hugeicons/core-free-icons/Add01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import type { AiShift } from "../api";
import { addShiftDate, isIsoDate, isoWeekdayOf, removeShiftDate, type DateKind } from "../scheduleHelpers";

// Sanalar ro'yxati (bayramlar / qo'shimcha ish kunlari): sana tanlash + qo'shish, chip'lar bilan o'chirish.
// Oddiy ko'rinish (Ish jadvali bloki) va "Jadval tafsilotlari" ikkalasi ham shuni ishlatadi.

/** "21 mar, Ya" ko'rinishidagi sana yorlig'i (oy nomlari i18n'dan — uz-UZ Intl ba'zan "M03" qaytaradi). */
export function useDateLabel(today: string) {
  const { t, i18n } = useTranslation();
  const months = useMemo(() => String(t("aiVoice.admin.schedule.months")).split(","), [i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps
  return (d: string) => {
    const y = d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : "";
    return `${Number(d.slice(8))} ${months[Number(d.slice(5, 7)) - 1] || d.slice(5, 7)}${y}, ${t(`aiVoice.admin.schedule.wd.${isoWeekdayOf(d)}`)}`;
  };
}

export default function DateList({ kind, shift, today, label, onChange }: {
  kind: DateKind; shift: AiShift; today: string; label: (d: string) => string; onChange: (fn: (s: AiShift) => AiShift) => void;
}) {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.schedule.${s}`);
  const [val, setVal] = useState("");
  const list = kind === "skip" ? shift.skipDates : shift.extraWorkDates;
  const add = () => { if (isIsoDate(val)) { onChange((s) => addShiftDate(s, kind, val)); setVal(""); } };
  const tone = kind === "skip" ? "border-red-500/30 bg-red-500/[0.06]" : "border-emerald-500/30 bg-emerald-500/[0.06]";
  return (
    <div data-testid={`ai-dates-${kind}`}>
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
        <p className="text-xs text-muted-foreground mt-2.5">{k("noDates")}</p>
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
    </div>
  );
}
