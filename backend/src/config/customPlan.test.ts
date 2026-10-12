import { describe, it, expect } from 'vitest';
import { priceCustomPlan, DEFAULT_CUSTOM_PRICING } from './customPlan';

describe("O'zim tanlayman tarifi narxi", () => {
  it('asosiy narx + funksiyalar, muddat chegirmasi bilan', () => {
    const one = priceCustomPlan(DEFAULT_CUSTOM_PRICING, 1, ['ai_assistant', 'income'])!;
    expect(one.amount).toBe(150_000 + 120_000 + 50_000);
    expect(one.days).toBe(30);
    const year = priceCustomPlan(DEFAULT_CUSTOM_PRICING, 12, ['ai_assistant', 'income'])!;
    expect(year.amount).toBe(Math.round((320_000 * 12 * 0.75) / 1000) * 1000);
    expect(year.days).toBe(365);
  });
  it("noma'lum funksiya va muddat rad etiladi", () => {
    expect(priceCustomPlan(DEFAULT_CUSTOM_PRICING, 5, [])).toBeNull();
    expect(priceCustomPlan(DEFAULT_CUSTOM_PRICING, 3, ['hack', 'gps_tracking'])!.features).toEqual(['gps_tracking']);
  });
});
