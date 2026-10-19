import { describe, it, expect } from 'vitest';
import { computePlanFact } from './planFact';

const NOW = new Date('2026-10-19T00:00:00Z');
const obj = (o: any = {}) => ({ _id: 'o1', name: 'Olmazor', status: 'active', ...o });

describe('computePlanFact', () => {
  it('progress from materials; forecast cost and end date at the current pace', () => {
    const p = computePlanFact(
      obj({ budget: 1_000_000_000, startDate: '2026-07-01', endDate: '2026-12-31' }),
      [{ name: 'Sement', unit: 't', needed: 100, sent: 40 }, { name: 'Armatura', unit: 't', needed: 100, sent: 40 }],
      { confirmed: 500_000_000, pending: 20_000_000 }, NOW);
    expect(p.progressPct).toBe(40);
    expect(p.progressSource).toBe('materials');
    expect(p.spentPct).toBe(50);
    expect(p.forecastCost).toBe(1_250_000_000);
    expect(p.forecastOverrun).toBe(250_000_000);
    expect(p.status).toBe('risk');
    expect(p.delayDays).toBeGreaterThan(60);
    expect(p.timePct).toBeGreaterThan(55);
  });

  it('manual progress wins over AI and materials; on-track object is ok', () => {
    const p = computePlanFact(
      obj({ budget: 100, startDate: '2026-10-01', endDate: '2026-11-01', progressManual: 60, progressAi: { percent: 10 } }),
      [{ name: 'Qum', unit: 'm3', needed: 10, sent: 1 }], { confirmed: 50, pending: 0 }, NOW);
    expect(p.progressPct).toBe(60);
    expect(p.progressSource).toBe('manual');
    expect(p.status).toBe('ok');
    expect(p.notes.join(' ')).toMatch(/Material yetkazish/);
  });

  it('over budget, late and no-plan states', () => {
    expect(computePlanFact(obj({ budget: 100 }), [], { confirmed: 150, pending: 0 }, NOW).status).toBe('over_budget');
    expect(computePlanFact(obj({ endDate: '2026-09-01', progressManual: 70 }), [], { confirmed: 0, pending: 0 }, NOW).status).toBe('late');
    expect(computePlanFact(obj(), [], { confirmed: 0, pending: 0 }, NOW).status).toBe('no_plan');
  });

  it('AI photo estimate is used when there is no manual value; completed = 100%', () => {
    expect(computePlanFact(obj({ progressAi: { percent: 33 } }), [], { confirmed: 0, pending: 0 }, NOW)).toMatchObject({ progressPct: 33, progressSource: 'ai_photo' });
    expect(computePlanFact(obj({ status: 'completed', budget: 10 }), [], { confirmed: 9, pending: 0 }, NOW)).toMatchObject({ progressPct: 100, forecastCost: 9 });
  });

  it('smeta total is the budget when no budget is set; lagging materials listed', () => {
    const p = computePlanFact(obj({ smeta: { meta: { totalWithoutVat: 200 } } }),
      [{ name: 'Blok', unit: 'dona', needed: 1000, sent: 100 }, { name: 'Qum', unit: 'm3', needed: 10, sent: 9 }], { confirmed: 20, pending: 0 }, NOW);
    expect(p.budget).toBe(200);
    expect(p.materials.behind.map((m) => m.name)).toEqual(['Blok']);
  });
});
