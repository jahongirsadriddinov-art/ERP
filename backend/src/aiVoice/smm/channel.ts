import { SmmSettings } from '../../models/Smm';

// Telegram kanal (owner 2026-10-23: "postlar KANALGA chiqsin, bot chatiga emas"). Kanal UI'dan ulanadi (env shart emas):
// dasturchi @username yoki -100… id kiritadi → Bot API bilan tekshiriladi (getMe, getChat — kanal, getChatMember — bot admin va
// "Xabar joylash" huquqi bor) → DB'da saqlanadi va env AGENT_TG_CHANNEL_ID'dan ustun turadi.
// Formatlash: parse_mode HTML, qalin sarlavha, o'qiladigan paragraflar, heshteglar oxirida, ixtiyoriy "🌐 sayt" tugmasi.
// Premium emoji kanal postlariga qo'llanmaydi (bot egasining premiumi faqat bot xabarlarida) — oddiy emoji.

const env = (k: string) => (process.env[k] || '').trim();
export const SITE_BUTTON_URL = () => env('SMM_SITE_URL') || 'https://erp-firma.uz';
export const siteButtonLabel = (url: string) => `🌐 ${url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

export class TgVerifyError extends Error { constructor(public code: string, public detail = '') { super(code); } }

let cache: { at: number; v: ChannelCfg } | null = null;
export interface ChannelCfg { chat: string; username?: string; title?: string; source: 'db' | 'env' | 'none'; siteButton: boolean }
export function __resetChannelCacheForTests() { cache = null; botCache = null; }
export function invalidateChannelCache() { cache = null; }

/** Amaldagi kanal: DB (UI'dan ulangan) → env AGENT_TG_CHANNEL_ID → yo'q. 15 s kesh. */
export async function channelConfig(): Promise<ChannelCfg> {
  if (cache && Date.now() - cache.at < 15_000) return cache.v;
  const s: any = await SmmSettings.findOne({ key: 'global' }).select('tgChannelId tgChannelUsername tgChannelTitle tgSiteButton').lean().catch(() => null);
  const siteButton = s?.tgSiteButton !== false;
  let v: ChannelCfg;
  if (s?.tgChannelId) v = { chat: String(s.tgChannelId), username: s.tgChannelUsername || undefined, title: s.tgChannelTitle || undefined, source: 'db', siteButton };
  else if (env('AGENT_TG_CHANNEL_ID')) {
    const c = env('AGENT_TG_CHANNEL_ID');
    v = { chat: c, username: /^@\w+$/.test(c) ? c.slice(1) : undefined, source: 'env', siteButton };
  } else v = { chat: '', source: 'none', siteButton };
  cache = { at: Date.now(), v };
  return v;
}

async function bot(method: string, token: string, body: Record<string, unknown>): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new TgVerifyError('tg_unreachable'); }
  const j: any = await res.json().catch(() => ({}));
  if (!j?.ok) {
    const d = String(j?.description || `HTTP ${res.status}`).slice(0, 200);
    if (/chat not found|username_invalid|USERNAME_NOT_OCCUPIED/i.test(d)) throw new TgVerifyError('tg_chat_not_found', d);
    if (/not enough rights|member list is inaccessible|forbidden|not a member|bot is not a member|kicked/i.test(d)) throw new TgVerifyError('tg_bot_not_admin', d);
    if (res.status === 401) throw new TgVerifyError('tg_bot_missing', d);
    throw new TgVerifyError('tg_failed', d);
  }
  return j.result;
}

let botCache: { at: number; token: string; v: { id: number; username: string } } | null = null;
export async function botInfo(token: string): Promise<{ id: number; username: string } | null> {
  if (!token) return null;
  if (botCache && botCache.token === token && Date.now() - botCache.at < 10 * 60_000) return botCache.v;
  try {
    const me = await bot('getMe', token, {});
    botCache = { at: Date.now(), token, v: { id: Number(me.id), username: String(me.username || '') } };
    return botCache.v;
  } catch { return null; }
}

/** Kanalni tekshirib saqlash. Qaytaradi: kanal nomi/username. */
export async function verifyAndSaveChannel(raw: unknown, token: string, by: string): Promise<{ id: string; username?: string; title: string }> {
  if (!token) throw new TgVerifyError('tg_bot_missing');
  let input = typeof raw === 'string' ? raw.trim() : '';
  const m = /^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,})\/?$/.exec(input);
  if (m) input = `@${m[1]}`;
  if (/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(input)) input = `@${input}`;
  if (!/^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(input) && !/^-100\d{5,}$/.test(input)) throw new TgVerifyError('tg_channel_invalid');
  const me = await bot('getMe', token, {});
  const chat = await bot('getChat', token, { chat_id: input });
  if (chat?.type !== 'channel') throw new TgVerifyError('tg_not_channel', String(chat?.type || ''));
  const mem = await bot('getChatMember', token, { chat_id: chat.id, user_id: me.id });
  if (mem?.status !== 'administrator' && mem?.status !== 'creator') throw new TgVerifyError('tg_bot_not_admin', String(mem?.status || ''));
  if (mem.status === 'administrator' && mem.can_post_messages === false) throw new TgVerifyError('tg_no_post_right');
  const v = { id: String(chat.id), username: chat.username ? String(chat.username) : undefined, title: String(chat.title || chat.username || chat.id).slice(0, 120) };
  await SmmSettings.updateOne({ key: 'global' }, {
    $set: { tgChannelId: v.id, tgChannelUsername: v.username || '', tgChannelTitle: v.title, tgChannelCheckedAt: new Date(), updatedBy: by },
  }, { upsert: true });
  cache = null;
  return v;
}

export async function removeChannel(by: string): Promise<void> {
  await SmmSettings.updateOne({ key: 'global' }, { $unset: { tgChannelId: 1, tgChannelUsername: 1, tgChannelTitle: 1, tgChannelCheckedAt: 1 }, $set: { updatedBy: by } }, { upsert: true });
  cache = null;
}

// ───────────── Kanal uchun formatlash (HTML) ─────────────
export const escHtml = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Matnni o'qiladigan paragraflarga bo'lish: bo'sh qatorlar saqlanadi; bitta uzun paragraf — har 2 gapdan keyin. */
export function paragraphs(text: string): string[] {
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  const parts = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 || t.length <= 320 || t.includes('\n')) return parts.length ? parts : [t];
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ0-9«"'🔹✅👉📌💡🚀⚡])/u);
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) out.push(sentences.slice(i, i + 2).join(' '));
  return out;
}

export interface ChannelPost { html: string; captionHtml: string; restHtml?: string; plainLength: number }
/** Kanal posti: <b>sarlavha</b>, paragraflar, heshteglar oxirida. caption ≤1024 (ko'rinadigan belgilar) — sig'masa, rasmga qisqa
 *  caption (sarlavha + birinchi paragraf, sig'sa) va to'liq matn keyingi xabarda. */
export function formatChannelPost(it: { title?: string; text?: string; hashtags?: string[] }, captionMax = 1024): ChannelPost {
  const title = String(it.title || '').trim();
  const paras = paragraphs(String(it.text || ''));
  const tags = (it.hashtags || []).filter((h) => /^#\S+$/.test(h)).slice(0, 30).join(' ');
  const blocks = [title ? `<b>${escHtml(title)}</b>` : '', ...paras.map(escHtml), tags ? escHtml(tags) : ''].filter(Boolean);
  const plain = [title, ...paras, tags].filter(Boolean).join('\n\n');
  const html = blocks.join('\n\n');
  if (plain.length <= captionMax) return { html, captionHtml: html, plainLength: plain.length };
  // sig'madi: caption = sarlavha (+ birinchi paragraf sig'sa); keyingi xabar — qolgan matn + heshteglar
  const first = paras[0] || '';
  const withFirst = title ? (title.length + 2 + first.length) <= captionMax : first.length <= captionMax;
  const captionHtml = title
    ? (withFirst ? `<b>${escHtml(title)}</b>\n\n${escHtml(first)}` : `<b>${escHtml(title.slice(0, captionMax - 1))}</b>`)
    : (withFirst ? escHtml(first) : `${escHtml(first.slice(0, captionMax - 2))}…`);
  const rest = [...(withFirst ? paras.slice(1) : paras), tags].filter(Boolean);
  const restHtml = rest.map(escHtml).join('\n\n').slice(0, 4000);
  return { html, captionHtml, restHtml: restHtml || undefined, plainLength: plain.length };
}
