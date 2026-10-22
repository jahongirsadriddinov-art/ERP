import { describe, it, expect, vi } from 'vitest';
vi.mock('../platform', () => ({ isTauri: () => true, isNative: () => true }));
import { installNativeContextMenuGuard } from './nativeContextMenu';

describe("ilovada brauzer menyusi chiqmaydi (owner 2026-10-22)", () => {
  it("oddiy joyda bloklanadi, matn maydonida — yo'q", () => {
    installNativeContextMenuGuard();
    const div = document.createElement('div'); const input = document.createElement('input');
    document.body.append(div, input);
    const fire = (el: Element) => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
    expect(fire(div)).toBe(true);
    expect(fire(input)).toBe(false);
  });
});
