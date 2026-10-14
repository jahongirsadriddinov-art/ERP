import { AI_TIMEZONE } from '../config';
import type { IsoDate, IsoWeekday } from '../contracts';
import { addDays, isoWeekdayOf, zonedParts, zonedToUtc } from '../lib/zonedTime';

// Eslatma takrorlanishi (sof funksiyalar). Hodisalar dueAt'ning MAHALLIY vaqtiga (Asia/Tashkent,
// daqiqa aniqligida) bog'langan: daily — har `interval` kun; weekdays — Du–Sha (ISO 1..6), byWeekday
// berilsa — o'sha kunlar; weekly — byWeekday (bo'sh bo'lsa dueAt kuni), har `interval` hafta (ISO, Dushanbadan);
// monthly — dueAt kuni, oy oxiriga qisiladi (31 → 30/28). until — oxirgi ruxsat etilgan vaqt,
// count — jami yuborishlar soni.

export type RecurrenceFreq = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
export interface Recurrence {
  freq: RecurrenceFreq;
  interval?: number;
  byWeekday?: number[];
  until?: Date | null;
  count?: number | null;
}

/** "Ish kunlari" (recurrence.weekdays) = Dushanba–Shanba (P3 qarori). */
export const RECURRENCE_WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6];

const DAY_MS = 86_400_000;
const dayNum = (d: IsoDate) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS;
const diffDays = (a: IsoDate, b: IsoDate) => Math.round(dayNum(b) - dayNum(a));

function clampMonthDate(year: number, month0: number, dom: number): IsoDate {
  const y = year + Math.floor(month0 / 12);
  const m = ((month0 % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(Math.min(dom, last)).padStart(2, '0')}`;
}

/**
 * `after`dan QAT'IY keyingi birinchi hodisa (UTC) yoki null (seriya tugagan).
 * firedSoFar — allaqachon yuborilganlar soni (count tekshiruvi uchun).
 */
export function nextOccurrence(rec: Recurrence, anchor: Date, after: Date, firedSoFar = 0, tz: string = AI_TIMEZONE): Date | null {
  if (rec.count != null && firedSoFar >= rec.count) return null;
  const until = rec.until ? new Date(rec.until).getTime() : Infinity;
  const ok = (d: Date | null) => (d && d.getTime() <= until ? d : null);
  if (rec.freq === 'none' || !rec.freq) return ok(anchor.getTime() > after.getTime() ? anchor : null);

  const interval = Math.max(1, Math.floor(rec.interval || 1));
  const a = zonedParts(anchor, tz);
  const time = a.hhmm;
  const at = (d: IsoDate) => zonedToUtc(d, time, tz);
  const afterDate = zonedParts(after, tz).date;
  // Qidiruv anchor kunidan oldin boshlanmaydi
  const startDate = diffDays(a.date, afterDate) > 0 ? afterDate : a.date;
  const fits = (d: Date) => d.getTime() > after.getTime() && d.getTime() >= anchor.getTime();

  if (rec.freq === 'daily') {
    const k0 = Math.max(0, Math.floor(diffDays(a.date, startDate) / interval));
    for (let k = k0; k < k0 + 3; k++) {
      const d = at(addDays(a.date, k * interval));
      if (fits(d)) return ok(d);
    }
    return null;
  }

  if (rec.freq === 'weekdays') {
    // byWeekday berilgan bo'lsa (P2 tool'i tanlangan kunlarni yozadi) — o'sha kunlar, aks holda Du–Sha
    const set = (rec.byWeekday || []).filter((x) => x >= 1 && x <= 7);
    const days: number[] = set.length ? set : RECURRENCE_WEEKDAYS;
    for (let i = 0; i < 9; i++) {
      const day = addDays(startDate, i);
      if (!days.includes(isoWeekdayOf(day))) continue;
      const d = at(day);
      if (fits(d)) return ok(d);
    }
    return null;
  }

  if (rec.freq === 'weekly') {
    const days = (rec.byWeekday && rec.byWeekday.length ? rec.byWeekday : [a.isoWeekday]).filter((x) => x >= 1 && x <= 7);
    if (!days.length) return null;
    const weekStart = addDays(a.date, -(a.isoWeekday - 1));   // anchor haftasining Dushanbasi
    const span = 7 * interval + 8;
    for (let i = 0; i < span; i++) {
      const day = addDays(startDate, i);
      const weekIdx = Math.floor(diffDays(weekStart, day) / 7);
      if (weekIdx < 0 || weekIdx % interval !== 0) continue;
      if (!days.includes(isoWeekdayOf(day))) continue;
      const d = at(day);
      if (fits(d)) return ok(d);
    }
    return null;
  }

  if (rec.freq === 'monthly') {
    const ay = +a.date.slice(0, 4), am = +a.date.slice(5, 7) - 1, dom = +a.date.slice(8, 10);
    const sy = +startDate.slice(0, 4), sm = +startDate.slice(5, 7) - 1;
    const monthsFromAnchor = (sy - ay) * 12 + (sm - am);
    let k = Math.max(0, Math.floor(monthsFromAnchor / interval) * interval);
    for (let n = 0; n < 4; n++, k += interval) {
      const d = at(clampMonthDate(ay, am + k, dom));
      if (fits(d)) return ok(d);
    }
    return null;
  }
  return null;
}

/** Birinchi yuborish vaqti: dueAt kelajakda bo'lsa — birinchi hodisa ≥ dueAt; o'tgan bo'lsa — now'dan keyingisi. */
export function firstFireAt(rec: Recurrence, dueAt: Date, now: Date, tz: string = AI_TIMEZONE): Date | null {
  const from = dueAt.getTime() > now.getTime() ? new Date(dueAt.getTime() - 1) : now;
  return nextOccurrence(rec, dueAt, from, 0, tz);
}
