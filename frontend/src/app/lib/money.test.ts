import { describe, it, expect } from "vitest";
import { amountToInput, caretAfterFormat, fmtNumber, formatMoneyInput, parseMoney } from "./money";

describe("formatMoneyInput (so'm)", () => {
  it.each([
    ["1000", "1.000"], ["1250000", "1.250.000"], ["12", "12"], ["", ""], ["0012", "12"],
    ["1.0000", "10.000"], ["1 250 000", "1.250.000"], ["1.250.000 so'm", "1.250.000"], ["abc", ""],
    ["1.00", "100"], // nuqta o'chirilganda raqam yo'qolmaydi
  ])("%s → %s", (raw, out) => expect(formatMoneyInput(raw, "UZS")).toBe(out));
});

describe("formatMoneyInput ($/€)", () => {
  it.each([
    ["1250", "1.250"], ["12,5", "12,5"], ["12,567", "12,56"], ["12.", "12,"], ["12.5", "12,5"],
    ["1250.50", "1.250,50"], ["1.250", "1.250"], [",5", "0,5"],
  ])("%s → %s", (raw, out) => expect(formatMoneyInput(raw, "USD")).toBe(out));
  it("deleting inside a group does not turn it into a decimal", () => {
    expect(formatMoneyInput("1.00", "USD", { dotDecimal: false })).toBe("100");
  });
});

describe("parseMoney", () => {
  it.each([
    ["1.000", 1000], ["1.250.000", 1250000], ["12,5", 12.5], ["1.250,75", 1250.75], ["150000", 150000],
    ["12.5", 12.5], ["", 0], ["abc", 0], ["1 000", 1000],
  ])("%s → %s", (s, n) => expect(parseMoney(s)).toBe(n));
  it("numbers pass through", () => expect(parseMoney(42)).toBe(42));
});

describe("fmtNumber / amountToInput", () => {
  it("groups with dots, decimals with comma", () => {
    expect(fmtNumber(1250000)).toBe("1.250.000");
    expect(fmtNumber(12.5)).toBe("12,5");
    expect(fmtNumber(-1000)).toBe("-1.000");
    expect(fmtNumber(0)).toBe("0");
  });
  it("edit dialog initial value", () => {
    expect(amountToInput(150000, "UZS")).toBe("150.000");
    expect(amountToInput(12.5, "USD")).toBe("12,5");
    expect(amountToInput(0)).toBe("");
  });
});

describe("caretAfterFormat", () => {
  it("keeps the caret after the same digit", () => {
    // "1000|" → "1.000|"
    expect(caretAfterFormat("1000", 4, "1.000")).toBe(5);
    // "1.0005|0" (yozildi 5) → "100.050" kursor 5 dan keyin
    expect(caretAfterFormat("1.00050", 6, "100.050")).toBe(6);
    // boshida: "9|1.000" → "91.000", kursor 1
    expect(caretAfterFormat("91.000", 1, "91.000")).toBe(1);
    // kasr: "12,|" → "12,"
    expect(caretAfterFormat("12,", 3, "12,")).toBe(3);
  });
});
