// SMM → Telegram (owner 2026-10-23): rasm/video FAYL sifatida yuboriladi (multipart — fayl serverda saqlanmaydi).
// Caption chegarasi 1024 belgi: uzun matn → rasm qisqa caption (sarlavha) bilan + to'liq matn keyingi xabarda (javob sifatida).

export const TG_CAPTION_MAX = 1024;
export interface TgFile { data: Buffer; mime: string }
export interface TgSendResult { messageId: number; url?: string }
export class TgError extends Error { constructor(public code: string, public detail = '') { super(code); } }

/** Kanal/xabar havolasi: @username → t.me/username/ID; -100… → t.me/c/…/ID (a'zolar uchun). */
export function tgMessageUrl(chat: string, messageId: number): string | undefined {
  if (!messageId) return undefined;
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
  if (!res.ok || !json?.ok) throw new TgError('telegram_failed', String(json?.description || `HTTP ${res.status}`).slice(0, 200));
  return json.result;
}

const fileName = (f: TgFile, i: number) => `smm-${i}.${f.mime === 'video/mp4' ? 'mp4' : f.mime === 'video/webm' ? 'webm' : f.mime === 'image/png' ? 'png' : 'jpg'}`;
const isVideo = (f: TgFile) => f.mime.startsWith('video/');

/** Matn (+ ixtiyoriy fayllar) yuborish. Qaytaradi: birinchi xabar ID'si va havolasi. */
export async function tgSendPost(o: { token: string; chat: string; text: string; title?: string; files: TgFile[] }): Promise<TgSendResult> {
  const text = o.text.trim();
  const files = o.files.slice(0, 10);
  if (!files.length) {
    const r = await call(o.token, 'sendMessage', { chat_id: o.chat, text: text.slice(0, 4096), disable_web_page_preview: true });
    return { messageId: r.message_id, url: tgMessageUrl(o.chat, r.message_id) };
  }
  const fits = text.length <= TG_CAPTION_MAX;
  const caption = fits ? text : (o.title || text).slice(0, TG_CAPTION_MAX);
  let first: number;
  if (files.length === 1) {
    const f = files[0];
    const fd = new FormData();
    fd.set('chat_id', o.chat);
    fd.set('caption', caption);
    const field = isVideo(f) ? 'video' : 'photo';
    fd.set(field, new Blob([new Uint8Array(f.data)], { type: f.mime }), fileName(f, 0));
    if (isVideo(f)) fd.set('supports_streaming', 'true');
    const r = await call(o.token, isVideo(f) ? 'sendVideo' : 'sendPhoto', fd);
    first = r.message_id;
  } else {
    const fd = new FormData();
    fd.set('chat_id', o.chat);
    fd.set('media', JSON.stringify(files.map((f, i) => ({ type: isVideo(f) ? 'video' : 'photo', media: `attach://f${i}`, ...(i === 0 ? { caption } : {}) }))));
    files.forEach((f, i) => fd.set(`f${i}`, new Blob([new Uint8Array(f.data)], { type: f.mime }), fileName(f, i)));
    const r = await call(o.token, 'sendMediaGroup', fd);
    first = Array.isArray(r) ? r[0]?.message_id : r?.message_id;
  }
  if (!fits) {
    await call(o.token, 'sendMessage', { chat_id: o.chat, text: text.slice(0, 4096), disable_web_page_preview: true, reply_parameters: { message_id: first, allow_sending_without_reply: true } });
  }
  return { messageId: first, url: tgMessageUrl(o.chat, first) };
}
