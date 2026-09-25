import { describe, it, expect } from 'vitest';
import { parseExpenseText, guessExpenseCategory } from './botExpense';

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
    expect(parseExpenseText('150000; Sement uchun; Yunusobod')).toEqual({ amount: 150000, description: 'Sement uchun', projectName: 'Yunusobod', category: 'material' });
  });
  it('parses grouped amounts', () => {
    expect(parseExpenseText('1 500 000; Transport')?.amount).toBe(1500000);
    expect(parseExpenseText('1.500.000; Transport')?.amount).toBe(1500000);
  });
  it('parses free text: first number is amount', () => {
    expect(parseExpenseText('150000 sement uchun')).toEqual({ amount: 150000, description: 'sement uchun', category: 'material' });
    expect(parseExpenseText('sement uchun 150000')).toEqual({ amount: 150000, description: 'sement uchun', category: 'material' });
  });
  it('rejects missing amount / description / zero', () => {
    expect(parseExpenseText('sement')).toBeNull();
    expect(parseExpenseText('150000')).toBeNull();
    expect(parseExpenseText('0; test')).toBeNull();
    expect(parseExpenseText('abc; test')).toBeNull();
  });
});
