import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import { aiConfig } from '../config';
import { getSettings } from '../settings';
import { getBotInstance, setBotInstance, onBotRegistered, type AiBotApi } from './instance';
import { aiActiveFor, answer as answerCallback, callbackActor } from './guard';
import { handleAttendanceCallback, handleConfirmCallback, handleReminderCallback } from './callbacks';
import { handleConsentCallback } from './consentFlow';
import { clearScheduleDraft, handleScheduleCallback, handleScheduleText, openScheduleMenu, scheduleAwaiting } from './scheduleMenu';
import { clearAiMode, enterAiMode, handleAiModeCallback, handleAiModeMessage, inAiMode, scheduleAiModeWarmup } from './aiMode';
import { ta } from './i18n';

// Mavjud ERP botiga (services/bot.ts) AI ilgaklari. bot.ts bu faylni import qiladi, lekin bu fayl
// bot.ts'ni HECH QACHON import qilmaydi (u tokensiz modul darajasida xato tashlaydi va sikl bo'lardi) —
// bot obyekti registerBotInstance() orqali DI bilan beriladi (bot/instance.ts).
//
// AI o'chiq (AI_VOICE_ENABLED yoki firma sozlamasi) bo'lsa — barcha ilgaklar haqiqiy no-op,
// botning mavjud xatti-harakati o'zgarmaydi. Callback prefikslari:
//   ai:a (davomat) · ai:r (eslatma) · ai:o (rozilik) · ai:x (amal tasdig'i) · ai:s (ish jadvali menyusi,
//   faqat rahbarlar — ular ishchi rollari emas, smena darvozasi ularga tegmaydi) · ai:m (AI rejimidan chiqish).

export type { AiBotApi } from './instance';

/** bot.ts modul oxirida chaqiradi. AI yoqiq bo'lsa AI rejimi keshi DB'dan isitiladi. */
export function registerBotInstance(bot: AiBotApi): void { setBotInstance(bot); }
export { getBotInstance };
onBotRegistered(() => scheduleAiModeWarmup());

// ───────────── Sof guard'lar (bot.ts ishlatadi, botHooksWiring testi tekshiradi) ─────────────

export const AI_CALLBACK_PREFIX = 'ai:';

/**
 * Smena darvozasi (bot.ts callback_query): smenasi yopiq ishchi FAQAT shu tugmalarni bosa oladi.
 * ai:a: (davomat), ai:o: (rozilik/opt-out), ai:r: (eslatma) — ruxsat; ai:x: (amal tasdig'i) — YO'Q.
 */
export const WORKER_OFFSHIFT_CALLBACK_RE = /^(confirm_checkin|cancel_checkin|lang_|setlang|ai:a:|ai:o:|ai:r:)/;

export function isAiCallbackData(data: unknown): data is string {
  return typeof data === 'string' && data.startsWith(AI_CALLBACK_PREFIX);
}

/**
 * AI bot buyruqlari: /ai — AI rejimi (matn/ovozli savol); /jadval — ish jadvali menyusi (owner decision
 * 2026-10-13: egasi/direktor (va ruxsat bo'lsa o'rinbosar) ish boshlanishi, hafta kunlari, skip/extra
 * sanalarni MAVJUD bot ichida inline tugmalar bilan o'zgartiradi; ruxsatni P4 settings.canEditSchedule bilan tekshiradi).
 */
export type AiBotCommand = 'ai' | 'schedule';
export const AI_BOT_COMMANDS: { command: string; kind: AiBotCommand; description: string }[] = [
  { command: 'ai', kind: 'ai', description: 'AI yordamchi / AI помощник' },
  { command: 'jadval', kind: 'schedule', description: 'Ish jadvali (rahbar) / График работы' },
];

/** "/ai", "/jadval" (ixtiyoriy "@BotName" va matn bilan) → buyruq turi; boshqasi null. */
// Klaviatura tugmalari matni (bot.ts klaviaturaga qo'shadi) — bosilsa buyruq bilan bir xil ishlaydi
const AI_BUTTONS: Record<AiBotCommand, { uz: string; ru: string }> = {
  ai: { uz: '🤖 AI yordamchi', ru: '🤖 AI-помощник' },
  schedule: { uz: '📅 Ish jadvali', ru: '📅 График работы' },
} as any;
export function aiBotButtonText(kind: AiBotCommand, lang?: string): string {
  return lang === 'ru' ? AI_BUTTONS[kind].ru : AI_BUTTONS[kind].uz;
}

export function aiBotCommandOf(text: unknown): AiBotCommand | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  for (const [kind, v] of Object.entries(AI_BUTTONS) as [AiBotCommand, { uz: string; ru: string }][]) {
    if (t === v.uz || t === v.ru) return kind;
  }
  const m = /^\/([a-z]+)(@\w+)?(\s|$)/i.exec(text);
  if (!m) return null;
  const name = m[1].toLowerCase();
  return AI_BOT_COMMANDS.find((c) => c.command === name)?.kind ?? null;
}

/** "/ai" yoki "/ai@BotName" (ixtiyoriy matn bilan). */
export function isAiCommand(text: unknown): boolean {
  return aiBotCommandOf(text) === 'ai';
}

// ───────────── Ilgaklar (P4) ─────────────

export interface AiMessageEnv {
  /** /ai yoki /jadval'ga kirishda boshqa barcha kutilayotgan holatlarni (chat, chiqim, joylashuv…) tozalaydi. */
  clearOtherStates: () => void;
  /** Xabar AI buyrug'imi (/ai yoki /jadval). */
  isCommand: boolean;
  /** Qaysi buyruq: 'ai' — AI rejimi, 'schedule' — ish jadvali menyusi; oddiy xabar — null. */
  command: AiBotCommand | null;
}

/**
 * ai:* callback (ai:a, ai:r, ai:o, ai:x, ai:s, ai:m). true — qayta ishlandi (javob berildi).
 * Xavfsizlik (B5): faqat shaxsiy chat, from.id === chat.id, foydalanuvchi bloklanmagan va firmasi bor;
 * yozuv SHU xodim/firmaga bog'liq, token muddati, atomik o'tish — modullarda. Shartlar bajarilmasa
 * false: dispatch jim javob beradi (nima noto'g'riligi oshkor qilinmaydi).
 */
export async function aiBotCallbackHook(query: any, user: any, _lang: string | undefined): Promise<boolean> {
  const data = typeof query?.data === 'string' ? query.data : '';
  const parts = data.split(':');
  const kind = parts[1];
  const a = callbackActor(query, user);
  if (!a) return false;
  // Jadval menyusi AI firmada o'chiq bo'lsa ham ishlaydi (AI'ni aynan shu yerdan yoqish mumkin)
  if (kind === 's') return handleScheduleCallback(query, a, parts);
  if (kind === 'm') return handleAiModeCallback(query, a, parts);
  if (!['a', 'r', 'o', 'x'].includes(kind)) return false;
  if (!(await aiActiveFor(a.companyId))) {
    await answerCallback(getBotInstance(), query.id, ta(a.lang, 'aiOff'), true);
    return true;
  }
  switch (kind) {
    case 'a': return handleAttendanceCallback(query, a, parts);
    case 'r': return handleReminderCallback(query, a, parts);
    case 'o': return handleConsentCallback(query, a, parts);
    case 'x': return handleConfirmCallback(query, a, parts);
  }
  return false;
}

function editorOf(user: any) {
  return {
    userId: String(user._id), role: String(user.role || ''), isOwner: !!user.isOwner,
    companyId: user.companyId ? String(user.companyId) : '', lang: user.language,
  };
}

/** /ai, /jadval va AI rejimidagi (yoki jadval menyusi matn kutayotgan) xabar. true — qayta ishlandi. */
export async function aiBotMessageHook(msg: any, user: any, _lang: string | undefined, env: AiMessageEnv): Promise<boolean> {
  if (msg?.chat?.type !== 'private') return false;
  const chatId = Number(msg.chat.id);
  if (msg.from?.id === undefined || String(msg.from.id) !== String(chatId)) return false;
  if (!user?._id || user.isBlocked) return false;
  // Dasturchi (yoki firmasiz) akkaunt — AI firma ichida ishlaydi. Avval jim qolardi ("buyruqlar ishlamayapti").
  // Owner 2026-10-17: dasturchi /ai bilan umumiy yordamchi + platforma holati (firma ma'lumotisiz) — platform.ts
  const dev = user.role === 'dasturchi';
  if (env.isCommand && dev && env.command === 'ai') return enterAiMode(msg, user, env.clearOtherStates, (id) => clearScheduleDraft(id));
  if (env.isCommand && (dev || !user.companyId)) {
    await getBotInstance()?.sendMessage(chatId, ta(user.language, 'devNoCompany')).catch(() => undefined);
    return true;
  }
  if (dev) return inAiMode(chatId) ? handleAiModeMessage(msg, user) : false;
  if (env.command === 'schedule') {
    if (!user.companyId) return false;
    const e = editorOf(user);
    env.clearOtherStates();
    clearAiMode(chatId);
    clearScheduleDraft(chatId);
    await openScheduleMenu(chatId, e);
    return true;
  }
  if (env.command === 'ai') {
    return enterAiMode(msg, user, env.clearOtherStates, (id) => clearScheduleDraft(id));
  }
  if (scheduleAwaiting(chatId)) {
    if (typeof msg.text !== 'string') return false;
    return handleScheduleText(msg, editorOf(user));
  }
  if (inAiMode(chatId)) return handleAiModeMessage(msg, user);
  return false;
}

/**
 * Chat AI ilgagi qo'lidami: AI rejimi (botAiModeUntil > now) YOKI jadval menyusi matn kutmoqda.
 * SINXRON — faqat xotira (ishga tushishda DB'dan isitiladi).
 */
export function aiBotInAiMode(chatId: number): boolean {
  return inAiMode(chatId) || scheduleAwaiting(chatId);
}

/** /res yoki boshqa oqimga o'tish — AI rejimi va jadval qoralamasi tozalanadi. */
export function aiBotResetChat(chatId: number): void {
  clearAiMode(chatId);
  clearScheduleDraft(chatId);
}

// ───────────── bot.ts chaqiradigan dispatch'lar ─────────────

/**
 * callback_query: obuna darvozasidan KEYIN, 'subcheck'dan OLDIN chaqiriladi.
 * ai:* bo'lmasa false (bot.ts davom etadi). ai:* bo'lsa DOIM true — ilgak ishlamasa ham javob beriladi,
 * shuning uchun ai:* ma'lumot hech qachon confirm_<txId> catch-all'iga yetib bormaydi.
 */
export async function dispatchAiCallback(
  query: any, user: any, lang: string | undefined,
  answer: (queryId: string) => Promise<unknown> = (id) => getBotInstance()?.answerCallbackQuery(id) ?? Promise.resolve(),
): Promise<boolean> {
  if (!isAiCallbackData(query?.data)) return false;
  let handled = false;
  if (aiConfig.enabled) {
    try { handled = await aiBotCallbackHook(query, user, lang); }
    catch (e) { console.error('[aiVoice/bot] callback ilgagi xatosi:', (e as Error).message); }
  }
  if (!handled) await Promise.resolve(answer(String(query?.id || ''))).catch(() => undefined);
  return true;
}

export interface AiMessageGate {
  /** Boshqa oqim (chat, chiqim kiritish, joylashuv kutish, xabar yuborish, tugma tahriri…) chatni ushlab turibdimi. */
  hasOtherPendingState: boolean;
  clearOtherStates: () => void;
  /** Foydalanuvchi faqat kerak bo'lganda yuklanadi (AI o'chiq bo'lsa DB so'rovi yo'q). */
  loadUser: () => Promise<any>;
}

/**
 * message: smena darvozasidan KEYIN chaqiriladi. Qoidalar (review D10):
 *  • AI o'chiq → false (no-op, DB so'rovi yo'q);
 *  • /ai, /jadval → ilgakka (u boshqa holatlarni tozalaydi);
 *  • aks holda faqat AI rejimida VA boshqa kutilayotgan holat bo'lmasa;
 *  • boshqa oqim boshlangan bo'lsa — AI rejimi tugatiladi, xabar o'sha oqimga qoladi;
 *  • boshqa slash-buyruqlar (/start, …) ushlanmaydi.
 */
export async function dispatchAiMessage(msg: any, gate: AiMessageGate): Promise<boolean> {
  if (!aiConfig.enabled || msg?.chat?.type !== 'private') return false;
  const chatId = Number(msg.chat.id);
  const text = typeof msg.text === 'string' ? msg.text : '';
  const command = aiBotCommandOf(text);
  const isCommand = command !== null;
  if (!isCommand) {
    if (!aiBotInAiMode(chatId)) return false;
    if (gate.hasOtherPendingState) { aiBotResetChat(chatId); return false; }
    if (text.startsWith('/')) return false;
  }
  try {
    const user = await gate.loadUser();
    if (!user || user.isBlocked) return false;
    return await aiBotMessageHook(msg, user, user.language, { clearOtherStates: gate.clearOtherStates, isCommand, command });
  } catch (e) {
    console.error('[aiVoice/bot] xabar ilgagi xatosi:', (e as Error).message);
    return false;
  }
}

/**
 * Eski ertalabki eslatma (sendMorningReminders) kimlarga YUBORILMASIN (review C8): faqat BUGUN uchun
 * AiAttendanceConfirmation'i bor va firmasida suppressLegacyMorningReminder yoqiq xodimlar.
 * Bitta $in so'rov + firma bo'yicha (keshli) sozlama. AI o'chiq bo'lsa — bo'sh to'plam, DB so'rovi yo'q.
 * Xato bo'lsa ham bo'sh to'plam — AI buzilsa hech kim eslatmasiz qolmaydi.
 */
export async function aiSuppressedMorningUserIds(userIds: string[], date: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (!aiConfig.enabled || !userIds.length) return out;
  try {
    const rows: any[] = await AiAttendanceConfirmation.find({ employeeId: { $in: userIds }, date })
      .select('employeeId companyId').lean();
    const byCompany = new Map<string, boolean>();
    for (const r of rows) {
      const cid = String(r.companyId);
      if (!byCompany.has(cid)) {
        const s = await getSettings(cid).catch(() => null);
        byCompany.set(cid, !!(s?.enabled && s.attendance.enabled && s.attendance.suppressLegacyMorningReminder));
      }
      if (byCompany.get(cid)) out.add(String(r.employeeId));
    }
  } catch (e) {
    console.error('[aiVoice/bot] ertalabki eslatma filtri xatosi:', (e as Error).message);
    out.clear();
  }
  return out;
}
