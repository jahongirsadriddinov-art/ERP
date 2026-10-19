import { describe, it, expect } from 'vitest';
import { mergeProgress, normalizeAnalysis } from './photoAnalysis';

describe('photoAnalysis helpers', () => {
  it('normalizes the AI JSON (clamps, drops junk, keeps severities)', () => {
    const a = normalizeAnalysis({ stage: 'Devor terish', progressPercent: '47.6', confidence: 3, workVisible: 'Ikkinchi qavat devori',
      safety: [{ issue: 'Kaskasiz ishchi', severity: 'high' }, { issue: '', severity: 'low' }, { issue: 'Chuqur to\'siqsiz', severity: 'weird' }], quality: ['Yoriq', ''] });
    expect(a).toMatchObject({ stage: 'Devor terish', progressPercent: 48, confidence: 1, quality: ['Yoriq'] });
    expect(a.safety).toEqual([{ issue: 'Kaskasiz ishchi', severity: 'high' }, { issue: "Chuqur to'siqsiz", severity: 'low' }]);
    expect(normalizeAnalysis({ progressPercent: 140 }).progressPercent).toBeNull();
    expect(normalizeAnalysis(null).safety).toEqual([]);
  });
  it('progress never drops sharply from one partial photo', () => {
    expect(mergeProgress(undefined, 30)).toBe(30);
    expect(mergeProgress(40, 55)).toBe(55);
    expect(mergeProgress(60, 20)).toBe(55);
    expect(mergeProgress(60, 58)).toBe(58);
  });
});
