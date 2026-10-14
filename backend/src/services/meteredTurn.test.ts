import { describe, it, expect } from 'vitest';
import { normalizeMeteredAppName } from './meteredTurn';

describe('normalizeMeteredAppName', () => {
  it("Render'ga qanday yozilsa ham faqat ilova nomini qaytaradi", () => {
    expect(normalizeMeteredAppName('erp-firma')).toBe('erp-firma');
    expect(normalizeMeteredAppName('erp-firma.metered.live')).toBe('erp-firma');
    expect(normalizeMeteredAppName('https://erp-firma.metered.live/')).toBe('erp-firma');
    expect(normalizeMeteredAppName(' https://erp-firma.metered.live/api/v1/turn ')).toBe('erp-firma');
    expect(normalizeMeteredAppName('')).toBeUndefined();
    expect(normalizeMeteredAppName(undefined)).toBeUndefined();
  });
});
