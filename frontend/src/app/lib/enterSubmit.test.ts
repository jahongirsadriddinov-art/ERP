// Enter bosilganda qaysi tugma "asosiy amal" deb hisoblanishi (owner 2026-10-29).
// Eng muhimi: qizil (o'chirish/bekor) tugma HECH QACHON tanlanmasligi kerak —
// aks holda Enter tasodifan ma'lumotni o'chirib yuborardi.
import { describe, it, expect } from "vitest";
import { isPrimaryClass } from "./enterSubmit";

describe("isPrimaryClass", () => {
  it("asosiy amal tugmalarini taniydi", () => {
    expect(isPrimaryClass("w-full bg-primary text-white rounded-full")).toBe(true);
    expect(isPrimaryClass("bg-gradient-to-r from-primary via-primary to-blue-700")).toBe(true);
    expect(isPrimaryClass("bg-green-600 text-white rounded py-1.5")).toBe(true);
  });

  it("xavfli va ikkinchi darajali tugmalarni tanlamaydi", () => {
    expect(isPrimaryClass("bg-red-500 text-white")).toBe(false);
    expect(isPrimaryClass("text-red-600 hover:bg-red-500/10")).toBe(false);
    expect(isPrimaryClass("p-1.5 rounded-lg hover:bg-muted")).toBe(false);
    expect(isPrimaryClass("text-sm text-muted-foreground hover:text-foreground")).toBe(false);
    expect(isPrimaryClass("")).toBe(false);
  });

  it("asosiy rang qizil bilan aralashsa — tanlamaydi (ehtiyot tomoni)", () => {
    expect(isPrimaryClass("bg-primary text-red-600")).toBe(false);
  });

  it("o'xshash nomlarni asosiy deb hisoblamaydi", () => {
    expect(isPrimaryClass("bg-primary/5 border-primary/30")).toBe(false);
  });
});
