import { describe, expect, it } from "vitest";
import { buildScenes, ease, pickShot, pickVideoMime, sceneAt, totalDuration, TRANSITION, wrapLines } from "./studio";

// SMM studiyasi — sof qismlar: sahnalar (muammo → yechim, maslahat, promo), vaqt jadvali va o'tishlar, matn bo'lish,
// skrinshot tanlash, video formati (MP4 bo'lsa — MP4).
const item = {
  title: "Qog'oz cheklar yo'qolmaydi", text: "Prorab ovoz bilan aytadi. Chiqim o'zi yoziladi. Hisobot tayyor.", topic: "ovozli chiqim", category: "problem",
  scenes: [{ title: "Cheklar yo'qoladi", text: "Oy oxirida pul topilmaydi" }, { title: "Ovozli chiqim", text: "Botga ayting — summa va obyekt yoziladi" }],
};

describe("studio", () => {
  it("muammo → yechim: hook, muammo, yechim, telefon maketi (moliya skrinshoti), CTA", () => {
    const s = buildScenes(item, "problem");
    expect(s.map((x) => x.kind)).toEqual(["hook", "problem", "solution", "device", "cta"]);
    expect(s[3].shot).toBe("finance");
    expect(s[1].title).toBe("Cheklar yo'qoladi");
    expect(totalDuration(s)).toBeGreaterThan(12);
    expect(totalDuration(s)).toBeLessThan(25);
  });

  it("maslahat va promo; skrinshotlar takrorlanmaydi", () => {
    expect(buildScenes(item, "tip").map((x) => x.kind)).toEqual(["hook", "points", "device", "cta"]);
    const promo = buildScenes({ ...item, scenes: [{ title: "GPS davomat", text: "xarita" }, { title: "Chiqimlar", text: "kassa" }, { title: "Chat", text: "xabar" }] }, "promo");
    expect(promo.filter((x) => x.kind === "device").map((x) => x.shot)).toEqual(["gps", "finance", "chat"]);
    expect(pickShot("nimadir")).toBe("dashboard");
    expect(pickShot("GPS xarita", ["gps"])).toBe("dashboard");
  });

  it("vaqt jadvali: o'tish oxirgi 0.45 s ichida, oxiri — oxirgi sahna", () => {
    const s = buildScenes(item, "problem");
    expect(sceneAt(s, 0)).toEqual({ i: 0, local: 0 });
    const mid = sceneAt(s, s[0].dur - TRANSITION / 2);
    expect(mid.i).toBe(0);
    expect(mid.next?.i).toBe(1);
    expect(mid.next!.mix).toBeGreaterThan(0.3);
    expect(mid.next!.mix).toBeLessThan(0.7);
    expect(sceneAt(s, s[0].dur + 0.1).i).toBe(1);
    expect(sceneAt(s, 999).i).toBe(s.length - 1);
    expect(ease.outCubic(0)).toBe(0);
    expect(ease.outCubic(1)).toBe(1);
    expect(ease.inOutCubic(0.5)).toBeCloseTo(0.5);
  });

  it("matnni qatorlarga bo'lish va kesish", () => {
    const m = (s: string) => s.length * 10;
    expect(wrapLines("bir ikki uch tort", 80, m)).toEqual(["bir ikki", "uch tort"]);
    expect(wrapLines("a b c d e f g h", 30, m, 2)).toEqual(["a b", "c d…"]);
  });

  it("video formati: MP4 (H.264) bo'lsa — MP4, aks holda WebM, yo'q bo'lsa null", () => {
    expect(pickVideoMime((m) => m.startsWith("video/mp4"))).toMatch(/^video\/mp4/);
    expect(pickVideoMime((m) => m.startsWith("video/webm"))).toMatch(/^video\/webm/);
    expect(pickVideoMime(() => false)).toBeNull();
  });
});
