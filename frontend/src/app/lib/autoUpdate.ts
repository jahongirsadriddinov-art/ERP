// Yangi versiya avtomatik qo'llanadi (owner 2026-10-25: "ilovadagi yangilanish faqat refreshdan keyin yuklanyapti").
//
// Sabab: sayt (va Telegram Mini App) bir sahifali ilova — ochiq oyna yangi deploy'ni hech qachon so'ramasdi;
// yangi kod faqat foydalanuvchi o'zi yangilaganda yuklanardi. Endi:
//   • har build o'z id'si bilan /version.json chiqaradi (vite.config.ts); ochiq oyna uni 5 daqiqada bir, ilova
//     qaytib ochilganda va internet qaytganda so'raydi (kesh yo'q);
//   • yangi build topilsa — service worker ham yangilanadi (sw.js: skipWaiting + clients.claim);
//   • qayta yuklash faqat XAVFSIZ paytda: sahifa ko'rinib turgan (iOS'da yashirin sahifani yangilash — oq ekran),
//     ochiq oyna (modal/dialog) yo'q, yozilayotgan maydon (fokusdagi input/textarea) yo'q, qo'ng'iroq yo'q va
//     foydalanuvchi ~20 s harakatsiz yoki ilovaga endigina qaytgan;
//   • yangilangandan keyin qisqa "Yangilandi" xabari.
// Bir build uchun ko'pi bilan bir marta qayta yuklanadi (CDN eski faylni bersa ham cheksiz aylanish bo'lmaydi).
// Windows/Android ilovalari (fayllar ilova ichida) — UpdateChecker.tsx o'zi boshqaradi, bu yerda o'chiq.

type Doc = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener' | 'querySelector'> & { activeElement: Element | null };

const RELOADED_FOR = 'erp_update_reloaded_for';
export const JUST_UPDATED = 'erp_just_updated';

/** Qayta yuklash foydalanuvchi ishini buzmaydimi. */
export function isSafeToReload(doc: Doc): boolean {
  if (doc.visibilityState === 'hidden') return false;
  try {
    // PIN qulfi / maxfiylik pardasi (AppLock) — qulf ortida yangilash foydalanuvchini qayta PIN so'rashga majburlaydi
    if (doc.querySelector('html.privacy-cover, [role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-call-active], [data-no-auto-reload]')) return false;
    const a = doc.activeElement as HTMLElement | null;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return false;
  } catch { return false; }
  return true;
}

/** Serverdagi build boshqa (yangi) va bu build uchun hali qayta yuklanmaganmi. */
export function needsUpdate(current: string, remote: string | null | undefined, reloadedFor: string | null): boolean {
  if (!remote || !current || remote === current) return false;
  return reloadedFor !== remote;
}

export interface AutoUpdateDeps {
  current: string;
  fetchBuild: () => Promise<string | null>;
  doc: Doc;
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  reload: () => void;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  updateServiceWorker?: () => void;
  now?: () => number;
  checkEveryMs?: number;
  idleMs?: number;
}

export function installAutoUpdate(d: AutoUpdateDeps): { check: () => Promise<void>; tryApply: (reason: string) => boolean; pending: () => string | null; dispose: () => void } {
  const now = d.now ?? (() => Date.now());
  const idleMs = d.idleMs ?? 20_000;
  let pendingBuild: string | null = null;
  let lastActivity = now();
  let returnedAt = Number.NEGATIVE_INFINITY;
  const get = (k: string) => { try { return d.storage?.getItem(k) ?? null; } catch { return null; } };
  const set = (k: string, v: string) => { try { d.storage?.setItem(k, v); } catch { /* */ } };

  const tryApply = (reason: string): boolean => {
    if (!pendingBuild) return false;
    if (!isSafeToReload(d.doc)) return false;
    const freshReturn = reason === 'visible' || now() - returnedAt < 1500;
    if (!freshReturn && now() - lastActivity < idleMs) return false;
    set(RELOADED_FOR, pendingBuild);
    set(JUST_UPDATED, pendingBuild);
    pendingBuild = null;
    d.reload();
    return true;
  };

  const check = async () => {
    if (d.doc.visibilityState === 'hidden') return;
    let remote: string | null = null;
    try { remote = await d.fetchBuild(); } catch { return; }
    if (!needsUpdate(d.current, remote, get(RELOADED_FOR))) return;
    if (pendingBuild !== remote) { pendingBuild = remote; try { d.updateServiceWorker?.(); } catch { /* */ } }
    tryApply('check');
  };

  const onActivity = () => { lastActivity = now(); };
  const onVisible = () => {
    if (d.doc.visibilityState === 'hidden') return;
    returnedAt = now();
    // Qaytish — xavfsiz payt: avval kutilayotgan yangilanish, keyin yangi tekshiruv
    if (!tryApply('visible')) void check();
  };
  const onOnline = () => { void check(); };
  d.doc.addEventListener('visibilitychange', onVisible);
  d.win.addEventListener('online', onOnline);
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) d.win.addEventListener(ev, onActivity, { passive: true, capture: true } as any);
  const t1 = setInterval(() => { void check(); }, d.checkEveryMs ?? 5 * 60_000);
  const t2 = setInterval(() => { tryApply('idle'); }, 5_000);
  return {
    check, tryApply, pending: () => pendingBuild,
    dispose: () => {
      clearInterval(t1); clearInterval(t2);
      d.doc.removeEventListener('visibilitychange', onVisible);
      d.win.removeEventListener('online', onOnline);
      for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) d.win.removeEventListener(ev, onActivity, { capture: true } as any);
    },
  };
}

/** Brauzerda ishga tushirish (main.tsx). Toast — yangilangandan keyin. */
export function startAutoUpdate(opts: { isNative: boolean; toast: (msg: string) => void; getRegistration?: () => Promise<ServiceWorkerRegistration | undefined> }) {
  if (typeof window === 'undefined') return;
  try {
    const done = sessionStorage.getItem(JUST_UPDATED);
    if (done) { sessionStorage.removeItem(JUST_UPDATED); setTimeout(() => opts.toast('Yangilandi — ilovaning yangi versiyasi'), 1200); }
  } catch { /* */ }
  if (opts.isNative || typeof __BUILD_ID__ === 'undefined') return;
  return installAutoUpdate({
    current: __BUILD_ID__,
    fetchBuild: async () => {
      const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      return typeof j?.build === 'string' ? j.build : null;
    },
    doc: document, win: window,
    reload: () => window.location.reload(),
    storage: sessionStorage,
    updateServiceWorker: () => { opts.getRegistration?.().then((reg) => reg?.update()).catch(() => {}); },
  });
}
