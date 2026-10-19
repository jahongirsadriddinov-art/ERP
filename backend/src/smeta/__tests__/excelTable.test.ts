import { describe, it, expect } from 'vitest';
import * as xlsx from 'xlsx';
import { groupOf, num, parseExcelRows, parseExcelTable } from '../excelTable';
import { parseSmeta } from '../index';

describe('excelTable — ustun sarlavhalari bo\'yicha', () => {
  it('Russian 2-row header, numbering row, sections, labor/machinery/material groups', () => {
    const rows = [
      ['ЛОКАЛЬНАЯ СМЕТА №1'],
      ['', '№', 'Шифр', 'Наименование', 'Ед. изм.', 'Кол-во', 'Стоимость единицы', 'Сумма'],
      ['', '', '', '', '', '', 'сум', 'сум'],
      ['', '1', '2', '3', '4', '5', '6', '7'],
      ['', '', '', 'Трудовые затраты', '', '', '', ''],
      ['', '1', '1-100', 'Рабочие строители', 'чел.-ч', '120,5', '25 000', '3 012 500'],
      ['', '', '', 'Машины и механизмы', '', '', '', ''],
      ['', '2', '2-200', 'Экскаватор', 'маш.-ч', '8', '450000', '3600000'],
      ['', '', '', 'Материалы', '', '', '', ''],
      ['', '3', '', 'Цемент М400', 'т', '12', '1 200 000', ''],
      ['', '4', '', 'Арматура А500С', 'т', '3,25', '9 800 000', '31 850 000'],
      ['', '', '', 'Итого по смете', '', '', '', '38 862 500'],
    ];
    const r = parseExcelRows([{ name: 'S1', rows }], 'smeta.xlsx')!;
    expect(r.resources.map((x) => x.rawName)).toEqual(['Рабочие строители', 'Экскаватор', 'Цемент М400', 'Арматура А500С']);
    expect(r.resources.map((x) => x.group)).toEqual(['labor', 'machinery', 'material', 'material']);
    expect(r.resources[0]).toMatchObject({ qty: 120.5, price: 25000, total: 3012500, shifr: '1-100' });
    expect(r.resources[2].total).toBe(14_400_000);   // narx × miqdor (summa bo'sh)
    expect(r.resources[2].category).toBe('beton');
    expect(r.resources[3].category).toBe('metall');
    expect(r.meta.totalWithoutVat).toBe(3012500 + 3600000 + 14400000 + 31850000);
    expect(r.totals.map((t) => t.group)).toEqual(['Mehnat', 'Mashina va mexanizmlar', 'Materiallar']);
  });

  it('Uzbek (Latin) header and Uzbek material names', () => {
    const rows = [
      ['T/r', 'Materialning nomi', "O'lchov birligi", 'Miqdori', 'Narxi', 'Jami summa'],
      [1, 'Sement M400', 'tonna', 5, 1100000, 5500000],
      [2, "G'isht", 'dona', 10000, 1200, 12000000],
      ['', 'Jami', '', '', '', 17500000],
    ];
    const r = parseExcelRows([{ name: 'S', rows }], 'x.xlsx')!;
    expect(r.resources).toHaveLength(2);
    expect(r.resources[0]).toMatchObject({ unit: 'tonna', qty: 5, price: 1100000, total: 5500000, category: 'beton' });
    expect(r.resources[1].category).toBe('beton');
  });

  it('returns null when there is no recognizable header (old path is used)', () => {
    expect(parseExcelRows([{ name: 'S', rows: [['a', 'b'], ['1', '2']] }], 'x.xlsx')).toBeNull();
  });

  it('end-to-end: real .xlsx buffer through parseSmeta', async () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['Наименование', 'Ед.изм', 'Количество', 'Цена', 'Сумма'],
      ['Песок', 'м3', 30, 90000, 2700000],
      ['Щебень', 'м3', 20, 150000, 3000000],
    ]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Smeta');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(parseExcelTable(buf, 'a.xlsx')!.resources).toHaveLength(2);
    const r = await parseSmeta(buf, 'a.xlsx');
    expect(r.resources.map((x) => x.rawName)).toEqual(['Песок', 'Щебень']);
    expect(r.meta.totalWithoutVat).toBe(5_700_000);
  });
});

describe('helpers', () => {
  it('num parses Uzbek/Russian number formats', () => {
    expect(num('1 234,56')).toBe(1234.56);
    expect(num('1.234,5')).toBe(1234.5);
    expect(num('1,234.5')).toBe(1234.5);
    expect(num('—')).toBeNull();
    expect(num(42)).toBe(42);
  });
  it('groupOf by unit/section', () => {
    expect(groupOf('чел.-ч', '', '')).toBe('labor');
    expect(groupOf('маш.-ч', '', '')).toBe('machinery');
    expect(groupOf('шт', 'Оборудование', '')).toBe('equipment');
    expect(groupOf('м3', 'Материалы', 'Бетон')).toBe('material');
  });
});
