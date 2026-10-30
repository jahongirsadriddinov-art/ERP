import { describe, expect, it } from 'vitest';
import { parseOlxOffer, fetchOlxOffers, DEFAULT_QUERIES } from './priceOlx';

const price = (value: number, extra: Record<string, unknown> = {}) => ({
  params: [{ key: 'price', value: { value, type: 'price', arranged: false, currency: 'UZS', ...extra } }],
});

describe('parseOlxOffer', () => {
  it("matnda aytilgan narxni oladi (eng ishonchli yo'l)", () => {
    const r = parseOlxOffer({ id: 1, title: "Sement M400 narxi 52 000 so'm/qop", ...price(200) });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ price: 52000, unit: 'qop' });
  });

  it("qop uchun aqlga sig'maydigan past narxni tashlaydi", () => {
    // Haqiqiy OLX e'lonida uchradi: "M400 qop 530 so'm" — qop bunga bo'lmaydi
    expect(parseOlxOffer({ id: 2, title: "Sement M400 qop 530 so'm", ...price(530) })).toHaveLength(0);
  });

  it('sarlavhada birlik bor bo\u2018lsa raqamli narxni oladi', () => {
    const r = parseOlxOffer({ id: 3, title: 'Penoblok dona', ...price(12000) });
    expect(r[0]).toMatchObject({ price: 12000, unit: 'dona' });
  });

  it('birlik aytilmagan e\u2018londan narx olmaydi', () => {
    // Sement bo'yicha sotuvchilar kg narxini yozadi — birliksiz raqam ma'nosiz
    expect(parseOlxOffer({ id: 4, title: 'Sement optom dostavka', ...price(470) })).toHaveLength(0);
  });

  it('"kelishiladi" va boshqa valyutani tashlaydi', () => {
    expect(parseOlxOffer({ id: 5, title: 'Penoblok dona', ...price(12000, { arranged: true, type: 'arranged' }) })).toHaveLength(0);
    expect(parseOlxOffer({ id: 6, title: 'Penoblok dona', ...price(12000, { currency: 'USD' }) })).toHaveLength(0);
  });

  it('nom o\u2018rnida faqat birlik yoki "narxi" bo\u2018lsa tashlaydi', () => {
    expect(parseOlxOffer({ id: 7, title: 'Tonna narxi', ...price(6_500_000) })).toHaveLength(0);
    expect(parseOlxOffer({ id: 8, title: '1 kg', ...price(7000) })).toHaveLength(0);
  });

  it('id yoki sarlavha yo\u2018q bo\u2018lsa jim o\u2018tadi', () => {
    expect(parseOlxOffer({ title: 'Penoblok dona', ...price(12000) })).toHaveLength(0);
    expect(parseOlxOffer({ id: 9, ...price(12000) })).toHaveLength(0);
  });

  it('viloyatni saqlaydi', () => {
    const r = parseOlxOffer({ id: 10, title: 'Penoblok dona', location: { region: { name: 'Samarqand' } }, ...price(12000) });
    expect(r[0].region).toBe('Samarqand');
  });
});

describe('fetchOlxOffers', () => {
  it("tashqi sayt xatosida bo'sh qaytaradi, otmaydi", async () => {
    const bad = (async () => { throw new Error('tarmoq yo\u2018q'); }) as unknown as typeof fetch;
    expect(await fetchOlxOffers('sement', bad)).toEqual([]);
  });

  it('javob 200 bo\u2018lmasa bo\u2018sh qaytaradi', async () => {
    const f = (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    expect(await fetchOlxOffers('sement', f)).toEqual([]);
  });

  it("qisqa so'rovga umuman chiqmaydi", async () => {
    let called = false;
    const f = (async () => { called = true; return { ok: true, json: async () => ({ data: [] }) }; }) as unknown as typeof fetch;
    expect(await fetchOlxOffers('s', f)).toEqual([]);
    expect(called).toBe(false);
  });

  it("so'rov matni URL'ga to'g'ri joylanadi", async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return { ok: true, json: async () => ({ data: [{ id: 1 }] }) }; }) as unknown as typeof fetch;
    await fetchOlxOffers('sement M400', f);
    expect(url).toContain('query=sement%20M400');
  });
});

describe('DEFAULT_QUERIES', () => {
  it("asosiy materiallar ro'yxati bo'sh emas va takrorlanmaydi", () => {
    expect(DEFAULT_QUERIES.length).toBeGreaterThan(5);
    expect(new Set(DEFAULT_QUERIES).size).toBe(DEFAULT_QUERIES.length);
  });
});
