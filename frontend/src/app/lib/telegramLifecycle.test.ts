import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installTelegramLifecycle, toHexColor, applyTelegramChrome } from './telegramLifecycle';
import { importWithRetry, whenVisible } from './lazyRetry';

// Minimal DOM o'rnini bosuvchi (vitest node muhitida) — hodisalar, style, getElementById
function fakeEnv(opts: { rootContent?: boolean } = {}) {
  const listeners: Record<string, Set<(e?: any) => void>> = {};
  const target = () => ({
    addEventListener: (ev: string, fn: any) => { (listeners[ev] ||= new Set()).add(fn); },
    removeEventListener: (ev: string, fn: any) => { listeners[ev]?.delete(fn); },
  });
  const body = { style: { opacity: '' } as any, offsetHeight: 1 };
  let hasContent = opts.rootContent ?? true;
  const doc: any = {
    ...target(),
    visibilityState: 'visible',
    body, documentElement: { style: {}, offsetHeight: 1 },
    head: { appendChild: vi.fn() },
    getElementById: (id: string) => id === 'root' ? { firstElementChild: hasContent ? {} : null } : null,
    querySelector: () => null,
  };
  const tgEvents: Record<string, (e?: any) => void> = {};
  const tg = {
    ready: vi.fn(), expand: vi.fn(), isVersionAtLeast: () => true,
    setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), setBottomBarColor: vi.fn(),
    onEvent: (ev: string, fn: any) => { tgEvents[ev] = fn; }, offEvent: vi.fn(),
  };
  const resized = vi.fn();
  const win: any = {
    ...target(),
    Telegram: { WebApp: tg },
    getComputedStyle: () => ({ backgroundColor: 'rgb(21, 16, 10)' }),
    dispatchEvent: (e: Event) => { if (e.type === 'resize') resized(); return true; },
    location: { reload: vi.fn() },
  };
  const fire = (ev: string) => listeners[ev]?.forEach((fn) => fn());
  return { doc, win, tg, tgEvents, fire, resized, body, setContent: (v: boolean) => { hasContent = v; } };
}

describe('telegramLifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('toHexColor converts computed colours for Telegram', () => {
    expect(toHexColor('rgb(21, 16, 10)')).toBe('#15100a');
    expect(toHexColor('#FFFBEB')).toBe('#fffbeb');
    expect(toHexColor('rgba(0, 0, 0, 0)')).toBeNull();
  });

  it('on start: ready(), expand(), header/background colour = page background', () => {
    const e = fakeEnv();
    installTelegramLifecycle({ win: e.win, doc: e.doc, raf: (fn) => fn() });
    expect(e.tg.ready).toHaveBeenCalled();
    expect(e.tg.expand).toHaveBeenCalled();
    expect(e.tg.setHeaderColor).toHaveBeenCalledWith('#15100a');
    expect(e.tg.setBackgroundColor).toHaveBeenCalledWith('#15100a');
  });

  it('hidden → visible (minimize/restore): re-expands, restores colours, repaints and fires resize; content stays', () => {
    const e = fakeEnv();
    const reload = vi.fn();
    installTelegramLifecycle({ win: e.win, doc: e.doc, reload, raf: (fn) => fn() });
    e.tg.expand.mockClear(); e.tg.setBackgroundColor.mockClear();
    e.doc.visibilityState = 'hidden';
    e.fire('visibilitychange');
    expect(e.tg.expand).not.toHaveBeenCalled(); // yashirin paytda hech narsa qilinmaydi
    vi.advanceTimersByTime(500);
    e.doc.visibilityState = 'visible';
    e.fire('visibilitychange');
    expect(e.tg.expand).toHaveBeenCalledTimes(1);
    expect(e.tg.setBackgroundColor).toHaveBeenCalledWith('#15100a');
    expect(e.resized).toHaveBeenCalled();
    expect(e.body.style.opacity).toBe('');
    vi.advanceTimersByTime(2000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("Telegram 'activated' event triggers recovery too", () => {
    const e = fakeEnv();
    installTelegramLifecycle({ win: e.win, doc: e.doc, raf: (fn) => fn() });
    e.tg.expand.mockClear();
    vi.advanceTimersByTime(500);
    e.tgEvents.activated?.();
    expect(e.tg.expand).toHaveBeenCalledTimes(1);
  });

  it('if the app root is blank after restore — reloads once (while visible)', () => {
    const e = fakeEnv({ rootContent: false });
    const reload = vi.fn();
    const lc = installTelegramLifecycle({ win: e.win, doc: e.doc, reload, raf: (fn) => fn() });
    lc.recover('test');
    vi.advanceTimersByTime(2000);
    lc.recover('again');
    vi.advanceTimersByTime(2000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('old Telegram without colour API — no crash', () => {
    const e = fakeEnv();
    expect(() => applyTelegramChrome({ expand: () => { throw new Error('x'); }, isVersionAtLeast: () => false }, e.win, e.doc)).not.toThrow();
  });
});

describe('lazyRetry', () => {
  it('retries a chunk that failed while hidden once the page is visible again', async () => {
    const listeners = new Set<() => void>();
    const doc: any = { visibilityState: 'hidden', addEventListener: (_: string, fn: any) => listeners.add(fn), removeEventListener: (_: string, fn: any) => listeners.delete(fn) };
    let calls = 0;
    const factory = () => { calls++; return calls === 1 ? Promise.reject(new TypeError('Importing a module script failed.')) : Promise.resolve({ default: 'ok' }); };
    const p = importWithRetry(factory, { doc, delayMs: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1); // hali yashirin — kutadi
    doc.visibilityState = 'visible';
    listeners.forEach((fn) => fn());
    await expect(p).resolves.toEqual({ default: 'ok' });
    expect(calls).toBe(2);
  });

  it('non-network errors are not retried', async () => {
    const factory = vi.fn(() => Promise.reject(new Error('SyntaxError in module')));
    await expect(importWithRetry(factory, { delayMs: 1 })).rejects.toThrow('SyntaxError');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('whenVisible resolves immediately without a document', async () => {
    await expect(whenVisible(undefined)).resolves.toBeUndefined();
  });
});
