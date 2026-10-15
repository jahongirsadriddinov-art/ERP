import { useEffect, useSyncExternalStore } from "react";
import { API_BASE } from "../api";

// Joriy foydalanuvchi uchun AI yordamchi faolmi (GET /api/ai-voice/me → status.aiActive).
// Bitta umumiy kesh: chat kontakti, qo'ng'iroq boshqaruvchisi va boshqalar BIR so'rovdan foydalanadi
// (5 daqiqa; sahifa ko'rinib qolganda eskirgan bo'lsa yangilanadi). Xato/403/404 → faol emas
// (AI o'chiq, dasturchi yoki firmasiz foydalanuvchi) — hech narsa ko'rsatilmaydi, so'rov ham takrorlanmaydi.

export interface AiStatus { loaded: boolean; aiActive: boolean }

const TTL_MS = 5 * 60_000;
let state: AiStatus = { loaded: false, aiActive: false };
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let userKey = "";
const listeners = new Set<() => void>();

function set(next: AiStatus) {
  if (next.loaded === state.loaded && next.aiActive === state.aiActive) return;
  state = next;
  for (const l of Array.from(listeners)) { try { l(); } catch { /* */ } }
}

export function getAiStatus(): AiStatus { return state; }

/** Ma'lum bo'lsa true/false, hali yuklanmagan bo'lsa null. */
export function aiActiveOrNull(): boolean | null { return state.loaded ? state.aiActive : null; }

export function subscribeAiStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Holatni yangilash (force — keshga qaramay). Foydalanuvchi almashsa kesh tozalanadi. */
export function refreshAiStatus(opts: { force?: boolean; user?: string } = {}): Promise<void> {
  if (opts.user !== undefined && opts.user !== userKey) {
    userKey = opts.user;
    fetchedAt = 0;
    set({ loaded: false, aiActive: false });
  }
  if (!opts.force && fetchedAt && Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  if (inflight) return inflight;
  if (typeof fetch !== "function") return Promise.resolve();
  inflight = (async () => {
    let active = false;
    try {
      const r = await fetch(`${API_BASE}/api/ai-voice/me`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        active = !!j?.status?.aiActive;
      }
    } catch { /* tarmoq xatosi — faol emas deb qolamiz, keyingi safar qayta */ }
    fetchedAt = Date.now();
    set({ loaded: true, aiActive: active });
  })().finally(() => { inflight = null; });
  return inflight;
}

/** React: AI holati (birinchi chaqiruvda yuklanadi). */
export function useAiStatus(user?: string): AiStatus {
  useEffect(() => {
    void refreshAiStatus({ user });
    const onVis = () => { if (!document.hidden) void refreshAiStatus(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [user]);
  return useSyncExternalStore(subscribeAiStatus, getAiStatus, getAiStatus);
}

/** Faqat testlar uchun. */
export function __setAiStatusForTests(s: AiStatus): void { fetchedAt = Date.now(); set(s); }
