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
import crypto from 'crypto';
import { aiConfig } from '../config';
import { pcm16ToWav } from '../voice/audio';

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
    // Owner 2026-10-19: Telegram orqali qo'ng'iroqlar ham ilovadagi AI chatida ko'rinsin
    AiConversation.find({ userId: m.userId, companyId: m.companyId, source: { $in: ['voice_inapp', 'telegram_call'] }, updatedAt: { $gte: since } })
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

// ───────────── POST /tts — "Ovozda o'qish" (owner 2026-10-19) ─────────────
// Brauzer ovozi (speechSynthesis) o'zbekchani bilmaydi — robotdek, "boshqa tilda" o'qirdi. Endi AI'ning O'Z
// ovozi (sozlamadagi Gemini ovozi, qo'ng'iroqdagi bilan bir xil). WAV qaytadi; 30 daqiqa xotirada kesh.
const ttsCache = new Map<string, { at: number; wav: Buffer }>();
const TTS_TTL_MS = 30 * 60_000;
const TTS_STYLE = {
  uz: "Quyidagi matnni tabiiy, samimiy, jonli o'zbek talaffuzida (Toshkent shevasi), oddiy odam gapirgandek o'qing: ",
  ru: 'Прочитай естественно и тепло, как живой человек: ',
};
router.post('/tts', wrap(async (req, res) => {
  const m = me(req);
  const raw = typeof req.body?.text === 'string' ? req.body.text : '';
  const text = raw.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/[*_#`>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (!text) return res.status(400).json({ error: 'bad_request' });
  const lang = langOf(req.body?.lang) === 'ru' ? 'ru' : 'uz';
  const rate = await hitRate(`aiv:tts:${m.userId}`, 40, RATE_WINDOW_MS);
  if (!rate.allowed) return res.status(429).json({ error: 'rate', retryAfterSec: rate.retryAfterSec });
  const settings = await getSettings(m.companyId);
  // Sozlamalarda ovozni tanlashdan oldin tinglab ko'rish (owner 2026-10-19) — faqat Gemini ovoz nomi shaklida
  const want = typeof req.body?.voiceName === 'string' && /^[A-Z][a-z]{2,15}$/.test(req.body.voiceName) ? req.body.voiceName : '';
  const voiceName = want || settings.voiceName || 'Kore';
  const key = crypto.createHash('sha256').update(`${voiceName}\n${lang}\n${text}`).digest('hex');
  const hit = ttsCache.get(key);
  let wav = hit && Date.now() - hit.at < TTS_TTL_MS ? hit.wav : null;
  if (!wav) {
    try {
      const { GeminiTts } = await import('../voice/geminiSpeech');
      const pcm = await new GeminiTts().synth(TTS_STYLE[lang] + text, { voiceName, lang, model: settings.provider.ttsModel || aiConfig.models.tts });
      wav = pcm16ToWav(pcm, 24_000);
      ttsCache.set(key, { at: Date.now(), wav });
      while (ttsCache.size > 60) ttsCache.delete(ttsCache.keys().next().value as string);
    } catch (e) {
      console.warn('[aiVoice/tts] ishlamadi:', (e as Error).message?.slice(0, 80));
      return res.status(503).json({ error: 'tts_unavailable' });
    }
  }
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'private, max-age=1800');
  res.send(wav);
}));

export default router;
