import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { hitRate } from '../lib/mongoRateLimit';
import { SmmRun } from '../../models/Smm';
import { analyticsSummary, refreshInsights } from './analytics';
import { connectionStatus, loadSettings, saveSettings, settingsDto } from './autopilot';
import { IgError, igCheck, igConfigured, igMaybeRefresh } from './instagram';
import { editItem, setApproval, setItemMedia } from './items';
import { IMAGE_MIMES, publishItem, VIDEO_MIMES } from './publish';
import { generateAiImage, ImageUnavailable, imagePromptFor, type Aspect } from './render';
import AgentTask from '../../models/AgentTask';

// SMM yo'llari (/api/ai-voice/platform/* — faqat dasturchi; bootstrap: requireAuth + requireDeveloper).

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((e) => {
      console.error('[aiVoice/smm] xato:', (e as Error)?.name || 'Error', (e as Error)?.message?.slice(0, 120));
      if (!res.headersSent) res.status(500).json({ error: 'internal' });
      else next();
    });
  };
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const uid = (req: Request) => String(req.user?.userId || '');
const idx = (req: Request) => Number.parseInt(String(req.params.i), 10);

export const MAX_FILE = 60 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE, files: 10 },
  fileFilter: (_req, f, cb) => cb(null, [...IMAGE_MIMES, ...VIDEO_MIMES].includes(f.mimetype)),
});

export const smmRoutes = Router();
smmRoutes.use('/smm', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

smmRoutes.get('/smm/settings', wrap(async (_req, res) => {
  res.json({ settings: settingsDto(await loadSettings()), status: await connectionStatus() });
}));

smmRoutes.put('/smm/settings', wrap(async (req, res) => {
  const r = await saveSettings(isObj(req.body) ? req.body : {}, uid(req), req);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, settings: r.settings });
}));

smmRoutes.get('/smm/runs', wrap(async (_req, res) => {
  const rows: any[] = await SmmRun.find({}).sort({ createdAt: -1 }).limit(30).lean();
  res.json({ runs: rows.map((r) => ({ key: r.key, status: r.status, mode: r.mode, format: r.format, category: r.category, topic: r.topic, taskId: r.taskId, note: r.note, at: new Date(r.createdAt).toISOString() })) });
}));

smmRoutes.post('/smm/instagram/check', wrap(async (req, res) => {
  const rl = await hitRate(`smm:igcheck:${uid(req)}`, 20, 3_600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited' });
  try {
    res.json(await igCheck());
  } catch (e) {
    const err = e instanceof IgError ? e : new IgError('ig_failed');
    res.status(err.httpStatus === 409 ? 409 : 502).json({ error: err.code, detail: err.detail || undefined });
  }
}));

smmRoutes.post('/smm/instagram/refresh', wrap(async (req, res) => {
  if (!igConfigured()) return res.status(409).json({ error: 'ig_not_configured' });
  const rl = await hitRate(`smm:igrefresh:${uid(req)}`, 5, 3_600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited' });
  const r = await igMaybeRefresh(new Date(), true);
  if (!r.refreshed) return res.status(502).json({ error: r.error || 'ig_failed' });
  res.json({ ok: true, expiresAt: r.expiresAt?.toISOString() });
}));

/** AI rasm (Gemini) — natija QURILMAGA qaytadi (base64), serverda saqlanmaydi. Mavjud bo'lmasa 503 → qurilma shablon chizadi. */
smmRoutes.post('/smm/image', wrap(async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  const rl = await hitRate(`smm:image:${uid(req)}`, 40, 3_600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited' });
  const aspect: Aspect = ['1:1', '4:5', '9:16'].includes(b.aspect) ? b.aspect : '4:5';
  let item: any = { title: typeof b.title === 'string' ? b.title.slice(0, 200) : '', text: typeof b.text === 'string' ? b.text.slice(0, 600) : '', imagePrompt: typeof b.prompt === 'string' ? b.prompt.slice(0, 1500) : '' };
  if (typeof b.taskId === 'string' && /^[0-9a-f]{24}$/i.test(b.taskId) && Number.isInteger(b.index)) {
    const t: any = await AgentTask.findById(b.taskId).select('items').lean();
    if (t?.items?.[b.index]) item = { ...t.items[b.index], ...(item.imagePrompt ? { imagePrompt: item.imagePrompt } : {}) };
  }
  try {
    const img = await generateAiImage(imagePromptFor(item), aspect);
    res.json({ mime: img.mime, data: img.data.toString('base64'), source: 'ai' });
  } catch (e) {
    res.status(503).json({ error: 'image_unavailable', reason: e instanceof ImageUnavailable ? e.reason : 'failed' });
  }
}));

smmRoutes.patch('/agent-tasks/:id/items/:i', wrap(async (req, res) => {
  const r = await editItem(String(req.params.id), idx(req), isObj(req.body) ? req.body : {}, uid(req), req);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true, item: r.item });
}));

smmRoutes.put('/agent-tasks/:id/items/:i/media', wrap(async (req, res) => {
  const r = await setItemMedia(String(req.params.id), idx(req), isObj(req.body) ? req.body.media : undefined);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true, item: r.item });
}));

smmRoutes.post('/agent-tasks/:id/items/:i/approval', wrap(async (req, res) => {
  const r = await setApproval(String(req.params.id), idx(req), isObj(req.body) ? req.body.decision : undefined, uid(req), req);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true, item: r.item });
}));

/** E'lon: qurilmadagi fayllar (multipart "files") VAQTINCHA keladi — Telegram'ga to'g'ridan-to'g'ri, Instagram'ga vaqtinchalik havola. */
smmRoutes.post('/agent-tasks/:id/items/:i/publish', (req, res, next) => {
  upload.array('files', 10)(req, res, (err: unknown) => {
    if (err) return res.status((err as any)?.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: (err as any)?.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'invalid' });
    next();
  });
}, wrap(async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  const target = b.target === 'telegram' || b.target === 'instagram' ? b.target : null;
  if (!target) return res.status(400).json({ error: 'invalid' });
  const rl = await hitRate(`smm:publish:${uid(req)}`, 30, 3_600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited' });
  const files = ((req.files as Express.Multer.File[]) || []).map((f) => ({ data: f.buffer, mime: f.mimetype }));
  const r = await publishItem(String(req.params.id), idx(req), target, files, {
    kind: b.kind, tgTarget: b.tgTarget === 'developer' ? 'developer' : 'channel', by: uid(req), force: b.force === 'true' || b.force === true, req,
  });
  if (!r.ok) return res.status(r.status).json({ error: r.error, ...(r.detail ? { detail: r.detail } : {}) });
  res.status(r.status).json({ ok: true, ...(r.sentTo ? { sentTo: r.sentTo } : {}), ...(r.url ? { url: r.url } : {}), ...(r.pending ? { pending: true } : {}) });
}));

smmRoutes.get('/smm/analytics', wrap(async (_req, res) => {
  res.json(await analyticsSummary());
}));

smmRoutes.post('/smm/analytics/refresh', wrap(async (req, res) => {
  if (!igConfigured()) return res.status(409).json({ error: 'ig_not_configured' });
  const rl = await hitRate(`smm:insights:${uid(req)}`, 6, 3_600_000);
  if (!rl.allowed) return res.status(429).json({ error: 'rate_limited' });
  const r = await refreshInsights(new Date());
  if (!r.ok) return res.status(502).json({ error: r.error });
  res.json({ ok: true, media: r.media, summary: await analyticsSummary() });
}));
