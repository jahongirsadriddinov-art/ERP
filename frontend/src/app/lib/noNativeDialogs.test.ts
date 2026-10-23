// Windows ilovasida (Tauri) window.confirm/alert/prompt "dialog not allowed by ACL" xatosi berardi (owner 2026-10-23) —
// hamma joyda ilovaning o'z oynasi (lib/confirmDialog) ishlatilsin.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("brauzer dialoglari ishlatilmaydi", () => {
  it("window.confirm / window.alert / window.prompt yo'q", () => {
    const bad = files(join(__dirname, "..")).filter((f) => /\bwindow\.(confirm|alert|prompt)\s*\(/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
