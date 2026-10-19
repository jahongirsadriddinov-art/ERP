import { describe, it, expect } from 'vitest';
import { docStage, fuelAnomaly, overSmetaFindings, priceTrends, spikeFinding } from './insights';

const NOW = new Date('2026-10-19T06:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('insights — material nazorati', () => {
  it('flags materials sent well above the smeta (critical at +40%)', () => {
    const f = overSmetaFindings('Olmazor', 'o1', [
      { name: 'Sement', unit: 't', needed: 100, sent: 112 },   // +12% — normal
      { name: 'Armatura', unit: 't', needed: 50, sent: 60 },   // +20% — warning
      { name: 'Qum', unit: 'm3', needed: 10, sent: 15 },       // +50% — critical
      { name: 'Blok', unit: 'dona', needed: 0, sent: 99 },     // smetada yo'q — e'tiborsiz
    ]);
    expect(f.map((x) => [x.text.split(':')[0], x.severity])).toEqual([['Armatura', 'warning'], ['Qum', 'critical']]);
  });
  it('spike = last 7 days ≥ 3× weekly average of the previous 4 weeks', () => {
    expect(spikeFinding(60, 40)).toBe(true);     // haftasiga 10, endi 60
    expect(spikeFinding(25, 40)).toBe(false);
    expect(spikeFinding(8, 0)).toBe(false);
  });
});

describe('insights — narx monitoringi', () => {
  it('compares the last week median with the previous period', () => {
    const rows = [
      { materialName: 'Sement M400', unit: 't', price: 1_000_000, createdAt: daysAgo(30) },
      { materialName: 'sement m400', unit: 't', price: 1_000_000, createdAt: daysAgo(20) },
      { materialName: 'Sement  M400', unit: 't', price: 1_020_000, createdAt: daysAgo(12) },
      { materialName: 'Sement M400', unit: 't', price: 1_150_000, createdAt: daysAgo(2) },
      { materialName: 'Qum', unit: 'm3', price: 90_000, createdAt: daysAgo(1) },
    ];
    const t = priceTrends(rows, NOW);
    expect(t[0]).toMatchObject({ material: 'Sement M400', samples: 4, recentAvg: 1_150_000, prevAvg: 1_000_000, changePct: 15 });
    expect(t.find((x) => x.material === 'Qum')).toMatchObject({ prevAvg: null, changePct: null });
  });
});

describe('insights — hujjat va texnika', () => {
  it('document reminder stages', () => {
    expect(docStage(new Date(NOW.getTime() + 25 * 86_400_000), NOW).stage).toBe('d30');
    expect(docStage(new Date(NOW.getTime() + 5 * 86_400_000), NOW).stage).toBe('d7');
    expect(docStage(new Date(NOW.getTime() + 12 * 3600_000), NOW).stage).toBe('d1');
    expect(docStage(daysAgo(2), NOW).stage).toBe('expired');
    expect(docStage(new Date(NOW.getTime() + 90 * 86_400_000), NOW).stage).toBeNull();
  });
  it('fuel anomaly vs norm or historical median', () => {
    expect(fuelAnomaly({ hours: 8, fuel: 160 }, [], 12)).toBe(1.7);                 // 20 l/soat vs 12
    expect(fuelAnomaly({ hours: 8, fuel: 100 }, [], 12)).toBeNull();
    const hist = Array.from({ length: 6 }, () => ({ hours: 10, fuel: 100 }));        // 10 l/soat
    expect(fuelAnomaly({ hours: 5, fuel: 80 }, hist)).toBe(1.6);
    expect(fuelAnomaly({ hours: 5, fuel: 80 }, hist.slice(0, 3))).toBeNull();        // tarix yetarli emas
  });
});
