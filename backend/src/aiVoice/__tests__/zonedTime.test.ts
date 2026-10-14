// lib/zonedTime: utils/tz.ts bilan kelishuv (18:59/19:00 UTC chegarasi), ISO hafta kuni,
// yarim tundan o'tuvchi jim soatlar, skipDates/extraWorkDates (review C7, owner decision).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { tashkentHour, todayInTashkent } from '../../utils/tz';
import {
  addDays, endOfLocalDay, isHHmm, isIsoDate, isoWeekdayOf, isWithinQuietHours, localDate, parseHHmm,
  quietHoursEnd, resolveWorkday, shiftHHmm, tzOffsetMinutes, zonedParts, zonedToUtc,
} from '../lib/zonedTime';

afterEach(() => { vi.useRealTimers(); });

describe('utils/tz.ts bilan kelishuv', () => {
  const cases = [
    '2026-10-13T18:59:00.000Z', '2026-10-13T18:59:59.999Z', '2026-10-13T19:00:00.000Z', '2026-10-13T19:00:00.001Z',
    '2026-12-31T18:59:59.000Z', '2026-12-31T19:00:00.000Z', // yil chegarasi
    '2028-02-28T19:00:00.000Z', '2028-02-29T19:00:00.000Z', // kabisa yili
    '2026-03-29T01:00:00.000Z', '2026-10-25T01:00:00.000Z', // Yevropa DST kunlari — Toshkentga ta'sir yo'q
  ];
  for (const iso of cases) {
    it(`${iso}: localDate === todayInTashkent, soat === tashkentHour`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(iso));
      const now = new Date();
      expect(localDate(now)).toBe(todayInTashkent());
      expect(zonedParts(now).hour).toBe(tashkentHour(now));
    });
  }

  it("18:59 UTC — hali shu kun 23:59; 19:00 UTC — ertangi kun 00:00", () => {
    const a = zonedParts(new Date('2026-10-13T18:59:00Z'));
    expect(a.date).toBe('2026-10-13');
    expect(a.hhmm).toBe('23:59');
    const b = zonedParts(new Date('2026-10-13T19:00:00Z'));
    expect(b.date).toBe('2026-10-14');
    expect(b.hhmm).toBe('00:00');
    expect(b.minutesOfDay).toBe(0);
  });

  it('Toshkent ofseti doim +300 daqiqa', () => {
    for (const iso of ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z', '2026-10-13T19:00:00Z']) {
      expect(tzOffsetMinutes(new Date(iso))).toBe(300);
    }
  });
});

describe('ISO hafta kuni (1=Du … 7=Ya)', () => {
  it('kalendar sanasi bo\'yicha', () => {
    expect(isoWeekdayOf('2026-10-12')).toBe(1); // dushanba
    expect(isoWeekdayOf('2026-10-17')).toBe(6); // shanba
    expect(isoWeekdayOf('2026-10-18')).toBe(7); // yakshanba (getDay()=0 emas)
  });

  it('zonedParts hafta kuni Toshkent sanasidan olinadi (UTC sanasidan emas)', () => {
    // 2026-10-17 shanba 19:30 UTC = Toshkentda yakshanba 00:30
    const p = zonedParts(new Date('2026-10-17T19:30:00Z'));
    expect(p.date).toBe('2026-10-18');
    expect(p.isoWeekday).toBe(7);
    // 2026-10-11 yakshanba 20:00 UTC = Toshkentda dushanba 01:00
    expect(zonedParts(new Date('2026-10-11T20:00:00Z')).isoWeekday).toBe(1);
  });
});

describe('zonedToUtc / endOfLocalDay / addDays', () => {
  it('Toshkent 08:00 = 03:00 UTC; 00:00 = oldingi kun 19:00 UTC', () => {
    expect(zonedToUtc('2026-10-13', '08:00').toISOString()).toBe('2026-10-13T03:00:00.000Z');
    expect(zonedToUtc('2026-10-13', '00:00').toISOString()).toBe('2026-10-12T19:00:00.000Z');
    expect(endOfLocalDay('2026-10-13').toISOString()).toBe('2026-10-13T19:00:00.000Z');
  });
  it('addDays oy/yil oxirida', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('formatlar', () => {
    expect(isHHmm('08:00')).toBe(true);
    expect(isHHmm('24:00')).toBe(false);
    expect(isHHmm('8:00')).toBe(false);
    expect(parseHHmm('21:30')).toBe(1290);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(shiftHHmm('08:00', -30)).toBe('07:30');
    expect(shiftHHmm('00:10', -30)).toBe('00:00'); // yarim tundan oldinga o'tmaydi
  });
});

describe('jim soatlar', () => {
  const wrap = { from: '21:00', to: '07:00' };
  const at = (hhmm: string) => zonedToUtc('2026-10-13', hhmm);

  it('yarim tundan o\'tuvchi oraliq [21:00, 07:00)', () => {
    expect(isWithinQuietHours(at('20:59'), wrap)).toBe(false);
    expect(isWithinQuietHours(at('21:00'), wrap)).toBe(true);
    expect(isWithinQuietHours(at('23:59'), wrap)).toBe(true);
    expect(isWithinQuietHours(at('00:00'), wrap)).toBe(true);
    expect(isWithinQuietHours(at('06:59'), wrap)).toBe(true);
    expect(isWithinQuietHours(at('07:00'), wrap)).toBe(false);
    expect(isWithinQuietHours(at('12:00'), wrap)).toBe(false);
  });

  it('oddiy oraliq va bo\'sh oraliq', () => {
    const day = { from: '13:00', to: '14:00' };
    expect(isWithinQuietHours(at('13:30'), day)).toBe(true);
    expect(isWithinQuietHours(at('14:00'), day)).toBe(false);
    expect(isWithinQuietHours(at('03:00'), { from: '08:00', to: '08:00' })).toBe(false);
    expect(isWithinQuietHours(at('03:00'), undefined)).toBe(false);
  });

  it('jim soat tugash vaqti: kechqurun → ertangi 07:00, tunda → shu kun 07:00', () => {
    expect(quietHoursEnd(at('22:00'), wrap).toISOString()).toBe(zonedToUtc('2026-10-14', '07:00').toISOString());
    expect(quietHoursEnd(at('03:00'), wrap).toISOString()).toBe(zonedToUtc('2026-10-13', '07:00').toISOString());
    const noon = at('12:00');
    expect(quietHoursEnd(noon, wrap)).toBe(noon);
  });
});

describe('ish kuni: workdays (ISO) + skipDates + extraWorkDates', () => {
  const sched = { workdays: [1, 2, 3, 4, 5], skipDates: ['2026-03-20'], extraWorkDates: ['2026-10-17'] };

  it('oddiy ish kuni va dam olish kuni', () => {
    expect(resolveWorkday('2026-10-13', sched)).toEqual({ work: true, reason: 'weekday' });
    expect(resolveWorkday('2026-10-18', sched)).toEqual({ work: false, reason: 'day_off' });
  });

  it('skipDates (bayram, masalan Navro\'z juma kuni) — ishlanmaydi', () => {
    expect(isoWeekdayOf('2026-03-20')).toBe(5);
    expect(resolveWorkday('2026-03-20', sched)).toEqual({ work: false, reason: 'skip_date' });
  });

  it('extraWorkDates — odatda dam olish kuni (shanba) ishlanadi', () => {
    expect(isoWeekdayOf('2026-10-17')).toBe(6);
    expect(resolveWorkday('2026-10-17', sched)).toEqual({ work: true, reason: 'extra_date' });
  });

  it('ikkala ro\'yxatda bo\'lsa — skip ustun (xavfsiz tomon)', () => {
    expect(resolveWorkday('2026-10-14', { workdays: [3], skipDates: ['2026-10-14'], extraWorkDates: ['2026-10-14'] }))
      .toEqual({ work: false, reason: 'skip_date' });
  });

  it('erkin tanlangan hafta kunlari (Mon–Sat bilan cheklanmagan)', () => {
    expect(resolveWorkday('2026-10-18', { workdays: [7] }).work).toBe(true);
    expect(resolveWorkday('2026-10-12', { workdays: [7] }).work).toBe(false);
  });
});
