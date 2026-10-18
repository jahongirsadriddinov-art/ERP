// Bot obyekti (node-telegram-bot-api) — DI: bot.ts modul oxirida registerBotInstance(bot) chaqiradi.
// Bu fayl (va butun aiVoice) bot.ts'ni HECH QACHON import qilmaydi (u tokensiz modul darajasida xato
// tashlaydi va sikl bo'lardi). botHooks.ts shu yerdan qayta eksport qiladi.

/** bot.ts'dan kerak bo'ladigan minimal Bot API. */
export interface AiBotApi {
  sendMessage(chatId: number | string, text: string, opts?: any): Promise<any>;
  answerCallbackQuery(id: string, opts?: any): Promise<any>;
  editMessageText?(text: string, opts?: any): Promise<any>;
  editMessageReplyMarkup?(markup: any, opts?: any): Promise<any>;
  deleteMessage?(chatId: number | string, messageId: number): Promise<any>;
  getMe?(): Promise<any>;
  /** Ovozli xabarni yuklab olish uchun (/ai rejimi). */
  getFileLink?(fileId: string): Promise<string>;
  sendChatAction?(chatId: number | string, action: string): Promise<any>;
  /** Kamera rasm/videosi (owner 2026-10-18): Buffer + fileOptions {filename, contentType}. */
  sendPhoto?(chatId: number | string, photo: any, opts?: any, fileOpts?: any): Promise<any>;
  sendVideo?(chatId: number | string, video: any, opts?: any, fileOpts?: any): Promise<any>;
}

let botInstance: AiBotApi | null = null;
const listeners: ((b: AiBotApi) => void)[] = [];

export function setBotInstance(bot: AiBotApi): void {
  botInstance = bot;
  for (const l of listeners) { try { l(bot); } catch { /* ilgak xatosi bot'ni buzmasin */ } }
}
export function getBotInstance(): AiBotApi | null { return botInstance; }
/** Bot ro'yxatga olinganda (masalan AI rejimi keshini DB'dan isitish). */
export function onBotRegistered(l: (b: AiBotApi) => void): void { listeners.push(l); }
