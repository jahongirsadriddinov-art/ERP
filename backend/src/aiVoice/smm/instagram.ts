import crypto from 'crypto';
import { SmmSettings } from '../../models/Smm';
import { decryptString, encryptString, secretsKeyConfigured } from '../lib/crypto';

// Instagram Graph API — RASMIY kontent e'lon qilish (owner 2026-10-23). Ikki yo'l qo'llanadi:
//  • "Instagram API with Instagram Login" — token "IG..." bilan boshlanadi, host graph.instagram.com;
//  • "Instagram API with Facebook Login" (Facebook sahifasiga ulangan professional akkaunt) — token "EAA...", host graph.facebook.com.
// Env: INSTAGRAM_ACCESS_TOKEN (uzoq muddatli), INSTAGRAM_USER_ID (bo'lmasa /me'dan aniqlanadi), ixtiyoriy META_APP_ID /
// META_APP_SECRET (Facebook tokenini yangilash uchun), INSTAGRAM_GRAPH_HOST, INSTAGRAM_API_VERSION.
// E'lon: media konteyner → holatini kutish (FINISHED) → media_publish → permalink. Token HECH QACHON log/xatoga yozilmaydi.
// Sozlanmagan bo'lsa hech narsa e'lon qilinmaydi (IgError 'ig_not_configured').

const env = (k: string) => (process.env[k] || '').trim();
export const IG_DEFAULT_VERSION = 'v23.0';

export function igEnv() {
  const token = env('INSTAGRAM_ACCESS_TOKEN');
  return {
    token, userId: env('INSTAGRAM_USER_ID'), appId: env('META_APP_ID'), appSecret: env('META_APP_SECRET'),
    host: env('INSTAGRAM_GRAPH_HOST') || (token.startsWith('IG') ? 'graph.instagram.com' : 'graph.facebook.com'),
    version: env('INSTAGRAM_API_VERSION') || IG_DEFAULT_VERSION,
  };
}
export const igConfigured = () => !!igEnv().token;
const tokenSource = (t: string) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);

export class IgError extends Error {
  constructor(public code: string, public detail = '', public httpStatus = 502) { super(code); }
}

// ── Test ilgaklari ──
let sleepFn = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export function __setIgSleepForTests(fn: ((ms: number) => Promise<void>) | null): void {
  sleepFn = fn || ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
}

/** Graph xatosini tushunarli kodga aylantirish. */
export function mapGraphError(json: any, http: number): IgError {
  const e = json?.error || {};
  const code = Number(e.code) || 0;
  const sub = Number(e.error_subcode) || 0;
  const msg = String(e.error_user_msg || e.message || `HTTP ${http}`).replace(/access_token=[^&\s]+/g, 'access_token=***').slice(0, 300);
  let c = 'ig_failed';
  if ([190, 102, 463, 467].includes(code) || /access token/i.test(msg)) c = 'ig_token_invalid';
  else if (sub === 2207042) c = 'ig_publish_limit';
  else if ([2207052, 2207003].includes(sub) || code === 9004) c = 'ig_media_fetch';
  else if ([2207026, 2207009, 2207004, 2207005, 2207006].includes(sub) || code === 36003 || code === 352) c = 'ig_media_format';
  else if ([4, 17, 32, 613, 9, 80002].includes(code)) c = 'ig_rate_limited';
  else if (code === 10 || code === 3 || (code >= 200 && code < 300)) c = 'ig_permission';
  return new IgError(c, msg, http >= 500 ? 502 : 400);
}

export interface IgCred { token: string; userId: string; base: string; host: string }

/** Amaldagi token: DB'dagi yangilangani (env tokeni o'zgarmagan bo'lsa) yoki env. */
async function currentToken(): Promise<string> {
  const e = igEnv();
  if (!e.token) return '';
  const s: any = await SmmSettings.findOne({ key: 'global' }).select('igToken igTokenSource').lean().catch(() => null);
  if (s?.igToken && s.igTokenSource === tokenSource(e.token)) {
    try { return decryptString(s.igToken, 'smm-ig'); } catch { /* kalit almashgan — env */ }
  }
  return e.token;
}

async function graph(method: 'GET' | 'POST', base: string, path: string, params: Record<string, string | number | boolean | undefined>, token: string): Promise<any> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  p.set('access_token', token);
  const url = method === 'GET' ? `${base}/${path}?${p}` : `${base}/${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method, signal: AbortSignal.timeout(60_000),
      ...(method === 'POST' ? { body: p, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : {}),
    });
  } catch {
    throw new IgError('ig_unreachable', "Instagram serveriga ulanib bo'lmadi", 502);
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw mapGraphError(json, res.status);
  return json;
}

export async function igCredentials(): Promise<IgCred> {
  const e = igEnv();
  if (!e.token) throw new IgError('ig_not_configured', '', 409);
  const token = await currentToken();
  const base = `https://${e.host}/${e.version}`;
  let userId = e.userId;
  if (!userId) {
    const s: any = await SmmSettings.findOne({ key: 'global' }).select('igUserId').lean().catch(() => null);
    userId = s?.igUserId || '';
  }
  if (!userId) {
    // Instagram Login tokeni: /me → user_id; Facebook tokeni bilan INSTAGRAM_USER_ID majburiy
    if (e.host !== 'graph.instagram.com') throw new IgError('ig_user_id_missing', '', 409);
    const me = await graph('GET', base, 'me', { fields: 'user_id,username' }, token);
    userId = String(me.user_id || me.id || '');
    if (!userId) throw new IgError('ig_user_id_missing', '', 409);
    await SmmSettings.updateOne({ key: 'global' }, { $set: { igUserId: userId, ...(me.username ? { igUsername: me.username } : {}) } }, { upsert: true });
  }
  return { token, userId, base, host: e.host };
}

/** Ulanishni tekshirish: akkaunt nomi va obunachilar. */
export async function igCheck(): Promise<{ ok: true; username: string; userId: string; followers?: number; mediaCount?: number }> {
  const c = await igCredentials();
  const fields = c.host === 'graph.instagram.com' ? 'username,followers_count,media_count,account_type' : 'username,followers_count,media_count';
  const me = await graph('GET', c.base, c.userId, { fields }, c.token);
  await SmmSettings.updateOne({ key: 'global' }, { $set: { igUsername: me.username || '' } }, { upsert: true });
  return { ok: true, username: String(me.username || ''), userId: c.userId, followers: me.followers_count, mediaCount: me.media_count };
}

export type IgKind = 'post' | 'carousel' | 'reel' | 'story';
export interface IgMediaIn { url: string; kind: 'image' | 'video' }
export interface IgPublishOpts { pollMs?: number; timeoutMs?: number; onStep?: (s: string) => void }

async function waitContainer(c: IgCred, id: string, video: boolean, o: IgPublishOpts): Promise<void> {
  const step = o.pollMs ?? (video ? 5_000 : 2_000);
  const deadline = Date.now() + (o.timeoutMs ?? (video ? 10 * 60_000 : 2 * 60_000));
  for (let i = 0; ; i++) {
    const st = await graph('GET', c.base, id, { fields: 'status_code,status' }, c.token);
    const code = String(st.status_code || '');
    if (code === 'FINISHED' || code === 'PUBLISHED') return;
    if (code === 'ERROR') throw new IgError('ig_media_format', String(st.status || 'ERROR').slice(0, 300), 400);
    if (code === 'EXPIRED') throw new IgError('ig_expired', '', 400);
    if (Date.now() > deadline || i > 400) throw new IgError('ig_timeout', '', 504);
    await sleepFn(step);
  }
}

/** E'lon: post (1 rasm), carousel (2–10), reel (video), story (rasm yoki video). */
export async function igPublish(kind: IgKind, media: IgMediaIn[], caption: string, o: IgPublishOpts = {}): Promise<{ mediaId: string; permalink?: string }> {
  const c = await igCredentials();
  const cap = caption.slice(0, 2200);
  const make = (p: Record<string, string | boolean | undefined>) => graph('POST', c.base, `${c.userId}/media`, p, c.token).then((r) => String(r.id));
  let containerId: string;
  let video = false;
  if (kind === 'carousel') {
    if (media.length < 2 || media.length > 10) throw new IgError('ig_carousel_count', '', 400);
    const kids: string[] = [];
    for (const m of media) {
      const id = await make(m.kind === 'video' ? { media_type: 'VIDEO', video_url: m.url, is_carousel_item: true } : { image_url: m.url, is_carousel_item: true });
      await waitContainer(c, id, m.kind === 'video', o);
      kids.push(id);
      if (m.kind === 'video') video = true;
    }
    o.onStep?.(`Karusel: ${kids.length} ta bo'lak tayyor`);
    containerId = await make({ media_type: 'CAROUSEL', children: kids.join(','), caption: cap });
  } else if (kind === 'reel') {
    const v = media.find((m) => m.kind === 'video');
    if (!v) throw new IgError('ig_video_required', '', 400);
    video = true;
    containerId = await make({ media_type: 'REELS', video_url: v.url, caption: cap, share_to_feed: true });
  } else if (kind === 'story') {
    const m = media[0];
    if (!m) throw new IgError('ig_media_required', '', 400);
    video = m.kind === 'video';
    containerId = await make(video ? { media_type: 'STORIES', video_url: m.url } : { media_type: 'STORIES', image_url: m.url });
  } else {
    const m = media.find((x) => x.kind === 'image');
    if (!m) throw new IgError('ig_media_required', '', 400);
    containerId = await make({ image_url: m.url, caption: cap });
  }
  o.onStep?.('Instagram faylni qayta ishlayapti');
  await waitContainer(c, containerId, video, o);
  const pub = await graph('POST', c.base, `${c.userId}/media_publish`, { creation_id: containerId }, c.token);
  const mediaId = String(pub.id || '');
  let permalink: string | undefined;
  try {
    const m = await graph('GET', c.base, mediaId, { fields: 'permalink' }, c.token);
    if (typeof m.permalink === 'string' && /^https:\/\/(www\.)?instagram\.com\//.test(m.permalink)) permalink = m.permalink;
  } catch { /* permalink ixtiyoriy */ }
  return { mediaId, permalink };
}

// ───────────── Statistika ─────────────
const MEDIA_METRICS: Record<string, string[]> = {
  post: ['reach', 'likes', 'comments', 'saved', 'shares', 'views', 'total_interactions'],
  carousel: ['reach', 'likes', 'comments', 'saved', 'shares', 'views', 'total_interactions'],
  reel: ['reach', 'likes', 'comments', 'saved', 'shares', 'views', 'total_interactions', 'ig_reels_avg_watch_time'],
  story: ['reach', 'views', 'replies', 'shares', 'total_interactions'],
};
const MEDIA_FALLBACK: Record<string, string[]> = { story: ['reach', 'replies'], default: ['reach', 'likes', 'comments', 'saved'] };

const parseInsights = (json: any): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const d of Array.isArray(json?.data) ? json.data : []) {
    const v = d?.total_value?.value ?? d?.values?.[0]?.value;
    if (typeof d?.name === 'string' && typeof v === 'number' && Number.isFinite(v)) out[d.name] = v;
  }
  return out;
};

/** Bitta media statistikasi (API qaytargan narsa — media turiga qarab). */
export async function igMediaInsights(mediaId: string, kind: string): Promise<Record<string, number>> {
  const c = await igCredentials();
  let metrics: Record<string, number> = {};
  try {
    metrics = parseInsights(await graph('GET', c.base, `${mediaId}/insights`, { metric: (MEDIA_METRICS[kind] || MEDIA_METRICS.post).join(',') }, c.token));
  } catch (e) {
    if ((e as IgError).code === 'ig_token_invalid') throw e;
    try {
      metrics = parseInsights(await graph('GET', c.base, `${mediaId}/insights`, { metric: (MEDIA_FALLBACK[kind] || MEDIA_FALLBACK.default).join(',') }, c.token));
    } catch (e2) { if ((e2 as IgError).code === 'ig_token_invalid') throw e2; }
  }
  if (kind !== 'story' && (metrics.likes === undefined || metrics.comments === undefined)) {
    try {
      const f = await graph('GET', c.base, mediaId, { fields: 'like_count,comments_count' }, c.token);
      if (metrics.likes === undefined && typeof f.like_count === 'number') metrics.likes = f.like_count;
      if (metrics.comments === undefined && typeof f.comments_count === 'number') metrics.comments = f.comments_count;
    } catch { /* */ }
  }
  return metrics;
}

/** Akkaunt: obunachilar, kunlik qamrov, profil ko'rishlar. */
export async function igAccountInsights(): Promise<Record<string, number | string>> {
  const c = await igCredentials();
  const me = await graph('GET', c.base, c.userId, { fields: 'username,followers_count,media_count' }, c.token);
  const out: Record<string, number | string> = {};
  if (typeof me.followers_count === 'number') out.followers = me.followers_count;
  if (typeof me.media_count === 'number') out.mediaCount = me.media_count;
  if (me.username) out.username = String(me.username);
  try {
    const ins = parseInsights(await graph('GET', c.base, `${c.userId}/insights`, { metric: 'reach,profile_views,accounts_engaged,views', period: 'day', metric_type: 'total_value' }, c.token));
    Object.assign(out, ins);
  } catch {
    try { Object.assign(out, parseInsights(await graph('GET', c.base, `${c.userId}/insights`, { metric: 'reach', period: 'day' }, c.token))); } catch { /* */ }
  }
  return out;
}

// ───────────── Tokenni yangilash ─────────────
const DAY = 86_400_000;
/** Uzoq muddatli token 60 kun yashaydi — muddati 15 kundan kam qolsa (yoki 20 kundan beri yangilanmagan bo'lsa) yangilanadi. */
export async function igMaybeRefresh(now = new Date(), force = false): Promise<{ refreshed: boolean; error?: string; expiresAt?: Date }> {
  const e = igEnv();
  if (!e.token) return { refreshed: false };
  const src = tokenSource(e.token);
  let s: any = await SmmSettings.findOne({ key: 'global' }).lean();
  if (s && s.igTokenSource && s.igTokenSource !== src) {
    // Egasi env'dagi tokenni almashtirdi — eski yangilangan token va holat tashlanadi
    await SmmSettings.updateOne({ key: 'global' }, { $unset: { igToken: 1, igTokenExpiresAt: 1, igLastRefreshAt: 1, igRefreshError: 1, igUserId: 1, igUsername: 1 }, $set: { igTokenSource: src } });
    s = { ...s, igToken: undefined, igTokenExpiresAt: undefined, igLastRefreshAt: undefined };
  }
  const exp = s?.igTokenExpiresAt ? new Date(s.igTokenExpiresAt).getTime() : 0;
  const last = s?.igLastRefreshAt ? new Date(s.igLastRefreshAt).getTime() : 0;
  const due = force || (exp ? exp - now.getTime() < 15 * DAY : !last || now.getTime() - last > 20 * DAY);
  if (!due) return { refreshed: false, expiresAt: exp ? new Date(exp) : undefined };
  const token = await currentToken();
  let url: string;
  if (e.host === 'graph.instagram.com') {
    url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  } else {
    if (!e.appId || !e.appSecret) return { refreshed: false, error: 'meta_app_missing' };
    url = `https://graph.facebook.com/${e.version}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(e.appId)}&client_secret=${encodeURIComponent(e.appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error || typeof json?.access_token !== 'string') throw mapGraphError(json, res.status);
    const expiresAt = typeof json.expires_in === 'number' && json.expires_in > 0 ? new Date(now.getTime() + json.expires_in * 1000) : undefined;
    const set: Record<string, unknown> = { igTokenSource: src, igLastRefreshAt: now, ...(expiresAt ? { igTokenExpiresAt: expiresAt } : {}) };
    const unset: Record<string, 1> = { igRefreshError: 1 };
    // Yangi token faqat shifrlangan holda saqlanadi (AI_SECRETS_KEY); kalit bo'lmasa — saqlanmaydi (env tokeni ishlatilaveradi)
    if (json.access_token !== token && secretsKeyConfigured()) set.igToken = encryptString(json.access_token, 'smm-ig');
    else if (json.access_token !== token) set.igRefreshError = 'secrets_key_missing';
    await SmmSettings.updateOne({ key: 'global' }, { $set: set, ...(set.igRefreshError ? {} : { $unset: unset }) }, { upsert: true });
    return { refreshed: true, expiresAt };
  } catch (err) {
    const code = err instanceof IgError ? err.code : 'ig_unreachable';
    await SmmSettings.updateOne({ key: 'global' }, { $set: { igRefreshError: code, igTokenSource: src } }, { upsert: true });
    return { refreshed: false, error: code };
  }
}
