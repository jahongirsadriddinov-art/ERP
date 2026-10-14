// Eslatma takrorlanishi (Asia/Tashkent, ISO hafta kunlari, oy oxiriga qisish, until/count).
import { describe, it, expect } from 'vitest';
import { firstFireAt, nextOccurrence, type Recurrence } from '../scheduler/recurrence';
import { zonedParts, zonedToUtc } from '../lib/zonedTime';

const T = (date: string, hhmm: string) => zonedToUtc(date, hhmm);   // Toshkent mahalliy → UTC
const local = (d: Date | null) => (d ? `${zonedParts(d).date} ${zonedParts(d).hhmm}` : null);
const series = (rec: Recurrence, anchor: Date, after: Date, n: number) => {
  const out: string[] = [];
  let cur = after;
  for (let i = 0; i < n; i++) {
    const nx = nextOccurrence(rec, anchor, cur, i);
    if (!nx) break;
    out.push(local(nx)!);
    cur = nx;
  }
  return out;
};

// 2026-10-14 — Chorshanba (ISO 3)
const A = T('2026-10-14', '09:30');

describe('nextOccurrence', () => {
  it("none — faqat anchor, o'tgan bo'lsa null", () => {
    expect(nextOccurrence({ freq: 'none' }, A, new Date(A.getTime() - 1))).toEqual(A);
    expect(nextOccurrence({ freq: 'none' }, A, A)).toBeNull();
  });
  it('daily (interval 1 va 3) — mahalliy vaqt saqlanadi', () => {
    expect(series({ freq: 'daily' }, A, new Date(A.getTime() - 1), 3)).toEqual(['2026-10-14 09:30', '2026-10-15 09:30', '2026-10-16 09:30']);
    expect(series({ freq: 'daily', interval: 3 }, A, new Date(A.getTime() - 1), 3)).toEqual(['2026-10-14 09:30', '2026-10-17 09:30', '2026-10-20 09:30']);
  });
  it('weekdays = Du–Sha (Yakshanba tashlanadi)', () => {
    const fri = T('2026-10-16', '09:30');
    expect(series({ freq: 'weekdays' }, A, fri, 3)).toEqual(['2026-10-17 09:30', '2026-10-19 09:30', '2026-10-20 09:30']);
    // P2 tool'i tanlangan kunlarni byWeekday'ga yozadi — o'sha kunlar hurmat qilinadi
    expect(series({ freq: 'weekdays', byWeekday: [1, 3, 5] }, A, fri, 3)).toEqual(['2026-10-19 09:30', '2026-10-21 09:30', '2026-10-23 09:30']);
  });
  it('weekly byWeekday (ISO) va interval 2', () => {
    expect(series({ freq: 'weekly', byWeekday: [1, 5] }, A, new Date(A.getTime() - 1), 4))
      .toEqual(['2026-10-16 09:30', '2026-10-19 09:30', '2026-10-23 09:30', '2026-10-26 09:30']);
    expect(series({ freq: 'weekly', interval: 2 }, A, new Date(A.getTime() - 1), 3))
      .toEqual(['2026-10-14 09:30', '2026-10-28 09:30', '2026-11-11 09:30']);
    expect(series({ freq: 'weekly', byWeekday: [7] }, A, new Date(A.getTime() - 1), 2)).toEqual(['2026-10-18 09:30', '2026-10-25 09:30']);
  });
  it('monthly — oy oxiriga qisiladi (31 → 30, 28)', () => {
    const jan31 = T('2027-01-31', '08:00');
    expect(series({ freq: 'monthly' }, jan31, new Date(jan31.getTime() - 1), 4))
      .toEqual(['2027-01-31 08:00', '2027-02-28 08:00', '2027-03-31 08:00', '2027-04-30 08:00']);
    expect(series({ freq: 'monthly', interval: 2 }, jan31, new Date(jan31.getTime() - 1), 3))
      .toEqual(['2027-01-31 08:00', '2027-03-31 08:00', '2027-05-31 08:00']);
  });
  it('until va count seriyani tugatadi', () => {
    expect(series({ freq: 'daily', until: T('2026-10-15', '23:00') }, A, new Date(A.getTime() - 1), 5)).toEqual(['2026-10-14 09:30', '2026-10-15 09:30']);
    expect(nextOccurrence({ freq: 'daily', count: 2 }, A, A, 2)).toBeNull();
    expect(nextOccurrence({ freq: 'daily', count: 2 }, A, A, 1)).toEqual(T('2026-10-15', '09:30'));
  });
  it("uzoq kechikishdan keyin — keyingi KELAJAKDAGI hodisa (to'plab emas)", () => {
    const later = T('2026-12-01', '12:00');
    expect(local(nextOccurrence({ freq: 'daily' }, A, later))).toBe('2026-12-02 09:30');
    expect(local(nextOccurrence({ freq: 'weekly', byWeekday: [3] }, A, later))).toBe('2026-12-02 09:30');
  });
  it('mahalliy yarim tun chegarasi (UTC 19:00) — sana Toshkent bo\'yicha', () => {
    const late = T('2026-10-14', '23:30');                    // UTC 18:30
    expect(local(nextOccurrence({ freq: 'daily' }, late, late))).toBe('2026-10-15 23:30');
    expect(late.toISOString()).toBe('2026-10-14T18:30:00.000Z');
  });
});

describe('firstFireAt', () => {
  const now = T('2026-10-14', '10:00');
  it("kelajakdagi dueAt — o'zi; o'tgan bir martalik — null; o'tgan takroriy — keyingisi", () => {
    expect(firstFireAt({ freq: 'none' }, T('2026-10-14', '11:00'), now)).toEqual(T('2026-10-14', '11:00'));
    expect(firstFireAt({ freq: 'none' }, A, now)).toBeNull();
    expect(local(firstFireAt({ freq: 'daily' }, A, now))).toBe('2026-10-15 09:30');
  });
  it("weekly — anchor kuni byWeekday'da bo'lmasa birinchi mos kun", () => {
    expect(local(firstFireAt({ freq: 'weekly', byWeekday: [5] }, T('2026-10-14', '11:00'), now))).toBe('2026-10-16 11:00');
  });
});
