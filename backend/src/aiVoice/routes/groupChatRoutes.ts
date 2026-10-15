import { Router } from 'express';
import Group from '../../models/Group';
import Message from '../../models/Message';
import User from '../../models/User';
import AiGroupAssistant from '../../models/AiGroupAssistant';
import type { AiRole, ToolCtx } from '../contracts';
import { createTextAgent } from '../brain/textAgent';
import { getSettings, isAiActive } from '../settings';
import { hitRate } from '../lib/mongoRateLimit';
import { isObjectIdString, newCorrelationId } from '../lib/ids';
import { localizeFree } from '../bot/i18n';
import {
  AGENT_TIMEOUT_MS, MAX_TEXT, RATE_WINDOW_MS, aiLang, appendDaily, appendMessages, langOf, me, roleOf, wrap, writeGate,
  type ChatLang, type Me,
} from './chatShared';

// Chat GURUHIDAGI "AI yordamchi" (egasi so'rovi, 2026-10-15): /api/ai-voice/me/chat/groups/*.
//  - guruhning istalgan a'zosi AI'ni qo'sha oladi; chiqarish — guruh admini/yaratuvchisi, direktor yoki qo'shgan odam;
//  - AI faqat chaqirilganda javob beradi: xabar "@AI" / "AI," bilan boshlansa (yoki ichida @AI bo'lsa) yoki
//    AI xabariga javob (reply) bo'lsa. Mijoz xabarni odatdagi /api/messages orqali yuboradi, keyin /ask'ni chaqiradi;
//  - savol SO'RAGAN ODAMNING huquqlari bilan bajariladi (TextAgent, kanal 'web', RBAC executor'da);
//  - MAXFIYLIK (kodda, modelga tayanmasdan): javob ERP ma'lumotiga tayansa (biror tool natija qaytargan bo'lsa)
//    yoki tasdiq kerak bo'lsa — javob guruhga EMAS, so'ragan odamning shaxsiy AI chatiga boradi, guruhga esa
//    faqat "shaxsiy chatga yubordim" degan qisqa xabar. Guruhga faqat umumiy (ma'lumotsiz) javoblar chiqadi.
//  - har bir savol-javob so'ragan odam nomidan AiConversation'da (sessionId 'aigroup:<groupId>:YYYY-MM-DD') — audit.

const router = Router();

/** Guruhdagi AI xabarlari shu "foydalanuvchi" nomidan (frontend aiVoice/chat/aiGroup.ts bilan bir xil). */
export const AI_SENDER_ID = 'ai-assistant';
const HISTORY_FOR_AGENT = 8;
let FIND_MSG_TRIES = 12;              // mijoz /ask'ni xabar saqlanishidan oldin chaqirishi mumkin — ~6 s kutamiz
let FIND_MSG_GAP_MS = 500;
/** Faqat testlar uchun. */
export function __setFindMsgWaitForTests(tries: number, gapMs: number): void { FIND_MSG_TRIES = tries; FIND_MSG_GAP_MS = gapMs; }
const MSG_MAX_AGE_MS = 2 * 60_000;

// "@AI ...", "AI, ...", "AI: ...", "AI yordamchi, ...", "ИИ, ..." yoki matn ichida "@AI"
const LEAD_RE = /^\s*(?:@\s*)?(?:ai|аи|ии)(?:\s+(?:yordamchi|ёрдамчи|помощник))?\s*[,:!?\-—]\s*/i;
const AT_RE = /(^|[\s(])@(?:ai|аи|ии)(?![\p{L}\p{N}_])/iu;

export function isAiMention(text: string): boolean {
  return LEAD_RE.test(text) || AT_RE.test(text);
}

export function stripAiMention(text: string): string {
  return text.replace(LEAD_RE, '').replace(new RegExp(AT_RE.source, 'giu'), '$1').replace(/\s{2,}/g, ' ').trim();
}

const L = (lang: ChatLang, uz: string, ru: string) => localizeFree(lang, lang === 'ru' ? ru : uz);

type GroupDoc = { _id: unknown; name?: string; memberIds?: string[]; adminIds?: string[]; createdBy?: string; companyId?: string; devSupport?: boolean };

/** Guruh + a'zolik. Begona/firma tashqarisidagi/dev-support guruh — 404 (mavjudligi oshkor qilinmaydi). */
async function loadGroup(m: Me, groupId: string): Promise<GroupDoc | null> {
  if (!isObjectIdString(groupId)) return null;
  const g = await Group.findById(groupId).select('name memberIds adminIds createdBy companyId devSupport').lean().catch(() => null) as GroupDoc | null;
  if (!g || g.devSupport) return null;
  if (String(g.companyId || '') !== m.companyId) return null;
  if (!(g.memberIds || []).map(String).includes(m.userId)) return null;
  return g;
}

function canManage(m: Me, g: GroupDoc, addedBy?: string): boolean {
  return m.isOwner || m.role === 'direktor'
    || String(g.createdBy || '') === m.userId
    || (g.adminIds || []).map(String).includes(m.userId)
    || (!!addedBy && addedBy === m.userId);
}

async function emitGroup(groupId: string, event: string, payload: unknown): Promise<void> {
  try {
    // Kechiktirilgan import: services/socket → aiVoice/socket aylanma import bo'lmasin
    const s = await import('../../services/socket');
    s.emitToGroup(groupId, event, payload);
  } catch { /* socket yo'q (test) */ }
}

/** Guruhga AI nomidan xabar (odatdagi Message — hamma qurilmada, tarixda ko'rinadi). */
async function postAiMessage(g: GroupDoc, text: string, replyToId?: string): Promise<string> {
  const msg: any = await Message.create({
    fromUserId: AI_SENDER_ID, toUserId: '', groupId: String(g._id), text: text.slice(0, 4000),
    timestamp: new Date().toISOString(), read: false, type: 'text', companyId: g.companyId,
    ...(replyToId ? { replyToId } : {}),
  } as any);
  await emitGroup(String(g._id), 'message:new', { ...msg.toObject(), id: msg._id });
  return String(msg._id);
}

async function isEnabled(groupId: string): Promise<{ enabled: boolean; addedBy?: string }> {
  const d: any = await AiGroupAssistant.findOne({ groupId }).select('enabled addedBy').lean();
  return { enabled: !!d?.enabled, addedBy: d?.addedBy ? String(d.addedBy) : undefined };
}

// ───────────── GET / — men a'zo bo'lgan, AI yoqilgan guruhlar ─────────────
router.get('/', wrap(async (req, res) => {
  const m = me(req);
  const groups = await Group.find({ companyId: m.companyId, memberIds: m.userId, devSupport: { $ne: true } }).select('_id').limit(500).lean();
  const ids = groups.map((g: any) => String(g._id));
  const on = ids.length ? await AiGroupAssistant.find({ groupId: { $in: ids }, enabled: true }).select('groupId').lean() : [];
  res.json({ groups: on.map((d: any) => String(d.groupId)) });
}));

// ───────────── GET /:groupId — holat ─────────────
router.get('/:groupId', wrap(async (req, res) => {
  const m = me(req);
  const g = await loadGroup(m, String(req.params.groupId));
  if (!g) return res.status(404).json({ error: 'not_found' });
  const [st, aiActive] = await Promise.all([isEnabled(String(g._id)), isAiActive(m.companyId).catch(() => false)]);
  res.json({ enabled: st.enabled, canManage: canManage(m, g, st.addedBy), aiActive });
}));

// ───────────── PUT /:groupId — qo'shish / chiqarish ─────────────
router.put('/:groupId', wrap(async (req, res) => {
  const m = me(req);
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'bad_request' });
  const enabled = req.body.enabled as boolean;
  const lang = langOf(req.body?.lang);
  const g = await loadGroup(m, String(req.params.groupId));
  if (!g) return res.status(404).json({ error: 'not_found' });
  if (!(await isAiActive(m.companyId))) return res.status(403).json({ error: 'ai_disabled' });
  const groupId = String(g._id);
  const cur = await isEnabled(groupId);
  if (!enabled && cur.enabled && !canManage(m, g, cur.addedBy)) return res.status(403).json({ error: 'denied' });
  if (cur.enabled !== enabled) {
    await AiGroupAssistant.updateOne(
      { groupId },
      { $set: { enabled, updatedBy: m.userId, companyId: m.companyId, ...(enabled ? { addedBy: m.userId } : {}) } },
      { upsert: true },
    );
    await postAiMessage(g, enabled
      ? L(lang,
        "🤖 AI yordamchi guruhga qo'shildi (Beta). Savol berish uchun xabarni «@AI» yoki «AI,» bilan boshlang yoki AI xabariga javob yozing. Shaxsiy ma'lumotlar guruhda ko'rsatilmaydi — ular so'ragan odamga shaxsiy chatda yuboriladi.",
        '🤖 ИИ-помощник добавлен в группу (Beta). Чтобы спросить, начните сообщение с «@AI» или «AI,» либо ответьте на сообщение ИИ. Личные данные в группе не показываются — они отправляются спросившему в личный чат.')
      : L(lang, '🤖 AI yordamchi guruhdan chiqarildi.', '🤖 ИИ-помощник удалён из группы.'));
    await emitGroup(groupId, 'ai:group', { groupId, enabled });
  }
  res.json({ enabled, canManage: canManage(m, g, enabled ? (cur.enabled ? cur.addedBy : m.userId) : undefined) });
}));

/** Mijoz yuborgan savol xabarini topish (u hali saqlanmagan bo'lishi mumkin — qisqa kutish). */
async function findAskerMessage(m: Me, groupId: string, text: string): Promise<any | null> {
  for (let i = 0; i < FIND_MSG_TRIES; i++) {
    const msg = await Message.findOne({
      groupId, fromUserId: m.userId, text, deleted: { $ne: true }, createdAt: { $gte: new Date(Date.now() - MSG_MAX_AGE_MS) },
    }).sort({ createdAt: -1 }).select('_id createdAt').lean();
    if (msg) return msg;
    if (i === FIND_MSG_TRIES - 1) break;
    await new Promise((r) => setTimeout(r, FIND_MSG_GAP_MS));
  }
  return null;
}

/** Modelga guruh konteksti: savoldan oldingi oxirgi xabarlar (ular guruhga baribir ko'rinadi). */
async function groupHistory(groupId: string, before: Date): Promise<{ role: 'user' | 'assistant'; text: string }[]> {
  const q: Record<string, unknown> = { groupId, deleted: { $ne: true }, text: { $ne: '' }, type: { $in: [null, 'text'] }, createdAt: { $lt: before } };
  const rows: any[] = await Message.find(q).sort({ createdAt: -1 }).limit(HISTORY_FOR_AGENT).select('fromUserId text').lean();
  rows.reverse();
  const ids = [...new Set(rows.map((r) => String(r.fromUserId)).filter((id) => isObjectIdString(id)))];
  const users: any[] = ids.length ? await User.find({ _id: { $in: ids } }).select('firstName').lean() : [];
  const names = new Map(users.map((u) => [String(u._id), String(u.firstName || '').slice(0, 40)]));
  return rows.map((r) => (String(r.fromUserId) === AI_SENDER_ID
    ? { role: 'assistant' as const, text: String(r.text || '').slice(0, 600) }
    : { role: 'user' as const, text: `${names.get(String(r.fromUserId)) || '?'}: ${String(r.text || '').slice(0, 300)}` }));
}

const GROUP_PREAMBLE = {
  uz: "[Bu savol chat GURUHIDA berildi — javobingizni guruhning barcha a'zolari ko'radi. Hech kimning shaxsiy ma'lumotini (ish haqi, qarz, davomat, telefon, moliya) javobga yozmang; qisqa javob bering.]\n",
  ru: '[Вопрос задан в ГРУППОВОМ чате — ответ увидят все участники. Не пишите ничьих личных данных (зарплата, долги, посещаемость, телефон, финансы); отвечайте кратко.]\n',
};

// ───────────── POST /:groupId/ask — guruhdagi savol ─────────────
router.post('/:groupId/ask', wrap(async (req, res) => {
  const m = me(req);
  const raw = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, MAX_TEXT) : '';
  if (!raw) return res.status(400).json({ error: 'bad_request' });
  const lang = langOf(req.body?.lang);
  const g = await loadGroup(m, String(req.params.groupId));
  if (!g) return res.status(404).json({ error: 'not_found' });
  const groupId = String(g._id);
  if (!(await isEnabled(groupId)).enabled) return res.status(409).json({ error: 'not_enabled' });

  // Chaqiruv: mention yoki AI xabariga reply (serverda qayta tekshiriladi)
  const replyToId = typeof req.body?.replyToId === 'string' && isObjectIdString(req.body.replyToId) ? req.body.replyToId : '';
  const replyToAi = !!replyToId && !!(await Message.exists({ _id: replyToId, groupId, fromUserId: AI_SENDER_ID }));
  if (!isAiMention(raw) && !replyToAi) return res.status(400).json({ error: 'no_mention' });

  const gate = await writeGate(m);
  if (gate) return res.status(403).json({ error: gate });
  const settings = await getSettings(m.companyId);
  const rate = await hitRate(`aiv:grpmsg:${m.userId}`, settings.limits.botMsgsPer10Min, RATE_WINDOW_MS);
  if (!rate.allowed) return res.status(429).json({ error: 'rate', retryAfterSec: rate.retryAfterSec });

  // Savol avval guruhga odatdagidek yuborilgan bo'lishi shart (AI "savolsiz" javob yozmasin)
  const asked = await findAskerMessage(m, groupId, raw);
  if (!asked) return res.status(404).json({ error: 'message_not_found' });
  if (await Message.exists({ groupId, fromUserId: AI_SENDER_ID, replyToId: String(asked._id) })) {
    return res.status(409).json({ error: 'already_answered' });
  }
  const question = stripAiMention(raw) || raw;
  const history = await groupHistory(groupId, new Date(asked.createdAt));
  const ctx: ToolCtx = {
    companyId: m.companyId, userId: m.userId, role: roleOf(m) as AiRole, isOwner: m.isOwner, lang: aiLang(lang), tz: 'Asia/Tashkent',
    channel: 'web', purpose: 'assistant', correlationId: newCorrelationId(),
  };
  let out: Awaited<ReturnType<ReturnType<typeof createTextAgent>['run']>>;
  try {
    out = await createTextAgent().run({ ctx, history, userText: GROUP_PREAMBLE[aiLang(lang)] + question, signal: AbortSignal.timeout(AGENT_TIMEOUT_MS) });
  } catch (e) {
    console.error('[aiVoice/group] TextAgent xatosi:', String((e as Error)?.message || e).slice(0, 160));
    return res.status(502).json({ error: 'agent_error' });
  }
  const reply = localizeFree(lang, String(out?.text || '').trim()).slice(0, 4000);
  if (!reply) return res.status(502).json({ error: 'agent_error' });

  // Maxfiylik: ERP ma'lumoti ishlatilgan yoki tasdiq kerak — faqat so'ragan odamga
  const pendingActions = (out.pendingActions || [])
    .filter((p) => p && p.confirmVia === 'ui' && isObjectIdString(p.pendingActionId))
    .map((p) => ({ pendingActionId: p.pendingActionId, summary: localizeFree(lang, String(p.summary || p.tool || '')).slice(0, 300), expiresAt: p.expiresAt, tool: p.tool }));
  // Har qanday tool chaqiruvi (hatto denied/not_found — "X topilmadi" ham ma'lumot) — shaxsiy chatga
  const usedData = (out.toolCalls || []).length > 0;
  const isPrivate = usedData || pendingActions.length > 0 || (out.pendingActions || []).length > 0;

  const groupName = String(g.name || '').slice(0, 60);
  await appendDaily(m, [{ role: 'user', content: question }, { role: 'assistant', content: reply }], `aigroup:${groupId}:`, `AI · ${groupName}`);

  if (isPrivate) {
    await appendMessages(m, [
      { role: 'user', content: `${L(lang, '«' + groupName + '» guruhida', 'В группе «' + groupName + '»')}: ${question}` },
      { role: 'assistant', content: reply },
    ]);
    const asker: any = await User.findById(m.userId).select('firstName').lean().catch(() => null);
    const who = String(asker?.firstName || '').slice(0, 40);
    await postAiMessage(g, L(lang,
      `${who ? who + ', j' : 'J'}avob shaxsiy ma'lumotga tayanadi — uni sizga AI yordamchi bilan shaxsiy chatda yubordim.`,
      `${who ? who + ', о' : 'О'}твет содержит личные/служебные данные — я отправил его вам в личный чат с ИИ-помощником.`), String(asked._id));
    return res.json({ delivered: 'private', reply, pendingActions });
  }
  const messageId = await postAiMessage(g, reply, String(asked._id));
  res.json({ delivered: 'group', messageId });
}));

export default router;
