// "AI bilan bezash": qo'shilgan emoji paketlaridan har bir tugma/xabar emojisi uchun mos premium emoji
// va tugma rangini (style) tanlaydi. Natija — QORALAMA (draft): dasturchi ko'rib chiqib "Qo'llash" bosadi.
// AI (Gemini) ishlamasa — oddiy emoji mosligi va kalit so'zlar bo'yicha tanlanadi.
import type { BotButtonStyle, BotEmojiPack, BotUiDraft } from '../../models/BotUiConfig';
import { BOT_UI_CATALOG, messageEmojiCandidates, type BotUiCatalogItem } from './catalog';

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
  ['⚠', '❗', '‼'],
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

/** Tugma vazifasi bo'yicha rang: bekor/o'chirish/orqaga → danger, tasdiq/saqlash → success, asosiy amal → primary. */
export function heuristicStyle(item: BotUiCatalogItem): BotButtonStyle | undefined {
  const k = item.key.toLowerCase();
  if (/\(danger\)/.test(item.meaning) || /cancel|reject|confirmno|disable|exit|end|back|checkout/.test(k)) return 'danger';
  if (/\(success\)/.test(item.meaning) || /confirm|accept|save|okbtn|enable|checkin/.test(k)) return 'success';
  if (['kb_addExpense', 'kb_dailyReport', 'kb_openSite', 'kb_pendingApprovals', 'subPayLinkBtn', 'ai_ai', 'kb_broadcast'].includes(item.key)) return 'primary';
  return undefined;
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
  return { source: 'keywords', createdAt: new Date(), buttons, messageEmoji };
}

export function buildPrompt(stickers: Sticker[], emojis: string[]): string {
  const btn = BOT_UI_CATALOG.map(i => `${i.key} | ${i.kind} | ${i.meaning} | ${i.defaults.uz}`).join('\n');
  const st = stickers.map(s => `${s.id} ${s.emoji}`).join('\n');
  return [
    'You decorate a Telegram bot of a construction-company ERP (Uzbek/Russian users).',
    'For EVERY button choose the single best custom emoji from EMOJIS (by meaning of the button and the emoji of each custom emoji),',
    'and a button style: "danger" (red) for cancel/reject/delete/disable/exit/back, "success" (green) for confirm/accept/save/enable/check-in,',
    '"primary" (blue) for the few main actions, or "" (default) for the rest. Use "" for icon if nothing fits. Prefer different emojis for different buttons.',
    'Also, for every plain emoji in MESSAGE_EMOJIS choose the best matching custom emoji id (same or very close meaning) or skip it.',
    'Answer ONLY JSON: {"buttons":{"<key>":{"icon":"<id or empty>","style":"primary|success|danger|"}},"messages":{"<plain emoji>":"<id>"}}',
    '',
    'BUTTONS (key | kind | meaning | current label):',
    btn,
    '',
    'EMOJIS (id emoji):',
    st,
    '',
    'MESSAGE_EMOJIS:',
    emojis.join(' '),
  ].join('\n');
}

/** AI natijasini tekshiradi: faqat mavjud kalitlar, mavjud emoji id'lari, ruxsat etilgan style'lar. */
export function sanitizeAiResult(raw: any, stickers: Sticker[]): Pick<BotUiDraft, 'buttons' | 'messageEmoji'> {
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
  return { buttons, messageEmoji };
}

export async function autoDecorate(packs: BotEmojiPack[], ai: AiFn | null): Promise<BotUiDraft> {
  const stickers = allStickers(packs).slice(0, 800);
  if (!stickers.length) throw new Error('NO_PACKS');
  const fallback = keywordDraft(packs);
  if (!ai) return fallback;
  try {
    const raw = await ai(buildPrompt(stickers, messageEmojiCandidates()));
    const res = sanitizeAiResult(raw, stickers);
    if (!Object.keys(res.buttons).length) return { ...fallback, note: 'AI javobi bo\'sh — kalit so\'zlar bo\'yicha tanlandi' };
    // AI tanlamagan tugma/emoji'larni kalit so'z natijasi bilan to'ldiramiz
    const buttons = { ...res.buttons };
    for (const [k, v] of Object.entries(fallback.buttons)) if (!buttons[k]) buttons[k] = v;
    return { source: 'ai', createdAt: new Date(), buttons, messageEmoji: { ...fallback.messageEmoji, ...res.messageEmoji } };
  } catch (e: any) {
    return { ...fallback, note: `AI xatosi: ${String(e?.message || e).slice(0, 120)} — kalit so'zlar bo'yicha tanlandi` };
  }
}
