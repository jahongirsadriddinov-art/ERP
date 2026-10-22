import { describe, it, expect } from 'vitest';
import { parseExpenseText, guessExpenseCategory, extractDate, detectCurrency } from './botExpense';

describe('guessExpenseCategory', () => {
  it('maps descriptions to site expense types', () => {
    expect(guessExpenseCategory('Sement uchun')).toBe('material');
    expect(guessExpenseCategory('ishchilarga oylik')).toBe('oylik');
    expect(guessExpenseCategory('benzin')).toBe('transport');
    expect(guessExpenseCategory('drel ijarasi')).toBe('jihozlar');
    expect(guessExpenseCategory('nimadir')).toBe('boshqa');
    expect(guessExpenseCategory('цемент')).toBe('material');
  });
});

describe('parseExpenseText', () => {
  it('parses semicolon format with project', () => {
    expect(parseExpenseText('150000; Sement uchun; Yunusobod')).toEqual({ amount: 150000, description: 'Sement uchun', projectName: 'Yunusobod', category: 'material', currency: 'UZS' });
  });
  it('parses grouped amounts', () => {
    expect(parseExpenseText('1 500 000; Transport')?.amount).toBe(1500000);
    expect(parseExpenseText('1.500.000; Transport')?.amount).toBe(1500000);
  });
  it('parses free text: first number is amount', () => {
    expect(parseExpenseText('150000 sement uchun')).toEqual({ amount: 150000, description: 'sement uchun', category: 'material', currency: 'UZS' });
    expect(parseExpenseText('sement uchun 150000')).toEqual({ amount: 150000, description: 'sement uchun', category: 'material', currency: 'UZS' });
  });
  it('rejects missing amount / description / zero', () => {
    expect(parseExpenseText('sement')).toBeNull();
    expect(parseExpenseText('150000')).toBeNull();
    expect(parseExpenseText('0; test')).toBeNull();
    expect(parseExpenseText('abc; test')).toBeNull();
  });
});

describe('dates and currency', () => {
  const today = '2026-09-26';
  it('relative and explicit dates', () => {
    expect(extractDate('kecha 50000 sement', today).date).toBe('2026-09-25');
    expect(extractDate("o'tgan kuni 50000 sement", today).date).toBe('2026-09-24');
    expect(extractDate('15-iyulda 50000 sement', today).date).toBe('2026-07-15');
    expect(extractDate('15.07 50000', today).date).toBe('2026-07-15');
    expect(extractDate('20-dekabr 5000', today).date).toBe('2025-12-20');
    expect(extractDate('50000 sement', today).date).toBeUndefined();
    expect(extractDate('вчера 5000 бензин', today).date).toBe('2026-09-25');
    expect(extractDate('позавчера 5000', today).date).toBe('2026-09-24');
    expect(extractDate('15 июля 5000', today).date).toBe('2026-07-15');
    expect(extractDate('3 marta 5000', today).date).toBeUndefined();
  });
  it('date number is not taken as amount', () => {
    const p = parseExpenseText('15-iyulda 200000 sement uchun', today);
    expect(p?.amount).toBe(200000);
    expect(p?.date).toBe('2026-07-15');
  });
  it('currency', () => {
    expect(detectCurrency('100 dollar')).toBe('USD');
    expect(detectCurrency('100$')).toBe('USD');
    expect(detectCurrency('50 evro')).toBe('EUR');
    expect(detectCurrency('100 долларов')).toBe('USD');
    expect(detectCurrency('50000 сум')).toBe('UZS');
    const p = parseExpenseText('100 dollar benzin', today);
    expect(p?.currency).toBe('USD');
    expect(p?.amount).toBe(100);
    expect(p?.description).toBe('benzin');
  });
});

describe("qoralamani tahrirlash (owner 2026-10-22)", () => {
  it('parseDateInput: 12.10, 12.10.2026, ISO, kecha; kelajak — yo\'q', async () => {
    const { parseDateInput } = await import('./botExpense');
    expect(parseDateInput('12.10', '2026-10-22')).toBe('2026-10-12');
    expect(parseDateInput('5/9/2026', '2026-10-22')).toBe('2026-09-05');
    expect(parseDateInput('2026-10-01', '2026-10-22')).toBe('2026-10-01');
    expect(parseDateInput('kecha', '2026-10-22')).toBe('2026-10-21');
    expect(parseDateInput('30.10', '2026-10-22')).toBeUndefined();
    expect(parseDateInput('salom', '2026-10-22')).toBeUndefined();
  });
  it('textToExpense: AI yo\'q bo\'lsa oddiy tahlilchi bilan, tuzatilgan matn saqlanadi', async () => {
    const prev = { a: process.env.GEMINI_API_KEY, b: process.env.GEMINI_API_KEYS };
    delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEYS;
    try {
      const { textToExpense } = await import('./botExpense');
      const r = await textToExpense('150000 sement uchun', '2026-10-22');
      expect(r).toMatchObject({ amount: 150000, description: 'sement uchun', category: 'material', cleanText: '150000 sement uchun' });
    } finally {
      if (prev.a !== undefined) process.env.GEMINI_API_KEY = prev.a;
      if (prev.b !== undefined) process.env.GEMINI_API_KEYS = prev.b;
    }
  });
});
