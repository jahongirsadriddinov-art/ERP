import { describe, it, expect } from 'vitest';
import { buildExpenseContext, promptLists, resolveEntity } from './expenseContext';
import { runVoiceExpensePipeline } from './voiceExpensePipeline';

const ctx = buildExpenseContext(
  [
    { _id: 'a1', name: '12-maktab', status: 'active' },
    { _id: 'a2', name: 'Yunusobod turar joy majmuasi', status: 'active' },
    { _id: 'a3', name: '45-maktab', status: 'active' },
    { _id: 'a4', name: 'Eski ombor', status: 'completed' },
  ],
  [
    { _id: 'b1', firstName: 'Botirjon', lastName: 'Karimov', role: 'prorab' },
    { _id: 'b2', firstName: 'Abdulaziz', lastName: 'Rahimov', role: 'brigadir' },
    { _id: 'b3', firstName: 'Aziz', lastName: 'Nazarov', role: 'ishchi' },
    { _id: 'b4', firstName: 'Dev', lastName: 'X', role: 'dasturchi' },
  ],
);

describe('expense context', () => {
  it('keys, aliases and prompt lines (active objects only, no developers)', () => {
    expect(ctx.objects.map((o) => o.key)).toEqual(['O1', 'O2', 'O3', 'O4']);
    expect(ctx.people.map((p) => p.id)).toEqual(['b1', 'b2', 'b3']);
    const l = promptLists(ctx);
    expect(l.objects).toHaveLength(3);
    expect(l.objects[1]).toMatch(/^O2: Yunusobod turar joy majmuasi \(.*yunusobod/);
    expect(l.people[0]).toMatch(/^P1: Botirjon Karimov — prorab \(.*botir/);
  });
});

describe('resolveEntity (model key + heard name → record or question)', () => {
  it('fuzzy match of heard name wins', () => {
    expect(resolveEntity(ctx.objects, 'Юнусабад').match?.id).toBe('a2');
    expect(resolveEntity(ctx.people, 'Botirga').match?.id).toBe('b1');
  });
  it('model key with high confidence resolves a nickname not in aliases', () => {
    expect(resolveEntity(ctx.people, 'Kaka', 'P1', 0.9).match?.id).toBe('b1');
    expect(resolveEntity(ctx.people, 'Kaka', 'P1', 0.5).match).toBeUndefined();
  });
  it('no heard name → model key only if confident', () => {
    expect(resolveEntity(ctx.objects, '', 'O3', 0.8).match?.id).toBe('a3');
    expect(resolveEntity(ctx.objects, '', 'O3', 0.3).match).toBeUndefined();
  });
  it('ambiguous "Aziz" → asks (choices), unless the model is confident in one of them', () => {
    const r = resolveEntity(ctx.people, 'Aziz');
    expect(r.match).toBeUndefined();
    expect(r.choices?.map((c) => c.id).sort()).toEqual(['b2', 'b3']);
    expect(resolveEntity(ctx.people, 'Aziz', 'P3', 0.9).match?.id).toBe('b3');
  });
  it('"maktab" with two schools → choices', () => {
    expect(resolveEntity(ctx.objects, 'maktabga').choices?.map((c) => c.id).sort()).toEqual(['a1', 'a3']);
  });
  it('model picked a different record than the exact heard name → heard name wins', () => {
    expect(resolveEntity(ctx.objects, '45-maktab', 'O1', 0.6).match?.id).toBe('a3');
  });
  it('unknown name stays unresolved (kept as spoken label)', () => {
    expect(resolveEntity(ctx.objects, 'Sergeli savdo markazi')).toEqual({});
  });
});

// Kechikish o'lchovi (soxta kechikishlar bilan): eski ketma-ket oqim va yangi parallel oqim.
// Telegram getFile+yuklash 350 ms, Mongo ro'yxatlar 120 ms, tasdiqlovchi 90 ms, Gemini 1200 ms (thinking bilan 2000 ms).
const wait = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
describe('voice pipeline latency (mocked)', () => {
  it('downloads, loads context and approver in parallel; AI starts as soon as audio+context are ready', async () => {
    const t0 = Date.now();
    const res = await runVoiceExpensePipeline({
      download: () => wait(350, Buffer.from('x')),
      loadContext: () => wait(120, ctx),
      loadApprover: () => wait(90, { _id: 'b1' }),
      parse: () => wait(1200, { amount: 1, description: 'x' }),
    });
    const total = Date.now() - t0;
    expect(res.parsed?.amount).toBe(1);
    expect(res.approver?._id).toBe('b1');
    // yangi: max(350,120) + 1200 ≈ 1550 ms
    expect(total).toBeLessThan(1550 + 250);
    // eski oqim (ketma-ket): 350 + 120 + 2000 + 120 (obyekt) + 90 (tasdiqlovchi) + 120 (xodimlar) = 2800 ms
    const old = 350 + 120 + 2000 + 120 + 90 + 120;
    expect(total).toBeLessThan(old - 1000);
    expect(res.timings.ai).toBeGreaterThanOrEqual(1150);
  });
  it('approver failure does not break the pipeline', async () => {
    const res = await runVoiceExpensePipeline({
      download: async () => Buffer.from('x'), loadContext: async () => ctx,
      loadApprover: () => Promise.reject(new Error('db')), parse: async () => null,
    });
    expect(res.approver).toBeNull();
    expect(res.parsed).toBeNull();
  });
});
