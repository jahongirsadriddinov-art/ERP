// Owner 2026-10-26: guruh/kanal buyruqlari — firmaga bog'langan guruhda firma buyruqlari,
// umumiy guruh/kanalda esa ochiq buyruqlar.
import { describe, it, expect } from 'vitest';
import { parseCommand } from './botGroups';

describe('guruh buyrug\'ini o\'qish', () => {
  it('oddiy buyruq', () => {
    expect(parseCommand('/bugun')).toEqual({ cmd: 'bugun', arg: '' });
    expect(parseCommand('/Hisobot  ')).toEqual({ cmd: 'hisobot', arg: '' });
  });

  it('bot nomi bilan — faqat o\'zimizniki', () => {
    expect(parseCommand('/narx@qurilish_erp_bot', 'qurilish_erp_bot')).toEqual({ cmd: 'narx', arg: '' });
    expect(parseCommand('/narx@boshqa_bot', 'qurilish_erp_bot')).toBeNull();
  });

  it('argument bilan', () => {
    expect(parseCommand('/ulash Jondor Iris Stroy')).toEqual({ cmd: 'ulash', arg: 'Jondor Iris Stroy' });
  });

  it('buyruq bo\'lmagan matn', () => {
    expect(parseCommand('salom')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
    expect(parseCommand('ha /bugun')).toBeNull();
  });
});
