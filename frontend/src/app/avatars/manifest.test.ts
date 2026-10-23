import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { AVATARS } from "./manifest";
import { memojiFor, memojiHtml } from "../components/UserAvatar";

const DIR = resolve(__dirname, "../../../public/avatars");

describe("avatar manifest (Fluent 3D, faqat boshlar)", () => {
  it("43 ta (qora/to'q terililar olib tashlangan — owner 2026-10-23), id noyob, fayl mavjud (≤10 KB), id = fayl nomi", () => {
    expect(AVATARS.length).toBe(43);
    expect(new Set(AVATARS.map((a) => a.id)).size).toBe(AVATARS.length);
    for (const a of AVATARS) {
      expect(a.file).toBe(`/avatars/${a.id}.webp`);
      const f = resolve(DIR, `${a.id}.webp`);
      expect(existsSync(f), a.file).toBe(true);
      expect(statSync(f).size, a.file).toBeLessThanOrEqual(10 * 1024);
      expect(["m", "f", "n"]).toContain(a.gender);
    }
  });
  it("papkada ortiqcha rasm yo'q, NOTICE.txt har bir faylning manbasini va MIT matnini o'z ichiga oladi", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".webp")).sort();
    expect(files).toEqual(AVATARS.map((a) => `${a.id}.webp`).sort());
    const notice = readFileSync(resolve(DIR, "NOTICE.txt"), "utf8");
    const lines = notice.split(String.fromCharCode(10)).map((l) => l.trim());
    for (const f of files) {
      const line = lines.find((l) => l.startsWith(f + " "));
      expect(line, f).toBeDefined();
      expect(line!.includes(" assets/") && line!.includes("/3D/") && line!.trim().endsWith(".png"), line).toBe(true);
    }
    expect(notice).toContain("MIT License");
  });
  it("erkak/ayol to'plamlari yetarli, barcha teri ranglari bor", () => {
    expect(AVATARS.filter((a) => a.gender === "m").length).toBeGreaterThanOrEqual(20);
    expect(AVATARS.filter((a) => a.gender === "f").length).toBeGreaterThanOrEqual(15);
    for (const tone of ["-light", "-medium-light", "-medium"]) expect(AVATARS.some((a) => a.id.endsWith(tone)), tone).toBe(true);
    expect(AVATARS.some((a) => /-(dark|medium-dark)$/.test(a.id))).toBe(false);
  });
  it("bust rasmlar (kaska, ro'mol) bosh doirani to'ldirishi uchun fit'ga ega", () => {
    for (const a of AVATARS.filter((x) => /construction-worker|headscarf/.test(x.id))) {
      expect(a.fit, a.id).toBeDefined();
      expect(a.fit!.zoom).toBeGreaterThan(1);
      expect(a.fit!.y).toBeGreaterThan(0);
      expect(a.fit!.y).toBeLessThan(50);
    }
  });
});

describe("avtomatik memoji", () => {
  it("deterministik (user id va chat 'u:<id>' kaliti bir xil), jinsga mos", () => {
    const a = memojiFor("64f0c0ffee", "Jahongir Sadriddinov");
    expect(memojiFor("64f0c0ffee", "Jahongir Sadriddinov")).toEqual(a);
    expect(memojiFor("u:64f0c0ffee", "Jahongir Sadriddinov")).toEqual(a);
    expect(AVATARS.find((x) => x.id === a.id)!.gender).toBe("m");
    for (let i = 0; i < 40; i++) {
      const f = memojiFor(`id-${i}`, "Malika Karimova");
      expect(AVATARS.find((x) => x.id === f.id)!.gender).toBe("f");
      expect(f.src).toBe(`/avatars/${f.id}.webp`);
    }
  });
  it("turli foydalanuvchilarga turli yuzlar tushadi", () => {
    const ids = new Set(Array.from({ length: 200 }, (_, i) => memojiFor(`user-${i}`).id));
    expect(ids.size).toBeGreaterThan(40);
  });
  it("memojiHtml (xarita markeri): rasm bo'lsa rasm (xatoda memoji), bo'lmasa memoji + fit o'zgaruvchilari", () => {
    const withPhoto = memojiHtml("u1", "https://res.cloudinary.com/x/a.jpg", "Ali");
    expect(withPhoto).toContain('class="memoji-avatar__photo" src="https://res.cloudinary.com/x/a.jpg"');
    expect(withPhoto).toContain(memojiFor("u1", "Ali").src);
    let seed = "";
    for (let i = 0; i < 500 && !seed; i++) if (memojiFor(`s${i}`).fit) seed = `s${i}`;
    const fitted = memojiHtml(seed);
    expect(fitted).toContain("memoji-avatar__img--fit");
    expect(fitted).toMatch(/--av-zoom:[\d.]+;--av-y:\d+%/);
  });
});
