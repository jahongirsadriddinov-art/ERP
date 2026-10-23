import { formatChannelPost } from './channel';

// SMM → Telegram (owner 2026-10-23): kanalga tayyor format — parse_mode HTML, qalin sarlavha, paragraflar, heshteglar oxirida,
// ixtiyoriy "🌐 sayt" tugmasi. Rasm/video FAYL sifatida (multipart — fayl serverda saqlanmaydi). Caption ≤1024: sig'masa —
// rasm qisqa caption bilan, to'liq matn keyingi xabarda (javob sifatida, tugma shu xabarda).

export const TG_CAPTION_MAX = 1024;
export interface TgFile { data: Buffer; mime: string }
export interface TgSendResult { messageId: number; url?: string }
export interface TgButton { text: string; url: string }
export class TgError extends Error { constructor(public code: string, public detail = '') { super(code); } }

/** Kanal/xabar havolasi: @username → t.me/username/ID; -100… → t.me/c/…/ID (a'zolar uchun). */
export function tgMessageUrl(chat: string, messageId: number, username?: string): string | undefined {
  if (!messageId) return undefined;
  if (username && /^[A-Za-z0-9_]{4,}$/.test(username)) return `https://t.me/${username}/${messageId}`;
  if (/^@[A-Za-z0-9_]{4,}$/.test(chat)) return `https://t.me/${chat.slice(1)}/${messageId}`;
  if (/^-100\d+$/.test(chat)) return `https://t.me/c/${chat.slice(4)}/${messageId}`;
  return undefined;
}

async function call(token: string, method: string, body: FormData | Record<string, unknown>): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new TgError('telegram_failed', "Telegram'ga ulanib bo'lmadi");
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const d = String(json?.description || `HTTP ${res.status}`).slice(0, 200);
    throw new TgError(/not enough rights|chat_write_forbidden|need administrator/i.test(d) ? 'tg_bot_not_admin' : /chat not found/i.test(d) ? 'tg_chat_not_found' : 'telegram_failed', d);
  }
  return json.result;
}

const fileName = (f: TgFile, i: number) => `smm-${i}.${f.mime === 'video/mp4' ? 'mp4' : f.mime === 'video/webm' ? 'webm' : f.mime === 'image/png' ? 'png' : 'jpg'}`;
const isVideo = (f: TgFile) => f.mime.startsWith('video/');
const markup = (b?: TgButton) => (b ? { inline_keyboard: [[{ text: b.text, url: b.url }]] } : undefined);

/** Post yuborish (HTML). Qaytaradi: birinchi xabar ID'si va havolasi. */
export async function tgSendPost(o: {
  token: string; chat: string; username?: string; item: { title?: string; text?: string; hashtags?: string[] }; files: TgFile[]; button?: TgButton;
}): Promise<TgSendResult> {
  const files = o.files.slice(0, 10);
  const post = formatChannelPost(o.item, files.length ? TG_CAPTION_MAX : 4096);
  const rm = markup(o.button);
  if (!files.length) {
    const r = await call(o.token, 'sendMessage', { chat_id: o.chat, text: post.captionHtml, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(rm && !post.restHtml ? { reply_markup: rm } : {}) });
    if (post.restHtml) await call(o.token, 'sendMessage', { chat_id: o.chat, text: post.restHtml, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(rm ? { reply_markup: rm } : {}) });
    return { messageId: r.message_id, url: tgMessageUrl(o.chat, r.message_id, o.username) };
  }
  let first: number;
  // Tugma: matn bitta xabarga sig'sa — rasmning o'zida; aks holda keyingi (to'liq matnli) xabarda. Albomga tugma qo'yib bo'lmaydi.
  const buttonOnMedia = !post.restHtml && files.length === 1 && rm;
  if (files.length === 1) {
    const f = files[0];
    const fd = new FormData();
    fd.set('chat_id', o.chat);
    fd.set('caption', post.captionHtml);
    fd.set('parse_mode', 'HTML');
    const field = isVideo(f) ? 'video' : 'photo';
    fd.set(field, new Blob([new Uint8Array(f.data)], { type: f.mime }), fileName(f, 0));
    if (isVideo(f)) fd.set('supports_streaming', 'true');
    if (buttonOnMedia) fd.set('reply_markup', JSON.stringify(rm));
    const r = await call(o.token, isVideo(f) ? 'sendVideo' : 'sendPhoto', fd);
    first = r.message_id;
  } else {
    const fd = new FormData();
    fd.set('chat_id', o.chat);
    fd.set('media', JSON.stringify(files.map((f, i) => ({ type: isVideo(f) ? 'video' : 'photo', media: `attach://f${i}`, ...(i === 0 ? { caption: post.captionHtml, parse_mode: 'HTML' } : {}) }))));
    files.forEach((f, i) => fd.set(`f${i}`, new Blob([new Uint8Array(f.data)], { type: f.mime }), fileName(f, i)));
    const r = await call(o.token, 'sendMediaGroup', fd);
    first = Array.isArray(r) ? r[0]?.message_id : r?.message_id;
  }
  if (post.restHtml) {
    await call(o.token, 'sendMessage', {
      chat_id: o.chat, text: post.restHtml, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      reply_parameters: { message_id: first, allow_sending_without_reply: true }, ...(rm ? { reply_markup: rm } : {}),
    });
  }
  return { messageId: first, url: tgMessageUrl(o.chat, first, o.username) };
}
