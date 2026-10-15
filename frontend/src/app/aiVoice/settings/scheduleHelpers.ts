import type { AiSettingsData, AiShift, ChannelName, IsoWeekday } from "./api";
import { CHANNEL_NAMES } from "./api";

// AI sozlamalari uchun sof yordamchilar (vaqt, hafta kunlari, sanalar ro'yxati, kanal tartibi, PUT patch).
// Server validatori (backend aiVoice/settings.ts) bilan bir xil qoidalar — foydalanuvchi xatoni saqlashdan
// OLDIN ko'rsin. Hammasi test qilinadi (scheduleHelpers.test.ts).

// ───────────── Vaqt (HH:mm) ─────────────
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHHmm = (v: unknown): v is string => typeof v === "string" && HHMM_RE.test(v);

/** "8:5" → null, "8:05" → "08:05", "0805" → "08:05", "08:05" → "08:05"; noto'g'ri — null. */
export function normalizeHHmm(raw: string): string | null {
  const s = String(raw || "").trim();
  let h: number, m: number;
  const a = /^(\d{1,2}):(\d{2})$/.exec(s);
  const b = /^(\d{3,4})$/.exec(s);
  if (a) { h = Number(a[1]); m = Number(a[2]); }
  else if (b) { h = Number(b[1].slice(0, -2)); m = Number(b[1].slice(-2)); }
  else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const hhmmOf = (min: number) => {
  const m = Math.min(23 * 60 + 59, Math.max(0, Math.trunc(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
/** AI so'rov vaqti = ish boshlanishi − callLeadMin (server ham shunday hisoblaydi). */
export const callTimeOf = (workStart: string, leadMin: number) => (isHHmm(workStart) ? hhmmOf(minutesOf(workStart) - Math.max(0, leadMin || 0)) : workStart);

// ───────────── Hafta kunlari (ISO: 1 = Dushanba … 7 = Yakshanba) ─────────────
export const WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAY_PRESETS: { key: "mon_fri" | "mon_sat" | "all"; days: IsoWeekday[] }[] = [
  { key: "mon_fri", days: [1, 2, 3, 4, 5] },
  { key: "mon_sat", days: [1, 2, 3, 4, 5, 6] },
  { key: "all", days: [1, 2, 3, 4, 5, 6, 7] },
];
export function toggleWeekday(list: readonly number[], d: IsoWeekday): IsoWeekday[] {
  const set = new Set(list.filter((x) => x >= 1 && x <= 7) as IsoWeekday[]);
  if (set.has(d)) set.delete(d); else set.add(d);
  return [...set].sort((a, b) => a - b);
}
export const sameDays = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

// ───────────── Sanalar (YYYY-MM-DD) ─────────────
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** ISO hafta kuni (sana kalendar kuni sifatida, vaqt zonasisiz). */
export function isoWeekdayOf(date: string): IsoWeekday {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (w === 0 ? 7 : w) as IsoWeekday;
}
/** Toshkentdagi bugungi sana. */
export function todayTashkent(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value || "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
/** Takrorsiz, saralangan ro'yxatga sana qo'shadi (noto'g'ri sana — o'zgarishsiz). */
export function addDate(list: readonly string[], d: string): string[] {
  if (!isIsoDate(d)) return [...list];
  return [...new Set([...list, d])].sort();
}
export const removeDate = (list: readonly string[], d: string) => list.filter((x) => x !== d);

export type DateKind = "skip" | "extra";
/** Bir sana faqat bitta ro'yxatda bo'ladi: qo'shilganda boshqasidan olib tashlanadi (server ham shunday). */
export function addShiftDate(shift: AiShift, kind: DateKind, d: string): AiShift {
  if (!isIsoDate(d)) return shift;
  return kind === "skip"
    ? { ...shift, skipDates: addDate(shift.skipDates, d), extraWorkDates: removeDate(shift.extraWorkDates, d) }
    : { ...shift, extraWorkDates: addDate(shift.extraWorkDates, d), skipDates: removeDate(shift.skipDates, d) };
}
export function removeShiftDate(shift: AiShift, kind: DateKind, d: string): AiShift {
  return kind === "skip" ? { ...shift, skipDates: removeDate(shift.skipDates, d) } : { ...shift, extraWorkDates: removeDate(shift.extraWorkDates, d) };
}

export type DayStatus = "work" | "off" | "skip" | "extra";
/** Kun holati: skipDates → yo'q; extraWorkDates → ha; aks holda hafta kuni (backend resolveWorkday). */
export function dayStatus(shift: Pick<AiShift, "workdays" | "skipDates" | "extraWorkDates">, date: string): DayStatus {
  if (shift.skipDates.includes(date)) return "skip";
  if (shift.extraWorkDates.includes(date)) return "extra";
  return (shift.workdays as number[]).includes(isoWeekdayOf(date)) ? "work" : "off";
}
/**
 * Kalendardagi kunni bosish: odatdagi ish kuni ↔ "ishlanmaydi" (skip), odatdagi dam olish kuni ↔
 * "qo'shimcha ish kuni" (extra). Bitta bosish — bitta aniq o'zgarish.
 */
export function toggleCalendarDay(shift: AiShift, date: string): AiShift {
  const st = dayStatus(shift, date);
  if (st === "skip") return removeShiftDate(shift, "skip", date);
  if (st === "extra") return removeShiftDate(shift, "extra", date);
  return addShiftDate(shift, st === "work" ? "skip" : "extra", date);
}
export const upcomingDays = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDaysIso(from, i));

// ───────────── Kanal tartibi ─────────────
export const isKnownChannel = (c: unknown): c is ChannelName => (CHANNEL_NAMES as unknown[]).includes(c);
export const channelsUnique = (list: readonly unknown[]) => list.every(isKnownChannel) && new Set(list).size === list.length;
export function moveItem<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
/** Kanal qo'shish — takror qo'shilmaydi. */
export const addChannel = (list: readonly ChannelName[], c: ChannelName) => (list.includes(c) ? [...list] : [...list, c]);
export const removeChannel = (list: readonly ChannelName[], c: ChannelName) => list.filter((x) => x !== c);
export const missingChannels = (list: readonly ChannelName[]) => CHANNEL_NAMES.filter((c) => !list.includes(c));

// ───────────── Tekshiruv (saqlashdan oldin) ─────────────
export type DraftError =
  | "workStart" | "absentCutoff" | "callLead" | "workdays" | "dates" | "dateConflict" | "numbers" | "roles"
  | "fallbackOrder" | "quietHours" | "budget";

const intIn = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

export function validateShift(s: AiShift): DraftError[] {
  const e: DraftError[] = [];
  if (!isHHmm(s.workStart)) e.push("workStart");
  if (!isHHmm(s.absentCutoff) || (isHHmm(s.workStart) && minutesOf(s.absentCutoff) <= minutesOf(s.workStart))) e.push("absentCutoff");
  if (!intIn(s.callLeadMin, 0, 180) || (isHHmm(s.workStart) && minutesOf(s.workStart) < s.callLeadMin)) e.push("callLead");
  if (!s.workdays.length || new Set(s.workdays).size !== s.workdays.length || !s.workdays.every((d) => intIn(d, 1, 7))) e.push("workdays");
  if (![...s.skipDates, ...s.extraWorkDates].every(isIsoDate) || s.skipDates.length > 366 || s.extraWorkDates.length > 366) e.push("dates");
  if (s.skipDates.some((d) => s.extraWorkDates.includes(d))) e.push("dateConflict");
  if (!intIn(s.lateAfterMin, 0, 240) || !intIn(s.buttonWaitMin, 1, 120) || !intIn(s.maxLateMin, 0, 360)) e.push("numbers");
  if (!s.roles.length) e.push("roles");
  return e;
}

export function validateDraft(d: AiSettingsData): DraftError[] {
  const e = new Set<DraftError>();
  for (const s of d.attendance.shifts) validateShift(s).forEach((x) => e.add(x));
  if (!d.fallbackOrder.length || !channelsUnique(d.fallbackOrder)) e.add("fallbackOrder");
  if (!isHHmm(d.calls.quietHours.from) || !isHHmm(d.calls.quietHours.to)) e.add("quietHours");
  // limits firma ko'rinishida kelmaydi (dasturchi bo'limi) — bo'lsagina tekshiriladi
  if (d.limits && !(d.limits.monthlyBudgetUsd >= 0 && d.limits.monthlyBudgetUsd <= 10000)) e.add("budget");
  return [...e];
}

// ───────────── PUT patch ─────────────
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const SKIP_KEYS = new Set(["companyId", "version", "updatedBy", "timezone"]);

/**
 * Server nusxasi va qoralama farqi: yuqori darajadagi o'zgargan maydonlar; bo'limlar (attendance, calls ...)
 * ichida faqat o'zgargan kalitlar (massivlar butunligicha). timezone/version — hech qachon yuborilmaydi.
 */
export function diffPatch(server: AiSettingsData, draft: AiSettingsData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(draft) as (keyof AiSettingsData)[]) {
    if (SKIP_KEYS.has(k)) continue;
    const a = server[k] as unknown, b = draft[k] as unknown;
    if (same(a, b)) continue;
    if (isObj(a) && isObj(b)) {
      const sub: Record<string, unknown> = {};
      for (const sk of Object.keys(b)) if (!same(a[sk], b[sk])) sub[sk] = b[sk];
      if (Object.keys(sub).length) out[k] = sub;
    } else {
      out[k] = b;
    }
  }
  // Qoralamada callTime eskirib qolmasin (server baribir qayta hisoblaydi)
  const att = out.attendance as Record<string, any> | undefined;
  if (att?.shifts) att.shifts = (att.shifts as AiShift[]).map((s) => ({ ...s, callTime: callTimeOf(s.workStart, s.callLeadMin) }));
  return out;
}
