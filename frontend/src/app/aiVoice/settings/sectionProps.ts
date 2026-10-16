import type { AiSettingsData, AiSettingsView, AiShift } from "./api";

// Sozlamalar bo'limlari uchun umumiy props: server ko'rinishi (huquqlar, kalit holati) va qoralama.
export interface SectionProps {
  view: AiSettingsView;
  draft: AiSettingsData;
  update: (fn: (d: AiSettingsData) => AiSettingsData) => void;
}

/** Bir nechta smena bo'lsa — qaysi biri tanlangan (oddiy blok va "Jadval tafsilotlari" bir xil smenani ko'rsatadi). */
export interface ShiftProps extends SectionProps {
  shiftIdx: number;
  setShiftIdx: (i: number) => void;
}

/** Tanlangan smena indeksi (ro'yxat qisqargan bo'lsa — chegaraga siqiladi). */
export const shiftIndex = (draft: AiSettingsData, idx: number) => Math.min(idx, Math.max(0, draft.attendance.shifts.length - 1));

/** i-smenani o'zgartiruvchi funksiya. */
export const shiftUpdater = (update: SectionProps["update"], i: number) => (fn: (s: AiShift) => AiShift) =>
  update((d) => ({ ...d, attendance: { ...d.attendance, shifts: d.attendance.shifts.map((s, j) => (j === i ? fn(s) : s)) } }));
