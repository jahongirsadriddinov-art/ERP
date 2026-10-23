// Telegram Mini App hayot sikli (iOS oq ekran tuzatildi).
//
// Muammo: Mini App pastga surib kichraytirilib (minimize) qayta ochilganda iOS'da ekran OQ bo'lib qolardi.
// Sabablar (bir nechtasi birga):
//   1) Telegram SDK faqat URL hash'ida tgWebAppData bo'lsa yuklanardi — WebView qayta yuklansa (iOS fonda
//      xotira tozalaganda) hash yo'qolgan bo'lishi mumkin: ready()/expand() chaqirilmay, Telegram sahifani
//      "yuklanmoqda" (oq) holatda ushlab turardi, fon/sarlavha rangi ham tiklanmasdi.
//   2) iOS WKWebView fondan qaytganda GPU qatlamlarini (backdrop-filter, fixed, WebGL) qayta chizmaydi —
//      DOM joyida, lekin ekran bo'sh. Majburiy qayta chizish (repaint) va resize hodisasi kerak.
//   3) Fonda boshlangan lazy bo'lak yuklanishi yiqilib, YASHIRIN sahifa qayta yuklanardi (lib/lazyRetry.ts).
// Yechim: SDK har doim (Mini App bo'lsa) yuklanadi; 'activated' / 'viewportChanged' / visibilitychange /
// pageshow hodisalarida — expand(), ranglarni tiklash, majburiy repaint + resize; #root bo'sh qolgan bo'lsa —
// bir marta (ko'rinib turgan holda) qayta yuklash.

export interface TgWebApp {
  ready?: () => void;
  expand?: () => void;
  isVersionAtLeast?: (v: string) => boolean;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  setBottomBarColor?: (c: string) => void;
  onEvent?: (ev: string, fn: (...a: any[]) => void) => void;
  offEvent?: (ev: string, fn: (...a: any[]) => void) => void;
}

export interface LifecycleEnv {
  win: Window & { Telegram?: { WebApp?: TgWebApp } };
  doc: Document;
  /** Bo'sh #root uchun qayta yuklash (sinovda almashtiriladi). */
  reload?: () => void;
  raf?: (fn: () => void) => void;
}

const SDK_URL = "https://telegram.org/js/telegram-web-app.js";

/** rgb(21, 16, 10) / #15100a → #15100a (Telegram faqat #RRGGBB qabul qiladi). */
export function toHexColor(c: string): string | null {
  const s = (c || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ("#" + s.slice(1).split("").map((x) => x + x).join("")).toLowerCase();
  const m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; // shaffof — foydasiz
  return "#" + [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0")).join("");
}

/** Sahifaning hozirgi fon rangi (html → body), Telegram uchun #RRGGBB. */
export function pageBackground(win: Window, doc: Document): string | null {
  try {
    for (const el of [doc.body, doc.documentElement]) {
      if (!el) continue;
      const hex = toHexColor(win.getComputedStyle(el).backgroundColor);
      if (hex) return hex;
    }
  } catch { /* */ }
  return null;
}

/** #root'da ilova chizilganmi (faqat boshlang'ich loader yoki bo'sh emas). */
export function rootHasContent(doc: Document): boolean {
  const root = doc.getElementById("root");
  if (!root) return false;
  if (!root.firstElementChild) return false;
  if (doc.getElementById("initial-loader")) return false;
  return true;
}

export function applyTelegramChrome(tg: TgWebApp, win: Window, doc: Document): void {
  try { tg.expand?.(); } catch { /* */ }
  const bg = pageBackground(win, doc);
  if (!bg) return;
  const ok = (v: string) => { try { return tg.isVersionAtLeast ? tg.isVersionAtLeast(v) : false; } catch { return false; } };
  if (ok("6.1")) {
    try { tg.setHeaderColor?.(bg); } catch { /* */ }
    try { tg.setBackgroundColor?.(bg); } catch { /* */ }
  }
  if (ok("7.10")) { try { tg.setBottomBarColor?.(bg); } catch { /* */ } }
}

/** iOS WKWebView fondan keyin chizmay qolgan qatlamlarni majburan qayta chizdiradi. */
export function forceRepaint(env: LifecycleEnv): void {
  const { win, doc } = env;
  const raf = env.raf ?? ((fn: () => void) => win.requestAnimationFrame ? win.requestAnimationFrame(() => fn()) : setTimeout(fn, 16));
  // opacity (transform emas) — fixed elementlarning joylashuviga ta'sir qilmaydi, lekin butun qatlamni qayta chizdiradi
  const el = doc.body || doc.documentElement;
  try {
    const prev = el.style.opacity;
    el.style.opacity = "0.999";
    void el.offsetHeight; // reflow
    raf(() => {
      el.style.opacity = prev;
      void el.offsetHeight;
      // Leaflet / three.js / virtual ro'yxatlar o'lchamni qayta hisoblasin
      try { win.dispatchEvent(new Event("resize")); } catch { /* */ }
    });
  } catch { /* */ }
}

export function loadTelegramSdk(env: LifecycleEnv): Promise<TgWebApp | null> {
  const { win, doc } = env;
  if (win.Telegram?.WebApp) return Promise.resolve(win.Telegram.WebApp);
  return new Promise((resolve) => {
    try {
      let s = doc.querySelector(`script[src="${SDK_URL}"]`) as HTMLScriptElement | null;
      if (!s) { s = doc.createElement("script"); s.src = SDK_URL; s.async = true; doc.head.appendChild(s); }
      const done = () => resolve(win.Telegram?.WebApp ?? null);
      s.addEventListener("load", done, { once: true });
      s.addEventListener("error", () => resolve(null), { once: true });
      // Skript allaqachon yuklangan bo'lishi mumkin (load hodisasi o'tib ketgan)
      setTimeout(() => { if (win.Telegram?.WebApp) done(); }, 0);
    } catch { resolve(null); }
  });
}

/**
 * Mini App ichida ishga tushiriladi. Qaytaradi: tozalash funksiyasi.
 * `recover` — hodisalar kelganda chaqiriladigan tiklash (sinov uchun ham eksport qilinadi).
 */
export function installTelegramLifecycle(env: LifecycleEnv): { recover: (reason: string) => void; dispose: () => void } {
  const { win, doc } = env;
  let tg: TgWebApp | null = win.Telegram?.WebApp ?? null;
  let reloaded = false;
  let lastRecover = 0;

  const recover = (_reason: string) => {
    if (doc.visibilityState === "hidden") return;
    const now = Date.now();
    if (now - lastRecover < 150) return; // bir qaytishda bir nechta hodisa keladi
    lastRecover = now;
    if (tg) applyTelegramChrome(tg, win, doc);
    forceRepaint(env);
    // Ilova umuman chizilmagan (oq ekran, #root bo'sh) — bir marta qayta yuklaymiz
    setTimeout(() => {
      if (!reloaded && doc.visibilityState !== "hidden" && !rootHasContent(doc)) {
        reloaded = true;
        (env.reload ?? (() => win.location.reload()))();
      }
    }, 1500);
  };

  const onVis = () => recover("visibility");
  const onPageShow = () => recover("pageshow");
  const onActivated = () => recover("activated");
  const onViewport = (e?: { isStateStable?: boolean }) => { if (!e || e.isStateStable !== false) recover("viewport"); };
  const onTheme = () => { if (tg) applyTelegramChrome(tg, win, doc); };

  doc.addEventListener("visibilitychange", onVis);
  win.addEventListener("pageshow", onPageShow);

  const bind = (w: TgWebApp) => {
    tg = w;
    try { w.ready?.(); } catch { /* */ }
    applyTelegramChrome(w, win, doc);
    try {
      w.onEvent?.("activated", onActivated);
      w.onEvent?.("viewportChanged", onViewport);
      w.onEvent?.("themeChanged", onTheme);
    } catch { /* */ }
  };
  if (tg) bind(tg); else loadTelegramSdk(env).then((w) => { if (w) bind(w); });

  // Ilova mavzusi (yorug'/qorong'i) almashsa — Telegram sarlavha/fon rangi ham
  let mo: MutationObserver | null = null;
  try {
    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(onTheme);
      mo.observe(doc.documentElement, { attributes: true, attributeFilter: ["class"] });
    }
  } catch { /* */ }

  return {
    recover,
    dispose: () => {
      doc.removeEventListener("visibilitychange", onVis);
      win.removeEventListener("pageshow", onPageShow);
      mo?.disconnect();
      try { tg?.offEvent?.("activated", onActivated); tg?.offEvent?.("viewportChanged", onViewport); tg?.offEvent?.("themeChanged", onTheme); } catch { /* */ }
    },
  };
}
