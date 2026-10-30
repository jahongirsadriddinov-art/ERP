import AgentTask from '../../models/AgentTask';
import User from '../../models/User';
import { SmmRun, SmmSettings, SMM_FORMATS, type SmmFormat } from '../../models/Smm';
import { logAudit } from '../../services/audit';
import { geminiConfigured } from '../../services/gemini';
import { agentConfig, createTaskAndWait } from '../agents/service';
import { secretsKeyConfigured } from '../lib/crypto';
import { isHHmm, zonedParts, zonedToUtc } from '../lib/zonedTime';
import { refreshInsights } from './analytics';
import { CATEGORY_HINT, SMM_CATEGORIES, type SmmCategory } from './content';
import { igConfigured, igEnv, igMaybeRefresh } from './instagram';
import { expireStalePublishing, publishItem, type InFile } from './publish';
import { ffmpegAvailable, GEMINI_IMAGE_MODEL, ImageUnavailable, imagePromptFor, smmRender, type Aspect } from './render';
import { publicUrlOk, purgeExpiredTemp } from './tempMedia';
import { botInfo, channelConfig, invalidateChannelCache } from './channel';

/** Rasm chiqmagani sababini Xatolar paneliga yozadi — soatiga bir marta. */
let lastImageReport = 0;
async function reportImageFailure(why: string, what: string): Promise<void> {
  if (Date.now() - lastImageReport < 3600_000) return;
  lastImageReport = Date.now();
  try {
    const { captureError } = await import('../../services/errorTracker');
    await captureError({
      source: 'server', kind: 'smm-image',
      message: `AI rasm chiqmadi (${what}): ${why}. Post gradientli shablon bilan ketdi.`.slice(0, 300),
      route: '/smm/image', method: 'POST',
    });
  } catch { /* xabar yetmasa ham post chiqishi to'xtamasin */ }
}


// SMM avtopilot (owner 2026-10-23: "agent o'zi boshqarsin — yangiliklar, postlar, reels").
// Rejimlar: off | approve ("tasdiq bilan" — jadval bo'yicha tayyorlaydi, egasi bir tugma bilan tasdiqlaydi; rasm/video
// egasining QURILMASIDA yaratiladi va o'sha yerdan e'lon qilinadi) | auto ("to'liq avto" — server o'zi: rasm Gemini yoki
// brendli shablon (ffmpeg), reels — shablon slaydlardan; fayllar faqat xotirada → vaqtinchalik havola → e'lon → o'chirish).
// Jadval: hafta kunlari × vaqtlar (Asia/Tashkent). Har slot SmmRun{key} — unique, shuning uchun bir nechta instansiyada
// ham faqat bittasi bajaradi. Kunlik limit, kill-switch (paused yoki env SMM_AUTOPILOT_DISABLED=1), takrorlanmas mavzular.
// Hech qachon sozlanmagan joyga e'lon qilinmaydi: Telegram — faqat AGENT_TG_CHANNEL_ID, Instagram — faqat token bilan.

export const SLOT_WINDOW_MS = 30 * 60_000;
export const AUTOPILOT_BY = 'smm-autopilot';
const FORMAT_UZ: Record<SmmFormat, string> = { post: 'rasmli post', carousel: 'karusel (3–5 slayd)', reel: 'Reels video (15–25 s, 4–5 sahna)', story: 'Story (vertikal, 1–3 sahna)' };
const logLine = (text: string) => ({ at: new Date(), text: text.slice(0, 500) });

export interface SmmSettingsDto {
  mode: 'off' | 'approve' | 'auto'; days: number[]; times: string[]; formats: SmmFormat[]; language: 'uz' | 'ru' | 'both';
  targets: { telegram: boolean; instagram: boolean }; dailyCap: number; paused: boolean; perWeek: number; next?: string; envKill: boolean;
}

export async function loadSettings(): Promise<any> {
  return SmmSettings.findOneAndUpdate({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true, returnDocument: 'after' }).lean();
}

const envKill = () => /^(1|true|yes)$/i.test((process.env.SMM_AUTOPILOT_DISABLED || '').trim());

export function settingsDto(s: any, now = new Date()): SmmSettingsDto {
  const days = (s?.days || []).filter((d: number) => d >= 1 && d <= 7);
  const times = (s?.times || []).filter(isHHmm);
  return {
    mode: s?.mode || 'off', days, times, formats: (s?.formats || SMM_FORMATS).filter((f: string) => (SMM_FORMATS as string[]).includes(f)),
    language: s?.language || 'uz', targets: { telegram: s?.targets?.telegram !== false, instagram: s?.targets?.instagram !== false },
    dailyCap: s?.dailyCap || 3, paused: !!s?.paused, perWeek: days.length * times.length,
    next: s?.mode && s.mode !== 'off' && !s.paused ? nextSlot(days, times, now)?.toISOString() : undefined, envKill: envKill(),
  };
}

/** Keyingi slot vaqti (UTC). */
export function nextSlot(days: number[], times: string[], now = new Date()): Date | null {
  if (!days.length || !times.length) return null;
  const today = zonedParts(now).date;
  for (let d = 0; d < 8; d++) {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10) as any;
    const wd = zonedParts(zonedToUtc(date, '12:00' as any)).isoWeekday;
    if (!days.includes(wd)) continue;
    for (const t of [...times].sort()) {
      const at = zonedToUtc(date, t as any);
      if (at.getTime() > now.getTime()) return at;
    }
  }
  return null;
}

export async function saveSettings(body: Record<string, any>, by: string, req?: any): Promise<{ ok: true; settings: SmmSettingsDto } | { ok: false; error: string }> {
  const set: Record<string, unknown> = {};
  if (body.mode !== undefined) {
    if (!['off', 'approve', 'auto'].includes(body.mode)) return { ok: false, error: 'invalid' };
    set.mode = body.mode;
  }
  if (body.days !== undefined) {
    if (!Array.isArray(body.days) || body.days.some((d: unknown) => !Number.isInteger(d) || (d as number) < 1 || (d as number) > 7)) return { ok: false, error: 'invalid' };
    set.days = [...new Set(body.days as number[])].sort();
  }
  if (body.times !== undefined) {
    if (!Array.isArray(body.times) || body.times.length > 6 || body.times.some((t: unknown) => !isHHmm(t))) return { ok: false, error: 'invalid' };
    set.times = [...new Set(body.times as string[])].sort();
  }
  if (body.formats !== undefined) {
    if (!Array.isArray(body.formats) || !body.formats.length || body.formats.some((f: unknown) => !(SMM_FORMATS as unknown[]).includes(f))) return { ok: false, error: 'invalid' };
    set.formats = [...new Set(body.formats as string[])];
  }
  if (body.language !== undefined) {
    if (!['uz', 'ru', 'both'].includes(body.language)) return { ok: false, error: 'invalid' };
    set.language = body.language;
  }
  if (body.targets !== undefined) {
    if (!body.targets || typeof body.targets !== 'object') return { ok: false, error: 'invalid' };
    if (typeof body.targets.telegram === 'boolean') set['targets.telegram'] = body.targets.telegram;
    if (typeof body.targets.instagram === 'boolean') set['targets.instagram'] = body.targets.instagram;
  }
  if (body.dailyCap !== undefined) {
    if (!Number.isInteger(body.dailyCap) || body.dailyCap < 1 || body.dailyCap > 10) return { ok: false, error: 'invalid' };
    set.dailyCap = body.dailyCap;
  }
  if (body.siteButton !== undefined) {
    if (typeof body.siteButton !== 'boolean') return { ok: false, error: 'invalid' };
    set.tgSiteButton = body.siteButton;
  }
  if (body.paused !== undefined) {
    if (typeof body.paused !== 'boolean') return { ok: false, error: 'invalid' };
    set.paused = body.paused;
  }
  set.updatedBy = by;
  const doc = await SmmSettings.findOneAndUpdate({ key: 'global' }, { $set: set }, { upsert: true, returnDocument: 'after' }).lean();
  invalidateChannelCache();
  const u: any = /^[0-9a-f]{24}$/i.test(by) ? await User.findById(by).select('firstName lastName role').lean().catch(() => null) : null;
  await logAudit({
    userId: by || 'system', userName: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Dasturchi', userRole: u?.role || 'dasturchi',
    action: 'update', entity: 'smm_settings', entityId: 'global',
    description: `SMM avtopilot sozlamalari: ${set.mode ? `rejim ${set.mode}` : ''}${set.paused === true ? ' · TO\'XTATILDI' : set.paused === false ? ' · davom ettirildi' : ''}`.trim(), newValue: set, req,
  }).catch(() => undefined);
  return { ok: true, settings: settingsDto(doc) };
}

/** Ulanishlar holati va sozlash ro'yxati (faqat NOMLAR — qiymatlar hech qachon). */
export async function connectionStatus() {
  const c = agentConfig();
  const s: any = await SmmSettings.findOne({ key: 'global' }).select('igUsername igTokenExpiresAt igLastRefreshAt igRefreshError igUserId tgPremiumError tgPremiumOkAt').lean().catch(() => null);
  const e = igEnv();
  const ig = {
    configured: igConfigured(), userIdSet: !!(e.userId || s?.igUserId), via: e.host === 'graph.instagram.com' ? 'instagram' : 'facebook',
    appSet: !!(e.appId && e.appSecret), username: s?.igUsername || undefined,
    expiresAt: s?.igTokenExpiresAt ? new Date(s.igTokenExpiresAt).toISOString() : undefined,
    lastRefreshAt: s?.igLastRefreshAt ? new Date(s.igLastRefreshAt).toISOString() : undefined, refreshError: s?.igRefreshError || undefined,
    publicUrl: publicUrlOk(), secretsKey: secretsKeyConfigured(),
  };
  const ch = await channelConfig();
  const b = await botInfo(c.botToken);
  const tg = {
    bot: !!c.botToken, botUsername: b?.username || undefined, channel: !!(ch.chat && c.botToken), channelSource: ch.source,
    channelName: ch.username ? `@${ch.username}` : undefined, channelTitle: ch.title, siteButton: ch.siteButton, devChat: !!(c.devChat && c.botToken), viewsAvailable: false,
    premium: s?.tgPremiumError ? 'rejected' : s?.tgPremiumOkAt ? 'ok' : 'unknown', premiumError: s?.tgPremiumError || undefined,
  };
  const items = [
    { key: 'TELEGRAM_BOT_TOKEN', ok: tg.bot, required: true, for: 'telegram' },
    { key: 'AGENT_TG_CHANNEL_ID', ok: tg.channel, required: false, for: 'telegram' },
    { key: 'TG_PREMIUM_EMOJI', ok: s?.tgPremiumError ? false : s?.tgPremiumOkAt ? true : null, required: false, for: 'telegram', ...(s?.tgPremiumError ? { detail: String(s.tgPremiumError) } : {}) },
    { key: 'INSTAGRAM_ACCESS_TOKEN', ok: ig.configured, required: true, for: 'instagram' },
    { key: 'INSTAGRAM_USER_ID', ok: ig.userIdSet, required: ig.via === 'facebook', for: 'instagram' },
    { key: 'META_APP_ID', ok: ig.appSet, required: false, for: 'instagram' },
    { key: 'META_APP_SECRET', ok: ig.appSet, required: false, for: 'instagram' },
    { key: 'AI_SECRETS_KEY', ok: ig.secretsKey, required: false, for: 'instagram' },
    { key: 'RENDER_EXTERNAL_URL', ok: ig.publicUrl, required: true, for: 'instagram' },
    { key: 'GEMINI_API_KEY', ok: geminiConfigured(), required: true, for: 'content' },
    { key: 'GEMINI_IMAGE_MODEL', ok: null, required: false, for: 'content' },
  ];
  return { telegram: tg, instagram: ig, gemini: { configured: geminiConfigured(), imageModel: GEMINI_IMAGE_MODEL() }, ffmpeg: ffmpegAvailable(), items };
}

// ───────────── Slot tanlash ─────────────
/** Hozir bajarilishi kerak bo'lgan slot (vaqti kelgan va 30 daqiqalik oynada). */
export function dueSlot(s: { days: number[]; times: string[] }, now = new Date()): { key: string; date: string; time: string } | null {
  const p = zonedParts(now);
  if (!s.days.includes(p.isoWeekday)) return null;
  for (const t of s.times) {
    const at = zonedToUtc(p.date, t as any).getTime();
    if (now.getTime() >= at && now.getTime() < at + SLOT_WINDOW_MS) return { key: `smm:${p.date}:${t}`, date: p.date, time: t };
  }
  return null;
}

/** Eng kam ishlatilgan (oxirgi bo'lmagan) qiymat — formatlar va turkumlar navbatma-navbat. */
export function pickLeastRecent<T extends string>(options: readonly T[], recent: (string | undefined)[]): T {
  const lastUse = new Map<string, number>();
  recent.forEach((v, i) => { if (v && !lastUse.has(v)) lastUse.set(v, i); });
  const unused = options.filter((o) => !lastUse.has(o));
  if (unused.length) return unused[0];
  return [...options].sort((a, b) => (lastUse.get(b)! - lastUse.get(a)!))[0];
}

export function autopilotPrompt(o: { format: SmmFormat; category: SmmCategory; history: string[]; language: string }): string {
  const lang = o.language === 'ru' ? '[lang:ru]' : o.language === 'both' ? '[lang:both]' : '[lang:uz]';
  return [
    `${lang} Avtopilot: QurilishERP ijtimoiy tarmoqlari uchun BITTA ${FORMAT_UZ[o.format]} tayyorla.`,
    `Turkum: ${o.category} — ${CATEGORY_HINT[o.category]}.`,
    o.history.length ? `Oldingi mavzular (TAKRORLAMA, boshqa burchakdan yoz): ${o.history.slice(0, 40).map((h) => `«${h}»`).join(', ')}.` : '',
    `Item "format" qiymati qat'iy "${o.format}" bo'lsin; faqat 1 ta item.`,
  ].filter(Boolean).join('\n');
}

// ───────────── Serverda (vaqtinchalik) media ─────────────
const ASPECT: Record<SmmFormat, Aspect> = { post: '4:5', carousel: '4:5', reel: '9:16', story: '9:16' };
const BADGE: Record<string, string> = { feature: 'Imkoniyat', tip: 'Maslahat', case: 'Tajriba', problem: 'Muammo → yechim', news: 'Yangilik' };

/** "To'liq avto" uchun fayllar (faqat xotirada). Reels yaratilmasa — post'ga tushiriladi. */
export async function serverMedia(it: any, format: SmmFormat): Promise<{ files: InFile[]; format: SmmFormat; source: string }> {
  const aspect = ASPECT[format];
  const badge = BADGE[it.category] || 'QurilishERP';
  const scenes: { title: string; text: string }[] = (it.scenes || []).slice(0, 5);
  // Owner 2026-10-29: "rasmlari g'alati, mazmunsiz chiqyapti". Ikki sabab bor edi:
  //  1) AI rasm olinmasa, jimgina gradientli shablonga tushib ketardi va NEGA ekani
  //     hech qayerda yozilmasdi (ImageUnavailable butunlay yutilardi);
  //  2) karusel slaydlari UMUMAN AI rasm ishlatmasdi — faqat muqova urinib ko'rilardi,
  //     qolgan 4 tasi doim shablon edi. Natijada albomdagi 5 rasmning 4 tasi mazmunsiz.
  // Endi har bir slayd ham o'z mazmuniga mos AI rasm oladi; faqat o'sha slayd
  // muvaffaqiyatsiz bo'lsa — o'zi shablonga tushadi.
  const aiImage = async (src: { title?: string; text?: string }, asp: Aspect, what: string): Promise<Buffer | null> => {
    try {
      const img = await smmRender.generateAiImage(imagePromptFor({ ...it, ...src, imagePrompt: '' }), asp);
      const [w, h] = asp === '9:16' ? [1080, 1920] : asp === '1:1' ? [1080, 1080] : [1080, 1350];
      return await smmRender.toJpeg(img.data, w, h);
    } catch (e) {
      // Sabab DOIM yozilsin: no_key / quota / model_unavailable — shusiz nega
      // gradient chiqayotganini bilib bo'lmaydi.
      const why = e instanceof ImageUnavailable ? e.message : String((e as Error)?.message || e).slice(0, 120);
      console.warn(`[smm] AI rasm olinmadi (${what}): ${why}`);
      // Owner 2026-10-30: "AI yana rasmlarni tushunarsiz qilib chiqaryapti".
      // Sabab jurnalga yozilardi, lekin jurnalni hech kim o'qimaydi — ekranda
      // esa shunchaki gradient ko'rinardi. Endi sabab Xatolar paneliga tushadi
      // (soatiga bir marta, jurnal to'lib ketmasin) va u yerda aniq ko'rinadi:
      // no_key / quota / model_unavailable / http_xxx.
      void reportImageFailure(why, what);
      return null;
    }
  };
  const cover = async (asp: Aspect): Promise<{ data: Buffer; source: string }> => {
    const ai = await aiImage(it, asp, 'muqova');
    if (ai) return { data: ai, source: 'ai' };
    return { data: await smmRender.renderTemplate({ title: it.title || it.topic || 'QurilishERP', subtitle: scenes[0]?.text || String(it.text || '').slice(0, 160), badge, aspect: asp }), source: 'template' };
  };
  if (format === 'post' || format === 'story') {
    const c = await cover(aspect);
    return { files: [{ data: c.data, mime: 'image/jpeg' }], format, source: c.source };
  }
  const slides: Buffer[] = [];
  const c = await cover(aspect);
  slides.push(c.data);
  const list = scenes.length ? scenes : [{ title: it.title, text: String(it.text || '').slice(0, 110) }];
  const n = Math.min(list.length, 4);
  // Barchasi BARAVARIGA so'raladi — ketma-ket bo'lsa 5 ta rasm bir necha daqiqa olardi
  const made = await Promise.all(Array.from({ length: n }, (_, i) => aiImage(list[i], aspect, `slayd ${i + 1}`)));
  for (let i = 0; i < n; i++) {
    slides.push(made[i] || await smmRender.renderTemplate({ title: list[i].title || it.title, subtitle: list[i].text, badge: `${i + 1}/${n}`, aspect, variant: i + 1 }));
  }
  if (format === 'carousel') return { files: slides.map((d) => ({ data: d, mime: 'image/jpeg' })), format, source: c.source };
  try {
    const video = await smmRender.renderSlideshow(slides, 3.5);
    return { files: [{ data: video, mime: 'video/mp4' }], format: 'reel', source: c.source };
  } catch (e) {
    console.warn('[smm] reels yaratilmadi — post:', (e as Error)?.message?.slice(0, 120));
    return { files: [{ data: slides[0], mime: 'image/jpeg' }], format: 'post', source: c.source };
  }
}

async function notifyOwner(text: string): Promise<void> {
  const c = agentConfig();
  if (!c.botToken) return;
  const chats = new Set<string>();
  if (c.devChat) chats.add(c.devChat);
  if (!chats.size) {
    const devs: any[] = await User.find({ role: 'dasturchi', telegramChatId: { $exists: true, $ne: null } }).select('telegramChatId').limit(3).lean().catch(() => []);
    for (const d of devs) if (d.telegramChatId) chats.add(String(d.telegramChatId));
  }
  for (const chat of chats) {
    await fetch(`https://api.telegram.org/bot${c.botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
  }
}

async function auditRun(description: string, entityId: string, newValue?: unknown) {
  await logAudit({ userId: 'system', userName: 'SMM avtopilot', userRole: 'system', action: 'create', entity: 'smm_autopilot', entityId, description, newValue }).catch(() => undefined);
}

/** Bitta slotni bajarish (claim qilingan SmmRun bilan). */
export async function runSlot(runKey: string, date: string, s: any): Promise<string> {
  const finish = async (status: string, note: string, extra: Record<string, unknown> = {}) => {
    await SmmRun.updateOne({ key: runKey }, { $set: { status, note: note.slice(0, 500), ...extra } });
    await auditRun(`SMM avtopilot: ${note}`, runKey, { status, ...extra });
    return status;
  };
  const done = await SmmRun.countDocuments({ date, status: { $in: ['prepared', 'published'] } });
  if (done >= (s.dailyCap || 3)) return finish('skipped', `kunlik limit (${s.dailyCap || 3}) — o'tkazildi`);
  const recent: any[] = await SmmRun.find({ status: { $in: ['prepared', 'published'] } }).sort({ createdAt: -1 }).limit(60).select('format category topic').lean();
  const formats = (s.formats?.length ? s.formats : SMM_FORMATS) as SmmFormat[];
  const format = pickLeastRecent(formats, recent.map((r) => r.format));
  const category = pickLeastRecent(SMM_CATEGORIES, recent.map((r) => r.category));
  const history = recent.map((r) => r.topic).filter(Boolean);
  const r = await createTaskAndWait('smm', autopilotPrompt({ format, category, history, language: s.language || 'uz' }), AUTOPILOT_BY);
  if (!r.ok) return finish('failed', `SMM agenti ishlamadi (${r.error})`);
  if (r.task.status !== 'done' || !r.task.items.length) return finish('failed', `post tayyorlanmadi (${r.task.error || 'bo\'sh'})`, { taskId: r.task.id });
  const taskId = r.task.id;
  const t: any = await AgentTask.findById(taskId).lean();
  const it = { ...t.items[0], format, category: t.items[0].category || category };
  const approve = s.mode === 'approve';
  await AgentTask.updateOne({ _id: taskId }, {
    $set: { items: [{ ...it, approval: approve ? 'pending' : 'approved' }] },
    $push: { log: logLine(approve ? 'Avtopilot: tasdiq kutmoqda (rasm/video qurilmangizda yaratiladi)' : "Avtopilot: to'liq avto — e'lon qilinmoqda") },
  });
  const meta = { taskId, format, category, topic: String(it.topic || it.title || '').slice(0, 300) };
  if (approve) {
    await notifyOwner(`📝 SMM avtopilot: yangi ${FORMAT_UZ[format]} tasdiq kutmoqda — «${String(it.title || '').slice(0, 100)}».\nAI ofis → SMM → «Tasdiqlash va e'lon qilish».`);
    return finish('prepared', `tasdiqqa tayyorlandi: ${format} — «${String(it.title || '').slice(0, 80)}»`, meta);
  }
  // ── To'liq avto ──
  const wantIg = s.targets?.instagram !== false && igConfigured() && publicUrlOk();
  const wantTg = s.targets?.telegram !== false && !!((await channelConfig()).chat && agentConfig().botToken);
  if (!wantIg && !wantTg) {
    await AgentTask.updateOne({ _id: taskId }, { $set: { 'items.0.approval': 'pending' }, $push: { log: logLine("Avtopilot: Instagram ham, Telegram kanal ham sozlanmagan — e'lon qilinmadi, tasdiq kutadi") } });
    return finish('prepared', "e'lon joyi sozlanmagan — tasdiq kutadi", meta);
  }
  let media: { files: InFile[]; format: SmmFormat; source: string };
  try {
    media = await serverMedia(it, format);
  } catch (e) {
    await AgentTask.updateOne({ _id: taskId }, { $set: { 'items.0.approval': 'pending' }, $push: { log: logLine(`Avtopilot: rasm yaratilmadi (${(e as Error)?.message?.slice(0, 80)}) — tasdiq kutadi`) } });
    return finish('prepared', 'rasm yaratilmadi — tasdiq kutadi', meta);
  }
  await AgentTask.updateOne({ _id: taskId }, {
    $set: {
      'items.0.format': media.format,
      'items.0.media': media.files.map((f, i) => ({ id: `server-${i}`, kind: f.mime.startsWith('video/') ? 'video' : 'image', mime: f.mime, size: f.data.length, source: `server-${media.source}`, at: new Date() })),
    },
    $push: { log: logLine(`Avtopilot: ${media.files.length} ta fayl serverda yaratildi (${media.source === 'ai' ? 'AI rasm' : 'shablon'}) — e'londan so'ng o'chiriladi`) },
  });
  const results: string[] = [];
  let okAny = false;
  if (wantTg) {
    const x = await publishItem(taskId, 0, 'telegram', media.files, { tgTarget: 'channel', auto: true });
    results.push(`Telegram: ${x.ok ? 'ok' : x.error}`); okAny ||= x.ok;
  }
  if (wantIg) {
    const x = await publishItem(taskId, 0, 'instagram', media.files, { kind: media.format, auto: true, wait: true });
    results.push(`Instagram: ${x.ok ? 'ok' : x.error}`); okAny ||= x.ok;
  }
  media.files.length = 0; // xotiradan ham bo'shatiladi
  return finish(okAny ? 'published' : 'failed', `${media.format}: ${results.join(', ')}`, { ...meta, format: media.format });
}

// ───────────── Tick (har daqiqa) ─────────────
let running = false;
export async function smmTick(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    await purgeExpiredTemp(now);
    await expireStalePublishing(now.getTime());
    const s: any = await loadSettings();
    // 1) Avtopilot
    if (s.mode !== 'off' && !s.paused && !envKill()) {
      const slot = dueSlot({ days: s.days || [], times: (s.times || []).filter(isHHmm) }, now);
      if (slot) {
        let claimed = false;
        try { await SmmRun.create({ key: slot.key, date: slot.date, mode: s.mode }); claimed = true; } catch (e: any) { if (e?.code !== 11000) throw e; }
        if (claimed) {
          try { await runSlot(slot.key, slot.date, s); } catch (e) {
            await SmmRun.updateOne({ key: slot.key }, { $set: { status: 'failed', note: String((e as Error)?.message || 'xato').slice(0, 300) } });
          }
        }
      }
    }
    // 2) Statistika — har 6 soatda (bitta instansiya: atomik "claim")
    if (igConfigured()) {
      const six = new Date(now.getTime() - 6 * 3600_000);
      const got = await SmmSettings.findOneAndUpdate({ key: 'global', $or: [{ insightsAt: { $exists: false } }, { insightsAt: null }, { insightsAt: { $lt: six } }] }, { $set: { insightsAt: now } });
      if (got) await refreshInsights(now);
      // 3) Tokenni yangilash — kuniga bir marta tekshiriladi
      const day = new Date(now.getTime() - 24 * 3600_000);
      const tok = await SmmSettings.findOneAndUpdate({ key: 'global', $or: [{ igRefreshCheckAt: { $exists: false } }, { igRefreshCheckAt: null }, { igRefreshCheckAt: { $lt: day } }] }, { $set: { igRefreshCheckAt: now } });
      if (tok) await igMaybeRefresh(now);
    }
  } finally {
    running = false;
  }
}

let started = false;
export function startSmm(): void {
  if (started) return;
  started = true;
  const run = () => { smmTick().catch((e) => console.error('[smm] tick:', (e as Error)?.message)); };
  const first = setTimeout(run, 45_000);
  first.unref?.();
  const t = setInterval(run, 60_000);
  t.unref?.();
}
