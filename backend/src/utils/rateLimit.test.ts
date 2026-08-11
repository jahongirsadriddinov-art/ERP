import { describe, it, expect, beforeEach } from 'vitest';
import { checkRate } from './rateLimit';

// Each test uses a unique key to avoid cross-test state pollution.
let counter = 0;
const key = () => `test:rateLimit:${++counter}`;

describe('checkRate', () => {
  it('allows first request', () => {
    const { allowed } = checkRate(key(), 3, 60_000);
    expect(allowed).toBe(true);
  });

  it('allows up to max requests', () => {
    const k = key();
    for (let i = 0; i < 3; i++) {
      expect(checkRate(k, 3, 60_000).allowed).toBe(true);
    }
  });

  it('blocks on max+1 request', () => {
    const k = key();
    for (let i = 0; i < 5; i++) checkRate(k, 5, 60_000);
    const { allowed, retryAfterSec } = checkRate(k, 5, 60_000);
    expect(allowed).toBe(false);
    expect(retryAfterSec).toBeGreaterThan(0);
  });

  it('returns retryAfterSec > 0 when blocked', () => {
    const k = key();
    checkRate(k, 1, 60_000);
    const { retryAfterSec } = checkRate(k, 1, 60_000);
    expect(retryAfterSec).toBeGreaterThan(0);
    expect(retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('different keys are independent', () => {
    const k1 = key(); const k2 = key();
    for (let i = 0; i < 3; i++) checkRate(k1, 3, 60_000);
    checkRate(k1, 3, 60_000); // blocked
    expect(checkRate(k2, 3, 60_000).allowed).toBe(true); // different key — fine
  });
});
