import AgentTask from '../../models/AgentTask';
import User from '../../models/User';
import { logAudit } from '../../services/audit';
import { agentConfig } from '../agents/service';
import { IgError, igConfigured, igPublish, type IgKind } from './instagram';
import { smmRender, ffmpegAvailable } from './render';
import { TgError, tgSendPost, type TgFile } from './telegram';
import { publicUrlOk, putTemp, removeTemp } from './tempMedia';

// SMM e'lon (owner 2026-10-23): qurilmadan kelgan (yoki avtopilot serverda yaratgan) fayllar bilan Telegram / Instagram.
// Fayl hech qayerda doimiy saqlanmaydi: Telegram — to'g'ridan-to'g'ri multipart; Instagram — vaqtinchalik ommaviy havola
// (tempMedia, 1 soat TTL), konteyner tayyor bo'lib e'lon qilingach (yoki xato bo'lsa) darhol o'chiriladi.
// Har amal: vazifa jurnaliga (AgentTask.log) + audit (AuditLog, entity 'smm_publish').

export interface InFile { data: Buffer; mime: string }
export type PublishTarget = 'telegram' | 'instagram';
export interface PublishOpts {
  kind?: IgKind; tgTarget?: 'channel' | 'developer'; by?: string; auto?: boolean; force?: boolean; req?: any;
  /** true — Instagram tugashini kutadi (avtopilot); aks holda fon ishi (202). */
  wait?: boolean;
}
export interface PublishResult { ok: boolean; status: number; error?: string; detail?: string; sentTo?: 'channel' | 'developer'; url?: string; pending?: boolean }

const pending = new Set<Promise<unknown>>();
export async function __drainSmmForTests(): Promise<void> { while (pending.size) await Promise.allSettled([...pending]); }
const background = (p: Promise<unknown>) => {
  const q = p.catch((e) => console.error('[smm] fon xatosi:', (e as Error)?.message)).finally(() => pending.delete(q));
  pending.add(q);
};

const logLine = (text: string) => ({ at: new Date(), text: text.slice(0, 500) });
const ID_RE = /^[0-9a-f]{24}$/i;
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];

export function captionOf(it: { title?: string; text?: string; hashtags?: string[] }, max = 2200): string {
  const tags = (it.hashtags || []).filter((h) => /^#\S+$/.test(h)).slice(0, 30).join(' ');
  return [it.title, it.text, tags].filter(Boolean).join('\n\n').slice(0, max);
}

async function audit(by: string | undefined, description: string, entityId: string, req?: any, newValue?: unknown): Promise<void> {
  const u: any = by && ID_RE.test(by) ? await User.findById(by).select('firstName lastName role').lean().catch(() => null) : null;
  await logAudit({
    userId: by || 'system', userName: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || (by ? 'Dasturchi' : 'SMM avtopilot'),
    userRole: u?.role || (by ? 'dasturchi' : 'system'), action: 'create', entity: 'smm_publish', entityId, description, newValue, req,
  }).catch(() => undefined);
}

/** Telegram uchun chat: kanal (sozlangan bo'lsa) yoki (faqat qo'lda) dasturchining o'z chati. Avtopilot — faqat kanal. */
async function tgChat(target: 'channel' | 'developer', by: string | undefined, strict: boolean): Promise<{ chat: string; sentTo: 'channel' | 'developer' } | null> {
  const c = agentConfig();
  if (!c.botToken) return null;
  if (target === 'channel' && c.tgChannel) return { chat: c.tgChannel, sentTo: 'channel' };
  if (strict) return null;
  if (target === 'developer' && c.devChat) return { chat: c.devChat, sentTo: 'developer' };
  const own: any = by && ID_RE.test(by) ? await User.findById(by).select('telegramChatId').lean().catch(() => null) : null;
  if (own?.telegramChatId) return { chat: String(own.telegramChatId), sentTo: 'developer' };
  if (c.devChat) return { chat: c.devChat, sentTo: 'developer' };
  return null;
}

/** Instagram uchun fayllarni tayyorlash: rasm → JPEG, video → MP4 (H.264). */
export async function prepareForInstagram(files: InFile[]): Promise<{ data: Buffer; mime: string; kind: 'image' | 'video' }[]> {
  const out: { data: Buffer; mime: string; kind: 'image' | 'video' }[] = [];
  for (const f of files) {
    if (IMAGE_MIMES.includes(f.mime)) {
      if (f.mime === 'image/jpeg') { out.push({ data: f.data, mime: f.mime, kind: 'image' }); continue; }
      if (!ffmpegAvailable()) throw new IgError('ig_jpeg_required', '', 400);
      const data = await smmRender.toJpeg(f.data, 0, 0).catch(() => { throw new IgError('ig_jpeg_required', '', 400); });
      out.push({ data, mime: 'image/jpeg', kind: 'image' });
    } else if (VIDEO_MIMES.includes(f.mime)) {
      if (ffmpegAvailable()) {
        try { out.push({ data: await smmRender.transcodeToMp4(f.data), mime: 'video/mp4', kind: 'video' }); continue; } catch { /* pastda */ }
      }
      if (f.mime !== 'video/mp4') throw new IgError('ig_video_format', 'MP4 (H.264) kerak', 400);
      out.push({ data: f.data, mime: f.mime, kind: 'video' });
    } else {
      throw new IgError('ig_media_format', f.mime, 400);
    }
  }
  return out;
}

export function resolveKind(kind: unknown, format: unknown, files: InFile[]): IgKind {
  const k = ['post', 'carousel', 'reel', 'story'].includes(String(kind)) ? (kind as IgKind) : ['post', 'carousel', 'reel', 'story'].includes(String(format)) ? (format as IgKind) : 'post';
  const hasVideo = files.some((f) => f.mime.startsWith('video/'));
  if (k === 'post' && hasVideo && !files.some((f) => f.mime.startsWith('image/'))) return 'reel';
  if (k === 'carousel' && files.length < 2) return hasVideo ? 'reel' : 'post';
  if (k === 'reel' && !hasVideo) return files.length >= 2 ? 'carousel' : 'post';
  return k;
}

export async function publishItem(taskId: string, index: number, target: PublishTarget, files: InFile[], o: PublishOpts = {}): Promise<PublishResult> {
  if (!ID_RE.test(taskId)) return { ok: false, status: 404, error: 'not_found' };
  const t: any = await AgentTask.findById(taskId).lean();
  if (!t) return { ok: false, status: 404, error: 'not_found' };
  if (t.status !== 'done') return { ok: false, status: 409, error: 'not_done' };
  const it = t.items?.[index];
  if (!Number.isInteger(index) || !it) return { ok: false, status: 400, error: 'invalid' };
  const key = `items.${index}`;
  const where = `${taskId}:${index}`;

  if (target === 'telegram') {
    const dest = await tgChat(o.tgTarget || 'channel', o.by, !!o.auto);
    if (!dest) return { ok: false, status: 409, error: 'not_configured' };
    try {
      const r = await tgSendPost({ token: agentConfig().botToken, chat: dest.chat, text: captionOf(it, 4096), title: it.title, files: files.map((f): TgFile => ({ data: f.data, mime: f.mime })) });
      const state = { status: 'published', at: new Date(), target: dest.sentTo, messageId: r.messageId, ...(r.url ? { url: r.url } : {}) };
      await AgentTask.updateOne({ _id: taskId }, { $set: { [`${key}.tg`]: state }, $push: { log: logLine(`${o.auto ? 'Avtopilot: ' : ''}Telegram ${dest.sentTo === 'channel' ? 'kanalga' : 'chatingizga'} yuborildi${files.length ? ` (${files.length} ta fayl)` : ''}`) } });
      await audit(o.by, `SMM: Telegram ${dest.sentTo === 'channel' ? 'kanalga' : 'dasturchi chatiga'} e'lon — "${String(it.title || '').slice(0, 80)}"`, where, o.req, { target: 'telegram', sentTo: dest.sentTo, files: files.length });
      return { ok: true, status: 200, sentTo: dest.sentTo, url: r.url };
    } catch (e) {
      const detail = e instanceof TgError ? e.detail : '';
      await AgentTask.updateOne({ _id: taskId }, { $set: { [`${key}.tg`]: { status: 'failed', at: new Date(), error: 'telegram_failed', detail } }, $push: { log: logLine(`Telegram xatosi: ${detail || 'yuborilmadi'}`) } });
      return { ok: false, status: 502, error: 'telegram_failed', detail };
    }
  }

  // ── Instagram ──
  if (!igConfigured()) return { ok: false, status: 409, error: 'ig_not_configured' };
  if (!publicUrlOk()) return { ok: false, status: 409, error: 'public_url_required' };
  if (!files.length) return { ok: false, status: 400, error: 'ig_media_required' };
  const kind = resolveKind(o.kind, it.format, files);
  // Ikki marta e'lon qilmaslik: 'publishing' bo'lsa rad; 'published' — faqat force bilan
  const blocked = o.force ? ['publishing'] : ['publishing', 'published'];
  const claim = await AgentTask.updateOne(
    { _id: taskId, [`${key}.ig.status`]: { $nin: blocked } },
    { $set: { [`${key}.ig`]: { status: 'publishing', at: new Date(), kind } }, $push: { log: logLine(`${o.auto ? 'Avtopilot: ' : ''}Instagram'ga yuborilyapti (${kind})`) } },
  );
  if (!claim.modifiedCount) return { ok: false, status: 409, error: it.ig?.status === 'published' ? 'already_published' : 'publishing' };

  const run = async (): Promise<PublishResult> => {
    const tokens: string[] = [];
    try {
      const prepared = await prepareForInstagram(files);
      const media = [];
      for (const f of prepared) {
        const tmp = await putTemp(f.data, f.mime);
        tokens.push(tmp.token);
        media.push({ url: tmp.url, kind: f.kind });
      }
      const r = await igPublish(kind, media, captionOf(it), {
        onStep: (s) => { AgentTask.updateOne({ _id: taskId }, { $push: { log: logLine(s) } }).catch(() => undefined); },
      });
      await AgentTask.updateOne({ _id: taskId }, {
        $set: { [`${key}.ig`]: { status: 'published', at: new Date(), kind, mediaId: r.mediaId, ...(r.permalink ? { url: r.permalink } : {}) } },
        $push: { log: logLine(`Instagram'da e'lon qilindi (${kind})${r.permalink ? ` — ${r.permalink}` : ''}`) },
      });
      await audit(o.by, `SMM: Instagram ${kind} e'lon qilindi — "${String(it.title || '').slice(0, 80)}"`, where, o.req, { target: 'instagram', kind, mediaId: r.mediaId });
      return { ok: true, status: 200, url: r.permalink };
    } catch (e) {
      const err = e instanceof IgError ? e : new IgError('ig_failed', (e as Error)?.message?.slice(0, 200) || '');
      await AgentTask.updateOne({ _id: taskId }, {
        $set: { [`${key}.ig`]: { status: 'failed', at: new Date(), kind, error: err.code, ...(err.detail ? { detail: err.detail } : {}) } },
        $push: { log: logLine(`Instagram xatosi (${err.code})${err.detail ? `: ${err.detail}` : ''}`) },
      });
      await audit(o.by, `SMM: Instagram e'lon xatosi (${err.code})`, where, o.req, { target: 'instagram', kind, error: err.code });
      return { ok: false, status: err.httpStatus, error: err.code, detail: err.detail };
    } finally {
      // Vaqtinchalik fayllar darhol o'chiriladi (Instagram ularni allaqachon olgan)
      await removeTemp(tokens);
    }
  };
  if (o.wait) return run();
  background(run());
  return { ok: true, status: 202, pending: true };
}

/** 20 daqiqadan beri 'publishing' holatida qolgan (masalan server qayta ishga tushgan) — 'failed'. */
export async function expireStalePublishing(now = Date.now()): Promise<void> {
  const rows: any[] = await AgentTask.find({ 'items.ig.status': 'publishing' }).select('items').limit(50).lean();
  for (const r of rows) {
    for (let i = 0; i < (r.items || []).length; i++) {
      const ig = r.items[i]?.ig;
      if (ig?.status === 'publishing' && ig.at && now - new Date(ig.at).getTime() > 20 * 60_000) {
        await AgentTask.updateOne({ _id: r._id, [`items.${i}.ig.status`]: 'publishing' }, {
          $set: { [`items.${i}.ig.status`]: 'failed', [`items.${i}.ig.error`]: 'ig_timeout' }, $push: { log: logLine('Instagram javobi kelmadi — qayta urinib ko\'ring') },
        });
      }
    }
  }
}
