import { API_BASE } from "../../api";

// Chatdagi AI kontakti — backend: /api/ai-voice/me/chat (backend/src/aiVoice/routes/chatRoutes.ts).

export interface AiChatItem {
  id: string;
  kind: "msg" | "call";
  day: string;
  at: string;
  role?: "user" | "assistant";
  text?: string;
  lines?: { role: "user" | "assistant"; text: string }[];
}
export interface AiPendingAction { pendingActionId: string; summary: string; expiresAt: string; tool: string }
export interface AiChatToolCall { name: string; status: string }
export interface AiChatReply { reply: string; pendingActions: AiPendingAction[]; toolCalls?: AiChatToolCall[] }

export type AiChatErrorCode = "rate" | "ai_disabled" | "off_shift" | "agent_error" | "network" | "error";

export class AiChatError extends Error {
  constructor(readonly code: AiChatErrorCode) { super(code); this.name = "AiChatError"; }
}

const BASE = `${API_BASE}/api/ai-voice/me/chat`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  } catch {
    throw new AiChatError("network");
  }
  if (r.ok) return (await r.json()) as T;
  const j = await r.json().catch(() => null);
  const e = String(j?.error || "");
  if (r.status === 429) throw new AiChatError("rate");
  if (e === "ai_disabled" || e === "off_shift" || e === "agent_error") throw new AiChatError(e);
  throw new AiChatError("error");
}

export function loadAiChatHistory(): Promise<{ aiActive: boolean; items: AiChatItem[] }> {
  return call("", { method: "GET" });
}

export function sendAiChatMessage(text: string, lang: string): Promise<AiChatReply> {
  return call("/message", { method: "POST", body: JSON.stringify({ text, lang }) });
}

export function confirmAiChatAction(pendingActionId: string, accept: boolean, lang: string): Promise<{ status: string; message: string }> {
  return call("/confirm", { method: "POST", body: JSON.stringify({ pendingActionId, accept, lang }) });
}
