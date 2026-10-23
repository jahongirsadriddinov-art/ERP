import { formatChannelPost } from './channel';
import { decorateMessage, ensureBotUiLoaded } from '../../services/botUi/runtime';

// SMM → Telegram (owner 2026-10-23): kanalga tayyor format — parse_mode HTML, qalin sarlavha, paragraflar, heshteglar oxirida,
// ixtiyoriy "🌐 sayt" tugmasi, premium (custom) emoji — bot xabarlaridagi kabi (Bot dizayni: emoji xaritasi, paketlar,
// ma'no bo'yicha boshlang'ich emoji). Telegram premium emojini rad etsa — xuddi shu post oddiy emoji bilan qayta yuboriladi.
// Rasm/video FAYL sifatida (multipart — fayl serverda saqlanmaydi). Caption ≤1024: sig'masa —
// rasm qisqa caption bilan, to'liq matn keyingi xabarda (javob sifatida, tugma shu xabarda).

export const TG_CAPTION_MAX = 1024;
export interface TgFile { data: Buffer; mime: string }
export interface TgSendResult { messageId: number; url?: string; premium: 'used' | 'rejected' | 'none'; premiumError?: string }
export interface TgButton { text: string; url: string }
export class TgError extends Error { constructor(public code: string, public detail = '', public http = 0) { super(code); } }

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
    throw new TgError(/not enough rights|chat_write_forbidden|need administrator/i.test(d) ? 'tg_bot_not_admin' : /chat not found/i.test(d) ? 'tg_chat_not_found' : 'telegram_failed', d, res.status);
  }
  return json.result;
}

const fileName = (f: TgFile, i: number) => `smm-${i}.${f.mime === 'video/mp4' ? 'mp4' : f.mime === 'video/webm' ? 'webm' : f.mime === 'image/png' ? 'png' : 'jpg'}`;
const isVideo = (f: TgFile) => f.mime.startsWith('video/');
const markup = (b?: TgButton) => (b ? { inline_keyboard: [[{ text: b.text, url: b.url }]] } : undefined);

/** Post yuborish (HTML). Qaytaradi: birinchi xabar ID'si, havolasi va premium emoji holati. */
export async function tgSendPost(o: {
  token: string; chat: string; username?: string; item: { title?: string; text?: string; hashtags?: string[] }; files: TgFile[]; button?: TgButton; premium?: boolean;
}): Promise<TgSendResult> {
  const files = o.files.slice(0, 10);
  const post = formatChannelPost(o.item, files.length ? TG_CAPTION_MAX : 4096);
  const rm = markup(o.button);
  let premium = o.premium !== false;
  if (premium) await ensureBotUiLoaded().catch(() => undefined);
  let used = false;
  let rejected: string | undefined;
  /** Premium emoji bilan bezash (Bot dizayni sozlamalari) — o'zgarsa "used". */
  const dec = (html: string) => {
    if (!premium) return html;
    const d = decorateMessage(html, { parse_mode: 'HTML' }).text;
    if (typeof d === 'string' && d !== html) { used = true; return d; }
    return html;
  };
  /** Bezakli variant 400 bilan rad etilsa — oddiy emoji bilan qayta (va keyingi xabarlar ham oddiy). */
  const send = async (method: string, build: (h: (s: string) => string) => FormData | Record<string, unknown>) => {
    const before = used;
    used = false;
    const body = build(dec);
    const decorated = used;
    used = before || decorated;
    if (!decorated) return call(o.token, method, body);
    try { return await call(o.token, method, body); } catch (e) {
      if (!(e instanceof TgError) || e.http !== 400) throw e;
      premium = false;
      rejected = e.detail;
      used = before;
      return call(o.token, method, build((x) => x));
    }
  };
  let first: number;
  if (!files.length) {
    const r = await send('sendMessage', (h) => ({ chat_id: o.chat, text: h(post.captionHtml), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(rm && !post.restHtml ? { reply_markup: rm } : {}) }));
    first = r.message_id;
    if (post.restHtml) await send('sendMessage', (h) => ({ chat_id: o.chat, text: h(post.restHtml!), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(rm ? { reply_markup: rm } : {}) }));
  } else {
    // Tugma: matn bitta xabarga sig'sa — rasmning o'zida; aks holda keyingi (to'liq matnli) xabarda. Albomga tugma qo'yib bo'lmaydi.
    const buttonOnMedia = !post.restHtml && files.length === 1 && rm;
    if (files.length === 1) {
      const f = files[0];
      const r = await send(isVideo(f) ? 'sendVideo' : 'sendPhoto', (h) => {
        const fd = new FormData();
        fd.set('chat_id', o.chat);
        fd.set('caption', h(post.captionHtml));
        fd.set('parse_mode', 'HTML');
        fd.set(isVideo(f) ? 'video' : 'photo', new Blob([new Uint8Array(f.data)], { type: f.mime }), fileName(f, 0));
        if (isVideo(f)) fd.set('supports_streaming', 'true');
        if (buttonOnMedia) fd.set('reply_markup', JSON.stringify(rm));
        return fd;
      });
      first = r.message_id;
    } else {
      const r = await send('sendMediaGroup', (h) => {
        const fd = new FormData();
        fd.set('chat_id', o.chat);
        fd.set('media', JSON.stringify(files.map((f, i) => ({ type: isVideo(f) ? 'video' : 'photo', media: `attach://f${i}`, ...(i === 0 ? { caption: h(post.captionHtml), parse_mode: 'HTML' } : {}) }))));
        files.forEach((f, i) => fd.set(`f${i}`, new Blob([new Uint8Array(f.data)], { type: f.mime }), fileName(f, i)));
        return fd;
      });
      first = Array.isArray(r) ? r[0]?.message_id : r?.message_id;
    }
    if (post.restHtml) {
      await send('sendMessage', (h) => ({
        chat_id: o.chat, text: h(post.restHtml!), parse_mode: 'HTML', link_preview_options: { is_disabled: true },
        reply_parameters: { message_id: first, allow_sending_without_reply: true }, ...(rm ? { reply_markup: rm } : {}),
      }));
    }
  }
  return { messageId: first, url: tgMessageUrl(o.chat, first, o.username), premium: rejected ? 'rejected' : used ? 'used' : 'none', ...(rejected ? { premiumError: rejected } : {}) };
}
