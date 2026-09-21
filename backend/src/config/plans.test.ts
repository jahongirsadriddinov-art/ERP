import { describe, it, expect } from 'vitest';
import { getPlanInfo, PLAN_CONFIG, ALL_FEATURE_KEYS } from './plans';

// getPlanInfo's Object.hasOwn guard is a real, previously-identified fix
// (see the comment above it in plans.ts) — without it, a key like
// '__proto__' or 'constructor' could resolve to a prototype-chain property
// instead of `undefined`, letting a request with a crafted planKey falsely
// appear to "have" a plan. This test locks that behavior in.
describe('getPlanInfo', () => {
  it('returns undefined for a plan key that does not exist', () => {
    expect(getPlanInfo('this-plan-does-not-exist')).toBeUndefined();
  });

  it('does not resolve prototype-chain properties for special keys', () => {
    expect(getPlanInfo('__proto__')).toBeUndefined();
    expect(getPlanInfo('constructor')).toBeUndefined();
    expect(getPlanInfo('toString')).toBeUndefined();
  });

  it('returns the plan info for a key actually present in PLAN_CONFIG', () => {
    PLAN_CONFIG['test-plan-xyz'] = { label: 'Test', days: 30, amount: 1000, features: ['gps_tracking'] };
    try {
      expect(getPlanInfo('test-plan-xyz')).toEqual({ label: 'Test', days: 30, amount: 1000, features: ['gps_tracking'] });
    } finally {
      delete PLAN_CONFIG['test-plan-xyz'];
    }
  });
});

describe('ALL_FEATURE_KEYS', () => {
  it('is a non-empty list of unique string keys', () => {
    expect(ALL_FEATURE_KEYS.length).toBeGreaterThan(0);
    expect(new Set(ALL_FEATURE_KEYS).size).toBe(ALL_FEATURE_KEYS.length);
  });
});
