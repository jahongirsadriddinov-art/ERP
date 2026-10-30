import { describe, it, expect } from "vitest";
import { defaultPlanKey } from "./SubscriptionBlocked";

type P = { key: string; label: string; days: number; amount: number };

const PLANS: P[] = [
  { key: "m1-oddiy", label: "1 oylik — Oddiy", days: 30, amount: 500_000 },
  { key: "m1-standart", label: "1 oylik — Standart", days: 30, amount: 800_000 },
  { key: "m1-premium", label: "1 oylik — Premium", days: 30, amount: 900_000 },
  { key: "m3-oddiy", label: "3 oylik — Oddiy", days: 90, amount: 2_000_000 },
  { key: "y1-oddiy", label: "12 oylik — Oddiy", days: 365, amount: 5_000_000 },
];

describe("standart tarif tanlovi", () => {
  it("1 oylik tariflar ichidan eng qimmatini tanlaydi (uzoq muddatlisini emas)", () => {
    expect(defaultPlanKey(PLANS)).toBe("m1-premium");
  });

  it("tartibi aralash bo'lsa ham bir xil natija", () => {
    expect(defaultPlanKey([...PLANS].reverse())).toBe("m1-premium");
  });

  it("faqat uzoq muddatli tariflar bo'lsa — eng qisqasining eng qimmati", () => {
    const only = PLANS.filter((p) => p.days > 30);
    expect(defaultPlanKey(only)).toBe("m3-oddiy");
  });

  it("ro'yxat bo'sh bo'lsa — bo'sh qaytaradi", () => {
    expect(defaultPlanKey([])).toBe("");
  });

  it("kun ko'rsatilmagan tarif chegarani buzmaydi", () => {
    const odd = [{ key: "x", label: "X", days: 0, amount: 100 }, ...PLANS];
    expect(defaultPlanKey(odd)).toBe("m1-premium");
  });
});
