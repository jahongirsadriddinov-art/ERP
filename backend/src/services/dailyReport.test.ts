import { describe, it, expect } from 'vitest';
import { formatReport, normalizeReport } from './dailyReport';

describe('dailyReport', () => {
  it('normalizes AI output and drops junk', () => {
    const r = normalizeReport({ summary: "Devor terildi", workDone: ['2-qavat devori', ''], materialsUsed: [{ name: 'Sement', qty: '20', unit: 'qop' }, { name: 'X', qty: -1 }],
      workersCount: '7', issues: [{ text: 'Kran buzildi', severity: 'medium' }, { text: '' }] })!;
    expect(r).toMatchObject({ summary: 'Devor terildi', workDone: ['2-qavat devori'], materialsUsed: [{ name: 'Sement', qty: 20, unit: 'qop' }], workersCount: 7, issues: [{ text: 'Kran buzildi', severity: 'medium' }] });
    expect(normalizeReport({})).toBeNull();
    expect(normalizeReport({ workDone: ['Qum tashildi'] })!.summary).toBe('Qum tashildi');
  });
  it('formats a readable message', () => {
    const t = formatReport({ objectName: 'Olmazor', summary: 'OK', workDone: ['A'], materialsUsed: [{ name: 'Qum', qty: 3, unit: 'm3' }], workersCount: 4, issues: [{ text: 'Yomg\'ir', severity: 'low' }] });
    expect(t).toMatch(/Olmazor/); expect(t).toMatch(/Qum — 3 m3/); expect(t).toMatch(/Ishchilar: 4/); expect(t).toMatch(/Yomg'ir/);
  });
});
