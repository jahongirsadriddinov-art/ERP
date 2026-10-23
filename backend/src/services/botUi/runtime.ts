// Bot dizayni — ish vaqtidagi qo'llash (services/bot.ts'dagi sendMessage/edit* o'ramlari shu yerni chaqiradi).
//
// Qanday ishlaydi:
//  • Klaviatura yasovchilar (ADMIN_KEYBOARD va h.k.) o'zgarmaydi — standart matnli tugma yasaydi.
//  • Yuborishdan oldin decorateMarkup() har bir tugma matnini katalogdagi standart matn bilan solishtirib,
//    kalitni topadi va dasturchi sozlamasini qo'llaydi: yangi matn, icon_custom_emoji_id, style.
//  • Foydalanuvchi o'zgartirilgan reply-tugmani bossa, botga YANGI matn keladi — canonicalizeIncomingText()
//    uni standart matnga qaytaradi (bot.processUpdate o'ramida), shu sabab bot.ts'dagi barcha solishtirishlar
//    (tb(lang,'kb_chat') === text, isMenuButtonText va h.k.) o'zgarishsiz ishlayveradi.
//  • Sozlama 60 s keshlanadi (saqlanganda darhol yangilanadi). Sinxron snapshot — processUpdate sinxron.
import BotUiConfig, { type BotButtonOverride, type BotButtonStyle } from '../../models/BotUiConfig';
import { BOT_UI_CATALOG, UI_LANGS, defaultLabel, type BotUiCatalogItem, type UiLang } from './catalog';
import { latinToCyrillicUz } from '../../utils/transliterate';
import { pickByEmoji } from './autoDecorate';
import { classifyMessage, markdownToHtml, MESSAGE_KIND_KEYS } from './messageKinds';

export const BOT_UI_CACHE_MS = 60_000;
const STYLES = new Set<BotButtonStyle>(['primary', 'success', 'danger']);

export interface BotUiSnapshot {
  buttons: Record<string, BotButtonOverride>;
  messageEmoji: Map<string, string>; // FE0F'siz emoji → custom_emoji_id
  messageEmojiEnabled: boolean;
  stripEmojiWhenIcon: boolean;
  /** qo'shilgan paketlardagi emojilar — xaritada yo'q oddiy emoji uchun ham mosi topiladi */
  stickers: { id: string; emoji: string }[];
  /** xabar turi (messageKinds) → custom_emoji_id: emojisiz xabar boshiga qo'yiladi */
  messagePrefix: Record<string, string>;
  messagePrefixEnabled: boolean;
}
const EMPTY: BotUiSnapshot = { buttons: {}, messageEmoji: new Map(), messageEmojiEnabled: true, stripEmojiWhenIcon: true, stickers: [], messagePrefix: {}, messagePrefixEnabled: true };
// oddiy emoji → paketdagi mos id (yoki null); snapshot almashganda tozalanadi
let resolved = new Map<string, string | null>();

let snap: BotUiSnapshot = EMPTY;
let loadedAt = 0;
let loading: Promise<void> | null = null;
let version = 0;

// standart matn → [{key, lang}] (bir xil matn bir nechta kalitda bo'lishi mumkin, masalan "✅ Tasdiqlash")
let defaultIndex: Map<string, { item: BotUiCatalogItem; lang: UiLang }[]> | null = null;
function getDefaultIndex() {
  if (!defaultIndex) {
    defaultIndex = new Map();
    // ru uz-cyrl'dan oldin: "💬 Чат" kabi ikkala tilda bir xil matn ruscha deb olinadi (ўқғҳ bo'lmasa farqlab bo'lmaydi)
    for (const item of BOT_UI_CATALOG) for (const lang of ['uz', 'ru', 'uz-cyrl'] as UiLang[]) {
      const t = defaultLabel(item, lang).trim();
      if (!t) continue;
      const arr = defaultIndex.get(t) || [];
      if (!arr.some(e => e.item.key === item.key)) arr.push({ item, lang });
      defaultIndex.set(t, arr);
    }
  }
  return defaultIndex;
}

// bot.ts dasturchi "⚙️ Tugmalarni sozlash" (AppSettings) orqali o'zgartirgan matnlar — ular ham bezalsin
type ExtraLabelSource = () => { text: string; key: string }[];
let extraSource: ExtraLabelSource | null = null;
export function registerExtraLabelSource(fn: ExtraLabelSource) { extraSource = fn; }

// bezalgan matn → asl matn (canonicalize uchun; server qayta ishga tushsa hisoblash yo'li bilan tiklanadi)
const aliases = new Map<string, string>();
function remember(decorated: string, original: string) {
  if (decorated === original) return;
  if (aliases.size > 3000) aliases.clear();
  aliases.set(decorated, original);
}

export function normalizeSnapshot(doc: any): BotUiSnapshot {
  if (!doc) return EMPTY;
  const buttons: Record<string, BotButtonOverride> = {};
  for (const [k, v] of Object.entries<any>(doc.buttons || {})) {
    if (!v || typeof v !== 'object') continue;
    const o: BotButtonOverride = {};
    const uz = typeof v.text?.uz === 'string' ? v.text.uz.trim() : '';
    const ru = typeof v.text?.ru === 'string' ? v.text.ru.trim() : '';
    if (uz || ru) o.text = { ...(uz ? { uz } : {}), ...(ru ? { ru } : {}) };
    if (typeof v.iconCustomEmojiId === 'string' && /^\d{1,32}$/.test(v.iconCustomEmojiId)) o.iconCustomEmojiId = v.iconCustomEmojiId;
    if (STYLES.has(v.style)) o.style = v.style;
    if (Object.keys(o).length) buttons[k] = o;
  }
  const messageEmoji = new Map<string, string>();
  for (const e of doc.messageEmoji || []) {
    if (e?.emoji && /^\d{1,32}$/.test(String(e.id || ''))) messageEmoji.set(stripVs(String(e.emoji)), String(e.id));
  }
  const stickers: { id: string; emoji: string }[] = [];
  const seen = new Set<string>();
  for (const p of doc.packs || []) for (const st of p?.stickers || []) {
    if (!st?.id || !/^\d{1,32}$/.test(String(st.id)) || seen.has(String(st.id))) continue;
    seen.add(String(st.id)); stickers.push({ id: String(st.id), emoji: String(st.emoji || '') });
  }
  const messagePrefix: Record<string, string> = {};
  for (const [k, v] of Object.entries<any>(doc.messagePrefix || {})) if (MESSAGE_KIND_KEYS.has(k) && /^\d{1,32}$/.test(String(v))) messagePrefix[k] = String(v);
  return {
    buttons, messageEmoji,
    messageEmojiEnabled: doc.messageEmojiEnabled !== false,
    stripEmojiWhenIcon: doc.stripEmojiWhenIcon !== false,
    stickers, messagePrefix,
    messagePrefixEnabled: doc.messagePrefixEnabled !== false,
  };
}

export function setBotUiSnapshot(s: BotUiSnapshot) { snap = s; loadedAt = Date.now(); version++; resolved = new Map(); }

/** Oddiy emoji → premium id: dasturchi tanlagani, bo'lmasa paketdagi aynan shu (yoki ma'nodosh) emoji. */
function emojiIdFor(e: string): string | undefined {
  const k = stripVs(e);
  const set = snap.messageEmoji.get(k);
  if (set) return set;
  if (!snap.stickers.length) return undefined;
  if (!resolved.has(k)) {
    if (resolved.size > 2000) resolved.clear();
    resolved.set(k, pickByEmoji(k, snap.stickers));
  }
  return resolved.get(k) || undefined;
}
export function getBotUiSnapshot() { return snap; }
export function botUiVersion() { return version; }

/** DB'dan qayta o'qiydi (saqlangandan keyin chaqiriladi). Xato bo'lsa — eski holat qoladi. */
export async function reloadBotUi(): Promise<void> {
  try {
    const doc = await BotUiConfig.findOne({ key: 'global' }).lean();
    setBotUiSnapshot(normalizeSnapshot(doc));
  } catch (e: any) {
    loadedAt = Date.now(); // xatoda har so'rovda DB'ni urmaslik uchun
    console.warn('[botUi] load failed:', e?.message);
  }
}
/** Kesh eskirgan bo'lsa fonda yangilaydi (kutmaydi). */
export function refreshBotUiIfStale() {
  if (loading || Date.now() - loadedAt < BOT_UI_CACHE_MS) return;
  loading = reloadBotUi().finally(() => { loading = null; });
}
export async function ensureBotUiLoaded() {
  if (loadedAt === 0) await reloadBotUi();
  else refreshBotUiIfStale();
}

// ── Matn yordamchilari ──
const LEAD_EMOJI_RE = /^[\p{Extended_Pictographic}\p{Regional_Indicator}‍️⃣\u{1F3FB}-\u{1F3FF}]+\s*/u;
export function stripLeadingEmoji(text: string): string {
  const out = text.replace(LEAD_EMOJI_RE, '').trim();
  return out || text;
}
function stripVs(s: string) { return s.replace(/️/g, ''); }

/** Dasturchi sozlamasi bo'yicha tugmaning ko'rinadigan matni (lang uchun). */
export function effectiveLabel(item: BotUiCatalogItem, lang: UiLang, s: BotUiSnapshot = snap, baseText?: string): string {
  const o = s.buttons[item.key];
  let t = baseText ?? defaultLabel(item, lang);
  if (o?.text) {
    if (lang === 'ru' && o.text.ru) t = o.text.ru;
    else if (lang === 'uz' && o.text.uz) t = o.text.uz;
    else if (lang === 'uz-cyrl' && o.text.uz) t = latinToCyrillicUz(o.text.uz);
  }
  if (o?.iconCustomEmojiId && s.stripEmojiWhenIcon) t = stripLeadingEmoji(t);
  return t;
}

function findItem(text: string): { item: BotUiCatalogItem; lang: UiLang; custom?: boolean } | null {
  const hits = getDefaultIndex().get(text.trim());
  if (hits?.length) return hits.find(h => snap.buttons[h.item.key]) || hits[0];
  if (extraSource) {
    try {
      const ex = extraSource().find(e => e.text === text);
      if (ex) {
        const item = BOT_UI_CATALOG.find(i => i.key === ex.key);
        if (item) return { item, lang: /[а-яё]/i.test(text) && !/[ўқғҳ]/i.test(text) ? 'ru' : 'uz', custom: true };
      }
    } catch { /* ignore */ }
  }
  return null;
}

function decorateButton(btn: any): any {
  const isStr = typeof btn === 'string';
  const text = isStr ? btn : btn?.text;
  if (typeof text !== 'string' || !text) return btn;
  const hit = findItem(text);
  if (!hit) return btn;
  const o = snap.buttons[hit.item.key];
  if (!o) return btn;
  // AppSettings'da o'zgartirilgan matn bo'lsa va panelda matn berilmagan bo'lsa — o'sha matn saqlanadi
  const label = effectiveLabel(hit.item, hit.lang, snap, hit.custom && !(o.text && (hit.lang === 'ru' ? o.text.ru : o.text.uz)) ? text : undefined);
  remember(label, text);
  const out: any = isStr ? { text: label } : { ...btn, text: label };
  if (o.iconCustomEmojiId) out.icon_custom_emoji_id = o.iconCustomEmojiId;
  if (o.style) out.style = o.style;
  return out;
}

/** reply_markup (obyekt yoki JSON satr) — tugmalarga sozlamani qo'llaydi. Asl obyekt o'zgartirilmaydi. */
export function decorateMarkup(markup: any): any {
  if (!markup || !Object.keys(snap.buttons).length) return markup;
  let obj = markup;
  const wasString = typeof markup === 'string';
  if (wasString) { try { obj = JSON.parse(markup); } catch { return markup; } }
  if (!obj || typeof obj !== 'object') return markup;
  let changed = false;
  const mapRows = (rows: any) => Array.isArray(rows) ? rows.map((r: any) => Array.isArray(r) ? r.map((b: any) => { const d = decorateButton(b); if (d !== b) changed = true; return d; }) : r) : rows;
  const next: any = { ...obj };
  if (Array.isArray(obj.keyboard)) next.keyboard = mapRows(obj.keyboard);
  if (Array.isArray(obj.inline_keyboard)) next.inline_keyboard = mapRows(obj.inline_keyboard);
  if (!changed) return markup;
  return wasString ? JSON.stringify(next) : next;
}

/** Foydalanuvchi bosgan (o'zgartirilgan) reply-tugma matnini kod kutadigan asl matnga qaytaradi. */
export function canonicalizeIncomingText(text: string): string {
  if (typeof text !== 'string' || !text || !Object.keys(snap.buttons).length) return text;
  const t = text.trim();
  if (getDefaultIndex().has(t)) return text; // allaqachon standart (eski klaviatura) — tegilmaydi
  const al = aliases.get(t);
  if (al) return al;
  for (const item of BOT_UI_CATALOG) {
    if (item.kind !== 'reply' || !snap.buttons[item.key]) continue;
    for (const lang of UI_LANGS) {
      if (effectiveLabel(item, lang) === t) {
        // AppSettings'dagi o'zgartirilgan matn bo'lsa — kod o'shani kutadi
        const extra = extraSource?.().find(e => e.key === item.key);
        return extra?.text || defaultLabel(item, lang);
      }
    }
  }
  if (extraSource) {
    for (const e of extraSource()) {
      const item = BOT_UI_CATALOG.find(i => i.key === e.key);
      if (item && snap.buttons[item.key] && stripLeadingEmoji(e.text) === t && snap.buttons[item.key].iconCustomEmojiId && snap.stripEmojiWhenIcon) return e.text;
    }
  }
  return text;
}

/** Telegram update (processUpdate'dan oldin) — xabar matnini kanonik qiladi. Joyida o'zgartiradi. */
export function canonicalizeUpdate(update: any): void {
  const m = update?.message;
  if (m && typeof m.text === 'string' && !m.text.startsWith('/')) {
    const c = canonicalizeIncomingText(m.text);
    if (c !== m.text) { m.text = c; delete m.entities; }
  }
}

// ── Xabarlardagi oddiy emoji → premium (custom) emoji ──
const PICTO_RE = /\p{Extended_Pictographic}️?/gu;
const SKIP_ENTITY = new Set(['custom_emoji', 'code', 'pre', 'url', 'text_link', 'email', 'phone_number', 'mention', 'bot_command']);

function plainEntities(text: string, existing: any[] | undefined, lookup: (e: string) => string | undefined) {
  const ranges = (existing || []).filter(e => SKIP_ENTITY.has(e?.type)).map(e => [e.offset, e.offset + e.length]);
  const added: any[] = [];
  for (const m of text.matchAll(PICTO_RE)) {
    const id = lookup(m[0]);
    if (!id) continue;
    const off = m.index!;
    if (ranges.some(([a, b]) => off < b && off + m[0].length > a)) continue;
    added.push({ type: 'custom_emoji', offset: off, length: m[0].length, custom_emoji_id: id });
    if (added.length >= 100) break; // Telegram: xabarda ko'pi bilan 100 custom emoji
  }
  return added;
}

function htmlReplace(text: string, lookup: (e: string) => string | undefined): string {
  let depth = 0; let count = 0;
  return text.split(/(<[^>]+>)/g).map(seg => {
    if (seg.startsWith('<')) {
      if (/^<(tg-emoji|code|pre|a)\b/i.test(seg)) depth++;
      else if (/^<\/(tg-emoji|code|pre|a)>/i.test(seg)) depth = Math.max(0, depth - 1);
      return seg;
    }
    if (depth > 0) return seg;
    return seg.replace(PICTO_RE, (e) => {
      const id = lookup(e);
      if (!id || count >= 100) return e;
      count++;
      return `<tg-emoji emoji-id="${id}">${e}</tg-emoji>`;
    });
  }).join('');
}

/**
 * sendMessage/editMessageText uchun matn+opts — premium emoji qo'shadi (owner 2026-10-23: hamma xabarda):
 *  • matndagi har bir oddiy emoji → mos premium emoji (sozlangan, bo'lmasa paketdagi o'xshashi);
 *  • emojisiz xabar boshiga — mazmuniga mos premium emoji (messageKinds);
 *  • eski Markdown rejimi HTML'ga o'giriladi (Markdown premium emojini qo'llamaydi).
 * Telegram rad etsa bot.ts bezaksiz asl xabarni qayta yuboradi.
 */
export function decorateMessage(text: any, opts: any): { text: any; opts: any } {
  if (typeof text !== 'string' || !text || !snap.messageEmojiEnabled) return { text, opts };
  if (!snap.messageEmoji.size && !snap.stickers.length && !Object.keys(snap.messagePrefix).length) return { text, opts };
  let mode = String(opts?.parse_mode || '');
  let body = text;
  let o = opts;
  if (mode === 'Markdown') { body = markdownToHtml(text); mode = 'HTML'; o = { ...(opts || {}), parse_mode: 'HTML' }; }
  const plain = mode.toUpperCase() === 'HTML' ? body.replace(/<[^>]+>/g, '') : body;
  const hasEmoji = new RegExp(PICTO_RE.source, 'u').test(plain);
  let prefix: { e: string; id: string } | null = null;
  if (!hasEmoji && snap.messagePrefixEnabled) {
    const kind = classifyMessage(plain);
    const id = kind ? (snap.messagePrefix[kind.key] || emojiIdFor(kind.emoji)) : undefined;
    if (kind && id) prefix = { e: kind.emoji, id };
  }
  if (!mode) {
    const added = plainEntities(body, o?.entities, emojiIdFor);
    let entities = [...(Array.isArray(o?.entities) ? o.entities : []), ...added];
    if (prefix) {
      const head = `${prefix.e} `;
      entities = entities.map(e => ({ ...e, offset: e.offset + head.length }));
      entities.unshift({ type: 'custom_emoji', offset: 0, length: prefix.e.length, custom_emoji_id: prefix.id });
      body = head + body;
    }
    if (!entities.length || (!added.length && !prefix)) return { text, opts };
    return { text: body, opts: { ...(o || {}), entities: entities.sort((a, b) => a.offset - b.offset) } };
  }
  if (mode.toUpperCase() === 'HTML') {
    let next = htmlReplace(body, emojiIdFor);
    if (prefix) next = `<tg-emoji emoji-id="${prefix.id}">${prefix.e}</tg-emoji> ${next}`;
    return next === text && o === opts ? { text, opts } : { text: next, opts: o };
  }
  return { text, opts };
}

/** Saqlashdan oldin: reply-tugmalar matnlari bir-biriga to'qnashmasin (aks holda bosilgan tugmani ajratib bo'lmaydi). */
export function findLabelConflicts(buttons: Record<string, BotButtonOverride>, stripEmojiWhenIcon = true): string[] {
  const s: BotUiSnapshot = { ...EMPTY, buttons, stripEmojiWhenIcon };
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const item of BOT_UI_CATALOG) {
    if (item.kind !== 'reply') continue;
    for (const lang of UI_LANGS) {
      const t = effectiveLabel(item, lang, s);
      const prev = seen.get(`${lang}|${t}`);
      if (prev && prev !== item.key) conflicts.push(`${prev} ↔ ${item.key} (${lang}: "${t}")`);
      else seen.set(`${lang}|${t}`, item.key);
      // boshqa kalitning STANDART matni bilan to'qnashuv ham xavfli
      const def = getDefaultIndex().get(t);
      if (buttons[item.key] && def?.some(d => d.item.key !== item.key && d.item.kind === 'reply')) conflicts.push(`${item.key} (${lang}: "${t}") = ${def.find(d => d.item.key !== item.key)!.item.key}`);
    }
  }
  return [...new Set(conflicts)];
}

/** Testlar uchun */
export function __resetBotUiForTests() { snap = EMPTY; loadedAt = 0; aliases.clear(); extraSource = null; defaultIndex = null; }
