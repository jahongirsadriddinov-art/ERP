import mongoose, { Schema } from 'mongoose';
import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';

// Render'ning diski EPHEMERAL: har deploy/restart'da /uploads papkasi tozalanadi — chatga
// tashlangan rasmlar, "Ish jarayoni" rasmlari, APK/exe havolalari o'lik havolaga aylanardi
// (Cloudinary sozlanmagan bo'lsa). Shu sabab diskka yozilgan har bir fayl nusxasi MongoDB'ga
// ham saqlanadi va disk'da topilmasa shu yerdan beriladi.
const MAX_BYTES = 15 * 1024 * 1024; // Mongo hujjati 16MB bilan cheklangan

const StoredFile: any = (mongoose.models as any).StoredFile || mongoose.model('StoredFile', new Schema({
  name: { type: String, required: true, unique: true },
  contentType: { type: String },
  size: { type: Number },
  data: { type: Buffer, required: true },
}, { timestamps: true }));

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.heic': 'image/heic', '.heif': 'image/heif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.pdf': 'application/pdf', '.apk': 'application/vnd.android.package-archive', '.exe': 'application/x-msdownload',
};
const SAFE_NAME = /^[A-Za-z0-9._-]{1,200}$/;

export async function persistUploadedFile(filePath: string): Promise<void> {
  try {
    const name = path.basename(filePath);
    if (!SAFE_NAME.test(name)) return;
    const st = fs.statSync(filePath);
    if (st.size === 0 || st.size > MAX_BYTES) return;
    const data = fs.readFileSync(filePath);
    const contentType = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
    await StoredFile.updateOne({ name }, { $set: { name, contentType, size: st.size, data } }, { upsert: true });
  } catch (e) {
    console.error('[durable upload]', (e as Error).message);
  }
}

// express.static'dan KEYIN ulanadi: disk'da yo'q bo'lsagina ishga tushadi.
export async function serveDurableUpload(req: Request, res: Response) {
  try {
    const name = String(req.params.name || '');
    if (!SAFE_NAME.test(name)) return res.status(404).end();
    const doc: any = await StoredFile.findOne({ name }).lean();
    if (!doc) return res.status(404).end();
    res.setHeader('Content-Type', doc.contentType || 'application/octet-stream');
    // SVG ichida skript bo'lishi mumkin — hech qachon inline ko'rsatilmaydi (stored XSS'ning oldi)
    if (/\.svg$/i.test(name) || /svg/i.test(String(doc.contentType))) res.setHeader('Content-Disposition', 'attachment');
    // O'zgarmas nomlilar (APK/exe "latest") har safar yangilanadi — kesh qilinmasin
    res.setHeader('Cache-Control', /latest/i.test(name) ? 'no-cache' : 'public, max-age=31536000, immutable');
    const buf: Buffer = (doc.data && doc.data.buffer) ? Buffer.from(doc.data.buffer) : Buffer.from(doc.data);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  } catch {
    res.status(500).end();
  }
}
