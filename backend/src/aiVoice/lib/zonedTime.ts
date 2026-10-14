import { AI_TIMEZONE } from '../config';
import type { HHmm, IsoDate, IsoWeekday } from '../contracts';

// Vaqt zonasi yordamchilari (Intl orqali). v1'da zona doim 'Asia/Tashkent' (C7) — u utils/tz.ts
// (qat'iy UTC+5) bilan bir xil natija berishi shart (Toshkentda 1991'dan beri DST yo'q);
// zonedTime.test.ts 18:59/19:00 UTC chegarasida buni tekshiradi.
// Hafta kuni — ISO (1=Dushanba … 7=Yakshanba), siljitilgan sanada Date.getDay() EMAS.

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, IsoWeekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface ZonedParts {
  date: IsoDate;          // YYYY-MM-DD
  hour: number;
  minute: number;
  second: number;
  isoWeekday: IsoWeekday;
  minutesOfDay: number;
  hhmm: HHmm;
}

export function zonedParts(at: Date = new Date(), tz: string = AI_TIMEZONE): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(at)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour, minute, second: Number(parts.second),
    isoWeekday: WD[parts.weekday] ?? 1,
    minutesOfDay: hour * 60 + minute,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/** Berilgan zonadagi bugungi sana (YYYY-MM-DD). */
export function localDate(at: Date = new Date(), tz: string = AI_TIMEZONE): IsoDate {
  return zonedParts(at, tz).date;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function isHHmm(v: unknown): v is HHmm { return typeof v === 'string' && HHMM_RE.test(v); }
export function parseHHmm(v: HHmm): number {
  const m = HHMM_RE.exec(v);
  if (!m) throw new Error('BAD_HHMM');
  return Number(m[1]) * 60 + Number(m[2]);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== 'string') return false;
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Kalendar sanasiga kun qo'shish (zonadan mustaqil). */
export function addDays(date: IsoDate, n: number): IsoDate {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error('BAD_DATE');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return d.toISOString().slice(0, 10);
}

/** Kalendar sanasining ISO hafta kuni. */
export function isoWeekdayOf(date: IsoDate): IsoWeekday {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error('BAD_DATE');
  const js = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(); // UTC yarim tun — siljish yo'q
  return (js === 0 ? 7 : js) as IsoWeekday;
}

/** Zonaning shu vaqtdagi UTC'dan farqi (daqiqada), masalan Toshkent: +300. */
export function tzOffsetMinutes(at: Date, tz: string = AI_TIMEZONE): number {
  const p = zonedParts(at, tz);
  const [y, mo, d] = p.date.split('-').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Zonadagi "sana + HH:mm" → UTC Date. */
export function zonedToUtc(date: IsoDate, hhmm: HHmm, tz: string = AI_TIMEZONE): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error('BAD_DATE');
  const mins = parseHHmm(hhmm);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], Math.floor(mins / 60), mins % 60);
  // Ikki bosqich — DST bo'lgan zonalarda ham to'g'ri (Toshkent uchun bitta bosqich yetarli)
  let off = tzOffsetMinutes(new Date(guess), tz);
  let utc = guess - off * 60_000;
  const off2 = tzOffsetMinutes(new Date(utc), tz);
  if (off2 !== off) { off = off2; utc = guess - off * 60_000; }
  return new Date(utc);
}

/**
 * Jim soatlar ichidami? from > to bo'lsa yarim tundan o'tadi (21:00 → 07:00).
 * from === to — jim soat yo'q. Oraliq [from, to) — 'to' daqiqasida allaqachon ruxsat.
 */
export function isWithinQuietHours(at: Date, quiet: { from: HHmm; to: HHmm } | undefined, tz: string = AI_TIMEZONE): boolean {
  if (!quiet || !isHHmm(quiet.from) || !isHHmm(quiet.to)) return false;
  const from = parseHHmm(quiet.from), to = parseHHmm(quiet.to);
  if (from === to) return false;
  const now = zonedParts(at, tz).minutesOfDay;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** Jim soatlar tugaydigan eng yaqin UTC vaqt (ichida bo'lmasa — at'ning o'zi). */
export function quietHoursEnd(at: Date, quiet: { from: HHmm; to: HHmm } | undefined, tz: string = AI_TIMEZONE): Date {
  if (!isWithinQuietHours(at, quiet, tz) || !quiet) return at;
  const p = zonedParts(at, tz);
  const to = parseHHmm(quiet.to);
  const day = p.minutesOfDay < to ? p.date : addDays(p.date, 1);
  return zonedToUtc(day, quiet.to, tz);
}

/** Zonadagi kun oxiri (keyingi kunning 00:00) — UTC. */
export function endOfLocalDay(date: IsoDate, tz: string = AI_TIMEZONE): Date {
  return zonedToUtc(addDays(date, 1), '00:00', tz);
}

export interface WorkSchedule { workdays: IsoWeekday[] | number[]; skipDates?: IsoDate[]; extraWorkDates?: IsoDate[] }
export type WorkdayReason = 'skip_date' | 'extra_date' | 'weekday' | 'day_off';

/**
 * Sana ish kunimi (owner decision): skipDates (bayram va h.k.) → YO'Q; extraWorkDates (odatda dam
 * olish kuni bo'lsa ham) → HA; aks holda ISO hafta kuni workdays ichidami. Validator ikkala
 * ro'yxatda bir sana bo'lishiga yo'l qo'ymaydi; baribir bo'lsa — skip ustun (xavfsiz tomon: qo'ng'iroq yo'q).
 */
export function resolveWorkday(date: IsoDate, sched: WorkSchedule): { work: boolean; reason: WorkdayReason } {
  if (sched.skipDates?.includes(date)) return { work: false, reason: 'skip_date' };
  if (sched.extraWorkDates?.includes(date)) return { work: true, reason: 'extra_date' };
  const wd = isoWeekdayOf(date);
  return (sched.workdays as number[]).includes(wd) ? { work: true, reason: 'weekday' } : { work: false, reason: 'day_off' };
}

/** HH:mm ga daqiqa qo'shish/ayirish; [00:00, 23:59] oralig'ida qisiladi (yarim tundan o'tmaydi). */
export function shiftHHmm(hhmm: HHmm, deltaMin: number): HHmm {
  const m = Math.min(23 * 60 + 59, Math.max(0, parseHHmm(hhmm) + Math.trunc(deltaMin)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
