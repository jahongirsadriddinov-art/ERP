import { describe, expect, it } from 'vitest';
import { capToolResult, explicitDecision } from '../toolPolicy';
import { dailyResetAt, quotaKindOf, quotaMessage } from '../quota';
import { GeminiQuotaError } from '../../lib/geminiKeys';
import { ProviderError } from '../providers/types';

describe('explicitDecision — faqat foydalanuvchining aniq buyrug\'i', () => {
  it("o'zbek/rus buyruqlari; boshqa gap — yo'q", () => {
    for (const t of ['tasdiqla', 'Kran chiqimini tasdiqlang', "ma'qulla", 'утверди', 'qabul qil']) expect(explicitDecision('approve', t), t).toBe(true);
    for (const t of ['rad et', 'отклони', 'qaytar']) expect(explicitDecision('reject', t), t).toBe(true);
    expect(explicitDecision('approve', 'bugun nima gap')).toBe(false);
    expect(explicitDecision('approve', 'rad et')).toBe(false);
  });
  it("'ha' — faqat AI oldingi javobida aynan shuni so'ragan bo'lsa", () => {
    expect(explicitDecision('approve', 'ha', [{ role: 'assistant', text: 'Tasdiqlaymi?' }])).toBe(true);
    expect(explicitDecision('approve', 'ha', [{ role: 'assistant', text: 'Eslatma qo\'yaymi?' }])).toBe(false);
    expect(explicitDecision('approve', 'ha', [])).toBe(false);
  });
});

describe('capToolResult', () => {
  it('katta natija — massivlar qisqaradi, truncated:true', () => {
    const r = capToolResult({ status: 'ok', message: 'x', retryable: false, data: { items: Array.from({ length: 500 }, (_, i) => ({ i, s: 'a'.repeat(40) })) } }, 2000);
    expect((r.data as any).truncated).toBe(true);
    expect(JSON.stringify(r.data).length).toBeLessThanOrEqual(2000);
  });
});

describe('kvota xabari', () => {
  it('turi va matni', () => {
    expect(quotaKindOf(new GeminiQuotaError(false, new Date()))).toBe('minute');
    expect(quotaKindOf(new GeminiQuotaError(true, new Date()))).toBe('daily');
    expect(quotaKindOf(new ProviderError('openrouter', 'HTTP_429', 429))).toBe('minute');
    expect(quotaKindOf(new Error('boshqa'))).toBeNull();
    expect(quotaMessage('minute', 'uz')).toMatch(/1 daqiqadan keyin/);
    // 2026-10-16 12:00 UTC → keyingi 00:00 PT = 07:00 UTC = 12:00 Toshkent (17-oktabr)
    expect(dailyResetAt(new Date('2026-10-16T12:00:00Z')).toISOString()).toBe('2026-10-17T07:00:00.000Z');
    expect(quotaMessage('daily', 'uz', new Date('2026-10-16T12:00:00Z'))).toBe('AI kunlik limiti tugadi, ertaga soat 12:00 da tiklanadi.');
  });
});
