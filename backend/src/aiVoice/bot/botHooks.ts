import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import { aiConfig } from '../config';
import { getSettings } from '../settings';

// Mavjud ERP botiga (services/bot.ts) AI ilgaklari. bot.ts bu faylni import qiladi, lekin bu fayl
// bot.ts'ni HECH QACHON import qilmaydi (u tokensiz modul darajasida xato tashlaydi va sikl bo'lardi) —
// bot obyekti registerBotInstance() orqali DI bilan beriladi.
//
// P1: yakuniy imzolar + xavfsiz dispatch/guard funksiyalari (sof, test qilinadi).
// P4: aiBotCallbackHook / aiBotMessageHook / aiBotInAiMode / aiBotResetChat ichini to'ldiradi.
// AI o'chiq (AI_VOICE_ENABLED yoki firma sozlamasi) bo'lsa — barcha ilgaklar haqiqiy no-op,
// botning mavjud xatti-harakati o'zgarmaydi.

/** bot.ts'dan kerak bo'ladigan minimal Bot API (node-telegram-bot-api). */
export interface AiBotApi {
  sendMessage(chatId: number | string, text: string, opts?: any): Promise<any>;
  answerCallbackQuery(id: string, opts?: any): Promise<any>;
  editMessageText?(text: string, opts?: any): Promise<any>;
  editMessageReplyMarkup?(markup: any, opts?: any): Promise<any>;
  deleteMessage?(chatId: number | string, messageId: number): Promise<any>;
  getMe?(): Promise<any>;
}

let botInstance: AiBotApi | null = null;

/** bot.ts modul oxirida chaqiradi. */
export function registerBotInstance(bot: AiBotApi): void { botInstance = bot; }
export function getBotInstance(): AiBotApi | null { return botInstance; }

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
export function aiBotCommandOf(text: unknown): AiBotCommand | null {
  if (typeof text !== 'string') return null;
  const m = /^\/([a-z]+)(@\w+)?(\s|$)/i.exec(text);
  if (!m) return null;
  const name = m[1].toLowerCase();
  return AI_BOT_COMMANDS.find((c) => c.command === name)?.kind ?? null;
}

/** "/ai" yoki "/ai@BotName" (ixtiyoriy matn bilan). */
export function isAiCommand(text: unknown): boolean {
  return aiBotCommandOf(text) === 'ai';
}

// ───────────── P4 to'ldiradigan ilgaklar (STUB) ─────────────

export interface AiMessageEnv {
  /** /ai yoki /jadval'ga kirishda boshqa barcha kutilayotgan holatlarni (chat, chiqim, joylashuv…) tozalaydi. */
  clearOtherStates: () => void;
  /** Xabar AI buyrug'imi (/ai yoki /jadval). */
  isCommand: boolean;
  /** Qaysi buyruq: 'ai' — AI rejimi, 'schedule' — ish jadvali menyusi; oddiy xabar — null. */
  command: AiBotCommand | null;
}

/**
 * ai:* callback (attendance ai:a:, reminder ai:r:, confirm ai:x:, consent ai:o:). true — qayta ishlandi.
 * P4: chat.type==='private', from.id===chatId, yozuv shu xodim/firmaga bog'liq, token muddati, atomik o'tish.
 */
export async function aiBotCallbackHook(_query: any, _user: any, _lang: string | undefined): Promise<boolean> {
  return false; // STUB (P4)
}

/** AI rejimidagi xabar (matn/ovoz). true — qayta ishlandi. */
export async function aiBotMessageHook(_msg: any, _user: any, _lang: string | undefined, _env: AiMessageEnv): Promise<boolean> {
  return false; // STUB (P4)
}

/**
 * Chat AI ilgagi qo'lidami: AI rejimi (botAiModeUntil > now) YOKI P4'ning o'z matn kutishi (masalan
 * jadval menyusida sana kiritish). SINXRON — har xabarda DB so'rovi bo'lmasin; P4 xotira keshini
 * yuritadi (ishga tushishda DB'dan isitadi).
 */
export function aiBotInAiMode(_chatId: number): boolean {
  return false; // STUB (P4)
}

/** /res yoki boshqa oqimga o'tish — AI rejimi va AI kutish holatlari tozalanadi. */
export function aiBotResetChat(_chatId: number): void {
  // STUB (P4)
}

// ───────────── bot.ts chaqiradigan dispatch'lar ─────────────

/**
 * callback_query: obuna darvozasidan KEYIN, 'subcheck'dan OLDIN chaqiriladi.
 * ai:* bo'lmasa false (bot.ts davom etadi). ai:* bo'lsa DOIM true — ilgak ishlamasa ham javob beriladi,
 * shuning uchun ai:* ma'lumot hech qachon confirm_<txId> catch-all'iga yetib bormaydi.
 */
export async function dispatchAiCallback(
  query: any, user: any, lang: string | undefined,
  answer: (queryId: string) => Promise<unknown> = (id) => botInstance?.answerCallbackQuery(id) ?? Promise.resolve(),
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
