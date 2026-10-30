import { describe, expect, it } from 'vitest';
import { dealTotals, phoneKeyOf, validSourceUrl } from './brigades';

describe('phoneKeyOf', () => {
  it("bir xil raqamning har xil yozilishini bitta kalitga keltiradi", () => {
    const k = phoneKeyOf('+998 90 123 45 67');
    expect(phoneKeyOf('998901234567')).toBe(k);
    expect(phoneKeyOf('90 123 45 67')).toBe(k);
    expect(phoneKeyOf('(90) 123-45-67')).toBe(k);
  });

  it("boshida 8 bo'lgan eski yozuvni ham tushunadi", () => {
    expect(phoneKeyOf('8901234567')).toBe('998901234567');
  });

  it("bo'sh yoki raqamsiz qiymatda bo'sh qaytaradi", () => {
    expect(phoneKeyOf('')).toBe('');
    expect(phoneKeyOf('telefon yo‘q')).toBe('');
  });
});

describe('dealTotals', () => {
  it("kelishilgan summani birlik narxi × hajm dan hisoblaydi", () => {
    expect(dealTotals({ volume: 120, ratePerUnit: 45_000 })).toMatchObject({ agreedTotal: 5_400_000, payable: 5_400_000 });
  });

  it('shtrafni ayiradi', () => {
    const r = dealTotals({ volume: 120, ratePerUnit: 45_000, penalty: 400_000 });
    expect(r.agreedTotal).toBe(5_400_000);
    expect(r.payable).toBe(5_000_000);
    expect(r.penalty).toBe(400_000);
  });

  it("shtraf summadan katta bo'lsa to'lov manfiy bo'lmaydi", () => {
    expect(dealTotals({ volume: 1, ratePerUnit: 100_000, penalty: 500_000 }).payable).toBe(0);
  });

  it("hajm yoki narx yo'q bo'lsa summa hisoblanmaydi (lekin shtraf qoladi)", () => {
    const r = dealTotals({ penalty: 50_000 });
    expect(r.agreedTotal).toBeUndefined();
    expect(r.payable).toBeUndefined();
    expect(r.penalty).toBe(50_000);
  });

  it("manfiy shtraf nolga keltiriladi", () => {
    expect(dealTotals({ volume: 10, ratePerUnit: 1000, penalty: -5000 })).toMatchObject({ penalty: 0, payable: 10_000 });
  });

  it('kasr hajmni yaxlitlaydi', () => {
    expect(dealTotals({ volume: 12.5, ratePerUnit: 33_333 }).agreedTotal).toBe(416_663);
  });
});

describe('validSourceUrl', () => {
  it('http va https havolalarni qabul qiladi', () => {
    expect(validSourceUrl('https://t.me/qurilish/123')).toBe(true);
    expect(validSourceUrl('http://example.uz/shartnoma.pdf')).toBe(true);
  });

  it("havola bo'lmasa rad etadi", () => {
    expect(validSourceUrl('')).toBe(false);
    expect(validSourceUrl("og'zaki aytdi")).toBe(false);
    expect(validSourceUrl('javascript:alert(1)')).toBe(false);
    expect(validSourceUrl('ftp://example.uz/a')).toBe(false);
  });

  it("tekshirib bo'lmaydigan ichki manzilni rad etadi", () => {
    expect(validSourceUrl('http://localhost/hujjat')).toBe(false);
    expect(validSourceUrl('https://intranet/hujjat')).toBe(false);
  });

  it("juda uzun havolani rad etadi", () => {
    expect(validSourceUrl(`https://example.uz/${'a'.repeat(600)}`)).toBe(false);
  });
});
