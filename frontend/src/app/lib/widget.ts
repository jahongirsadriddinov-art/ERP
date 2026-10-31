import { registerPlugin } from "@capacitor/core";
import { isCapacitor } from "../platform";
import { API_BASE } from "../api";

// Bosh ekrandagi widget bilan bog'lanish (owner 2026-10-31: "ilovalarga widget
// chiqarish kerak").
//
// Widget ALOHIDA jarayonda ishlaydi va WebView'dagi localStorage'ga kira
// olmaydi — shuning uchun kirgandan keyin token va server manzili native
// tomonga beriladi (android/.../WidgetPlugin.java), widget esa ularni o'zi
// o'qib, /api/widget/summary dan ixcham xulosa oladi.
//
// Ilova bo'lmagan joyda (sayt, Windows) bu modul hech narsa qilmaydi.

interface ErpWidgetPlugin {
  setAuth(o: { token: string; apiBase: string; company?: string }): Promise<void>;
  clear(): Promise<void>;
  refreshNow(): Promise<void>;
}

const plugin = registerPlugin<ErpWidgetPlugin>("ErpWidget");

const available = (): boolean => isCapacitor() && /Android/i.test(navigator.userAgent || "");

/** Kirgandan keyin: widget shu token bilan ma'lumot oladi. */
export async function widgetSetAuth(token: string, company?: string): Promise<void> {
  if (!available() || !token) return;
  try {
    await plugin.setAuth({ token, apiBase: API_BASE, company: company || "" });
  } catch { /* widget ikkilamchi — xatosi ilovani buzmasin */ }
}

/** Chiqishda: widget "kirilmagan" holatga tushadi. */
export async function widgetClear(): Promise<void> {
  if (!available()) return;
  try { await plugin.clear(); } catch { /* ignore */ }
}

/** Ma'lumot o'zgardi (chiqim, davomat) — widget darhol yangilansin. */
export async function widgetRefresh(): Promise<void> {
  if (!available()) return;
  try { await plugin.refreshNow(); } catch { /* ignore */ }
}

/** Widget tugmasidan kelgan bo'lim nomi (bir marta o'qiladi). */
export function takeWidgetRoute(): string | null {
  try {
    const w = window as unknown as { __erpWidgetRoute?: string };
    const r = w.__erpWidgetRoute;
    if (!r) return null;
    delete w.__erpWidgetRoute;
    return r;
  } catch {
    return null;
  }
}

/** Ilova ochiq turganda widget tugmasi bosilsa — shu hodisa keladi. */
export function onWidgetRoute(fn: (route: string) => void): () => void {
  const h = (e: Event) => {
    const r = (e as CustomEvent).detail;
    if (typeof r === "string" && r) fn(r);
  };
  window.addEventListener("erp:widget-route", h);
  return () => window.removeEventListener("erp:widget-route", h);
}
