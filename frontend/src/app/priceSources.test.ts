import { describe, it, expect } from "vitest";
import { looksLikeSite } from "./PriceSourcesPanel";

describe("manba turini ajratish", () => {
  it("sayt manzillarini sayt deb biladi", () => {
    for (const v of ["https://narxlar.uz", "http://stroy.uz/sement", "narxlar.uz", "narxlar.uz/sement"]) {
      expect(looksLikeSite(v), v).toBe(true);
    }
  });

  it("Telegram kanalini sayt deb bilmaydi", () => {
    for (const v of ["@qurilish_narx", "qurilish_narx", "https://t.me/qurilish_narx", "t.me/qurilish_narx"]) {
      expect(looksLikeSite(v), v).toBe(false);
    }
  });

  it("bo'sh qiymat sayt emas", () => {
    expect(looksLikeSite("")).toBe(false);
    expect(looksLikeSite("   ")).toBe(false);
  });
});
