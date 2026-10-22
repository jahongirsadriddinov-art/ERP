import { describe, it, expect, vi } from 'vitest';
vi.mock('../platform', () => ({ isTauri: () => true, isNative: () => true }));
import { installNativeContextMenuGuard } from './nativeContextMenu';

describe("ilovada brauzer menyusi chiqmaydi (owner 2026-10-22)", () => {
  it("oddiy joyda bloklanadi, matn maydonida va belgilangan matnda — yo'q", () => {
    let handler: ((e: any) => void) | null = null;
    (globalThis as any).document = { addEventListener: (_t: string, h: any) => { handler = h; } };
    let selected = '';
    (globalThis as any).window = { getSelection: () => ({ toString: () => selected }) };
    installNativeContextMenuGuard();
    const fire = (editable: boolean) => {
      const e = { target: { closest: () => (editable ? {} : null) }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      handler!(e);
      return e.defaultPrevented;
    };
    expect(fire(false)).toBe(true);
    expect(fire(true)).toBe(false);
    selected = 'matn';
    expect(fire(false)).toBe(false);
  });
});
