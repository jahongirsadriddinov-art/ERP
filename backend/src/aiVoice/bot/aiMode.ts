import mongoose from 'mongoose';
import User from '../../models/User';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import { tb, type BotLang } from '../../i18n/bot';
import { aiConfig } from '../config';
import { AI_ROLES, type AiRole, type ToolCtx } from '../contracts';
import { createTextAgent } from '../brain/textAgent';
import { hitRate } from '../lib/mongoRateLimit';
import { isObjectIdString, newCorrelationId } from '../lib/ids';
import { getSettings } from '../settings';
import { isPlatformScope, PLATFORM_SCOPE, platformSettings } from '../platform';
import { getBotInstance } from './instance';
import { ta, aiLangOf, localizeFree } from './i18n';
import { AI_MODE_EXIT_DATA, aiActiveFor, answer, closeButtons, confirmKeyboard, type CallbackActor } from './guard';

// /ai rejimi (Telegram bot): matn va ovozli xabarlar TextAgent'ga (brain/textAgent.createTextAgent —
// P2 amalga oshiradi; tool'lar FAQAT executor orqali, kanal 'bot'). Rejim xotirada keshlanadi
// (aiBotInAiMode SINXRON — har xabarda DB so'rovi yo'q), AiEmployeeContact.botAiModeUntil'ga ham
// yoziladi va ishga tushishda DB'dan isitiladi. Boshqa oqim boshlansa (bot.ts hasPendingChatState)
// yoki menyu tugmasi bosilsa — rejim tugaydi, xabar o'sha oqimga qoladi (review D10).

export const AI_MODE_TTL_MS = 15 * 60_000;
const HISTORY_MAX = 12;
const RATE_WINDOW_MS = 10 * 60_000;
const AGENT_TIMEOUT_MS = 45_000;
const VOICE_MAX_SEC = 120;
const VOICE_MAX_BYTES = 2 * 1024 * 1024;
const BOSS_ROLES = ['direktor', 'orinbosar'];

interface ModeState {
  userId: string;
  companyId: string;
  until: number;
  correlationId: string;
  history: { role: 'user' | 'assistant'; text: string }[];
  busy: boolean;
}
const modes = new Map<number, ModeState>();

// ───────────── Ovozli xabar → matn (DI: testlar soxtasini qo'yadi) ─────────────
export type Transcriber = (audio: Buffer, mimeType: string) => Promise<string>;
const TRANSCRIBE_PROMPT = "Bu o'zbek yoki rus tilidagi qisqa ovozli xabar. Uni AYNAN eshitilganidek matnga aylantir, hech narsa qo'shma. Javob FAQAT JSON: {\"text\":\"\"}";
let transcriber: Transcriber = async (audio, mimeType) => {
  const { geminiAudioToJson, geminiConfigured } = await import('../../services/gemini');
  if (!geminiConfigured()) throw new Error('NO_GEMINI');
  const r = await geminiAudioToJson(audio, mimeType, TRANSCRIBE_PROMPT);
  return String(r?.text || '').trim();
};
export function setTranscriber(t: Transcriber): void { transcriber = t; }

// ───────────── Menyu tugmalari: AI rejimi ularni "o'g'irlamaydi" ─────────────
const BOT_LANGS: BotLang[] = ['uz', 'uz-cyrl', 'ru'];
let menuLabels: Set<string> | null = null;
/** Mavjud bot klaviaturasidagi barcha (standart) tugma matnlari — bosilsa AI rejimi tugaydi. */
export function isMenuButtonText(text: string): boolean {
  if (!menuLabels) {
    menuLabels = new Set();
    // i18n/bot.ts'dagi kb_* kalitlari (funksiyalar emas, oddiy matnlar)
    const probe = ['kb_openSite', 'kb_chat', 'kb_pendingApprovals', 'kb_financeStatus', 'kb_objects', 'kb_staffList', 'kb_report',
      'kb_subscriptionStatus', 'kb_incomingTransfers', 'kb_sentTransfers', 'kb_incomingPayments', 'kb_addExpense', 'kb_expenseHistory',
      'kb_firmsList', 'kb_allUsers', 'kb_chatHistory', 'kb_allSubscriptions', 'kb_generalStats', 'kb_language', 'kb_broadcast',
      'kb_checkIn', 'kb_checkOut', 'kb_refreshStatus', 'kb_devSettings', 'kb_subscribeGate'] as const;
    for (const l of BOT_LANGS) {
      for (const k of probe) {
        try {
          const v = (tb as any)(l, k);
          if (typeof v === 'string' && v) menuLabels.add(v);
        } catch { /* kalit yo'q */ }
      }
    }
  }
  return menuLabels.has(String(text || '').trim());
}

// ───────────── Holat ─────────────
export function inAiMode(chatId: number, now = Date.now()): boolean {
  const s = modes.get(chatId);
  if (!s) return false;
  if (s.until <= now) { modes.delete(chatId); return false; }
  return true;
}

// DB yozuvlari xodim bo'yicha KETMA-KET (kirish/chiqish tez almashsa eski $unset yangi $set'ni bosib ketmasin)
const persistChain = new Map<string, Promise<void>>();
function persistUntil(s: Pick<ModeState, 'userId' | 'companyId'>, until: Date | null) {
  if (isPlatformScope(s.companyId)) return;            // dasturchi rejimi — faqat xotirada (firma yozuvi yo'q)
  const upd = until
    ? { $set: { botAiModeUntil: until }, $setOnInsert: { companyId: s.companyId, employeeId: s.userId } }
    : { $unset: { botAiModeUntil: 1 } };
  const prev = persistChain.get(s.userId) || Promise.resolve();
  const next = prev
    .then(() => AiEmployeeContact.updateOne({ companyId: s.companyId, employeeId: s.userId }, upd, { upsert: !!until }))
    .then(() => undefined)
    .catch((e) => console.error('[aiVoice/bot] AI rejimi yozilmadi:', (e as Error).message));
  persistChain.set(s.userId, next);
  void next.finally(() => { if (persistChain.get(s.userId) === next) persistChain.delete(s.userId); });
}

/** Faqat testlar uchun: navbatdagi DB yozuvlarini kutish. */
export async function __flushAiModePersist(): Promise<void> {
  await Promise.all([...persistChain.values()]);
}

/** AI rejimini tugatish (xotira + DB, fire-and-forget). */
export function clearAiMode(chatId: number): void {
  const s = modes.get(chatId);
  if (!s) return;
  modes.delete(chatId);
  persistUntil(s, null);
}

/** Faqat testlar uchun. */
export function __aiModes() { return modes; }

/** Ishga tushishda: botAiModeUntil > now bo'lgan xodimlarni xotiraga yuklash. */
export async function warmAiModeCache(now = new Date()): Promise<number> {
  if (!aiConfig.enabled) return 0;
  const rows: any[] = await AiEmployeeContact.find({ botAiModeUntil: { $gt: now } }).select('companyId employeeId botAiModeUntil').limit(5000).lean();
  if (!rows.length) return 0;
  const users: any[] = await User.find({ _id: { $in: rows.map((r) => r.employeeId).filter(isObjectIdString) }, isBlocked: { $ne: true } })
    .select('telegramChatId companyId').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  let n = 0;
  for (const r of rows) {
    const u = byId.get(String(r.employeeId));
    if (!u?.telegramChatId || String(u.companyId) !== String(r.companyId)) continue;
    modes.set(Number(u.telegramChatId), {
      userId: String(r.employeeId), companyId: String(r.companyId), until: new Date(r.botAiModeUntil).getTime(),
      correlationId: newCorrelationId(), history: [], busy: false,
    });
    n++;
  }
  return n;
}

/** Bot ro'yxatga olinganda chaqiriladi: Mongo ulangach keshni isitadi. */
export function scheduleAiModeWarmup(): void {
  if (!aiConfig.enabled) return;
  const run = () => { warmAiModeCache().catch((e) => console.error('[aiVoice/bot] AI rejimi keshi:', (e as Error).message)); };
  if (mongoose.connection.readyState === 1) run();
  else mongoose.connection.once('connected', run);
}

// ───────────── Kirish va xabarlar ─────────────
const exitKb = (lang: unknown, boss: boolean) => ({
  inline_keyboard: [
    ...(boss ? [[{ text: ta(lang, 'aiScheduleBtn'), callback_data: 'ai:s:m' }]] : []),
    [{ text: ta(lang, 'aiExitBtn'), callback_data: AI_MODE_EXIT_DATA }],
  ],
});

const isDev = (user: any) => String(user?.role) === 'dasturchi';
/** Rejim kaliti: firma yoki (dasturchi uchun) platforma. */
const scopeOf = (user: any): string => (isDev(user) ? PLATFORM_SCOPE : (user?.companyId ? String(user.companyId) : ''));
/** AI shu foydalanuvchi uchun hozir ishlaydimi (dasturchi — server kaliti; xodim — firma sozlamasi). */
const modeActive = (user: any, scope: string) => (isDev(user) ? Promise.resolve(aiConfig.enabled) : aiActiveFor(scope));

function roleOf(user: any): AiRole | null {
  if (isDev(user)) return 'dasturchi' as AiRole;      // platforma rejimi: faqat umumiy yordamchi (agent/executor cheklaydi)
  if (user?.isOwner) return 'direktor';
  return (AI_ROLES as string[]).includes(String(user?.role)) ? (user.role as AiRole) : null;
}

/**
 * /ai [savol] — rejimga kirish. Firmasiz foydalanuvchi → false (mavjud oqim). AI firmada o'chiq →
 * tushuntirish. Kirishda boshqa kutilayotgan holatlar tozalanadi.
 */
export async function enterAiMode(msg: any, user: any, clearOtherStates: () => void, onEnter?: (chatId: number) => void): Promise<boolean> {
  const chatId = Number(msg.chat.id);
  const companyId = scopeOf(user);
  if ((!isDev(user) && !isObjectIdString(companyId)) || !isObjectIdString(String(user?._id || ''))) return false;
  const bot = getBotInstance();
  const lang = user.language;
  if (!(await modeActive(user, companyId))) {
    await bot?.sendMessage(chatId, ta(lang, 'aiOff')).catch(() => undefined);
    return true;
  }
  if (!roleOf(user)) {
    await bot?.sendMessage(chatId, ta(lang, 'aiNoAccess')).catch(() => undefined);
    return true;
  }
  clearOtherStates();
  onEnter?.(chatId);
  const s: ModeState = {
    userId: String(user._id), companyId, until: Date.now() + AI_MODE_TTL_MS, correlationId: newCorrelationId(), history: [], busy: false,
  };
  modes.set(chatId, s);
  persistUntil(s, new Date(s.until));
  const boss = !!user.isOwner || BOSS_ROLES.includes(String(user.role));
  const rest = typeof msg.text === 'string' ? msg.text.replace(/^\/ai(@\w+)?/i, '').trim() : '';
  if (!rest) {
    await bot?.sendMessage(chatId, ta(lang, 'aiWelcome'), { reply_markup: exitKb(lang, boss) }).catch(() => undefined);
    return true;
  }
  await ask(chatId, s, user, rest);
  return true;
}

async function voiceToText(msg: any): Promise<string | null> {
  const bot = getBotInstance();
  const media = msg.voice || msg.audio;
  if (!bot?.getFileLink || !media?.file_id) return null;
  if (Number(media.duration || 0) > VOICE_MAX_SEC || Number(media.file_size || 0) > VOICE_MAX_BYTES) return null;
  try {
    const link = await bot.getFileLink(media.file_id);
    const res = await fetch(link, { signal: AbortSignal.timeout(20_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > VOICE_MAX_BYTES) return null;
    const text = await transcriber(buf, media.mime_type || 'audio/ogg');
    return text ? text.slice(0, 2000) : null;
  } catch (e) {
    console.warn('[aiVoice/bot] ovozli xabar matnga aylanmadi:', String((e as Error)?.message || e).slice(0, 120));
    return null;
  }
}

/** AI rejimidagi xabar. false — rejim yo'q/boshqa foydalanuvchi/menyu tugmasi (xabar mavjud oqimga). */
export async function handleAiModeMessage(msg: any, user: any): Promise<boolean> {
  const chatId = Number(msg.chat.id);
  const s = modes.get(chatId);
  if (!s || !inAiMode(chatId)) return false;
  if (s.userId !== String(user?._id) || s.companyId !== scopeOf(user)) { clearAiMode(chatId); return false; }
  if (typeof msg.text === 'string' && isMenuButtonText(msg.text)) { clearAiMode(chatId); return false; }
  const bot = getBotInstance();
  const lang = user.language;
  if (!(await modeActive(user, s.companyId)) || !roleOf(user)) {
    clearAiMode(chatId);
    await bot?.sendMessage(chatId, ta(lang, 'aiOff')).catch(() => undefined);
    return true;
  }
  if (s.busy) { await bot?.sendMessage(chatId, ta(lang, 'aiThinking')).catch(() => undefined); return true; }

  let text: string | null = null;
  if (typeof msg.text === 'string' && msg.text.trim()) text = msg.text.trim().slice(0, 2000);
  else if (msg.voice || msg.audio) {
    text = await voiceToText(msg);
    if (!text) { await bot?.sendMessage(chatId, ta(lang, 'aiVoiceFail')).catch(() => undefined); return true; }
  } else {
    await bot?.sendMessage(chatId, ta(lang, 'aiUnsupported')).catch(() => undefined);
    return true;
  }
  await ask(chatId, s, user, text as string);
  return true;
}

async function ask(chatId: number, s: ModeState, user: any, text: string): Promise<void> {
  const bot = getBotInstance();
  const lang = user.language;
  const role = roleOf(user) as AiRole;
  const settings = isPlatformScope(s.companyId) ? platformSettings() : await getSettings(s.companyId);
  const rate = await hitRate(`aiv:botmsg:${s.userId}`, settings.limits.botMsgsPer10Min, RATE_WINDOW_MS);
  if (!rate.allowed) { await bot?.sendMessage(chatId, ta(lang, 'aiRate')).catch(() => undefined); return; }

  s.busy = true;
  s.until = Date.now() + AI_MODE_TTL_MS;
  persistUntil(s, new Date(s.until));
  await bot?.sendChatAction?.(chatId, 'typing').catch(() => undefined);
  const ctx: ToolCtx = {
    companyId: s.companyId, userId: s.userId, role, isOwner: !!user.isOwner, lang: aiLangOf(lang), tz: 'Asia/Tashkent',
    channel: 'bot', purpose: 'assistant', correlationId: s.correlationId,
  };
  const boss = !!user.isOwner || BOSS_ROLES.includes(String(user.role));
  try {
    const out = await createTextAgent().run({ ctx, history: [...s.history], userText: text, signal: AbortSignal.timeout(AGENT_TIMEOUT_MS) });
    const reply = localizeFree(lang, String(out?.text || '').trim()).slice(0, 4000) || ta(lang, 'error');
    s.history.push({ role: 'user', text }, { role: 'assistant', text: reply });
    if (s.history.length > HISTORY_MAX) s.history.splice(0, s.history.length - HISTORY_MAX);
    await bot?.sendMessage(chatId, reply, { reply_markup: exitKb(lang, boss) }).catch(() => undefined);
    // Tasdiq talab qiladigan amallar — FAQAT tugma orqali (ai:x), model "tasdiqladim" deya olmaydi (B3)
    for (const p of out?.pendingActions || []) {
      if (p?.confirmVia !== 'bot' || !p.token) continue;
      await bot?.sendMessage(chatId, ta(lang, 'pendingAsk', { summary: String(p.summary || p.tool || '').slice(0, 300) }), {
        reply_markup: { inline_keyboard: confirmKeyboard(p.token, lang) },
      }).catch(() => undefined);
    }
  } catch (e) {
    console.error('[aiVoice/bot] TextAgent xatosi:', String((e as Error)?.message || e).slice(0, 160));
    await bot?.sendMessage(chatId, ta(lang, 'error'), { reply_markup: exitKb(lang, boss) }).catch(() => undefined);
  } finally {
    s.busy = false;
  }
}

/** ai:m:x — AI rejimidan chiqish tugmasi. */
export async function handleAiModeCallback(query: any, a: CallbackActor, parts: string[]): Promise<boolean> {
  const bot = getBotInstance();
  if (parts[2] !== 'x') { await answer(bot, query.id); return true; }
  const s = modes.get(a.chatId);
  if (s && s.userId === a.userId) clearAiMode(a.chatId);
  await answer(bot, query.id);
  await closeButtons(bot, a, query);
  await bot?.sendMessage(a.chatId, ta(a.lang, 'aiExited')).catch(() => undefined);
  return true;
}
