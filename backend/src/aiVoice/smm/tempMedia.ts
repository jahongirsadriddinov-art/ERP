import crypto from 'crypto';
import type { Request, Response } from 'express';
import { SmmTempMedia } from '../../models/Smm';
import { getBackendUrl } from '../../utils/backendUrl';

// Vaqtinchalik e'lon fayllari (owner 2026-10-23: rasm/video QURILMADA saqlanadi). Instagram faqat ommaviy URL'dan oladi —
// shu sabab e'lon paytida fayl bu yerga yoziladi: taxmin qilib bo'lmaydigan token (192 bit), Mongo'da (bir nechta
// instansiyada ham ishlaydi), 1 soatlik TTL (expireAt indeksi) va ish tugashi bilan darhol o'chiriladi.

export const TEMP_TTL_MS = 60 * 60_000;
const CHUNK = 8 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const TOKEN_RE = /^([A-Za-z0-9_-]{32})(?:\.[a-z0-9]{2,4})?$/;

export function publicBase(): string { return getBackendUrl(); }
/** Instagram serverlari fayl olishi uchun ommaviy https manzil kerak (localhost emas). */
export function publicUrlOk(): boolean {
  const b = publicBase();
  return /^https:\/\//.test(b) && !/localhost|127\.0\.0\.1|\.local\b/.test(b);
}

export async function putTemp(data: Buffer, mime: string, ttlMs = TEMP_TTL_MS): Promise<{ token: string; url: string }> {
  const token = crypto.randomBytes(24).toString('base64url');
  const parts = Math.max(1, Math.ceil(data.length / CHUNK));
  const expireAt = new Date(Date.now() + ttlMs);
  const docs = Array.from({ length: parts }, (_, i) => ({ token, part: i, parts, mime, size: data.length, data: data.subarray(i * CHUNK, (i + 1) * CHUNK), expireAt }));
  await SmmTempMedia.insertMany(docs, { ordered: true });
  return { token, url: `${publicBase()}/api/smm-media/${token}.${EXT[mime] || 'bin'}` };
}

export async function getTemp(token: string): Promise<{ data: Buffer; mime: string } | null> {
  const rows: any[] = await SmmTempMedia.find({ token, expireAt: { $gt: new Date() } }).sort({ part: 1 }).lean();
  if (!rows.length || rows.length !== rows[0].parts) return null;
  const data = Buffer.concat(rows.map((r) => (r.data?.buffer ? Buffer.from(r.data.buffer) : Buffer.from(r.data))));
  return { data, mime: rows[0].mime || 'application/octet-stream' };
}

export async function removeTemp(tokens: string[]): Promise<void> {
  if (tokens.length) await SmmTempMedia.deleteMany({ token: { $in: tokens } }).catch(() => undefined);
}
/** TTL indeksi ham o'chiradi; bu — qo'shimcha (Mongo TTL monitori 60 s kechikishi mumkin). */
export async function purgeExpiredTemp(now = new Date()): Promise<number> {
  const r = await SmmTempMedia.deleteMany({ expireAt: { $lte: now } }).catch(() => ({ deletedCount: 0 }));
  return (r as any).deletedCount || 0;
}

/** GET /api/smm-media/:file — ommaviy (auth yo'q, faqat token). Range qo'llanadi (video). */
export async function serveTempMedia(req: Request, res: Response): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const m = TOKEN_RE.exec(String(req.params.file || ''));
  if (!m) { res.status(404).end(); return; }
  try {
    const f = await getTemp(m[1]);
    if (!f || !/^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime))$/.test(f.mime)) { res.status(404).end(); return; }
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && (range[1] || range[2])) {
      const size = f.data.length;
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start); end = Math.min(size - 1, end);
      if (start > end) { res.status(416).setHeader('Content-Range', `bytes */${size}`); res.end(); return; }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      res.end(f.data.subarray(start, end + 1));
      return;
    }
    res.setHeader('Content-Length', String(f.data.length));
    res.end(f.data);
  } catch {
    res.status(500).end();
  }
}
