// Guruhdagi AI'ga murojaatni aniqlash (sof — test qilinadi). Backend'dagi groupChatRoutes.ts bilan BIR XIL qoida:
// "@AI ...", "AI, ...", "AI: ...", "AI yordamchi, ...", "ИИ, ..." yoki matn ichida "@AI"; yoki AI xabariga reply.

/** Guruhdagi AI xabarlari shu "foydalanuvchi" nomidan keladi (backend AI_SENDER_ID). */
export const AI_SENDER_ID = "ai-assistant";

const LEAD_RE = /^\s*(?:@\s*)?(?:ai|аи|ии)(?:\s+(?:yordamchi|ёрдамчи|помощник))?\s*[,:!?\-—]\s*/i;
const AT_RE = /(^|[\s(])@(?:ai|аи|ии)(?![\p{L}\p{N}_])/iu;

export function isAiMention(text: string): boolean {
  return LEAD_RE.test(text) || AT_RE.test(text);
}

/** Xabar AI'ga qaratilganmi (matnli xabar + mention yoki AI xabariga reply). */
export function aiGroupTrigger(msg: { text?: string; type?: string }, replyTo?: { fromUserId?: string } | null): boolean {
  if (msg.type && msg.type !== "text") return false;
  const text = (msg.text || "").trim();
  if (!text) return false;
  return isAiMention(text) || replyTo?.fromUserId === AI_SENDER_ID;
}
