import { API_BASE } from "../api";
import { isAndroid, isTauri } from "../platform";

// Frontend xatolarini kuzatish: ushlanmagan JS xatolari va Promise rad etilishlari serverga
// yuboriladi (/api/errors/log); server YANGI turdagi xato bo'lsa dasturchiga botda xabar beradi.
// Bir sessiyada bir xil xato faqat bir marta, jami ko'pi bilan 15 ta yuboriladi.
// Oxirgisi: yangi versiya chiqqanda eski oynadagi bo'lak topilmasligi — xato emas, sahifa o'zi yangilanadi (lib/chunkReload.ts)
const IGNORE = [/Language detection is not supported/i, /ResizeObserver loop/i, /Load failed|Failed to fetch|NetworkError/i, /AbortError/i,
  /valid JavaScript MIME type|dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i,
  // Kamera/mikrofon ruxsati berilmagan — foydalanuvchi holati, dastur xatosi emas (lib/mediaErrors.ts)
  /NotAllowedError|user denied permission|Permission denied by (the )?user|Permission dismissed/i];
const sent = new Set<string>();
let count = 0;

export const platformName = () => (isTauri() ? "windows" : isAndroid() ? "android" : "web");

// ── Kontekst: "qaysi ekran, qaysi tugma" (owner 2026-10-22). Faqat tugma/havola YORLIG'I olinadi —
// forma maydonlari qiymati (input/textarea/select) HECH QACHON yuborilmaydi.
type Act = { label: string; at: number };
const trail: Act[] = [];
const CLICKABLE = 'button,a,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],[role="checkbox"],summary,[data-testid]';

export function describeTarget(target: EventTarget | null): string | null {
  const el = (target as Element | null)?.closest?.(CLICKABLE) as HTMLElement | null;
  if (!el || el.matches("input,textarea,select,[contenteditable='true']")) return null;
  const tag = el.tagName.toLowerCase();
  const raw = el.getAttribute("aria-label") || el.getAttribute("title") || (tag === "input" ? "" : el.innerText || el.textContent || "") || el.getAttribute("data-testid") || "";
  const label = raw.replace(/\s+/g, " ").trim().slice(0, 50);
  if (!label) return null;
  const kind = tag === "a" ? "havola" : el.getAttribute("role") === "tab" ? "tab" : "tugma";
  return `${kind} «${label}»`;
}

export function recordAction(label: string, at = Date.now()) {
  trail.push({ label, at });
  if (trail.length > 5) trail.shift();
}

/** Joriy ekran: ilova sahifasi (localStorage "page") + ochiq oyna sarlavhasi. */
export function currentScreen(): string {
  let page = "";
  try { page = localStorage.getItem("page") || ""; } catch { /* */ }
  let dialog = "";
  try {
    const d = document.querySelector('[role="dialog"] h1, [role="dialog"] h2, [role="dialog"] h3, [role="alertdialog"] h2');
    dialog = (d?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50);
  } catch { /* */ }
  return [page, dialog && `oyna «${dialog}»`].filter(Boolean).join(" → ");
}

export function errorContext(now = Date.now()) {
  const last = trail[trail.length - 1];
  const ago = last ? Math.round((now - last.at) / 1000) : -1;
  return {
    screen: currentScreen() || undefined,
    action: last && ago <= 60 ? `${last.label} (${ago} s oldin)` : undefined,
    breadcrumbs: trail.length ? trail.map((a) => `${a.label} −${Math.round((now - a.at) / 1000)}s`) : undefined,
  };
}

export function reportError(message: string, stack?: string, extra?: Record<string, unknown>) {
  try {
    if (!message || IGNORE.some(re => re.test(message))) return;
    // Lokal sinov/robot testlari (localhost) xatolarini haqiqiy dasturchi botiga yubormaymiz
    // (Android ilova ham https://localhost'da ishlaydi — u native bo'lgani uchun xatolari yuboriladi)
    const w = window as any;
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !w.Capacitor?.isNativePlatform?.() && !w.__TAURI_INTERNALS__) return;
    const key = message.slice(0, 200);
    if (sent.has(key) || count >= 15) return;
    sent.add(key); count++;
    let userId: string | undefined;
    try { userId = JSON.parse(localStorage.getItem("currentUser") || "null")?.id; } catch { /* */ }
    fetch(`${API_BASE}/api/errors/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message.slice(0, 2000), stack: stack?.slice(0, 5000),
        // So'rov qatori/hash yuborilmaydi (unda token bo'lishi mumkin)
        url: window.location.origin + window.location.pathname, userAgent: navigator.userAgent, timestamp: new Date().toISOString(),
        appVersion: __APP_VERSION__, platform: platformName(), userId, ...errorContext(), ...extra,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* monitoring hech qachon ilovani buzmasin */ }
}

export function installErrorReporting() {
  document.addEventListener("click", e => { try { const l = describeTarget(e.target); if (l) recordAction(l); } catch { /* */ } }, { capture: true, passive: true });
  window.addEventListener("error", e => {
    const err = e.error as Error | undefined;
    reportError(err?.message || e.message, err?.stack, { source: `${e.filename}:${e.lineno}:${e.colno}` });
  });
  window.addEventListener("unhandledrejection", e => {
    const r: any = e.reason;
    reportError(r?.message ?? String(r ?? ""), r?.stack, { kind: "unhandledrejection" });
  });
}
