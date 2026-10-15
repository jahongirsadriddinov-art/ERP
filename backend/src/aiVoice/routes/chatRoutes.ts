import { Router } from 'express';
import AiConversation from '../../models/AiConversation';
import type { AiRole, ToolCtx } from '../contracts';
import { createTextAgent } from '../brain/textAgent';
import { confirmPendingAction } from '../tools/executor';
import { getSettings, isAiActive } from '../settings';
import { hitRate } from '../lib/mongoRateLimit';
import { isObjectIdString, newCorrelationId } from '../lib/ids';
import { localDate } from '../lib/zonedTime';
import { localizeFree } from '../bot/i18n';
import {
  AGENT_TIMEOUT_MS, CHAT_SESSION_PREFIX, MAX_TEXT, RATE_WINDOW_MS, aiLang, appendMessages, langOf, me, roleOf, wrap, writeGate, type Me,
} from './chatShared';
import groupChatRoutes from './groupChatRoutes';

// Chatdagi "AI yordamchi" kontakti (egasi so'rovi #6): /api/ai-voice/me/chat (bootstrap: requireAuth +
// blockDeveloper). /me ostida — workGate ALLOW; smena qoidasini shu yerning o'zi tekshiradi (423 emas,
// 403 off_shift — ilova "Ishga keldim" ekraniga otib yubormasin).
// Matn TextAgent'ga (bot /ai bilan bir xil miya, kanal 'web'); tool'lar FAQAT executor orqali (RBAC, audit).
// Tarix AiConversation'da: har kun uchun bitta hujjat (source 'chat', sessionId 'aichat:YYYY-MM-DD') —
// saqlash muddati/arxiv ishi kun bo'yicha toza ishlay oladi. Ovozli qo'ng'iroq transkriptlari
// (source 'voice_inapp') tarixda "qo'ng'iroq" yozuvi sifatida ko'rsatiladi.

const router = Router();

export { CHAT_SESSION_PREFIX };
const HISTORY_FOR_AGENT = 12;          // modelga beriladigan oxirgi xabarlar (token tejash)
const HISTORY_DAYS = 14;               // UI'ga qaytariladigan kunlar (bazada nima qolgan bo'lsa)

router.use((req, res, next) => {
  const m = me(req);
  if (!isObjectIdString(m.userId) || !isObjectIdString(m.companyId)) { res.status(403).json({ error: 'no_company' }); return; }
  if (!roleOf(m)) { res.status(403).json({ error: 'denied' }); return; }
  next();
});

// Guruhlardagi AI (egasi so'rovi, 2026-10-15): /api/ai-voice/me/chat/groups/*
router.use('/groups', groupChatRoutes);

/** Modelga beriladigan qisqa tarix (oxirgi 2 kun hujjatlaridan). */
async function recentHistory(m: Me): Promise<{ role: 'user' | 'assistant'; text: string }[]> {
  const docs: any[] = await AiConversation.find({ userId: m.userId, companyId: m.companyId, source: 'chat', sessionId: { $regex: `^${CHAT_SESSION_PREFIX}` } })
    .sort({ sessionId: -1 }).limit(2).select('messages').lean();
  const all = docs.reverse().flatMap((d) => (d.messages || []) as { role: 'user' | 'assistant'; content: string }[]);
  return all.slice(-HISTORY_FOR_AGENT).map((x) => ({ role: x.role, text: String(x.content || '').slice(0, 1200) }));
}

// ───────────── GET / — tarix ─────────────
export interface AiChatHistoryItem {
  id: string;
  kind: 'msg' | 'call';
  day: string;                               // YYYY-MM-DD (Toshkent)
  at: string;                                // hujjat vaqti (kun ajratgichi/qo'ng'iroq vaqti uchun)
  role?: 'user' | 'assistant';
  text?: string;
  lines?: { role: 'user' | 'assistant'; text: string }[];
}

router.get('/', wrap(async (req, res) => {
  const m = me(req);
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
  const [aiActive, chats, calls] = await Promise.all([
    isAiActive(m.companyId).catch(() => false),
    AiConversation.find({ userId: m.userId, companyId: m.companyId, source: 'chat', sessionId: { $regex: `^${CHAT_SESSION_PREFIX}` }, updatedAt: { $gte: since } })
      .sort({ sessionId: 1 }).limit(HISTORY_DAYS + 1).select('sessionId messages createdAt updatedAt').lean(),
    AiConversation.find({ userId: m.userId, companyId: m.companyId, source: 'voice_inapp', updatedAt: { $gte: since } })
      .sort({ createdAt: 1 }).limit(50).select('messages createdAt').lean(),
  ]);
  const items: (AiChatHistoryItem & { sortAt: number; seq: number })[] = [];
  for (const d of chats as any[]) {
    const day = String(d.sessionId).slice(CHAT_SESSION_PREFIX.length);
    const at = new Date(d.createdAt);
    (d.messages || []).forEach((x: any, i: number) => {
      items.push({ id: `${d._id}:${i}`, kind: 'msg', day, at: at.toISOString(), role: x.role, text: String(x.content || ''), sortAt: Date.parse(`${day}T00:00:00Z`), seq: i });
    });
  }
  for (const c of calls as any[]) {
    const at = new Date(c.createdAt);
    const lines = (c.messages || []).slice(-60).map((x: any) => ({ role: x.role, text: String(x.content || '').slice(0, 1000) }));
    if (!lines.length) continue;
    // Qo'ng'iroq yozuvi o'z kunining oxiriga (kun ichidagi aniq o'rni noma'lum — xabarlarda vaqt yo'q)
    items.push({ id: `call:${c._id}`, kind: 'call', day: localDate(at), at: at.toISOString(), lines, sortAt: Date.parse(`${localDate(at)}T00:00:00Z`), seq: 1e6 + at.getTime() / 1e3 });
  }
  items.sort((a, b) => a.sortAt - b.sortAt || a.seq - b.seq);
  res.json({ aiActive, items: items.slice(-500).map(({ sortAt: _s, seq: _q, ...it }) => it) });
}));

// ───────────── POST /message — savol ─────────────
router.post('/message', wrap(async (req, res) => {
  const m = me(req);
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, MAX_TEXT) : '';
  if (!text) return res.status(400).json({ error: 'bad_request' });
  const lang = langOf(req.body?.lang);
  const gate = await writeGate(m);
  if (gate) return res.status(403).json({ error: gate });
  const settings = await getSettings(m.companyId);
  const rate = await hitRate(`aiv:webmsg:${m.userId}`, settings.limits.botMsgsPer10Min, RATE_WINDOW_MS);
  if (!rate.allowed) return res.status(429).json({ error: 'rate', retryAfterSec: rate.retryAfterSec });

  const ctx: ToolCtx = {
    companyId: m.companyId, userId: m.userId, role: roleOf(m) as AiRole, isOwner: m.isOwner, lang: aiLang(lang), tz: 'Asia/Tashkent',
    channel: 'web', purpose: 'assistant', correlationId: newCorrelationId(),
  };
  const history = await recentHistory(m);
  let reply = '';
  let out: Awaited<ReturnType<ReturnType<typeof createTextAgent>['run']>> | null = null;
  try {
    out = await createTextAgent().run({ ctx, history, userText: text, signal: AbortSignal.timeout(AGENT_TIMEOUT_MS) });
    reply = localizeFree(lang, String(out?.text || '').trim()).slice(0, 4000);
  } catch (e) {
    console.error('[aiVoice/chat] TextAgent xatosi:', String((e as Error)?.message || e).slice(0, 160));
    return res.status(502).json({ error: 'agent_error' });
  }
  if (!reply) return res.status(502).json({ error: 'agent_error' });
  await appendMessages(m, [{ role: 'user', content: text }, { role: 'assistant', content: reply }]);
  const pendingActions = (out?.pendingActions || [])
    .filter((p) => p && p.confirmVia === 'ui' && isObjectIdString(p.pendingActionId))
    .map((p) => ({ pendingActionId: p.pendingActionId, summary: localizeFree(lang, String(p.summary || p.tool || '')).slice(0, 300), expiresAt: p.expiresAt, tool: p.tool }));
  const toolCalls = (out?.toolCalls || []).slice(0, 10).map((t) => ({ name: t.name, status: t.status }));
  res.json({ reply, pendingActions, toolCalls });
}));

// ───────────── POST /confirm — tasdiq kartasi ─────────────
router.post('/confirm', wrap(async (req, res) => {
  const m = me(req);
  const pendingActionId = String(req.body?.pendingActionId || '');
  const accept = req.body?.accept === true;
  if (!isObjectIdString(pendingActionId) || typeof req.body?.accept !== 'boolean') return res.status(400).json({ error: 'bad_request' });
  const lang = langOf(req.body?.lang);
  const gate = await writeGate(m);
  if (gate) return res.status(403).json({ error: gate });
  const outcome = await confirmPendingAction({
    pendingActionId, actorUserId: m.userId, companyId: m.companyId, channel: 'web', accept, lang: aiLang(lang),
  });
  const message = localizeFree(lang, String(outcome.result.message || '')).slice(0, 500);
  if (message) await appendMessages(m, [{ role: 'assistant', content: message }]);
  res.json({ status: outcome.result.status, message });
}));

// Tarixni foydalanuvchi o'chira olmaydi — bu audit yozuvi (egasi so'rovi #3: 7 kun bazada, keyin arxiv).

export default router;
