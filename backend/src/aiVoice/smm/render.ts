import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { geminiApiKeys } from '../../services/gemini';

// SMM rasm/video (owner 2026-10-23). Hech narsa diskda/bazada SAQLANMAYDI — natija Buffer bo'lib qaytadi:
//  • qurilma uchun: Gemini rasmi brauzerga beriladi (u IndexedDB'da saqlaydi);
//  • "to'liq avto" avtopilot uchun: rasm (Gemini yoki brendli shablon) → vaqtinchalik → e'lon → o'chirish.
// ffmpeg-static (allaqachon dependency — chat ovozlari uchun) bilan: shablon rasm (gradient + matn), PNG → JPEG
// (Instagram faqat JPEG qabul qiladi), WebM → MP4 (Reels H.264), shablon slaydlardan oddiy Reels videosi.

export const GEMINI_IMAGE_MODEL = () => (process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image').trim();
export class ImageUnavailable extends Error { constructor(public reason: string) { super(reason); } }

export type Aspect = '1:1' | '4:5' | '9:16';
export const ASPECT_SIZE: Record<Aspect, [number, number]> = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920] };

/** Ingliz tilidagi rasm tavsifi (matnsiz) — post mavzusidan. */
export function imagePromptFor(item: { title?: string; text?: string; imagePrompt?: string; category?: string }): string {
  const base = (item.imagePrompt || '').trim() || `Topic: ${String(item.title || '').slice(0, 160)}. ${String(item.text || '').slice(0, 300)}`;
  return [
    'Create a professional, modern social media visual for a construction-management software company (QurilishERP, Uzbekistan).',
    base,
    'Style: clean, bright, realistic photo or polished 3D illustration of construction sites, engineers, foremen with tablets/phones, building materials, cranes — Central Asian setting.',
    'Brand colours: deep navy blue (#1B3A6B) and warm amber/orange (#B45309, #F59E0B) accents, white space.',
    'IMPORTANT: no text, no letters, no logos, no watermarks in the image (at most a tiny abstract icon). High quality, sharp, well lit.',
  ].join('\n');
}

/** Gemini native rasm yaratish (REST, kalitlar rotatsiyasi). Bo'lmasa — ImageUnavailable. */
export async function generateAiImage(prompt: string, aspect: Aspect = '4:5'): Promise<{ data: Buffer; mime: string }> {
  const keys = geminiApiKeys();
  if (!keys.length) throw new ImageUnavailable('no_key');
  const model = GEMINI_IMAGE_MODEL();
  let last = 'failed';
  for (const key of keys) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch { last = 'unreachable'; continue; }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 429 (kvota), 403 (ruxsat) — keyingi kalit; 404/400 (model yo'q / tarifda yo'q) — umuman yo'q
      last = res.status === 429 ? 'quota' : res.status === 404 ? 'model_unavailable' : `http_${res.status}`;
      if (res.status === 404 || res.status === 400) break;
      continue;
    }
    const parts: any[] = json?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p?.inlineData?.data || p?.inline_data?.data);
    const d = img?.inlineData || img?.inline_data;
    if (d?.data) return { data: Buffer.from(String(d.data), 'base64'), mime: String(d.mimeType || d.mime_type || 'image/png') };
    last = 'no_image';
  }
  throw new ImageUnavailable(last);
}

// ───────────── ffmpeg ─────────────
export const ffmpegAvailable = (): boolean => !!ffmpegPath && fs.existsSync(String(ffmpegPath));

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'smm-'));
  try { return await fn(dir); } finally { fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}

function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegAvailable()) { reject(new Error('NO_FFMPEG')); return; }
    const p = spawn(String(ffmpegPath), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + String(d)).slice(-600); });
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('FFMPEG_TIMEOUT')); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(); else reject(new Error(`FFMPEG_${code}: ${err.trim().slice(-200)}`)); });
  });
}

/** Istalgan rasm → JPEG (w×h berilsa — "cover" bilan kesiladi, aks holda faqat format, eni ≤1440). */
export async function toJpeg(data: Buffer, w = 1080, h = 1350): Promise<Buffer> {
  return withTmp(async (dir) => {
    const inp = path.join(dir, 'in.img'), out = path.join(dir, 'out.jpg');
    await fs.promises.writeFile(inp, data);
    const vf = w && h ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=yuvj420p` : "scale='min(1440,iw)':-2,format=yuvj420p";
    await runFfmpeg(['-i', inp, '-vf', vf, '-frames:v', '1', '-q:v', '3', out], 60_000);
    return fs.promises.readFile(out);
  });
}

/** Brauzerda yozilgan WebM (yoki boshqa) video → MP4 H.264 + AAC, 30 fps (Instagram Reels talabi). */
export async function transcodeToMp4(data: Buffer): Promise<Buffer> {
  return withTmp(async (dir) => {
    const inp = path.join(dir, 'in.vid'), out = path.join(dir, 'out.mp4');
    await fs.promises.writeFile(inp, data);
    await runFfmpeg(['-i', inp, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-map', '0:v:0', '-map', '0:a:0?', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out], 8 * 60_000);
    return fs.promises.readFile(out);
  });
}

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf', '/usr/share/fonts/noto/NotoSans-Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/segoeuib.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf',
];
let fontCache: string | null | undefined;
/** Shablon matni uchun shrift (SMM_FONT_FILE yoki tizim shriftlari). Topilmasa — matnsiz shablon. */
export function findFont(): string | null {
  if (fontCache !== undefined) return fontCache;
  const list = [process.env.SMM_FONT_FILE || '', ...FONT_CANDIDATES].filter(Boolean);
  fontCache = list.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || null;
  return fontCache;
}
export function __resetFontForTests(): void { fontCache = undefined; }
const esc = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/** Matnni qatorlarga bo'lish (so'z bo'yicha). */
export function wrapText(s: string, max: number, maxLines: number): string[] {
  const words = String(s || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur ? cur.length + 1 : 0) + w.length > max && cur) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;:!?]?$/, '')}…`;
  return lines;
}

const PALETTES = [
  { c0: '0x10264a', c1: '0x1B3A6B', c2: '0xB45309', accent: '0xF59E0B' },
  { c0: '0x1B3A6B', c1: '0x0f5b78', c2: '0x0e7490', accent: '0xF59E0B' },
  { c0: '0x2a1606', c1: '0x7c2d12', c2: '0xB45309', accent: '0xFCD34D' },
];

export interface TemplateIn { title: string; subtitle?: string; badge?: string; aspect?: Aspect; variant?: number; footer?: string }
/** Brendli shablon (JPEG): gradient fon, dekorativ shakllar, belgi, sarlavha, qisqa matn, logotip yozuvi. */
export async function renderTemplate(t: TemplateIn): Promise<Buffer> {
  const [w, h] = ASPECT_SIZE[t.aspect || '4:5'];
  const pal = PALETTES[Math.abs(t.variant || 0) % PALETTES.length];
  const font = findFont();
  return withTmp(async (dir) => {
    const out = path.join(dir, 'out.jpg');
    const pad = Math.round(w * 0.08);
    const top = Math.round(h * (h > w * 1.4 ? 0.3 : 0.2));
    const filters: string[] = [
      // dekorativ: burchakdagi doiralar o'rniga yarim shaffof bloklar + aksent chiziq
      `drawbox=x=${w - Math.round(w * 0.42)}:y=${-Math.round(h * 0.06)}:w=${Math.round(w * 0.55)}:h=${Math.round(w * 0.55)}:color=white@0.06:t=fill`,
      `drawbox=x=${-Math.round(w * 0.12)}:y=${h - Math.round(h * 0.28)}:w=${Math.round(w * 0.5)}:h=${Math.round(w * 0.5)}:color=white@0.05:t=fill`,
      `drawbox=x=${pad}:y=${top}:w=${Math.round(w * 0.14)}:h=10:color=${pal.accent}@1:t=fill`,
      // "logo" belgisi — uycha shakli o'rniga 2 ta kvadrat
      `drawbox=x=${pad}:y=${h - pad - 64}:w=56:h=56:color=${pal.accent}@1:t=fill`,
      `drawbox=x=${pad + 14}:y=${h - pad - 50}:w=28:h=28:color=${pal.c1}@1:t=fill`,
    ];
    if (font) {
      const f = esc(font);
      const title = wrapText(t.title, h > w * 1.4 ? 16 : 18, 5);
      const sub = wrapText(t.subtitle || '', 32, h > w * 1.4 ? 6 : 4);
      await fs.promises.writeFile(path.join(dir, 'title.txt'), title.join('\n'));
      await fs.promises.writeFile(path.join(dir, 'sub.txt'), sub.join('\n'));
      await fs.promises.writeFile(path.join(dir, 'badge.txt'), (t.badge || 'QurilishERP').toUpperCase().slice(0, 40));
      await fs.promises.writeFile(path.join(dir, 'brand.txt'), t.footer || 'QurilishERP  ·  qurilish firmalari uchun ERP');
      const titleSize = Math.round(w * (title.length > 3 ? 0.072 : 0.085));
      const titleY = top + 48;
      const subY = titleY + title.length * Math.round(titleSize * 1.22) + 36;
      filters.push(
        `drawtext=fontfile='${f}':textfile='${esc(path.join(dir, 'badge.txt'))}':x=${pad}:y=${top - 64}:fontsize=${Math.round(w * 0.03)}:fontcolor=${pal.accent}`,
        `drawtext=fontfile='${f}':textfile='${esc(path.join(dir, 'title.txt'))}':x=${pad}:y=${titleY}:fontsize=${titleSize}:fontcolor=white:line_spacing=${Math.round(titleSize * 0.22)}`,
        `drawtext=fontfile='${f}':textfile='${esc(path.join(dir, 'sub.txt'))}':x=${pad}:y=${subY}:fontsize=${Math.round(w * 0.036)}:fontcolor=white@0.85:line_spacing=${Math.round(w * 0.014)}`,
        `drawtext=fontfile='${f}':textfile='${esc(path.join(dir, 'brand.txt'))}':x=${pad + 76}:y=${h - pad - 50}:fontsize=${Math.round(w * 0.03)}:fontcolor=white`,
      );
    }
    const src = `gradients=s=${w}x${h}:c0=${pal.c0}:c1=${pal.c1}:c2=${pal.c2}:nb_colors=3:x0=0:y0=0:x1=${w}:y1=${h}:duration=1:rate=1`;
    try {
      await runFfmpeg(['-f', 'lavfi', '-i', src, '-vf', `${filters.join(',')},format=yuvj420p`, '-frames:v', '1', '-q:v', '3', out], 60_000);
    } catch (e) {
      if (!font) throw e;
      // shrift muammosi — matnsiz (sarlavha baribir caption'da)
      await runFfmpeg(['-f', 'lavfi', '-i', src, '-vf', `${filters.filter((x) => !x.startsWith('drawtext')).join(',')},format=yuvj420p`, '-frames:v', '1', '-q:v', '3', out], 60_000);
    }
    return fs.promises.readFile(out);
  });
}

/** Slaydlardan (JPEG, 1080×1920) oddiy Reels videosi: sekin kattalashish + o'tishlar, jim audio trek. */
export async function renderSlideshow(slides: Buffer[], secEach = 3.5): Promise<Buffer> {
  if (!slides.length) throw new Error('NO_SLIDES');
  return withTmp(async (dir) => {
    const args: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const f = path.join(dir, `s${i}.jpg`);
      await fs.promises.writeFile(f, slides[i]);
      args.push('-i', f);
    }
    const n = slides.length;
    const frames = Math.round(secEach * 30);
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      parts.push(`[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0007,1.06)':d=${frames}:s=1080x1920:fps=30,setsar=1,format=yuv420p[v${i}]`);
    }
    let last = 'v0';
    const fade = 0.5;
    for (let i = 1; i < n; i++) {
      const outL = `x${i}`;
      parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${fade}:offset=${(i * (secEach - fade)).toFixed(2)}[${outL}]`);
      last = outL;
    }
    const out = path.join(dir, 'out.mp4');
    await runFfmpeg([...args, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-filter_complex', parts.join(';'), '-map', `[${last}]`, '-map', `${n}:a`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out], 6 * 60_000);
    return fs.promises.readFile(out);
  });
}

/** Testlar / avtopilot uchun almashtiriladigan to'plam. */
export const smmRender = { generateAiImage, renderTemplate, renderSlideshow, toJpeg, transcodeToMp4 };
