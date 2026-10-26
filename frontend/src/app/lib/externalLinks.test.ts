// Ilovada tashqi havolalar tizim brauzerida ochilishi kerak (owner 2026-10-26: shell|open ACL xatosi).
// Brauzersiz tekshiriladi — frontend testlarida DOM yo'q.
import { describe, it, expect } from "vitest";
import { externalHrefFrom } from "./externalLinks";

const clicked = (href: string | null, target?: string) => ({
  closest: () => (href === null ? null : { getAttribute: (n: string) => (n === "href" ? href : n === "target" ? target ?? null : null) }),
});

describe("externalHrefFrom", () => {
  it("tashqi havolalarni topadi", () => {
    expect(externalHrefFrom(clicked("https://t.me/qurilish_erp_bot", "_blank"))).toBe("https://t.me/qurilish_erp_bot");
    expect(externalHrefFrom(clicked("mailto:a@b.uz"))).toBe("mailto:a@b.uz");
    expect(externalHrefFrom(clicked("tel:+998901112233"))).toBe("tel:+998901112233");
  });
  it("ichki yo'llar va xavfli sxemalarga tegmaydi", () => {
    expect(externalHrefFrom(clicked("#bolim"))).toBeNull();
    expect(externalHrefFrom(clicked("/moliya"))).toBeNull();
    expect(externalHrefFrom(clicked("javascript:alert(1)"))).toBeNull();
    expect(externalHrefFrom(clicked(null))).toBeNull();
    expect(externalHrefFrom({})).toBeNull();
  });
});
