// Telegram kanallaridan narx ajratish (BETA). Eng muhimi — NOTO'G'RI narx olmaslik:
// telefon raqami, yil, birliksiz son indeksga tushsa, butun "o'rtacha narx" buziladi.
import { describe, it, expect } from 'vitest';
import { parseLine, parsePost } from './priceChannels';

describe('parseLine', () => {
  it("o'zbekcha e'londan narxni oladi", () => {
    expect(parseLine("Sement M400 — 52 000 so'm/qop")).toEqual({ name: 'Sement M400', price: 52000, unit: 'qop' });
  });

  it('ruscha va kirill birligini tushunadi', () => {
    expect(parseLine('Цемент М400 52000 сум мешок')).toEqual({ name: 'Цемент М400', price: 52000, unit: 'qop' });
  });

  it('birlik narxdan oldin bo\'lsa ham topadi', () => {
    expect(parseLine("G'isht 1 dona 1 200 so'm")).toMatchObject({ price: 1200, unit: 'dona' });
  });

  it('tonna va kub birliklarini oladi', () => {
    expect(parseLine("Armatura 12mm - 9 500 000 so'm/tonna")).toMatchObject({ price: 9500000, unit: 't' });
    expect(parseLine("Shag'al 1 kub 180 000 so'm")).toMatchObject({ price: 180000, unit: 'm3' });
  });

  it('telefon raqamini narx deb olmaydi', () => {
    expect(parseLine("Murojaat: +998 90 123 45 67, sement 52 000 so'm/qop")).toBeNull();
  });

  it('havola va tegli satrni tashlaydi', () => {
    expect(parseLine("Buyurtma: https://t.me/shop — 52 000 so'm/qop")).toBeNull();
    expect(parseLine("@beton_uz 52 000 so'm/qop")).toBeNull();
  });

  it("birligi yo'q narxni olmaydi (solishtirib bo'lmaydi)", () => {
    expect(parseLine("Sement 52 000 so'm")).toBeNull();
  });

  it("nomsiz yoki aqlga sig'maydigan narxni olmaydi", () => {
    expect(parseLine("52 000 so'm/qop")).toBeNull();          // nom yo'q
    expect(parseLine("Sement 5 so'm/qop")).toBeNull();        // juda arzon
    expect(parseLine("Sement 999 999 999 999 so'm/qop")).toBeNull();
  });

  it("valyutasiz sonni narx deb olmaydi", () => {
    expect(parseLine('Sement M400 52000 qop')).toBeNull();
  });
});

describe('parsePost', () => {
  it("ko'p qatorli e'londan barcha narxlarni oladi", () => {
    const post = `НАРХЛАР 29.10
Sement M400 — 52 000 so'm/qop
G'isht M100 - 1 200 so'm/dona
Tel: +998901234567
Shag'al 180 000 so'm kub`;
    const r = parsePost(post);
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.price)).toEqual([52000, 1200, 180000]);
    expect(r.map((x) => x.unit)).toEqual(['qop', 'dona', 'm3']);
  });

  it("narxsiz postdan hech nima olmaydi", () => {
    expect(parsePost('Assalomu alaykum! Bugun dam olish kuni.')).toEqual([]);
  });
});
