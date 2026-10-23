import { describe, it, expect } from "vitest";
import { isDevtoolsShortcut } from "./devtoolsGuard";

const k = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  ({ key, code: key === "F12" ? "F12" : `Key${key.toUpperCase()}`, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });

describe("isDevtoolsShortcut", () => {
  it("F12, Ctrl+Shift+I/J/C, Ctrl+U bloklanadi; oddiy yozish va Ctrl+C/V emas", () => {
    expect(isDevtoolsShortcut(k("F12"))).toBe(true);
    expect(isDevtoolsShortcut(k("i", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsShortcut(k("J", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsShortcut(k("u", { ctrlKey: true }))).toBe(true);
    expect(isDevtoolsShortcut(k("c", { ctrlKey: true }))).toBe(false);
    expect(isDevtoolsShortcut(k("v", { ctrlKey: true }))).toBe(false);
    expect(isDevtoolsShortcut(k("a"))).toBe(false);
  });
});
