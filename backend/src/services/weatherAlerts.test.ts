// Ob-havo ogohlantirishi: qaysi prognozda xabar yuborilishi va qaysida YUBORILMASLIGI.
// Eng muhimi — yaxshi kunda jim turish: har kuni "ertaga ob-havo yaxshi" deb yozish spam,
// va bir haftada odam bunday xabarlarni umuman o'qimay qo'yadi (owner 2026-10-29).
import { describe, it, expect } from 'vitest';
import { risksFor, alertText, severe, type DayForecast } from './weatherAlerts';

const day = (p: Partial<DayForecast>): DayForecast => ({
  date: '2026-10-30', tMin: 14, tMax: 24, rainProb: 5, rainMm: 0, snowCm: 0, windMax: 3, ...p,
});

describe('risksFor', () => {
  it('yaxshi kunda xavf yo\'q — xabar yuborilmaydi', () => {
    expect(risksFor(day({}))).toEqual([]);
    expect(alertText(day({}), 'Toshkent')).toBe('');
  });

  it("yomg'ir ehtimoli yuqori bo'lsa — beton/suvoq ogohlantirishi", () => {
    const r = risksFor(day({ rainProb: 80, rainMm: 6 }));
    expect(r.map((x) => x.kind)).toContain('rain');
    expect(r[0].text).toMatch(/beton quyish/);
  });

  it('sovuqda beton qotmaydi — ogohlantiradi', () => {
    expect(risksFor(day({ tMin: 2 })).map((x) => x.kind)).toContain('frost');
  });

  it('jaziramada ishchilar uchun ogohlantirish', () => {
    expect(risksFor(day({ tMax: 41 })).map((x) => x.kind)).toContain('heat');
  });

  it('kuchli shamolda kran xavfli', () => {
    expect(risksFor(day({ windMax: 15 })).map((x) => x.kind)).toContain('wind');
  });

  it('qor yomg\'irdan ustun — ikkisi birdan aytilmaydi', () => {
    const r = risksFor(day({ snowCm: 3, rainProb: 90 }));
    const kinds = r.map((x) => x.kind);
    expect(kinds).toContain('snow');
    expect(kinds).not.toContain('rain');
  });

  it('bir nechta xavf birga chiqadi', () => {
    const r = risksFor(day({ rainProb: 75, tMin: 1, windMax: 14 }));
    expect(r.map((x) => x.kind).sort()).toEqual(['frost', 'rain', 'wind']);
  });

  it("prognoz bo'lmasa — xavf ham yo'q (taxmin qilmaymiz)", () => {
    expect(risksFor(null)).toEqual([]);
    expect(alertText(null, 'Toshkent')).toBe('');
  });
});

describe('severe', () => {
  it('qor, sovuq va shamol — jiddiy (AI qo\'ng\'iroq qilishi mumkin)', () => {
    expect(severe(risksFor(day({ snowCm: 2 })))).toBe(true);
    expect(severe(risksFor(day({ tMin: 0 })))).toBe(true);
    expect(severe(risksFor(day({ windMax: 20 })))).toBe(true);
  });

  it("yomg'ir va jazirama — xabar yetarli", () => {
    expect(severe(risksFor(day({ rainProb: 90 })))).toBe(false);
    expect(severe(risksFor(day({ tMax: 40 })))).toBe(false);
  });
});

describe('alertText', () => {
  it('sana, harorat va joyni ko\'rsatadi', () => {
    const t = alertText(day({ rainProb: 80, tMin: 9, tMax: 17 }), 'Olmazor');
    expect(t).toContain('2026-10-30');
    expect(t).toContain('Olmazor');
    expect(t).toContain('9…17°C');
  });
});
