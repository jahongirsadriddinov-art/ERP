import type { AiBotApi } from './instance';
import { getCompanyAiState, isAiActive } from '../settings';
import { isObjectIdString } from '../lib/ids';
import { ta } from './i18n';

// ai:* callback'lar uchun umumiy xavfsizlik tekshiruvlari (review B5) va callback_data formatlari.
// Bot obyekti DI orqali (botHooks.getBotInstance) — bu fayl bot.ts'ni import qilmaydi.

/** Telegram callback_data chegarasi — bayt (UTF-8) bo'yicha. */
export const CALLBACK_DATA_MAX_BYTES = 64;
export const callbackBytes = (s: string) => Buffer.byteLength(s, 'utf8');
export const callbackFits = (s: string) => typeof s === 'string' && s.length > 0 && callbackBytes(s) <= CALLBACK_DATA_MAX_BYTES;

export type AttendanceChoice = 'c' | 'l' | 'd';
export const ATT_TOKEN_RE = /^[A-Za-z0-9]{8,32}$/;
export const CONFIRM_TOKEN_RE = /^[A-Za-z0-9]{10,40}$/;

export const attendanceData = (token: string, choice: AttendanceChoice) => `ai:a:${token}:${choice}`;
export const reminderData = (reminderId: string, action: 'd' | 's') => `ai:r:${reminderId}:${action}`;
export const consentData = (token: string, v: 'y' | 'n') => `ai:o:${token}:${v}`;
export const confirmData = (token: string, v: 'y' | 'n') => `ai:x:${token}:${v}`;
export const AI_MODE_EXIT_DATA = 'ai:m:x';

/** Davomat tugmalari (uchtasi alohida qatorda — uzun matnlar). */
export function attendanceKeyboard(token: string, lang: unknown): { text: string; callback_data: string }[][] {
  return [
    [{ text: ta(lang, 'attBtnConfirm'), callback_data: attendanceData(token, 'c') }],
    [{ text: ta(lang, 'attBtnLate'), callback_data: attendanceData(token, 'l') }],
    [{ text: ta(lang, 'attBtnDecline'), callback_data: attendanceData(token, 'd') }],
  ];
}

export function reminderKeyboard(reminderId: string, lang: unknown): { text: string; callback_data: string }[][] {
  return [[
    { text: ta(lang, 'remBtnDone'), callback_data: reminderData(reminderId, 'd') },
    { text: ta(lang, 'remBtnSnooze'), callback_data: reminderData(reminderId, 's') },
  ]];
}

export function confirmKeyboard(token: string, lang: unknown): { text: string; callback_data: string }[][] {
  return [[
    { text: ta(lang, 'pendingYes'), callback_data: confirmData(token, 'y') },
    { text: ta(lang, 'pendingNo'), callback_data: confirmData(token, 'n') },
  ]];
}

export interface CallbackActor {
  userId: string;
  companyId: string;
  role: string;
  isOwner: boolean;
  lang: string | undefined;
  chatId: number;
  fromId: string;
  messageId?: number;
}

/**
 * Callback kim tomonidan va qayerdan bosildi: faqat shaxsiy chat, from.id === chat.id, foydalanuvchi
 * (bot.ts telegramChatId bo'yicha topgan) mavjud, bloklanmagan, dasturchi emas va firmasi bor.
 * Mos kelmasa null — chaqiruvchi jim javob beradi (ma'lumot oshkor qilinmaydi).
 */
export function callbackActor(query: any, user: any): CallbackActor | null {
  const chat = query?.message?.chat;
  if (!chat || chat.type !== 'private') return null;
  const chatId = chat.id;
  const fromId = query?.from?.id;
  if (fromId === undefined || fromId === null || String(fromId) !== String(chatId)) return null;
  if (!user || !user._id || user.isBlocked) return null;
  if (user.telegramChatId !== undefined && user.telegramChatId !== null && String(user.telegramChatId) !== String(chatId)) return null;
  if (user.role === 'dasturchi') return null;
  const companyId = user.companyId ? String(user.companyId) : '';
  if (!isObjectIdString(companyId)) return null;
  return {
    userId: String(user._id), companyId, role: String(user.role || ''), isOwner: !!user.isOwner,
    lang: user.language, chatId: Number(chatId), fromId: String(fromId), messageId: query?.message?.message_id,
  };
}

/** AI shu firma uchun to'liq yoqilganmi (env + tarif + firma faol + sozlama). */
export const aiActiveFor = (companyId: string) => isAiActive(companyId).catch(() => false);

/** Firma AI funksiyasiga ega va faolmi (sozlamadagi enabled'dan qat'i nazar — /jadval AI'ni yoqishi uchun). */
export async function companyAllowsAi(companyId: string): Promise<boolean> {
  const st = await getCompanyAiState(companyId).catch(() => null);
  return !!(st && st.exists && st.active && st.hasFeature);
}

/** Callback'ga javob (xato yutiladi — "query is too old"). */
export async function answer(bot: AiBotApi | null, queryId: unknown, text?: string, alert = false): Promise<void> {
  if (!bot) return;
  await bot.answerCallbackQuery(String(queryId || ''), text ? { text: text.slice(0, 190), show_alert: alert } : undefined).catch(() => undefined);
}

/** Xabardagi inline tugmalarni olib tashlash (ixtiyoriy matn qo'shib). */
export async function closeButtons(bot: AiBotApi | null, a: CallbackActor, query: any, appendLine?: string): Promise<void> {
  if (!bot || !a.messageId) return;
  const old = typeof query?.message?.text === 'string' ? query.message.text : '';
  if (appendLine && old && bot.editMessageText) {
    const ok = await bot.editMessageText(`${old}\n\n${appendLine}`.slice(0, 4000), { chat_id: a.chatId, message_id: a.messageId, reply_markup: { inline_keyboard: [] } })
      .then(() => true).catch(() => false);
    if (ok) return;
  }
  await bot.editMessageReplyMarkup?.({ inline_keyboard: [] }, { chat_id: a.chatId, message_id: a.messageId }).catch(() => undefined);
}
