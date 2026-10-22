import { describe, it, expect } from 'vitest';
import { priceCustomPlan, DEFAULT_CUSTOM_PRICING, BASE_FEATURE_KEYS } from './customPlan';

describe("O'zim tanlayman tarifi narxi (owner 2026-10-22: faqat qo'shimchalar; bazaviylari har tarifda)", () => {
  it('asos narx + qo\'shimchalar, muddat chegirmasi bilan; bazaviylar bepul qo\'shiladi', () => {
    const one = priceCustomPlan(DEFAULT_CUSTOM_PRICING, 1, ['ai_assistant'])!;
    expect(one.amount).toBe(250_000 + 200_000);
    expect(one.days).toBe(30);
    expect(one.features).toEqual([...BASE_FEATURE_KEYS, 'ai_assistant']);
    const year = priceCustomPlan(DEFAULT_CUSTOM_PRICING, 12, ['ai_assistant'])!;
    expect(year.amount).toBe(Math.round((450_000 * 12 * 0.77) / 1000) * 1000);
    expect(year.days).toBe(365);
  });
  it("bazaviy funksiya tanlansa narx oshmaydi; noma'lum funksiya va muddat rad etiladi", () => {
    expect(priceCustomPlan(DEFAULT_CUSTOM_PRICING, 1, ['gps_tracking', 'reports'])!.amount).toBe(250_000);
    expect(priceCustomPlan(DEFAULT_CUSTOM_PRICING, 5, [])).toBeNull();
    expect(priceCustomPlan(DEFAULT_CUSTOM_PRICING, 3, ['hack'])!.features).toEqual(BASE_FEATURE_KEYS);
  });
  it("hamma qo'shimcha ≈ Premium (600 000/oy) narxida", () => {
    const all = priceCustomPlan(DEFAULT_CUSTOM_PRICING, 1, ['ai_assistant', 'backup', 'audit_log', 'multi_currency'])!;
    expect(all.amount).toBe(600_000);
  });
});
