// Bir bosish — bitta amal. Tugmani ketma-ket 2-3 marta tez bosish (yoki sekin internetda "ishlamadi" deb qayta
// bosish) bir xil amalni bir necha marta bajarardi: ikkita chiqim, ikkita xabar, ikki marta "ishga keldim".
// Bu himoya butun ilova uchun bitta joyda ishlaydi (har bir tugmaga alohida yozish shart emas):
//   1) bir xil tugma 0.4 soniya ichida qayta bosilsa — e'tiborsiz qoldiriladi;
//   2) bosish serverga so'rov yuborsa — so'rov tugaguncha shu tugma "band" (yarim shaffof) bo'ladi va qayta
//      bosishlar o'tkazib yuboriladi.
// Tez-tez bosilishi KERAK bo'lgan tugmalar (PIN klaviaturasi, +/− , xarita) `data-multi-tap` bilan belgilanadi.

const REPEAT_MS = 400;
const LINK_MS = 150;       // bosishdan keyin shuncha vaqt ichida boshlangan so'rov — o'sha tugmaniki
const MAX_BUSY_MS = 20000; // so'rov osilib qolsa ham tugma abadiy qulflanmasin

let lastEl: Element | null = null;
let lastAt = 0;
const busy = new WeakMap<Element, number>();

function target(e: Event): HTMLElement | null {
  const t = e.target as Element | null;
  const el = t?.closest?.('button, [role="button"], a[href], input[type="submit"], input[type="button"]') as HTMLElement | null;
  if (!el) return null;
  if (el.closest('[data-multi-tap], .leaflet-container, [role="slider"]')) return null;
  return el;
}

function onClick(e: MouseEvent) {
  const el = target(e);
  if (!el) return;
  const now = performance.now();
  if ((busy.get(el) || 0) > 0 || (el === lastEl && now - lastAt < REPEAT_MS)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  lastEl = el;
  lastAt = now;
}

function setBusy(el: Element, delta: number) {
  const n = Math.max(0, (busy.get(el) || 0) + delta);
  busy.set(el, n);
  if (n > 0) el.setAttribute('data-tap-busy', '');
  else el.removeAttribute('data-tap-busy');
}

/** API so'rovi boshlanganda chaqiriladi; qaytgan funksiya so'rov tugaganda chaqiriladi. */
export function trackTapRequest(): () => void {
  const el = lastEl;
  if (!el || performance.now() - lastAt > LINK_MS || !el.isConnected) return () => {};
  setBusy(el, 1);
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(timer); setBusy(el, -1); };
  const timer = setTimeout(finish, MAX_BUSY_MS);
  return finish;
}

let installed = false;
export function installTapGuard() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // window + capture: React'ning o'z tinglovchilaridan OLDIN ishlaydi, shuning uchun takroriy bosish umuman
  // komponentgacha yetib bormaydi.
  window.addEventListener('click', onClick, true);
  // fetch orqali yuboriladigan so'rovlar ham (axios'dan tashqari) kuzatiladi
  const origFetch = window.fetch.bind(window);
  window.fetch = ((...args: Parameters<typeof fetch>) => {
    const done = trackTapRequest();
    return origFetch(...args).finally(done);
  }) as typeof fetch;
}
