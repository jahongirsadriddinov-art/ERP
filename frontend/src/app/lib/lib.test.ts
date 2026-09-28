import { describe, it, expect, afterEach } from "vitest";
import { compareVersions } from "./version";
import { guessExpType } from "./expense";
import { isTauri } from "../platform";

describe("compareVersions", () => {
  it("orders date-based release versions", () => {
    expect(compareVersions("2026.09.28-abc", "2026.09.27-xyz")).toBeGreaterThan(0);
    expect(compareVersions("2026.10.01-a", "2026.09.30-b")).toBeGreaterThan(0);
    expect(compareVersions("2026.09.28-a", "2026.09.28-b")).toBe(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
  });
});

describe("guessExpType", () => {
  it("detects expense categories from description", () => {
    expect(guessExpType("Sement 20 qop")).toBe("material");
    expect(guessExpType("ishchilarga oylik")).toBe("oylik");
    expect(guessExpType("benzin uchun")).toBe("transport");
    expect(guessExpType("drel ijarasi")).toBe("jihozlar");
    expect(guessExpType("цемент М400")).toBe("material");
    expect(guessExpType("xy")).toBeNull();
    expect(guessExpType("nimadir boshqa")).toBeNull();
  });
});

describe("isTauri", () => {
  const g = globalThis as any;
  afterEach(() => { delete g.window; });
  it("detects Tauri v2 via __TAURI_INTERNALS__ (withGlobalTauri off)", () => {
    g.window = { __TAURI_INTERNALS__: {} };
    expect(isTauri()).toBe(true);
  });
  it("is false in a normal browser", () => {
    g.window = {};
    expect(isTauri()).toBe(false);
  });
});
