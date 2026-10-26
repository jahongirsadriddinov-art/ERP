// Dasturchi paneli → "Zaxira": tashqi zaxira holati, "Hozir zaxira olish", arxivlar ro'yxati, tiklash.
// index.ts: app.use('/api/dev/backup', requireAuth, requireDeveloper, devBackupRoutes)
import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import User from '../models/User';
import { checkRate } from '../utils/rateLimit';
import { logAudit } from '../services/audit';
import {
  backupStatus, runBackup, stageBackup, listArchives, inspectArchive, previewRestore, executeRestore, registerUpload,
  ArchiveSource, RestoreError, BackupRun, runView, Actor,
} from '../services/offsiteBackup';
import { joinParts } from '../services/offsiteBackup/telegram';
import { ArchiveKeyError } from '../services/offsiteBackup/archive';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 30 } });

async function actorOf(req: any): Promise<Actor> {
  const id = String(req.user?.userId || '');
  const u: any = id ? await User.findById(id).select('firstName lastName role').lean().catch(() => null) : null;
  return { userId: id, name: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Dasturchi' : 'Dasturchi', role: u?.role || 'dasturchi' };
}

function parseSource(s: any): ArchiveSource | null {
  if (!s || typeof s !== 'object') return null;
  if (s.type === 's3' && typeof s.key === 'string' && s.key.length < 600) return { type: 's3', key: s.key };
  if (s.type === 'telegram' && typeof s.runId === 'string' && mongoose.isValidObjectId(s.runId)) return { type: 'telegram', runId: s.runId };
  if (s.type === 'upload' && typeof s.token === 'string' && /^[a-f0-9]{24}$/.test(s.token)) return { type: 'upload', token: s.token };
  return null;
}
function parseScope(b: any): { scope: 'full' | 'company'; companyId?: string; mode: 'upsert' | 'exact' } | null {
  const scope = b?.scope === 'company' ? 'company' : b?.scope === 'full' ? 'full' : null;
  if (!scope) return null;
  const companyId = scope === 'company' ? String(b.companyId || '') : undefined;
  if (scope === 'company' && !/^[a-f0-9]{24}$/i.test(companyId!)) return null;
  return { scope, companyId, mode: b?.mode === 'exact' ? 'exact' : 'upsert' };
}
const fail = (res: any, e: any) => {
  if (e instanceof RestoreError) return res.status(e.status).json({ error: e.message });
  if (e instanceof ArchiveKeyError) return res.status(422).json({ error: e.message });
  console.error('[dev backup]', e?.message || e);
  return res.status(500).json({ error: String(e?.message || 'Server xatoligi').slice(0, 300) });
};

router.get('/status', async (_req, res) => {
  try { res.json(await backupStatus()); } catch (e) { fail(res, e); }
});

router.get('/runs', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const runs = await BackupRun.find({}).sort({ createdAt: -1 }).limit(limit).select('-manifest -companies -collections').lean();
  res.json(runs.map(runView));
});

// "Hozir zaxira olish" — butun baza; javob arxiv yaratilib bo'lgach qaytadi, yuborish fonda tugaydi
router.post('/run', async (req, res) => {
  const rl = checkRate(`devbackup:run:${(req as any).user?.userId}`, 6, 3600_000);
  if (!rl.allowed) return res.status(429).json({ error: `Juda tez-tez — ${Math.ceil(rl.retryAfterSec / 60)} daqiqadan keyin` });
  try {
    const by = await actorOf(req);
    const wait = req.body?.wait === true;
    if (wait) {
      const r = await runBackup({ scope: 'full', reason: 'manual', by });
      if (!r.run) return res.status(409).json({ error: r.skipped || 'Zaxira olinmadi' });
      return res.json(runView(r.run));
    }
    const st = await stageBackup({ scope: 'full', reason: 'manual', by });
    if (!st.run) return res.status(409).json({ error: st.skipped || 'Zaxira olinmadi' });
    void st.done;
    await logAudit({ userId: by.userId, userName: by.name, userRole: by.role, action: 'create', entity: 'backup', entityId: String(st.run._id), description: "Qo'lda tashqi zaxira olindi (butun baza)", req });
    res.status(202).json(runView(st.run));
  } catch (e) { fail(res, e); }
});

router.get('/archives', async (_req, res) => {
  try { res.json(await listArchives()); } catch (e) { fail(res, e); }
});

router.post('/inspect', async (req, res) => {
  const src = parseSource(req.body?.source);
  if (!src) return res.status(400).json({ error: "Arxiv tanlanmagan" });
  try { res.json({ manifest: await inspectArchive(src) }); } catch (e) { fail(res, e); }
});

// Telegram'dan yuklab olingan arxiv (bitta .qbk yoki barcha .partNNofMM bo'laklari)
router.post('/upload', upload.array('files', 30), async (req, res) => {
  const files = ((req as any).files || []) as { originalname: string; buffer: Buffer }[];
  if (!files.length) return res.status(400).json({ error: 'Fayl tanlanmagan' });
  if (!checkRate(`devbackup:upload:${(req as any).user?.userId}`, 20, 3600_000).allowed) return res.status(429).json({ error: "Juda ko'p yuklash" });
  try {
    const buf = joinParts(files.map((f) => ({ name: f.originalname, data: f.buffer })));
    const r = await registerUpload(buf, files[0].originalname.replace(/\.part\d+of\d+$/i, ''));
    res.json({ source: { type: 'upload', token: r.token }, manifest: r.manifest, sizeBytes: r.sizeBytes });
  } catch (e: any) {
    if (e instanceof ArchiveKeyError) return res.status(422).json({ error: e.message });
    res.status(400).json({ error: String(e?.message || 'Fayl o\'qilmadi').slice(0, 300) });
  }
});

// Sinov (dry-run): hech narsa yozilmaydi — har kolleksiya bo'yicha nima qo'shiladi/yangilanadi/o'chiriladi + tasdiqlash kodi
router.post('/preview', async (req, res) => {
  const src = parseSource(req.body?.source);
  const sc = parseScope(req.body);
  if (!src || !sc) return res.status(400).json({ error: "Arxiv yoki doira noto'g'ri" });
  if (!checkRate(`devbackup:preview:${(req as any).user?.userId}`, 30, 3600_000).allowed) return res.status(429).json({ error: "Juda ko'p so'rov" });
  try { res.json(await previewRestore({ source: src, ...sc })); } catch (e) { fail(res, e); }
});

router.post('/restore', async (req, res) => {
  const src = parseSource(req.body?.source);
  const sc = parseScope(req.body);
  if (!src || !sc) return res.status(400).json({ error: "Arxiv yoki doira noto'g'ri" });
  if (!checkRate(`devbackup:restore:${(req as any).user?.userId}`, 5, 3600_000).allowed) return res.status(429).json({ error: "Juda ko'p tiklash — 1 soatdan keyin" });
  try {
    const by = await actorOf(req);
    const r = await executeRestore({ source: src, ...sc, confirmText: String(req.body?.confirmText || ''), by });
    res.json({ ok: true, ...r });
  } catch (e) { fail(res, e); }
});

export default router;
