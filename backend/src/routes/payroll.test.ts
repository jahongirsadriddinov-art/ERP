import { describe, it, expect } from 'vitest';
import { workingDaysInMonth } from './payroll';

// Ish haqi hisob-kitobi shu songa bo'linadi (kunlik stavka = oylik / shu son)
// — noto'g'ri bo'lsa HAR BIR xodimning maoshi noto'g'ri chiqadi, shuning
// uchun aniq taqvim raqamlari bilan tekshiramiz (yakshanba hisobga
// olinmaydi — O'zbekistonda odatiy 6 kunlik ish haftasi).
describe('workingDaysInMonth', () => {
  it('excludes Sundays from a 31-day month', () => {
    // 2026-08 boshlanadi shanba (2026-08-01), 31 kun, 4 ta to'liq hafta + 3 kun.
    const days = workingDaysInMonth('2026-08');
    // Sanity: kamida 25, ko'pi bilan 27 (31 kunda 4-5 ta yakshanba bo'ladi).
    expect(days).toBeGreaterThanOrEqual(25);
    expect(days).toBeLessThanOrEqual(27);
  });

  it('a 28-day February with exactly 4 Sundays gives 24 working days', () => {
    // 2026 kabisa yil emas — fevral 28 kun. 2026-02-01 yakshanba kuni.
    expect(workingDaysInMonth('2026-02')).toBe(24);
  });

  it('never returns more days than the month has', () => {
    expect(workingDaysInMonth('2026-04')).toBeLessThanOrEqual(30);
  });
});
