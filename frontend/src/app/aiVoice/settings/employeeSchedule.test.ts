import { describe, it, expect } from "vitest";
import { dayRanges, normalizeOverride, overrideSummary, sameOverride, validateOverride } from "./employeeSchedule";

const L = (d: number) => ["", "Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"][d];

describe("xodim jadvali (override)", () => {
  it("kunlarni tartiblaydi, takror va noto'g'ri qiymatlarni tashlaydi, vaqtni normallashtiradi", () => {
    expect(normalizeOverride({ weekdays: [5, 1, 1, 9, 0, "2"], workStart: "7:30" })).toEqual({ weekdays: [1, 5], workStart: "07:30" });
    expect(normalizeOverride({ weekdays: [3], workStart: "" })).toEqual({ weekdays: [3] });
    expect(normalizeOverride({ weekdays: [3], workStart: "25:00" })).toEqual({ weekdays: [3] });
    expect(normalizeOverride(null)).toBeNull();
  });
  it("tekshiruv: kamida bitta kun, vaqt SS:DD", () => {
    expect(validateOverride(null)).toBeNull();
    expect(validateOverride({ weekdays: [] })).toBe("needDay");
    expect(validateOverride({ weekdays: [1], workStart: "8:61" })).toBe("badTime");
    expect(validateOverride({ weekdays: [1], workStart: "" })).toBeNull();
    expect(validateOverride({ weekdays: [1, 2], workStart: "08:00" })).toBeNull();
  });
  it("taqqoslash tartib va null'ni hisobga oladi", () => {
    expect(sameOverride({ weekdays: [2, 1] }, { weekdays: [1, 2] })).toBe(true);
    expect(sameOverride({ weekdays: [1], workStart: "08:00" }, { weekdays: [1] })).toBe(false);
    expect(sameOverride(null, undefined)).toBe(true);
    expect(sameOverride(null, { weekdays: [1] })).toBe(false);
  });
  it("oraliqlar va qisqa ko'rinish", () => {
    expect(dayRanges([1, 2, 3, 5, 7, 6])).toEqual([[1, 3], [5, 7]]);
    expect(overrideSummary({ weekdays: [1, 2, 3, 4, 5], workStart: "07:30" }, L)).toBe("Du–Ju · 07:30");
    expect(overrideSummary({ weekdays: [1, 2, 4] }, L)).toBe("Du, Se, Pa");
  });
});
