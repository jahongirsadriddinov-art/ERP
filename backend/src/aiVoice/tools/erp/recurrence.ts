import type { IsoDate, IsoWeekday } from '../../contracts';
import { addDays, isoWeekdayOf, localDate, zonedToUtc } from '../../lib/zonedTime';

// Eslatma takrorlanishi uchun MAHALLIY yordamchi (P2). Keyingi yonishlarni (nextFireAt'ni oldinga
// surish) P3 scheduler/recurrence.ts hisoblaydi; bu yerda faqat birinchi yonish vaqti va
// normallashtirish — P3 bilan bir xil qoidalar: ISO hafta kunlari, "weekdays" = Dushanba–Shanba.

export type Freq = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
export const FREQS: Freq[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];
/** "Ish kunlari" = Du–Sha (P3 recurrence.ts bilan kelishilgan). */
export const DEFAULT_WORK_WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6];

export interface Recurrence { freq: Freq; interval: number; byWeekday: IsoWeekday[]; until?: Date }

export function normalizeRecurrence(
  freq: Freq | undefined, weekdays: number[] | undefined, startDate: IsoDate, until?: IsoDate,
): Recurrence {
  const f: Freq = freq && FREQS.includes(freq) ? freq : 'none';
  const uniq = [...new Set((weekdays || []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort() as IsoWeekday[];
  let byWeekday: IsoWeekday[] = [];
  if (f === 'weekdays') byWeekday = uniq.length ? uniq : DEFAULT_WORK_WEEKDAYS;
  else if (f === 'weekly') byWeekday = uniq.length ? uniq : [isoWeekdayOf(startDate)];
  return { freq: f, interval: 1, byWeekday, ...(until && f !== 'none' ? { until: zonedToUtc(until, '23:59') } : {}) };
}

/** Birinchi yonish: startDate'dan boshlab hafta kuni mos keladigan birinchi sana (Toshkent vaqti). */
export function firstOccurrence(startDate: IsoDate, time: string, rec: Recurrence): Date {
  let d = startDate;
  if (rec.byWeekday.length && (rec.freq === 'weekly' || rec.freq === 'weekdays')) {
    for (let i = 0; i < 7 && !rec.byWeekday.includes(isoWeekdayOf(d)); i++) d = addDays(d, 1);
  }
  return zonedToUtc(d, time);
}

function addMonth(date: IsoDate): IsoDate {
  const [y, m, day] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();       // keyingi oyning oxirgi kuni
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * Takroriy eslatma uchun: vaqt allaqachon o'tgan bo'lsa — keyingi mos kun (portlashsiz, C2).
 * Bir martalik eslatma uchun o'tgan vaqt null qaytaradi (chaqiruvchi xato beradi).
 */
export function firstFutureOccurrence(startDate: IsoDate, time: string, rec: Recurrence, now: Date = new Date()): Date | null {
  let d = startDate;
  for (let i = 0; i < 400; i++) {
    const at = firstOccurrence(d, time, rec);
    if (at.getTime() >= now.getTime() - 60_000) {
      return rec.until && at > rec.until ? null : at;
    }
    if (rec.freq === 'none') {
      // Owner 2026-10-29 (AI jurnali): "Bu vaqt allaqachon o'tgan" xatosi takror-takror
      // chiqqan — 10-15, 10-16, 10-18, 10-23. Sabab: kechqurun "soat 7 da eslat" deyilsa,
      // model BUGUNGI sanani yuboradi, 07:00 esa allaqachon o'tgan. Odam buni "ertaga 7 da"
      // deb tushunadi — endi tizim ham shunday tushunadi: sana AYNAN BUGUN bo'lsa va vaqt
      // o'tgan bo'lsa, ertangi kunga suriladi. Aniq o'tgan SANA berilsa (masalan kecha) —
      // avvalgidek xato qaytadi, chunki u yerda niyat noaniq emas.
      if (i === 0 && d === localDate(now)) { d = addDays(d, 1); continue; }
      return null;
    }
    d = rec.freq === 'monthly' ? addMonth(d) : addDays(d, 1);
  }
  return null;
}
