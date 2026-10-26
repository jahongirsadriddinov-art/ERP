// Ilovalarda (Tauri/Capacitor) tashqi havolalar (owner 2026-10-26: "Command plugin:shell|open not allowed by ACL"):
// oddiy <a target="_blank"> bosilganda WebView Tauri'ning taqiqlangan shell plaginiga murojaat qilib, xato berardi
// va havola umuman ochilmasdi. Endi bunday bosishlar ushlanib, ilovaning o'z yo'li (openExternalUrl) bilan ochiladi.
import { isNative, isTauri, openExternalUrl } from "../platform";

const EXTERNAL = /^(https?:|mailto:|tel:)/i;

/** Havola elementiga o'xshash eng kichik shakl — testda brauzersiz tekshirish uchun. */
type LinkLike = { closest(sel: string): { getAttribute(name: string): string | null } | null };

/** Bosilgan element yoki uning ota-elementlaridan havolani topadi (test uchun eksport). */
export function externalHrefFrom(target: unknown): string | null {
  const t = target as Partial<LinkLike> | null;
  const el = typeof t?.closest === "function" ? t.closest("a[href]") : null;
  if (!el) return null;
  const href = el.getAttribute("href") || "";
  if (!EXTERNAL.test(href.trim())) return null; // ichki yo'llar, "#" va boshqa sxemalar — tegilmaydi
  // o'z saytimizdagi havola va yangi oynada ochilmaydiganlari — brauzerning o'zi uddalaydi
  const sameOrigin = (() => { try { return new URL(href, location.href).origin === location.origin; } catch { return false; } })();
  if (sameOrigin && el.getAttribute("target") !== "_blank") return null;
  return href;
}

export function installExternalLinkGuard(): void {
  if (typeof document === "undefined" || !(isTauri() || isNative())) return;
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = externalHrefFrom(e.target);
    if (!href) return;
    e.preventDefault();
    void openExternalUrl(href);
  }, true);
}
