// Owner 2026-10-26: "bitta ofertani yukladim — ma'lumotlarni to'liq, aniq chiqarmayapti va narxlarini umuman
// ko'rsatmayapti; pastdagi boshqa varaqlarni ham o'qisin". Haqiqiy oferta shakllari shu yerda sinaladi.
import { describe, it, expect } from 'vitest';
import * as xlsx from 'xlsx';
import { parseExcelRows, parseExcelTable } from '../excelTable';

/** aoa + birlashtirilgan kataklardan haqiqiy .xlsx buffer. */
function book(sheets: Array<{ name: string; aoa: unknown[][]; merges?: string[] }>): Buffer {
  const wb = xlsx.utils.book_new();
  for (const s of sheets) {
    const ws = xlsx.utils.aoa_to_sheet(s.aoa as any[][]);
    if (s.merges?.length) ws['!merges'] = s.merges.map((r) => xlsx.utils.decode_range(r));
    xlsx.utils.book_append_sheet(wb, ws, s.name);
  }
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe("oferta — narx ustuni birlashtirilgan sarlavha ostida", () => {
  it('"Жами" ustuni ikkiga bo\'linib "бирлик нархи | сумма" bo\'lsa ham narx chiqadi', () => {
    const buf = book([{
      name: 'ОФЕРТА',
      aoa: [
        ['ОФЕРТА — Жондор туман'],
        ['Т/р', 'Ишларнинг номи', 'Ўлчов бирлиги', 'Ҳажми', 'Жами', ''],
        ['', '', '', '', 'бирлик нархи', 'сумма'],
        [1, 'Семент М400', 'тонна', 5, 1_100_000, 5_500_000],
        [2, "Ғишт М100", 'дона', 10_000, 1_200, 12_000_000],
        ['', 'Жами', '', '', '', 17_500_000],
      ],
      merges: ['E2:F2'],
    }]);
    const r = parseExcelTable(buf, 'oferta.xlsx')!;
    expect(r.resources.map((x) => x.rawName)).toEqual(['Семент М400', 'Ғишт М100']);
    expect(r.resources[0]).toMatchObject({ unit: 'тонна', qty: 5, price: 1_100_000, total: 5_500_000 });
    expect(r.resources[1].price).toBe(1_200);
    expect(r.meta.totalWithoutVat).toBe(17_500_000);
  });

  it('narx ustuni umuman yo\'q bo\'lsa — summa/miqdordan hisoblanadi', () => {
    const r = parseExcelRows([{
      name: 'Смета',
      rows: [
        ['Наименование', 'Ед. изм.', 'Кол-во', 'Сумма'],
        ['Песок', 'м3', 30, 2_700_000],
        ['Щебень', 'м3', 20, 3_000_000],
      ],
    }], 'x.xlsx')!;
    expect(r.resources.map((x) => x.price)).toEqual([90_000, 150_000]);
  });

  it('miqdor ustuni bo\'sh bo\'lsa — summa/narxdan tiklanadi', () => {
    const r = parseExcelRows([{
      name: 'S',
      rows: [
        ['Наименование', 'Ед. изм.', 'Кол-во', 'Цена', 'Сумма'],
        ['Кабель ВВГ', 'м', '', 12_000, 600_000],
      ],
    }], 'x.xlsx')!;
    expect(r.resources[0]).toMatchObject({ qty: 50, price: 12_000, total: 600_000 });
  });

  it('pastdagi barcha varaqlar o\'qiladi — sarlavhasi tanilmagani ham', () => {
    const buf = book([
      { name: 'ОФЕРТА', aoa: [['Наименование', 'Ед.изм', 'Кол-во', 'Цена', 'Сумма'], ['Песок', 'м3', 30, 90_000, 2_700_000]] },
      { name: 'РЕСУРС', aoa: [['Қум', 'м3', 10, 50_000, 500_000], ['Шағал', 'м3', 4, 150_000, 600_000]] },
      { name: 'Лист3', aoa: [['izoh', 'matn']] },
    ]);
    const r = parseExcelTable(buf, 'oferta.xlsx')!;
    expect(r.resources.map((x) => x.rawName)).toEqual(['Песок', 'Қум', 'Шағал']);
    expect(r.resources.map((x) => x.index)).toEqual([1, 2, 3]);
    const note = r.validation.warnings.join(' ');
    expect(note).toContain('ОФЕРТА: 1 qator');
    expect(note).toContain('РЕСУРС: 2 qator');
    expect(note).toContain("Лист3: jadval topilmadi");
  });

  it("bo'lim sarlavhalari saqlanadi, smeta oxiridagi xarajat jamlanmalari material bo'lib qolmaydi", () => {
    const r = parseExcelRows([{
      name: 'S',
      rows: [
        ['Наименование', 'Ед. изм.', 'Кол-во', 'Цена', 'Сумма'],
        ['Оборудование', '', '', '', ''],
        ['Насос КМ-80', 'шт', 2, 5_000_000, 10_000_000],
        ['Зарплата', '', '', '', 7_000_000],
        ['Транспортные расходы', '', '', '', 1_000_000],
      ],
    }], 'x.xlsx')!;
    expect(r.resources.map((x) => x.rawName)).toEqual(['Насос КМ-80']);
    expect(r.resources[0].group).toBe('equipment');
    expect(r.meta.totalWithoutVat).toBe(10_000_000);
  });
});
