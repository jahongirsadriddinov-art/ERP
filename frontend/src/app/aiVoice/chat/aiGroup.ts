import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import i18n from "../../i18n";
import { API_BASE } from "../../api";
import { getSocket } from "../../socket";
import { openAiChat } from "../bus";
import { injectAiChatExchange } from "./aiChatStore";
import type { AiPendingAction } from "./api";
import { AI_SENDER_ID, aiGroupTrigger } from "./aiGroupMention";

// Guruhdagi AI yordamchi — mijoz tomoni (backend: /api/ai-voice/me/chat/groups, groupChatRoutes.ts).
// Har guruh holati keshda (60 s); guruh ochilganda AiGroupButton yuklaydi. Xabar yuborilgach ChatPage
// aiGroupAfterSend()'ni chaqiradi: AI guruhda yoqilgan va xabar unga qaratilgan bo'lsa — /ask.
// AI javobi guruhga odatdagi xabar (message:new) bo'lib keladi; shaxsiy bo'lsa — shaxsiy AI chatiga.

export { AI_SENDER_ID };

export interface GroupAiState { loaded: boolean; enabled: boolean; canManage: boolean; aiActive: boolean; at: number }
const EMPTY: GroupAiState = { loaded: false, enabled: false, canManage: false, aiActive: false, at: 0 };
const TTL_MS = 60_000;
const BASE = `${API_BASE}/api/ai-voice/me/chat/groups`;

const cache = new Map<string, GroupAiState>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function put(groupId: string, patch: Partial<GroupAiState>) {
  cache.set(groupId, { ...(cache.get(groupId) || EMPTY), ...patch });
  for (const l of Array.from(listeners)) { try { l(); } catch { /* */ } }
}

export function getGroupAi(groupId: string): GroupAiState { return cache.get(groupId) || EMPTY; }

const langNow = () => (i18n.language === "ru" ? "ru" : i18n.language === "uz-cyrl" ? "uz-cyrl" : "uz");
const t = (k: string) => i18n.t(`aiVoiceCall.${k}`);

export function loadGroupAi(groupId: string, force = false): Promise<void> {
  const cur = cache.get(groupId);
  if (!force && cur?.loaded && Date.now() - cur.at < TTL_MS) return Promise.resolve();
  const running = inflight.get(groupId);
  if (running) return running;
  const p = (async () => {
    try {
      const r = await fetch(`${BASE}/${encodeURIComponent(groupId)}`, { cache: "no-store" });
      if (!r.ok) { put(groupId, { ...EMPTY, loaded: true, at: Date.now() }); return; }
      const j = await r.json();
      put(groupId, { loaded: true, enabled: !!j.enabled, canManage: !!j.canManage, aiActive: !!j.aiActive, at: Date.now() });
    } catch { /* tarmoq — keyingi ochilishda qayta */ }
  })().finally(() => inflight.delete(groupId));
  inflight.set(groupId, p);
  return p;
}

/** Qo'shish/chiqarish. Xato bo'lsa kodini qaytaradi. */
export async function setGroupAi(groupId: string, enabled: boolean): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/${encodeURIComponent(groupId)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, lang: langNow() }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return String(j?.error || "error");
    put(groupId, { loaded: true, enabled: !!j.enabled, canManage: !!j.canManage, at: Date.now() });
    return null;
  } catch { return "network"; }
}

// Boshqa a'zo AI'ni qo'shsa/chiqarsa (socket 'ai:group') — kesh yangilanadi
let boundSocket: unknown = null;
const onGroupEvent = (d: { groupId?: string; enabled?: boolean }) => {
  if (!d || typeof d.groupId !== "string") return;
  put(d.groupId, { enabled: !!d.enabled, at: 0 });   // at:0 — canManage keyingi ochilishda qayta so'raladi
};
function bindSocket() {
  const s = getSocket();
  if (!s || s === boundSocket) return;
  (boundSocket as { off?: (e: string, f: unknown) => void } | null)?.off?.("ai:group", onGroupEvent);
  s.on("ai:group", onGroupEvent);
  boundSocket = s;
}

/** React: guruh AI holati (montajda yuklanadi). */
export function useGroupAi(groupId: string): GroupAiState {
  useEffect(() => { bindSocket(); void loadGroupAi(groupId); }, [groupId]);
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => getGroupAi(groupId),
    () => getGroupAi(groupId),
  );
}

interface AskResult { delivered: "group" | "private"; reply?: string; pendingActions?: AiPendingAction[] }

const ERR_KEY: Record<string, string> = {
  rate: "errRate", ai_disabled: "errDisabled", off_shift: "errOffShift", agent_error: "errAgent", message_not_found: "groupNotFound",
};

/**
 * ChatPage doSend()'dan keyin: AI shu guruhda yoqilgan va xabar AI'ga qaratilgan bo'lsa — savolni yuboradi.
 * Hech narsa kutmaydi (fon); natija toast orqali.
 */
export function aiGroupAfterSend(groupId: string, msg: { text?: string; type?: string }, replyTo?: { fromUserId?: string; id?: string } | null): void {
  const g = getGroupAi(groupId);
  if (!g.enabled || !aiGroupTrigger(msg, replyTo)) return;
  const text = (msg.text || "").trim();
  const replyToId = replyTo?.fromUserId === AI_SENDER_ID && replyTo.id && /^[a-f0-9]{24}$/i.test(replyTo.id) ? replyTo.id : undefined;
  const tid = toast.loading(`${t("groupThinking")}…`);
  void (async () => {
    try {
      const r = await fetch(`${BASE}/${encodeURIComponent(groupId)}/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, replyToId, lang: langNow() }),
      });
      const j = (await r.json().catch(() => null)) as (AskResult & { error?: string }) | null;
      if (!r.ok || !j) {
        const code = String(j?.error || "");
        if (code === "not_enabled") { put(groupId, { enabled: false }); toast.dismiss(tid); return; }
        if (code === "already_answered" || code === "no_mention") { toast.dismiss(tid); return; }
        toast.error(t(ERR_KEY[code] || "errSend"), { id: tid });
        return;
      }
      if (j.delivered === "private") {
        injectAiChatExchange(text, String(j.reply || ""), j.pendingActions || []);
        toast.success(t("groupPrivateSent"), { id: tid, action: { label: t("groupOpenPrivate"), onClick: () => { openAiChat(); } } });
      } else {
        toast.dismiss(tid);
      }
    } catch {
      toast.error(t("errSend"), { id: tid });
    }
  })();
}

/** ChatPage userById() zaxirasi: AI xabarlari jo'natuvchisi (ism + avatar o'rniga). */
export function aiSenderUser(id: string): { id: string; name: string; role: string; phone: string; projectIds: string[] } | undefined {
  if (id !== AI_SENDER_ID) return undefined;
  return { id: AI_SENDER_ID, name: `🤖 ${t("aiSender")}`, role: "ai", phone: "", projectIds: [] };
}
