// Chat sozlamalari — har bir foydalanuvchi uchun alohida, shu qurilmada (localStorage).
// localStorage bo'lmasa/xato bersa — standart qiymatlar bilan ishlaydi (hech narsa buzilmaydi).
import { useCallback, useEffect, useState } from "react";
import type { Msg } from "../App";
import { TOGGLEABLE_FOLDERS, groupKey, userKey, type FolderId, type SortMode } from "./chatModel";

export interface ChatPrefs {
  v: 1;
  hiddenFolders: FolderId[];
  sort: SortMode;
  compact: boolean;
  pinned: string[];                       // suhbat kalitlari ("u:<id>" / "g:<id>"), tartib muhim
  muted: string[];
  groupSeen: Record<string, number>;      // guruh → oxirgi ko'rilgan vaqt (ms)
  baseline: number;                       // birinchi ochilish — undan oldingi guruh xabarlari o'qilgan hisoblanadi
  readAllAt: number;                      // "Hammasini o'qildi qilish" bosilgan vaqt
}

const KEY = (uid: string) => `erp_chatPrefs:${uid}`;

export function defaultPrefs(now = Date.now()): ChatPrefs {
  return { v: 1, hiddenFolders: [], sort: "recent", compact: false, pinned: [], muted: [], groupSeen: {}, baseline: now, readAllAt: 0 };
}

export function loadPrefs(uid: string): ChatPrefs {
  const d = defaultPrefs();
  if (!uid) return d; // tizimga kirilmagan — hech narsa yozilmaydi
  try {
    const raw = localStorage.getItem(KEY(uid));
    if (!raw) { try { localStorage.setItem(KEY(uid), JSON.stringify(d)); } catch { /* */ } return d; }
    const p = JSON.parse(raw) || {};
    return {
      v: 1,
      hiddenFolders: Array.isArray(p.hiddenFolders) ? p.hiddenFolders.filter((f: any) => TOGGLEABLE_FOLDERS.includes(f)) : [],
      sort: p.sort === "unread" ? "unread" : "recent",
      compact: !!p.compact,
      pinned: Array.isArray(p.pinned) ? p.pinned.filter((x: any) => typeof x === "string").slice(0, 50) : [],
      muted: Array.isArray(p.muted) ? p.muted.filter((x: any) => typeof x === "string").slice(0, 500) : [],
      groupSeen: p.groupSeen && typeof p.groupSeen === "object" ? p.groupSeen : {},
      baseline: Number(p.baseline) || d.baseline,
      readAllAt: Number(p.readAllAt) || 0,
    };
  } catch { return d; }
}

// Bir sahifadagi bir nechta useChatPrefs (ChatPage + App navbar belgisi) bir-biriga mos turishi uchun
const PREFS_EVENT = "erp-chat-prefs";
export function savePrefs(uid: string, p: ChatPrefs, src?: object) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(p)); } catch { /* xotira yo'q — sessiya ichida ishlayveradi */ }
  try { window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: { uid, prefs: p, src } })); } catch { /* SSR/test */ }
}

export function useChatPrefs(uid: string) {
  const [prefs, setPrefs] = useState<ChatPrefs>(() => loadPrefs(uid));
  const [token] = useState(() => ({}));
  useEffect(() => { setPrefs(loadPrefs(uid)); }, [uid]);
  useEffect(() => {
    const on = (ev: Event) => {
      const d = (ev as CustomEvent).detail;
      if (d && d.uid === uid && d.src !== token && d.prefs) setPrefs(d.prefs);
    };
    window.addEventListener(PREFS_EVENT, on);
    return () => window.removeEventListener(PREFS_EVENT, on);
  }, [uid, token]);
  const update = useCallback((fn: (p: ChatPrefs) => ChatPrefs) => {
    setPrefs((prev) => { const next = fn(prev); if (next !== prev) savePrefs(uid, next, token); return next; });
  }, [uid, token]);
  return [prefs, update] as const;
}

/** Shu xabar kelgan suhbat foydalanuvchi tomonidan "ovozsiz" qilinganmi (bildirishnoma uchun App'dan chaqirish mumkin). */
export function isChatMuted(meId: string, m: Pick<Msg, "fromUserId" | "toUserId" | "groupId">): boolean {
  try {
    const raw = localStorage.getItem(KEY(meId));
    if (!raw) return false;
    const muted: string[] = JSON.parse(raw)?.muted || [];
    const key = m.groupId ? groupKey(m.groupId) : userKey(m.fromUserId === meId ? m.toUserId : m.fromUserId);
    return muted.includes(key);
  } catch { return false; }
}

export const toggleIn = (arr: string[], k: string, front = false) =>
  arr.includes(k) ? arr.filter((x) => x !== k) : front ? [k, ...arr] : [...arr, k];
