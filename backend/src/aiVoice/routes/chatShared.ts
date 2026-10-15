import type { Request, Response, NextFunction } from 'express';
import AiConversation from '../../models/AiConversation';
import { AI_ROLES, type AiRole } from '../contracts';
import { getSettings, isAiActive } from '../settings';
import { newCorrelationId } from '../lib/ids';
import { localDate } from '../lib/zonedTime';
import { isOnShift, WORKER_ROLES } from '../../middleware/workGate';

// Chatdagi AI (shaxsiy kontakt — chatRoutes.ts, guruhlar — groupChatRoutes.ts) uchun umumiy yordamchilar.

export const CHAT_SESSION_PREFIX = 'aichat:';
export const MAX_MESSAGES_PER_DAY = 400;
export const MAX_TEXT = 2000;
export const AGENT_TIMEOUT_MS = 45_000;
export const RATE_WINDOW_MS = 10 * 60_000;

export type Me = { userId: string; companyId: string; role: string; isOwner: boolean };
export const me = (req: Request): Me => ({
  userId: String(req.user!.userId), companyId: String(req.user!.companyId || ''), role: String(req.user!.role), isOwner: !!req.user!.isOwner,
});

export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch((e) => {
    console.error('[aiVoice/chat] xato:', String((e as Error)?.message || e).slice(0, 160));
    if (!res.headersSent) res.status(500).json({ error: 'internal' });
    else next(e);
  });
};

export function roleOf(m: Me): AiRole | null {
  if (m.isOwner) return 'direktor';
  return (AI_ROLES as string[]).includes(m.role) ? (m.role as AiRole) : null;
}

export type ChatLang = 'uz' | 'uz-cyrl' | 'ru';
export const langOf = (v: unknown): ChatLang => (v === 'ru' || v === 'uz-cyrl' ? v : 'uz');
export const aiLang = (l: ChatLang): 'uz' | 'ru' => (l === 'ru' ? 'ru' : 'uz');

/** Yozish yo'llari: AI faol + smena qoidasi (ishchi/prorab/brigadir — smena ochiq yoki sozlamada ruxsat). */
export async function writeGate(m: Me): Promise<string | null> {
  if (!(await isAiActive(m.companyId))) return 'ai_disabled';
  if (WORKER_ROLES.includes(m.role) && !m.isOwner && !(await isOnShift(m.userId))) {
    const s = await getSettings(m.companyId);
    if (!s.tools.allowOffShiftAssistant) return 'off_shift';
  }
  return null;
}

/** Kunlik hujjatga xabar qo'shish (sessionId `${prefix}YYYY-MM-DD`). */
export async function appendDaily(
  m: Me, msgs: { role: 'user' | 'assistant'; content: string }[], prefix = CHAT_SESSION_PREFIX, title = 'AI yordamchi',
): Promise<void> {
  if (!msgs.length) return;
  await AiConversation.updateOne(
    { userId: m.userId, companyId: m.companyId, source: 'chat', sessionId: `${prefix}${localDate()}` },
    {
      $push: { messages: { $each: msgs, $slice: -MAX_MESSAGES_PER_DAY } },
      $setOnInsert: { title: `${title} · ${localDate()}`, correlationId: newCorrelationId() },
    },
    { upsert: true },
  );
}

/** Shaxsiy AI chatiga (kontakt tarixiga) yozish. */
export const appendMessages = (m: Me, msgs: { role: 'user' | 'assistant'; content: string }[]) => appendDaily(m, msgs);
