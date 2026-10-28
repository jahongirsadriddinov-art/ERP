import { spawn } from 'child_process';
import crypto from 'crypto';
import ffmpegPath from 'ffmpeg-static';

// Kamera (owner 2026-10-18): Telegram video qo'ng'irog'ida suhbatdosh kamerasi kadrlari (JPEG) — worker
// ~1 kadr/s yuboradi (videoga olishda ko'proq). Sessiya bo'yicha oxirgi ~30 s xotirada (bazaga yozilmaydi).
// Tool'lar (capturePhoto/recordVideo) shu yerdan oladi; olingan rasm/video 30 daqiqa "media" sifatida turadi
// (forwardMedia boshqa odamga yuborishi uchun), keyin o'chadi.

export const VIDEO_FRAME_MAX_BYTES = 600 * 1024;
const KEEP_MS = 30_000;
const KEEP_MAX = 240;
const MEDIA_TTL_MS = 30 * 60_000;

export interface Frame { at: number; jpeg: Buffer }
interface Ring { frames: Frame[]; listeners: Set<(f: Frame) => void>; firstAt: number }

const rings = new Map<string, Ring>();

export function pushFrame(sessionId: string, jpeg: Buffer, now = Date.now()): boolean {
  if (!sessionId || !jpeg?.length || jpeg.length > VIDEO_FRAME_MAX_BYTES) return false;
  // JPEG imzosi (FF D8) — boshqa narsa saqlanmaydi
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return false;
  let r = rings.get(sessionId);
  const first = !r;
  if (!r) { r = { frames: [], listeners: new Set(), firstAt: now }; rings.set(sessionId, r); }
  const f = { at: now, jpeg };
  r.frames.push(f);
  while (r.frames.length > KEEP_MAX || (r.frames.length && now - r.frames[0].at > KEEP_MS)) r.frames.shift();
  for (const l of [...r.listeners]) { try { l(f); } catch { /* tinglovchi xatosi */ } }
  return first;
}

export function hasVision(sessionId: string | undefined, maxAgeMs = 15_000, now = Date.now()): boolean {
  const r = sessionId ? rings.get(sessionId) : undefined;
  const last = r?.frames[r.frames.length - 1];
  return !!last && now - last.at <= maxAgeMs;
}

export function latestFrame(sessionId: string | undefined, maxAgeMs = 8_000, now = Date.now()): Frame | null {
  if (!hasVision(sessionId, maxAgeMs, now)) return null;
  const r = rings.get(sessionId!)!;
  return r.frames[r.frames.length - 1];
}

/** Keyingi `ms` davomida kelgan kadrlar (videoga olish). */
export function collectFrames(sessionId: string, ms: number): Promise<Frame[]> {
  const r = rings.get(sessionId);
  if (!r) return Promise.resolve([]);
  const out: Frame[] = [];
  return new Promise((resolve) => {
    const l = (f: Frame) => { out.push(f); };
    r.listeners.add(l);
    const t = setTimeout(() => { r.listeners.delete(l); resolve(out); }, ms);
    t.unref?.();
  });
}

export function clearVision(sessionId: string): void {
  const r = rings.get(sessionId);
  if (r) { r.listeners.clear(); rings.delete(sessionId); }
}

// ── Olingan media (rasm/video), 30 daqiqa ──
export interface Media { id: string; kind: 'photo' | 'video'; data: Buffer; companyId: string; ownerId: string; at: number; caption?: string }
const media = new Map<string, Media>();

export function saveMedia(m: Omit<Media, 'id' | 'at'>, now = Date.now()): Media {
  for (const [k, v] of media) if (now - v.at > MEDIA_TTL_MS) media.delete(k);
  while (media.size > 50) media.delete(media.keys().next().value as string);
  const item: Media = { ...m, id: crypto.randomBytes(6).toString('hex'), at: now };
  media.set(item.id, item);
  return item;
}

export function getMedia(id: string, companyId: string, now = Date.now()): Media | null {
  const m = media.get(String(id || ''));
  if (!m || m.companyId !== companyId || now - m.at > MEDIA_TTL_MS) return null;
  return m;
}

/** Oxirgi media (model id'ni unutsa — "shu rasmni yubor"). */
export function lastMediaOf(ownerId: string, companyId: string, now = Date.now()): Media | null {
  let best: Media | null = null;
  for (const m of media.values()) if (m.ownerId === ownerId && m.companyId === companyId && now - m.at <= MEDIA_TTL_MS && (!best || m.at > best.at)) best = m;
  return best;
}

/** JPEG ketma-ketligi → MP4 (H.264, telefonlarda ochiladi). ffmpeg-static; xato bo'lsa throw. */
export function encodeMp4(frames: Frame[], fps: number, timeoutMs = 30_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) { reject(new Error('NO_FFMPEG')); return; }
    if (!frames.length) { reject(new Error('NO_FRAMES')); return; }
    // Kirish tezligi — kadrlar HAQIQATDA qanday kelgan bo'lsa (chaqiruvchi hisoblab beradi),
    // chiqish esa DOIM 24 kadr/s. Ilgari mp4 ichida 2-6 kadr/s turardi: Telegram va ko'p
    // pleyerlar bunday videoni "qotib qolgan" qilib ko'rsatardi, surib ko'rish ham ishlamasdi
    // (owner 2026-10-28: "video sifati yomon va qotib qolgan"). Kadrlar takrorlanib,
    // tasvir o'sha-o'sha qoladi, lekin ijro silliq bo'ladi.
    const inFps = Math.max(0.5, Math.min(30, fps));
    const p = spawn(ffmpegPath as unknown as string, [
      '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(inFps), '-i', '-',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-r', '24',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-profile:v', 'baseline', '-level', '3.1',
      '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', '-',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('FFMPEG_TIMEOUT')); }, timeoutMs);
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-400); });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.length) resolve(Buffer.concat(out)); else reject(new Error(`FFMPEG_${code}: ${err}`));
    });
    p.stdin.on('error', () => undefined);
    for (const f of frames) p.stdin.write(f.jpeg);
    p.stdin.end();
  });
}
