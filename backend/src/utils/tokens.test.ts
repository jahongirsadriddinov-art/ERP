import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, normalizePhone, isValidUzPhone, isStrongPassword, safeEqual } from './tokens';

describe('hashPassword / verifyPassword', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    expect(h1).not.toBe(h2);
    expect(await verifyPassword('same-password', h1)).toBe(true);
    expect(await verifyPassword('same-password', h2)).toBe(true);
  });

  it('never throws on garbage stored hash (e.g. corrupted DB field)', async () => {
    await expect(verifyPassword('anything', 'not-a-real-hash')).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
  });
});

describe('normalizePhone / isValidUzPhone', () => {
  it('adds a leading + if missing', () => {
    expect(normalizePhone('998901234567')).toBe('+998901234567');
  });
  it('strips spaces and dashes', () => {
    expect(normalizePhone('+998 90-123 45 67')).toBe('+998901234567');
  });
  it('accepts a valid Uzbek number', () => {
    expect(isValidUzPhone('+998901234567')).toBe(true);
  });
  it('rejects a non-Uzbek / malformed number', () => {
    expect(isValidUzPhone('+1234567890')).toBe(false);
    expect(isValidUzPhone('+99890123')).toBe(false);
  });
});

describe('isStrongPassword', () => {
  it('rejects short passwords', () => {
    expect(isStrongPassword('short')).toBe(false);
  });
  it('accepts 8+ character passwords', () => {
    expect(isStrongPassword('longenough')).toBe(true);
  });
});

describe('safeEqual', () => {
  it('returns true for equal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
  it('returns false for different strings (no throw on length mismatch)', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abc', 'xyz')).toBe(false);
  });
});
