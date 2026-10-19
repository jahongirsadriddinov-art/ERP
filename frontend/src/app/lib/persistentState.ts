import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

// Sahifa yangilanganda (refresh) foydalanuvchi qayerda bo'lsa o'sha joyda qolsin (owner 2026-10-19): tanlangan tab,
// ochilgan firma/bo'lim va skroll joyi sessionStorage'da (shu brauzer oynasi uchun; boshqa qurilma/oynaga o'tmaydi).
// Saqlash ishlamasa (maxfiy oyna, taqiq) — oddiy useState kabi ishlaydi.

const PREFIX = "erp_ui:";

function read<T>(key: string, fallback: T, valid?: (v: unknown) => boolean): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    return valid && !valid(v) ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

/** useState + sessionStorage. `valid` — saqlangan qiymat hali ruxsat etilganmi (masalan, tab ro'yxatda bormi). */
export function usePersistentState<T>(key: string, initial: T | (() => T), valid?: (v: unknown) => boolean): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => read(key, typeof initial === "function" ? (initial as () => T)() : initial, valid));
  useEffect(() => {
    try { sessionStorage.setItem(PREFIX + key, JSON.stringify(v)); } catch { /* saqlanmasa — muhim emas */ }
  }, [key, v]);
  return [v, setV];
}

export function oneOf<T extends string>(list: readonly T[]) {
  return (v: unknown): boolean => typeof v === "string" && (list as readonly string[]).includes(v);
}

/** Element yo'li (ildizdan bolalar indekslari) — kontent yangilansa ham barqaror. */
function pathOf(root: Element, el: Element): string | null {
  const parts: number[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parent: Element | null = cur.parentElement;
    if (!parent) return null;
    parts.unshift(Array.prototype.indexOf.call(parent.children, cur));
    cur = parent;
  }
  return cur === root ? parts.join(".") : null;
}
function byPath(root: Element, path: string): HTMLElement | null {
  if (!path) return root as HTMLElement;
  let cur: Element | undefined = root;
  for (const i of path.split(".")) {
    cur = cur?.children[Number(i)];
    if (!cur) return null;
  }
  return (cur as HTMLElement) || null;
}

/**
 * Skroll joyini eslab qolish: sahifa (`key`) ichidagi har aylantirilgan element (o'z yo'li bo'yicha) saqlanadi va
 * qaytganda/refreshda tiklanadi. Kontent kechikib yuklanadi — balandlik yetguncha ~4 s qayta urinadi; foydalanuvchi
 * o'zi aylantira boshlasa to'xtaydi.
 */
export function useScrollMemory(key: string) {
  const ref = useRef<HTMLElement | null>(null);
  const storeKey = PREFIX + "scroll:" + key;
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let saved: Record<string, number> = {};
    try { saved = JSON.parse(sessionStorage.getItem(storeKey) || "{}") || {}; } catch { saved = {}; }
    const pending = new Map(Object.entries(saved).filter(([, v]) => typeof v === "number" && v > 0));
    let userMoved = false;
    let tries = 0;
    let timer = 0;
    const restore = () => {
      if (userMoved) return;
      for (const [path, top] of [...pending]) {
        const el = byPath(root, path);
        if (!el) continue;
        if (el.scrollHeight - el.clientHeight >= top - 2 || tries >= 40) {
          el.scrollTop = top;
          pending.delete(path);
        }
      }
      if (pending.size && tries++ < 40) timer = window.setTimeout(restore, 100);
    };
    restore();
    let saveTimer = 0;
    const dirty = new Set<Element>();
    const onScroll = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element) || !root.contains(t)) return;
      dirty.add(t);
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        for (const el of dirty) {
          const p = pathOf(root, el);
          if (p !== null) saved[p] = Math.round((el as HTMLElement).scrollTop);
        }
        dirty.clear();
        try { sessionStorage.setItem(storeKey, JSON.stringify(saved)); } catch { /* */ }
      }, 150);
    };
    const stop = () => { userMoved = true; };
    root.addEventListener("scroll", onScroll, { capture: true, passive: true });
    root.addEventListener("wheel", stop, { passive: true });
    root.addEventListener("touchstart", stop, { passive: true });
    root.addEventListener("keydown", stop);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(saveTimer);
      root.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      root.removeEventListener("wheel", stop);
      root.removeEventListener("touchstart", stop);
      root.removeEventListener("keydown", stop);
    };
  }, [storeKey]);
  return useCallback((node: HTMLElement | null) => { ref.current = node; }, []);
}
