// Kapitalbank kursi (owner 2026-10-23): bank.uz'dagi Kapitalbank sahifasidan sotib olish/sotish kurslari o'qiladi
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseKapitalRates } from './currency';

describe('parseKapitalRates', () => {
  it("bank.uz sahifasidan USD va EUR sotib olish/sotish kurslarini o'qiydi", () => {
    const html = readFileSync(join(__dirname, '__fixtures__', 'bankuz-kapitalbank.html'), 'utf8');
    const r = parseKapitalRates(html);
    expect(r.USD).toEqual({ buy: 11_870, sell: 11_950 });
    expect(r.EUR).toEqual({ buy: 13_060, sell: 13_650 });
    expect(r.updatedAt).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
  });
  it("sahifa o'zgarsa yoki bo'sh bo'lsa — hech narsa olinmaydi (Markaziy bank zaxirasi ishlaydi)", () => {
    expect(parseKapitalRates('<html>Just a moment...</html>')).toEqual({});
    expect(parseKapitalRates('Kod USD Birlik 1 Valyuta AQSH dollari Sotib olish 5 Sotish 7 Yangilanish vaqti 01.01.2026 10:00')).toEqual({});
  });
});
