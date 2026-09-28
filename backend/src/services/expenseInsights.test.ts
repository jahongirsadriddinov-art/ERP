import { describe, it, expect } from 'vitest';
import { median, isAnomalous, budgetLevel } from './expenseInsights';

describe('expense insights', () => {
  it('median', () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('anomaly needs enough history, a big amount and 3x the median', () => {
    const hist = [500_000, 600_000, 700_000, 800_000, 550_000];
    expect(isAnomalous(3_000_000, hist)).toBe(true);
    expect(isAnomalous(1_500_000, hist)).toBe(false);
    expect(isAnomalous(3_000_000, hist.slice(0, 3))).toBe(false);
    expect(isAnomalous(900_000, [100, 200, 150, 120, 130])).toBe(false); // < 1 mln
  });
  it('budget level thresholds', () => {
    expect(budgetLevel(50, 0)).toBe(0);
    expect(budgetLevel(79, 100)).toBe(0);
    expect(budgetLevel(80, 100)).toBe(80);
    expect(budgetLevel(100, 100)).toBe(100);
    expect(budgetLevel(150, 100)).toBe(100);
  });
});
