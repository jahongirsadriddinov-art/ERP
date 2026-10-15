import type { AiScheduleOverride, IsoWeekday } from "./api";
import { normalizeHHmm, WEEKDAYS } from "./scheduleHelpers";

// Xodimning alohida ish jadvali (firma jadvalidan farqli) — sof yordamchilar (UI va testlar uchun).

/** Kunlar tartiblangan, takrorsiz, faqat 1-7; vaqt SS:DD yoki yo'q. */
export function normalizeOverride(o: { weekdays?: readonly unknown[]; workStart?: unknown } | null | undefined): AiScheduleOverride | null {
  if (!o || typeof o !== "object") return null;
  const days = Array.from(new Set((o.weekdays || []).filter((d): d is IsoWeekday => WEEKDAYS.includes(d as IsoWeekday)))).sort((a, b) => a - b);
  const ws = typeof o.workStart === "string" && o.workStart.trim() ? normalizeHHmm(o.workStart) : null;
  return ws ? { weekdays: days, workStart: ws } : { weekdays: days };
}

export type OverrideError = "needDay" | "badTime";

/** Saqlashdan oldin tekshirish: kamida bitta kun, vaqt (bo'lsa) to'g'ri. */
export function validateOverride(o: { weekdays: readonly number[]; workStart?: string } | null): OverrideError | null {
  if (!o) return null;
  if (!o.weekdays.some((d) => WEEKDAYS.includes(d as IsoWeekday))) return "needDay";
  if (o.workStart !== undefined && o.workStart !== "" && !normalizeHHmm(o.workStart)) return "badTime";
  return null;
}

export function sameOverride(a: AiScheduleOverride | null | undefined, b: AiScheduleOverride | null | undefined): boolean {
  const x = normalizeOverride(a), y = normalizeOverride(b);
  if (!x || !y) return !x && !y;
  return x.weekdays.join(",") === y.weekdays.join(",") && (x.workStart || "") === (y.workStart || "");
}

/** Ketma-ket kunlarni oraliqqa yig'ish: [1,2,3,5] → [[1,3],[5,5]]. */
export function dayRanges(days: readonly number[]): [number, number][] {
  const s = Array.from(new Set(days)).filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const d of s) {
    const last = out[out.length - 1];
    if (last && d === last[1] + 1) last[1] = d; else out.push([d, d]);
  }
  return out;
}

/** Qisqa ko'rinish: "Du–Ju · 07:30". label — kun qisqa nomi. */
export function overrideSummary(o: AiScheduleOverride, label: (d: number) => string): string {
  const days = dayRanges(o.weekdays).map(([a, b]) => (a === b ? label(a) : b === a + 1 ? `${label(a)}, ${label(b)}` : `${label(a)}–${label(b)}`)).join(", ");
  return o.workStart ? `${days} · ${o.workStart}` : days;
}
