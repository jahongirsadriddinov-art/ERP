import { useSyncExternalStore } from "react";
import {
  AiChatError, confirmAiChatAction, loadAiChatHistory, sendAiChatMessage,
  type AiChatErrorCode, type AiChatItem, type AiPendingAction,
} from "./api";

// Chatdagi AI suhbati holati — modul darajasida (boshqa kontaktga o'tib qaytganda tarix qayta yuklanmaydi,
// so'rov va limit tejaladi). Yagona yozuvchi: shu fayl. UI useAiChat() orqali obuna bo'ladi.

export interface AiChatEntry extends Omit<AiChatItem, "kind"> {
  kind: AiChatItem["kind"] | "confirm";
  /** Faqat mijozda: yuborilmagan / xato bo'lgan xabar. */
  failed?: AiChatErrorCode;
  sending?: boolean;
  /** kind 'confirm' — tasdiq kartasi (faqat mijozda). */
  confirm?: AiPendingAction & { state: "idle" | "busy" | "done"; result?: string };
}

export interface AiChatState {
  status: "idle" | "loading" | "ready" | "error";
  items: AiChatEntry[];
  thinking: boolean;
  aiActive: boolean | null;
  lastError: AiChatErrorCode | null;
  /** AI "qo'ng'iroq qilaman" dedi (requestCallback) — shu vaqtgacha chatda "AI qo'ng'iroq qilmoqda" belgisi. */
  callExpectedUntil: number;
  /** Ovozli qo'ng'iroq ishlamay matnga o'tildi — chat tepasidagi izoh (i18n kaliti). */
  notice: string | null;
}

const INITIAL: AiChatState = { status: "idle", items: [], thinking: false, aiActive: null, lastError: null, callExpectedUntil: 0, notice: null };
const CALL_EXPECT_MS = 120_000;
let st: AiChatState = INITIAL;
let owner = "";
let seq = 0;
const listeners = new Set<() => void>();
const callListeners = new Set<(ms: number) => void>();
let callTimer: ReturnType<typeof setTimeout> | null = null;

function set(patch: Partial<AiChatState>) {
  st = { ...st, ...patch };
  for (const l of Array.from(listeners)) { try { l(); } catch { /* */ } }
}

/** Toshkent bo'yicha YYYY-MM-DD (kun ajratgichlari server bilan bir xil bo'lsin). */
export function tashkentDay(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const localId = () => `local:${Date.now().toString(36)}:${++seq}`;

export function getAiChatState(): AiChatState { return st; }
export function subscribeAiChat(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Foydalanuvchi almashsa — boshqa odamning suhbati ko'rinib qolmasin. */
export function bindAiChatUser(userId: string): void {
  if (owner === userId) return;
  owner = userId;
  st = INITIAL;
  set({});
}

export async function loadAiChat(force = false): Promise<void> {
  if (!force && (st.status === "loading" || st.status === "ready")) return;
  const me = owner;
  set({ status: "loading" });
  try {
    const r = await loadAiChatHistory();
    if (me !== owner) return;
    // Yuklash paytida yozilgan mahalliy xabarlar saqlanib qoladi
    const local = st.items.filter((i) => i.sending || i.failed || (i.kind === "confirm" && i.confirm?.state !== "done"));
    set({ status: "ready", items: [...(r.items || []), ...local], aiActive: !!r.aiActive });
  } catch {
    if (me !== owner) return;
    set({ status: "error" });
  }
}

function patchItem(id: string, patch: Partial<AiChatEntry>) {
  set({ items: st.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
}

export async function sendAiChat(text: string, lang: string): Promise<void> {
  const clean = text.trim().slice(0, 2000);
  if (!clean || st.thinking) return;
  const id = localId();
  const now = new Date();
  set({ items: [...st.items, { id, kind: "msg", role: "user", text: clean, day: tashkentDay(now), at: now.toISOString(), sending: true }], thinking: true, lastError: null });
  await deliver(id, clean, lang);
}

/**
 * AI chatda o'ziga qo'ng'iroqni navbatga qo'ydi (requestCallback ok) — ovozli ildiz (AiVoiceRoot) kelgan
 * qo'ng'iroqni darhol ulashi uchun xabar beramiz; chatda "AI qo'ng'iroq qilmoqda" belgisi.
 */
function noteCallRequested(): void {
  const until = Date.now() + CALL_EXPECT_MS;
  set({ callExpectedUntil: until });
  if (callTimer) clearTimeout(callTimer);
  callTimer = setTimeout(() => { callTimer = null; if (st.callExpectedUntil <= Date.now() + 50) set({ callExpectedUntil: 0 }); }, CALL_EXPECT_MS);
  for (const l of Array.from(callListeners)) { try { l(CALL_EXPECT_MS); } catch { /* */ } }
}

/** Qo'ng'iroq keldi / tugadi — belgini o'chiramiz. */
export function clearAiCallExpected(): void {
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
  if (st.callExpectedUntil) set({ callExpectedUntil: 0 });
}

/** AiVoiceRoot obunasi: chatda qo'ng'iroq so'ralganda (ms — kutish oynasi). */
export function onAiCallRequested(fn: (ms: number) => void): () => void {
  callListeners.add(fn);
  return () => { callListeners.delete(fn); };
}

/** Ovozli qo'ng'iroq matnga o'tganda chat tepasidagi izoh (null — olib tashlash). */
export function setAiChatNotice(key: string | null): void { if (st.notice !== key) set({ notice: key }); }

export const replyRequestedCall = (r: { toolCalls?: { name: string; status: string }[] } | null | undefined): boolean =>
  !!r?.toolCalls?.some((t) => t && t.name === "requestCallback" && t.status === "ok");

/** Server javobi matnli tasdiq bilan amalni hal qildimi (toolCalls: 'confirm'). */
export const replyResolvedConfirm = (r: { toolCalls?: { name: string; status: string }[] } | null | undefined): boolean =>
  !!r?.toolCalls?.some((t) => t && t.name === "confirm");

async function deliver(id: string, text: string, lang: string) {
  const me = owner;
  try {
    const r = await sendAiChatMessage(text, lang);
    if (me !== owner) return;
    if (replyRequestedCall(r)) noteCallRequested();
    const now = new Date();
    const day = tashkentDay(now);
    const extra: AiChatEntry[] = [{ id: localId(), kind: "msg", role: "assistant", text: r.reply, day, at: now.toISOString() }];
    for (const p of r.pendingActions || []) {
      extra.push({ id: localId(), kind: "confirm", day, at: now.toISOString(), confirm: { ...p, state: "idle" } });
    }
    // Foydalanuvchi "ha"/"yo'q" deb yozdi va server kutilayotgan amalni hal qildi — ochiq kartalar yopiladi
    const resolved = replyResolvedConfirm(r);
    const items = st.items.map((i) => {
      if (i.id === id) return { ...i, sending: false, failed: undefined };
      if (resolved && i.kind === "confirm" && i.confirm?.state === "idle") return { ...i, confirm: { ...i.confirm, state: "done" as const, result: r.reply } };
      return i;
    });
    set({ items: [...items, ...extra], thinking: false });
  } catch (e) {
    if (me !== owner) return;
    const code: AiChatErrorCode = e instanceof AiChatError ? e.code : "error";
    patchItem(id, { sending: false, failed: code });
    set({ thinking: false, lastError: code });
  }
}

export async function retryAiChat(id: string, lang: string): Promise<void> {
  const it = st.items.find((i) => i.id === id);
  if (!it || !it.failed || st.thinking || !it.text) return;
  patchItem(id, { failed: undefined, sending: true });
  set({ thinking: true, lastError: null });
  await deliver(id, it.text, lang);
}

export async function answerAiChatConfirm(id: string, accept: boolean, lang: string): Promise<void> {
  const it = st.items.find((i) => i.id === id);
  if (!it?.confirm || it.confirm.state !== "idle") return;
  const me = owner;
  patchItem(id, { confirm: { ...it.confirm, state: "busy" } });
  try {
    const r = await confirmAiChatAction(it.confirm.pendingActionId, accept, lang);
    if (me !== owner) return;
    const cur = st.items.find((i) => i.id === id);
    if (cur?.confirm) patchItem(id, { confirm: { ...cur.confirm, state: "done", result: r.message } });
  } catch (e) {
    if (me !== owner) return;
    const cur = st.items.find((i) => i.id === id);
    if (cur?.confirm) patchItem(id, { confirm: { ...cur.confirm, state: "idle" } });
    set({ lastError: e instanceof AiChatError ? e.code : "error" });
  }
}

/**
 * Guruhdan shaxsiy chatga yuborilgan javob (aiGroup.ts): tarix allaqachon yuklangan bo'lsa — darhol qo'shiladi
 * (aks holda keyingi yuklashda serverdan keladi).
 */
export function injectAiChatExchange(question: string, reply: string, pending: AiPendingAction[] = []): void {
  if (st.status !== "ready") return;
  const now = new Date();
  const day = tashkentDay(now);
  const at = now.toISOString();
  const extra: AiChatEntry[] = [
    { id: localId(), kind: "msg", role: "user", text: question, day, at },
    { id: localId(), kind: "msg", role: "assistant", text: reply, day, at },
    ...pending.map((p): AiChatEntry => ({ id: localId(), kind: "confirm", day, at, confirm: { ...p, state: "idle" } })),
  ];
  set({ items: [...st.items, ...extra] });
}

export function useAiChat(): AiChatState {
  return useSyncExternalStore(subscribeAiChat, getAiChatState, getAiChatState);
}

/** Faqat testlar uchun. */
export function __resetAiChat(): void {
  st = INITIAL; owner = ""; listeners.clear(); callListeners.clear();
  if (callTimer) { clearTimeout(callTimer); callTimer = null; }
}
