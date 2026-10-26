import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installAutoUpdate, isSafeToReload, needsUpdate, JUST_UPDATED } from './autoUpdate';

function env(o: { dialog?: boolean; active?: any; hidden?: boolean } = {}) {
  const listeners: Record<string, Set<() => void>> = {};
  const add = (ev: string, fn: any) => { (listeners[ev] ||= new Set()).add(fn); };
  const rm = (ev: string, fn: any) => { listeners[ev]?.delete(fn); };
  const doc: any = {
    visibilityState: o.hidden ? 'hidden' : 'visible', activeElement: o.active ?? null,
    querySelector: () => (o.dialog ? {} : null), addEventListener: add, removeEventListener: rm,
  };
  const win: any = { addEventListener: add, removeEventListener: rm };
  const store: Record<string, string> = {};
  const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
  const fire = (ev: string) => listeners[ev]?.forEach((f) => f());
  return { doc, win, storage, store, fire, o };
}

describe('autoUpdate', () => {
  let t = 0;
  beforeEach(() => { vi.useFakeTimers(); t = 0; });
  afterEach(() => vi.useRealTimers());

  it('needsUpdate: different build, not already reloaded for it', () => {
    expect(needsUpdate('a', 'b', null)).toBe(true);
    expect(needsUpdate('a', 'a', null)).toBe(false);
    expect(needsUpdate('a', 'b', 'b')).toBe(false); // bir build uchun bir marta — aylanish yo'q
    expect(needsUpdate('a', null, null)).toBe(false);
  });

  it('isSafeToReload: not while hidden, a dialog is open or the user is typing', () => {
    expect(isSafeToReload(env().doc)).toBe(true);
    expect(isSafeToReload(env({ hidden: true }).doc)).toBe(false);
    expect(isSafeToReload(env({ dialog: true }).doc)).toBe(false);
    expect(isSafeToReload(env({ active: { tagName: 'TEXTAREA' } }).doc)).toBe(false);
    // PIN qulfi (maxfiylik pardasi) ortida ham yangilanmaydi
    const locked = env(); locked.doc.querySelector = (sel: string) => (sel.includes('privacy-cover') ? {} : null);
    expect(isSafeToReload(locked.doc)).toBe(false);
  });

  it('new build → waits for idle, then reloads once and marks "just updated"', async () => {
    const e = env();
    const reload = vi.fn();
    const sw = vi.fn();
    const au = installAutoUpdate({ current: 'old', fetchBuild: async () => 'new', doc: e.doc, win: e.win, reload, storage: e.storage, updateServiceWorker: sw, now: () => t, idleMs: 20_000 });
    t = 1000; e.fire('pointerdown');
    await au.check();
    expect(sw).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled(); // foydalanuvchi hozirgina harakat qildi
    t = 30_000; vi.advanceTimersByTime(5_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(e.store[JUST_UPDATED]).toBe('new');
    await au.check();
    expect(reload).toHaveBeenCalledTimes(1);
    au.dispose();
  });

  it('modal open → no reload; returning to the app (visible) applies it right away', async () => {
    const e = env({ dialog: true });
    const reload = vi.fn();
    const au = installAutoUpdate({ current: 'old', fetchBuild: async () => 'new', doc: e.doc, win: e.win, reload, storage: e.storage, now: () => t });
    t = 100_000;
    await au.check();
    vi.advanceTimersByTime(20_000);
    expect(reload).not.toHaveBeenCalled();
    e.o.dialog = false;
    e.doc.querySelector = () => null;
    e.doc.visibilityState = 'hidden'; e.fire('visibilitychange');
    expect(reload).not.toHaveBeenCalled(); // yashirin — iOS'da oq ekran bo'lardi
    e.doc.visibilityState = 'visible'; e.fire('visibilitychange');
    expect(reload).toHaveBeenCalledTimes(1);
    au.dispose();
  });

  it('same build or fetch failure → nothing happens', async () => {
    const e = env();
    const reload = vi.fn();
    const au = installAutoUpdate({ current: 'x', fetchBuild: async () => { throw new Error('offline'); }, doc: e.doc, win: e.win, reload, storage: e.storage, now: () => t });
    await au.check();
    expect(au.pending()).toBeNull();
    au.dispose();
  });
});
