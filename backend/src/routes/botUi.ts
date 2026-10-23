import { Router, type Request, type Response } from 'express';
import BotUiConfig, { type BotButtonOverride, type BotEmojiPack } from '../models/BotUiConfig';
import { BOT_UI_CATALOG, BOT_UI_COMMANDS, BOT_UI_KEYS, messageEmojiCandidates } from '../services/botUi/catalog';
import { findLabelConflicts, reloadBotUi } from '../services/botUi/runtime';
import { applyBotCommands } from '../services/botUi/commands';
import { autoDecorate } from '../services/botUi/autoDecorate';
import { parsePackName, tgCall, tgDownloadFile } from '../services/botUi/telegramApi';
import { geminiTextToJson } from '../services/gemini';
import { MESSAGE_KIND_KEYS } from '../services/botUi/messageKinds';

// Bot dizayni (owner 2026-10-22) — /api/dev/bot-ui (index.ts: requireAuth + requireDeveloper — faqat dasturchi).
const router = Router();

const STYLES = new Set(['primary', 'success', 'danger']);
const ID_RE = /^\d{1,32}$/;
const MAX_TEXT = 64;

async function getDoc() {
  return BotUiConfig.findOneAndUpdate({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
}

function packSummary(p: BotEmojiPack) {
  return { name: p.name, title: p.title, count: p.stickers?.length || 0, stickers: (p.stickers || []).map(s => ({ id: s.id, emoji: s.emoji, animated: !!s.animated, video: !!s.video })) };
}

// Har javobda to'liq ma'lumot (owner 2026-10-22: paket qo'shilgach sahifa "catalog" yo'qligidan yiqilardi)
function view(doc: any) {
  return {
    catalog: BOT_UI_CATALOG,
    commandsCatalog: BOT_UI_COMMANDS,
    messageEmojiCandidates: messageEmojiCandidates(),
    config: {
      buttons: doc?.buttons || {},
      messageEmoji: doc?.messageEmoji || [],
      messageEmojiEnabled: doc?.messageEmojiEnabled !== false,
      messagePrefix: doc?.messagePrefix || {},
      messagePrefixEnabled: doc?.messagePrefixEnabled !== false,
      stripEmojiWhenIcon: doc?.stripEmojiWhenIcon !== false,
      commands: doc?.commands || [],
      updatedAt: doc?.updatedAt || null,
    },
    packs: (doc?.packs || []).map(packSummary),
    draft: doc?.draft || null,
    decorating: !!decorateJob,
    decorateError: lastDecorateError,
  };
}

/** Reply-klaviaturadagi yangi sozlamalarni qo'llash: runtime kesh + buyruqlar (xato bo'lsa ham saqlash bekor qilinmaydi). */
async function afterSave(commandsChanged: boolean): Promise<string | null> {
  await reloadBotUi();
  if (!commandsChanged) return null;
  try { await applyBotCommands(); return null; } catch (e: any) { return String(e?.message || e).slice(0, 200); }
}

export function sanitizeButtons(input: any): { buttons: Record<string, BotButtonOverride>; errors: string[] } {
  const buttons: Record<string, BotButtonOverride> = {};
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { buttons, errors };
  for (const [k, v] of Object.entries<any>(input)) {
    if (!BOT_UI_KEYS.has(k)) { errors.push(`noma'lum tugma: ${k}`); continue; }
    if (!v || typeof v !== 'object') continue;
    const o: BotButtonOverride = {};
    const uz = typeof v.text?.uz === 'string' ? v.text.uz.trim() : '';
    const ru = typeof v.text?.ru === 'string' ? v.text.ru.trim() : '';
    if (uz.length > MAX_TEXT || ru.length > MAX_TEXT) errors.push(`${k}: matn ${MAX_TEXT} belgidan oshmasin`);
    if (/^\//.test(uz) || /^\//.test(ru)) errors.push(`${k}: matn "/" bilan boshlanmasin`);
    if (uz || ru) o.text = { ...(uz ? { uz } : {}), ...(ru ? { ru } : {}) };
    if (v.iconCustomEmojiId) {
      if (ID_RE.test(String(v.iconCustomEmojiId))) o.iconCustomEmojiId = String(v.iconCustomEmojiId);
      else errors.push(`${k}: emoji id noto'g'ri`);
    }
    if (v.style) {
      if (STYLES.has(v.style)) o.style = v.style;
      else errors.push(`${k}: style noto'g'ri`);
    }
    if (Object.keys(o).length) buttons[k] = o;
  }
  return { buttons, errors };
}

function sanitizeMessageEmoji(input: any): { emoji: string; id: string }[] {
  const out: { emoji: string; id: string }[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(input) ? input : []) {
    const emoji = String(e?.emoji || '').replace(/️/g, '').trim();
    const id = String(e?.id || '');
    if (!emoji || emoji.length > 8 || !/\p{Extended_Pictographic}/u.test(emoji) || !ID_RE.test(id) || seen.has(emoji)) continue;
    seen.add(emoji); out.push({ emoji, id });
  }
  return out.slice(0, 300);
}

function sanitizeCommands(input: any): { commands: any[]; errors: string[] } {
  const errors: string[] = [];
  const commands = [];
  for (const c of Array.isArray(input) ? input : []) {
    const def = BOT_UI_COMMANDS.find(x => x.command === c?.command);
    if (!def) { errors.push(`noma'lum buyruq: ${c?.command}`); continue; }
    const uz = String(c?.description?.uz || '').trim();
    const ru = String(c?.description?.ru || '').trim();
    if (uz.length > 256 || ru.length > 256) errors.push(`/${def.command}: tavsif 256 belgidan oshmasin`);
    commands.push({ command: def.command, enabled: c?.enabled !== false, description: { uz, ru } });
  }
  return { commands, errors };
}

router.get('/', async (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  const doc: any = await BotUiConfig.findOne({ key: 'global' }).lean();
  res.json(view(doc));
});

router.put('/', async (req: Request, res: Response) => {
  const body = req.body || {};
  const errors: string[] = [];
  const set: any = { updatedBy: req.user?.userId };
  if ('buttons' in body) {
    const b = sanitizeButtons(body.buttons);
    errors.push(...b.errors);
    const strip = body.stripEmojiWhenIcon !== undefined ? body.stripEmojiWhenIcon !== false : true;
    errors.push(...findLabelConflicts(b.buttons, strip).map(c => `matn to'qnashuvi: ${c}`));
    set.buttons = b.buttons;
  }
  if ('messageEmoji' in body) set.messageEmoji = sanitizeMessageEmoji(body.messageEmoji);
  if ('messageEmojiEnabled' in body) set.messageEmojiEnabled = body.messageEmojiEnabled !== false;
  if ('messagePrefixEnabled' in body) set.messagePrefixEnabled = body.messagePrefixEnabled !== false;
  if ('stripEmojiWhenIcon' in body) set.stripEmojiWhenIcon = body.stripEmojiWhenIcon !== false;
  let commandsChanged = false;
  if ('commands' in body) {
    const c = sanitizeCommands(body.commands);
    errors.push(...c.errors);
    set.commands = c.commands; commandsChanged = true;
  }
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  await getDoc();
  const doc = await BotUiConfig.findOneAndUpdate({ key: 'global' }, { $set: set }, { returnDocument: 'after' }).lean();
  const commandsError = await afterSave(commandsChanged);
  res.json({ ...view(doc), commandsError });
});

// ── Emoji paketlari ──
router.post('/packs', async (req: Request, res: Response) => {
  const name = parsePackName(req.body?.link || req.body?.name || '');
  if (!name) return res.status(400).json({ error: "Paket havolasi noto'g'ri (masalan https://t.me/addemoji/NAME)" });
  let set: any;
  try { set = await tgCall('getStickerSet', { name }); } catch (e: any) {
    return res.status(400).json({ error: `Paket topilmadi: ${String(e?.message || e).slice(0, 160)}` });
  }
  if (set?.sticker_type !== 'custom_emoji') return res.status(400).json({ error: "Bu emoji paketi emas (t.me/addemoji/... havolasi kerak — oddiy stiker paketi tugmaga qo'yilmaydi)" });
  const pack: BotEmojiPack = {
    name: set.name, title: String(set.title || set.name).slice(0, 80), loadedAt: new Date(),
    stickers: (set.stickers || []).filter((s: any) => s?.custom_emoji_id).slice(0, 300).map((s: any) => ({
      id: String(s.custom_emoji_id), emoji: String(s.emoji || ''), fileId: s.file_id, thumbFileId: s.thumbnail?.file_id,
      animated: !!s.is_animated, video: !!s.is_video,
    })),
  };
  const doc = await getDoc();
  const packs = (doc.packs || []).filter((p: any) => p.name !== pack.name);
  if (packs.length >= 20) return res.status(400).json({ error: "Ko'pi bilan 20 ta paket" });
  packs.push(pack);
  doc.packs = packs as any;
  await doc.save();
  stickerIndex = null;
  await reloadBotUi(); // yangi paket emojilari darhol xabarlarda ishlasin
  res.json(view(doc.toObject()));
});

router.delete('/packs/:name', async (req: Request, res: Response) => {
  const doc = await getDoc();
  doc.packs = (doc.packs || []).filter((p: any) => p.name !== req.params.name) as any;
  await doc.save();
  stickerIndex = null;
  await reloadBotUi();
  res.json(view(doc.toObject()));
});

// ── AI bilan bezash (qoralama) ──
// Fonda ishlaydi (owner 2026-10-23: "hardoim error beryapti lekin ishlayapti" — AI uzoq o'ylaganda brauzer
// so'rovi uzilardi). POST darhol javob beradi (decorating: true), sahifa GET bilan tayyor bo'lguncha kutadi.
let decorateJob: Promise<void> | null = null;
let lastDecorateError: string | null = null;
export function __decorateJobForTests() { return decorateJob; }
router.post('/auto-decorate', async (req: Request, res: Response) => {
  const doc = await getDoc();
  const packs = (doc.toObject().packs || []) as BotEmojiPack[];
  if (!packs.length) return res.status(400).json({ error: "Avval kamida bitta emoji paketini qo'shing" });
  if (!decorateJob) {
    const useAi = req.body?.useAi !== false;
    const aiWithTimeout = (prompt: string) => Promise.race([
      geminiTextToJson(prompt),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('AI 90 s ichida javob bermadi')), 90_000)),
    ]);
    lastDecorateError = null;
    decorateJob = (async () => {
      const draft = await autoDecorate(packs, useAi ? aiWithTimeout : null);
      await BotUiConfig.updateOne({ key: 'global' }, { $set: { draft } });
    })().catch((e: any) => { lastDecorateError = String(e?.message || e).slice(0, 200); })
      .finally(() => { decorateJob = null; });
  }
  res.status(202).json({ ...view(doc.toObject()), decorating: true });
});

router.post('/draft/apply', async (req: Request, res: Response) => {
  const doc = await getDoc();
  const draft: any = doc.draft;
  if (!draft) return res.status(400).json({ error: "Qoralama yo'q" });
  const buttons: Record<string, BotButtonOverride> = { ...(doc.buttons || {}) };
  for (const [k, v] of Object.entries<any>(draft.buttons || {})) {
    if (!BOT_UI_KEYS.has(k)) continue;
    const cur = { ...(buttons[k] || {}) };
    if (v.iconCustomEmojiId) cur.iconCustomEmojiId = v.iconCustomEmojiId;
    if (v.style) cur.style = v.style;
    buttons[k] = cur;
  }
  const strip = doc.stripEmojiWhenIcon !== false;
  const conflicts = findLabelConflicts(buttons, strip);
  if (conflicts.length) return res.status(400).json({ error: `matn to'qnashuvi: ${conflicts[0]}`, errors: conflicts });
  const me = new Map((doc.messageEmoji || []).map((e: any) => [e.emoji, e.id]));
  for (const [e, id] of Object.entries<any>(draft.messageEmoji || {})) me.set(e, id);
  doc.buttons = buttons as any;
  doc.markModified('buttons');
  doc.messageEmoji = sanitizeMessageEmoji([...me].map(([emoji, id]) => ({ emoji, id })));
  const prefix: Record<string, string> = { ...(doc.messagePrefix || {}) };
  for (const [k, id] of Object.entries<any>(draft.prefix || {})) if (MESSAGE_KIND_KEYS.has(k) && ID_RE.test(String(id))) prefix[k] = String(id);
  doc.messagePrefix = prefix as any;
  doc.markModified('messagePrefix');
  doc.draft = null;
  doc.updatedBy = req.user?.userId;
  await doc.save();
  await afterSave(false);
  res.json(view(doc.toObject()));
});

router.delete('/draft', async (_req: Request, res: Response) => {
  const doc = await getDoc();
  doc.draft = null;
  await doc.save();
  res.json(view(doc.toObject()));
});

// Standartga qaytarish — matn/ikonka/rang/xabar emoji/buyruqlar tozalanadi, paketlar qoladi
router.post('/reset', async (req: Request, res: Response) => {
  const doc = await BotUiConfig.findOneAndUpdate({ key: 'global' },
    { $set: { buttons: {}, messageEmoji: [], commands: [], draft: null, messageEmojiEnabled: true, stripEmojiWhenIcon: true, updatedBy: req.user?.userId } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }).lean();
  const commandsError = await afterSave(true);
  res.json({ ...view(doc), commandsError });
});

// ── Stiker rasmlari (ochiq: <img> token yubormaydi) — FAQAT qo'shilgan paketlardagi emoji'lar ──
let stickerIndex: { at: number; map: Map<string, { fileId: string; thumb?: string; animated?: boolean; video?: boolean }> } | null = null;
const imgCache = new Map<string, { buf: Buffer; type: string }>();

async function findSticker(id: string) {
  if (!stickerIndex || Date.now() - stickerIndex.at > 60_000) {
    const doc: any = await BotUiConfig.findOne({ key: 'global' }).select('packs').lean();
    const map = new Map();
    for (const p of doc?.packs || []) for (const s of p.stickers || []) map.set(s.id, { fileId: s.fileId, thumb: s.thumbFileId, animated: s.animated, video: s.video });
    stickerIndex = { at: Date.now(), map };
  }
  return stickerIndex.map.get(id);
}

const imgFailed = new Map<string, number>();
export const stickerImageRouter = Router();
stickerImageRouter.get('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  if (!ID_RE.test(id)) return res.status(400).end();
  const hit = imgCache.get(id);
  const send = (v: { buf: Buffer; type: string }) => { res.set('Cache-Control', 'public, max-age=604800, immutable'); res.set('Cross-Origin-Resource-Policy', 'cross-origin'); res.set('X-Content-Type-Options', 'nosniff'); res.type(v.type).send(v.buf); };
  if (hit) return send(hit);
  const s = await findSticker(id).catch(() => undefined);
  if (!s) return res.status(404).end();
  // Rasm: thumbnail (webp/jpg); bo'lmasa statik stikerning o'zi (webp). Animatsion (tgs) va video (webm) — faqat thumbnail.
  const fileId = s.thumb || (!s.animated ? s.fileId : undefined);
  if (!fileId) return res.status(404).end();
  // Ilgari yuklab bo'lmagan rasm — 10 daqiqa qayta urinilmaydi (sahifa oddiy emojini ko'rsatadi)
  const failedAt = imgFailed.get(id);
  if (failedAt && Date.now() - failedAt < 10 * 60_000) return res.status(404).end();
  try {
    // Telegram ko'p so'rovda vaqtincha rad etadi (429) — bir marta qayta urinamiz
    const { buf, path } = await tgDownloadFile(fileId).catch(async () => { await new Promise((r) => setTimeout(r, 1200)); return tgDownloadFile(fileId); });
    const type = /\.webm$/i.test(path) ? 'video/webm' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.png$/i.test(path) ? 'image/png' : 'image/webp';
    if (imgCache.size > 1500) imgCache.clear();
    const v = { buf, type };
    imgCache.set(id, v);
    send(v);
  } catch {
    // Bu xato emas: emoji botda ishlaydi, faqat ko'rinish rasmi yo'q — xatolar ro'yxatini to'ldirmasin
    if (imgFailed.size > 2000) imgFailed.clear();
    imgFailed.set(id, Date.now());
    res.status(404).end();
  }
});

export default router;
