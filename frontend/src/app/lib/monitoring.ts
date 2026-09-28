import { API_BASE } from "../api";
import { isAndroid, isTauri } from "../platform";

// Frontend xatolarini kuzatish: ushlanmagan JS xatolari va Promise rad etilishlari serverga
// yuboriladi (/api/errors/log); server YANGI turdagi xato bo'lsa dasturchiga botda xabar beradi.
// Bir sessiyada bir xil xato faqat bir marta, jami ko'pi bilan 15 ta yuboriladi.
const IGNORE = [/Language detection is not supported/i, /ResizeObserver loop/i, /Load failed|Failed to fetch|NetworkError/i, /AbortError/i];
const sent = new Set<string>();
let count = 0;

export const platformName = () => (isTauri() ? "windows" : isAndroid() ? "android" : "web");

export function reportError(message: string, stack?: string, extra?: Record<string, unknown>) {
  try {
    if (!message || IGNORE.some(re => re.test(message))) return;
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
        url: window.location.href, userAgent: navigator.userAgent, timestamp: new Date().toISOString(),
        appVersion: __APP_VERSION__, platform: platformName(), userId, ...extra,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* monitoring hech qachon ilovani buzmasin */ }
}

export function installErrorReporting() {
  window.addEventListener("error", e => {
    const err = e.error as Error | undefined;
    reportError(err?.message || e.message, err?.stack, { source: `${e.filename}:${e.lineno}:${e.colno}` });
  });
  window.addEventListener("unhandledrejection", e => {
    const r: any = e.reason;
    reportError(r?.message ?? String(r ?? ""), r?.stack, { kind: "unhandledrejection" });
  });
}
