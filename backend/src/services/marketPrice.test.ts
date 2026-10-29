// Narx razvedkasining "miyasi" — nom va birlikni bir ko'rinishga keltirish hamda
// qimmat/arzonni baholash. Baza kerak emas: faqat sof hisob (owner 2026-10-29).
import { describe, it, expect } from 'vitest';
import { itemKey, normUnit, compare, EXPENSIVE_PCT, type PriceStats } from './marketPrice';

describe('normUnit', () => {
  it('bir xil birlikning turli yozilishini birlashtiradi', () => {
    expect(normUnit('кг')).toBe('kg');
    expect(normUnit('Kilogramm')).toBe('kg');
    expect(normUnit('tonna')).toBe('t');
    expect(normUnit('мешок')).toBe('qop');
    expect(normUnit('QOP')).toBe('qop');
    expect(normUnit('шт')).toBe('dona');
    expect(normUnit('куб')).toBe('m3');
    expect(normUnit('кв.м')).toBe('m2');
  });

  it("birlik yo'q bo'lsa — bo'sh", () => {
    expect(normUnit('')).toBe('');
    expect(normUnit(null)).toBe('');
  });
});

describe('itemKey', () => {
  it('kirill va lotin yozuvini birlashtiradi', () => {
    expect(itemKey('цемент')).toBe(itemKey('sement'));
    expect(itemKey("g'isht")).toBe(itemKey('gisht'));
    expect(itemKey("shag'al")).toBe(itemKey('shagal'));
  });

  it("so'z tartibi va ortiqcha so'zlar ta'sir qilmaydi", () => {
    expect(itemKey('sement M400')).toBe(itemKey('M400 sement'));
    expect(itemKey('sement xaridi')).toBe(itemKey('sement'));
  });

  it('RAQAM saqlanadi — M400 va M500 boshqa mahsulot', () => {
    expect(itemKey('sement M400')).not.toBe(itemKey('sement M500'));
  });

  it("bo'sh nom — bo'sh kalit", () => {
    expect(itemKey('   ')).toBe('');
  });
});

const stats = (median: number): PriceStats => ({
  key: 'sement', name: 'Sement M400', unit: 'qop',
  median, low: median * 0.95, high: median * 1.05,
  points: 12, companies: 5, updatedAt: new Date(),
});

describe('compare', () => {
  it('qimmat xaridni aniqlaydi', () => {
    const r = compare(61_000, stats(52_000))!;
    expect(r.pct).toBe(17);
    expect(r.expensive).toBe(true);
  });

  it("bozor narxidagi xarid ogohlantirmaydi", () => {
    const r = compare(53_000, stats(52_000))!;
    expect(r.expensive).toBe(false);
    expect(r.pct).toBeLessThan(EXPENSIVE_PCT);
  });

  it('arzon xaridda manfiy foiz', () => {
    expect(compare(45_000, stats(52_000))!.pct).toBe(-13);
  });

  it("ma'lumot yetarli bo'lmasa — xulosa yo'q (noto'g'ri ogohlantirmaymiz)", () => {
    expect(compare(61_000, null)).toBeNull();
    expect(compare(0, stats(52_000))).toBeNull();
  });
});
