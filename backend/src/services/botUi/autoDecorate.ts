// "AI bilan bezash": qo'shilgan emoji paketlaridan har bir tugma/xabar emojisi uchun mos premium emoji
// va tugma rangini (style) tanlaydi. Natija — QORALAMA (draft): dasturchi ko'rib chiqib "Qo'llash" bosadi.
// AI (Gemini) ishlamasa — oddiy emoji mosligi va kalit so'zlar bo'yicha tanlanadi.
import type { BotButtonStyle, BotEmojiPack, BotUiDraft } from '../../models/BotUiConfig';
import { BOT_UI_CATALOG, messageEmojiCandidates, type BotUiCatalogItem } from './catalog';
import { MESSAGE_KINDS, MESSAGE_KIND_KEYS } from './messageKinds';

type Sticker = { id: string; emoji: string };
type AiFn = (prompt: string) => Promise<any>;

const STYLES = new Set(['primary', 'success', 'danger']);
const vs = (s: string) => String(s || '').replace(/️/g, '');
const LEAD = /^\p{Extended_Pictographic}️?/u;

// Ma'nosi yaqin oddiy emoji guruhlari (paketda aynan shu emoji bo'lmasa — o'xshashi olinadi)
const SYNONYMS: string[][] = [
  ['✅', '✔', '☑', '👍', '🆗', '💚'],
  ['❌', '✖', '🚫', '⛔', '🛑', '❎', '🔴'],
  ['🟢', '✅', '💚', '▶'],
  ['💰', '💵', '💸', '🤑', '💲', '🪙', '💳'],
  ['💳', '💰', '💵'],
  ['💬', '🗨', '💭', '📨', '✉'],
  ['📋', '📝', '🗒', '📄', '📑'],
  ['📊', '📈', '📉', '🧮'],
  ['🏗', '🏢', '🏠', '🏘', '🧱', '🏛'],
  ['🏢', '🏗', '🏬', '🏛'],
  ['👥', '👤', '🧑‍🤝‍🧑', '👨‍👩‍👦'],
  ['📦', '🎁', '📥'],
  ['📤', '📨', '🚀'],
  ['📬', '📫', '📩', '💌'],
  ['➕', '✏', '🖊', '📝'],
  ['🧾', '📃', '📄'],
  ['🌐', '🌍', '🌏', '🔗'],
  ['📢', '📣', '🔊'],
  ['⚙', '🛠', '🔧'],
  ['🔄', '🔁', '♻'],
  ['🤖', '🧠', '✨'],
  ['📅', '🗓', '📆'],
  ['📱', '☎', '📞'],
  ['📍', '🗺', '🧭'],
  ['🔚', '🚪', '⏹', '🛑'],
  ['⏹', '🛑', '🔚'],
  ['◀', '⬅', '🔙', '↩'],
  ['🏷', '🔖'],
  ['✏', '🖊', '📝'],
  ['⏳', '⌛', '🕐'],
  ['⚠', '❗', '‼', '❕', '🚨', '📛'],
  ['❗', '‼', '⚠', '❕', '🚨'],
  ['❓', '❔', '🤔', '💭'],
  ['⏳', '⌛', '⏱', '🕐', '🔄', '⏰'],
  ['⌛', '⏳', '⏱'],
  ['⏰', '⏱', '🕐', '⏳'],
  ['🔔', '🔊', '📢', '📣'],
  ['👋', '🤝', '😊', '🙂'],
  ['ℹ', '💡', '📌', '📍', '🔹'],
  ['💡', 'ℹ', '✨'],
  ['📌', '📍', 'ℹ'],
  ['🔒', '🔐', '🔑', '🛡'],
  ['🔑', '🔐', '🔒'],
  ['🗑', '❌', '🚫'],
  ['📷', '📸', '🖼'],
  ['🎤', '🎙', '🔊'],
  ['📞', '☎', '📱'],
  ['🚀', '⚡', '✨'],
  ['⭐', '🌟', '✨'],
  ['🎉', '🥳', '🎊', '✨'],
  ['🔍', '🔎'],
  ['📁', '📂', '🗂'],
  ['👷', '👤', '👥'],
  ['🚚', '🚛', '📦'],
  ['💼', '📋', '🗂'],
];

export function pickByEmoji(base: string, stickers: Sticker[], used?: Set<string>): string | null {
  const b = vs(base);
  if (!b) return null;
  const exact = stickers.filter(s => vs(s.emoji).includes(b));
  const pick = (arr: Sticker[]) => (arr.find(s => !used?.has(s.id)) || arr[0])?.id || null;
  if (exact.length) return pick(exact);
  for (const group of SYNONYMS) {
    if (!group.some(g => vs(g) === b)) continue;
    for (const alt of group) {
      const hit = stickers.filter(s => vs(s.emoji).includes(vs(alt)));
      if (hit.length) return pick(hit);
    }
  }
  return null;
}

/** Tugma vazifasi bo'yicha rang (owner 2026-10-23: har bir tugmaga): bekor/o'chirish/orqaga → qizil,
 *  tasdiq/saqlash/kelish → yashil, qolgan hamma amal → ko'k. */
export function heuristicStyle(item: BotUiCatalogItem): BotButtonStyle {
  const k = item.key.toLowerCase();
  if (/\(danger\)/.test(item.meaning) || /cancel|reject|confirmno|disable|exit|end|back|checkout/.test(k)) return 'danger';
  if (/\(success\)/.test(item.meaning) || /confirm|accept|save|okbtn|enable|checkin/.test(k)) return 'success';
  if (/delete|remove|stop|logout|leave|no$/.test(k) || /o'chir|удал|выйти|chiqish/i.test(item.defaults.uz)) return 'danger';
  if (/approve|done|finish|yes$|pay/.test(k)) return 'success';
  return 'primary';
}

function allStickers(packs: BotEmojiPack[]): Sticker[] {
  const seen = new Set<string>();
  const out: Sticker[] = [];
  for (const p of packs) for (const s of p.stickers || []) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id); out.push({ id: s.id, emoji: s.emoji || '' });
  }
  return out;
}

export function keywordDraft(packs: BotEmojiPack[]): BotUiDraft {
  const stickers = allStickers(packs);
  const used = new Set<string>();
  const buttons: BotUiDraft['buttons'] = {};
  for (const item of BOT_UI_CATALOG) {
    const base = (LEAD.exec(item.defaults.uz) || [''])[0];
    const id = pickByEmoji(base, stickers, used);
    const style = heuristicStyle(item);
    if (id) used.add(id);
    if (id || style) buttons[item.key] = { ...(id ? { iconCustomEmojiId: id } : {}), ...(style ? { style } : {}) };
  }
  const messageEmoji: Record<string, string> = {};
  for (const e of messageEmojiCandidates()) {
    const id = pickByEmoji(e, stickers);
    if (id) messageEmoji[e] = id;
  }
  const prefix: Record<string, string> = {};
  for (const k of MESSAGE_KINDS) {
    const id = pickByEmoji(k.emoji, stickers);
    if (id) prefix[k.key] = id;
  }
  return { source: 'keywords', createdAt: new Date(), buttons, messageEmoji, prefix };
}

/** AI'ga yuboriladigan ro'yxat: har bir oddiy emoji uchun ko'pi bilan 3 ta variant, jami 300 — so'rov tez bo'lsin. */
export function compactStickers(stickers: Sticker[]): Sticker[] {
  const per = new Map<string, number>();
  const out: Sticker[] = [];
  for (const s of stickers) {
    const k = vs(s.emoji) || '?';
    const n = per.get(k) || 0;
    if (n >= 3) continue;
    per.set(k, n + 1); out.push(s);
    if (out.length >= 300) break;
  }
  return out;
}

export function buildPrompt(stickers: Sticker[], emojis: string[]): string {
  const btn = BOT_UI_CATALOG.map(i => `${i.key} | ${i.kind} | ${i.meaning} | ${i.defaults.uz}`).join('\n');
  const st = stickers.map(s => `${s.id} ${s.emoji}`).join('\n');
  return [
    'You decorate a Telegram bot of a construction-company ERP (Uzbek/Russian users).',
    'For EVERY button choose the single best custom emoji from EMOJIS (by meaning of the button and the emoji of each custom emoji),',
    'and a button style: "danger" (red) for cancel/reject/delete/disable/exit/back, "success" (green) for confirm/accept/save/enable/check-in,',
    '"primary" (blue) for every other action. EVERY button must get a style and, whenever anything fits, an icon. Prefer different emojis for different buttons.',
    'For every plain emoji in MESSAGE_EMOJIS choose the best matching custom emoji id (same or very close meaning).',
    'For every message KIND choose the custom emoji that best fits messages of that kind (it is put in front of messages that have no emoji).',
    'Answer ONLY JSON: {"buttons":{"<key>":{"icon":"<id or empty>","style":"primary|success|danger"}},"messages":{"<plain emoji>":"<id>"},"kinds":{"<kind key>":"<id>"}}',
    '',
    'BUTTONS (key | kind | meaning | current label):',
    btn,
    '',
    'EMOJIS (id emoji):',
    st,
    '',
    'MESSAGE_EMOJIS:',
    emojis.join(' '),
    '',
    'KINDS (key | meaning | typical emoji):',
    MESSAGE_KINDS.map(k => `${k.key} | ${k.meaning} | ${k.emoji}`).join('\n'),
  ].join('\n');
}

/** AI natijasini tekshiradi: faqat mavjud kalitlar, mavjud emoji id'lari, ruxsat etilgan style'lar. */
export function sanitizeAiResult(raw: any, stickers: Sticker[]): Pick<BotUiDraft, 'buttons' | 'messageEmoji' | 'prefix'> {
  const ids = new Set(stickers.map(s => s.id));
  const keys = new Set(BOT_UI_CATALOG.map(i => i.key));
  const buttons: BotUiDraft['buttons'] = {};
  for (const [k, v] of Object.entries<any>(raw?.buttons || {})) {
    if (!keys.has(k) || !v || typeof v !== 'object') continue;
    const icon = String(v.icon ?? v.iconCustomEmojiId ?? '');
    const style = String(v.style || '');
    const o: any = {};
    if (ids.has(icon)) o.iconCustomEmojiId = icon;
    if (STYLES.has(style)) o.style = style;
    if (Object.keys(o).length) buttons[k] = o;
  }
  const messageEmoji: Record<string, string> = {};
  for (const [e, id] of Object.entries<any>(raw?.messages || {})) {
    if (ids.has(String(id)) && /\p{Extended_Pictographic}/u.test(e) && e.length <= 8) messageEmoji[vs(e)] = String(id);
  }
  const prefix: Record<string, string> = {};
  for (const [k, id] of Object.entries<any>(raw?.kinds || {})) if (MESSAGE_KIND_KEYS.has(k) && ids.has(String(id))) prefix[k] = String(id);
  return { buttons, messageEmoji, prefix };
}

export async function autoDecorate(packs: BotEmojiPack[], ai: AiFn | null): Promise<BotUiDraft> {
  const stickers = compactStickers(allStickers(packs));
  if (!stickers.length) throw new Error('NO_PACKS');
  const fallback = keywordDraft(packs);
  if (!ai) return fallback;
  try {
    const raw = await ai(buildPrompt(stickers, messageEmojiCandidates()));
    const res = sanitizeAiResult(raw, stickers);
    if (!Object.keys(res.buttons).length) return { ...fallback, note: 'AI javobi bo\'sh — kalit so\'zlar bo\'yicha tanlandi' };
    // AI tanlamagan tugma/emoji'larni kalit so'z natijasi bilan to'ldiramiz
    const buttons = { ...res.buttons };
    for (const [k, v] of Object.entries(fallback.buttons)) buttons[k] = { ...v, ...(buttons[k] || {}) };
    return { source: 'ai', createdAt: new Date(), buttons, messageEmoji: { ...fallback.messageEmoji, ...res.messageEmoji }, prefix: { ...fallback.prefix, ...res.prefix } };
  } catch (e: any) {
    return { ...fallback, note: `AI xatosi: ${String(e?.message || e).slice(0, 120)} — kalit so'zlar bo'yicha tanlandi` };
  }
}
