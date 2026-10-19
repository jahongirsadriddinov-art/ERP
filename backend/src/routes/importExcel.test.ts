import { describe, it, expect } from 'vitest';
import { parseImportRows } from './importExcel';

describe('Excel import parsing', () => {
  it('employees: Uzbek headers, FIO split, 9-digit phones, role words, row errors', () => {
    const r = parseImportRows('employees', [
      ['№', 'F.I.O', 'Telefon raqami', 'Lavozimi', 'Oylik maosh'],
      [1, 'Valiyev Ali', '901234567', 'Prorab', '6 000 000'],
      [2, 'Aliyev Vali', '+998 90 765 43 21', 'ishchi', ''],
      [3, 'Bad Phone', '123', 'ishchi', ''],
      [4, '', '', '', ''],
    ]);
    expect(r.rows).toEqual([
      { line: 2, firstName: 'Ali', lastName: 'Valiyev', phone: '+998901234567', role: 'prorab', baseSalary: 6_000_000, brigade: undefined },
      { line: 3, firstName: 'Vali', lastName: 'Aliyev', phone: '+998907654321', role: 'ishchi', baseSalary: undefined, brigade: undefined },
    ]);
    expect(r.errors).toEqual([{ row: 4, error: "Telefon noto'g'ri: 123" }]);
  });
  it('objects and materials (Russian headers, dates dd.mm.yyyy)', () => {
    const o = parseImportRows('objects', [['Название объекта', 'Адрес', 'Бюджет', 'Начало', 'Окончание'], ['ЖК Олмазор', 'Ташкент', '1 500 000 000', '01.11.2026', '2027-06-30']]);
    expect(o.rows[0]).toMatchObject({ name: 'ЖК Олмазор', budget: 1_500_000_000, startDate: '2026-11-01', endDate: '2027-06-30' });
    const m = parseImportRows('materials', [['Объект', 'Наименование', 'Ед. изм', 'Количество', 'Цена'], ['ЖК Олмазор', 'Цемент', 'т', '12,5', '1100000'], ['ЖК Олмазор', 'Песок', 'м3', '0', '']]);
    expect(m.rows).toEqual([{ line: 2, object: 'ЖК Олмазор', name: 'Цемент', unit: 'т', needed: 12.5, price: 1_100_000 }]);
    expect(m.errors[0].row).toBe(3);
  });
  it('missing header gives a clear error', () => {
    expect(parseImportRows('materials', [['a', 'b'], ['1', '2']]).errors[0].error).toMatch(/Sarlavha/);
  });
});
