import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { requireDeveloper } from '../middleware/auth';
import { checkRate } from '../utils/rateLimit';
import { captureError, normalizePath, redact } from '../services/errorTracker';
import ErrorEvent from '../models/ErrorEvent';

const router = Router();

const LOG_FILE = path.join(process.cwd(), 'logs', 'client-errors.log');

function ensureLogDir() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// POST /api/errors/log — receives frontend error reports
router.post('/log', (req, res) => {
  try {
    const b = req.body || {};
    const { message, stack, url, userAgent, timestamp, appVersion, platform } = b;
    if (!message) return res.status(400).json({ error: 'message required' });
    const rl = checkRate(`clienterr:${req.ip}`, 30, 10 * 60 * 1000);
    if (!rl.allowed) return res.status(429).json({ error: 'too many' });
    // Kim — token'dan (ishonchli); tokensiz (login ekranidan oldin) bo'lsa body'dagi userId faqat ma'lumot uchun
    const u = req.user;
    const userId = u?.userId || (b.userId ? String(b.userId).slice(0, 40) : undefined);

    const entry = JSON.stringify({
      timestamp: timestamp || new Date().toISOString(),
      message: redact(message, 2000),
      stack: stack ? redact(stack, 5000) : undefined,
      url: url ? redact(url, 500) : undefined,
      userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined,
      appVersion: appVersion ? String(appVersion).slice(0, 40) : undefined,
      platform: platform ? String(platform).slice(0, 20) : undefined,
      userId,
    });

    const kind = b.kind ? String(b.kind).slice(0, 40) : 'js';
    const api = b.api && typeof b.api === 'object' ? b.api : null;
    const page = [b.screen ? String(b.screen).slice(0, 60) : '', url ? normalizePath(String(url)) : ''].filter(Boolean).join(' · ');
    void (async () => {
      // Mijoz xabar bergan 5xx: server o'zi ham shu marshrutni yozib, dasturchiga xabar bergan bo'ladi — takror xabar shart emas
      let silent = false;
      if (kind === 'api' && api && Number(api.status) >= 500 && mongoose.connection.readyState === 1) {
        silent = !!(await ErrorEvent.exists({ source: 'server', method: String(api.method || '').toUpperCase(), route: normalizePath(api.path), lastSeen: { $gte: new Date(Date.now() - 5 * 60 * 1000) } }).catch(() => null));
      }
      await captureError({
        source: 'client', kind, message: String(message), stack: stack ? String(stack) : undefined,
        componentStack: b.componentStack ? String(b.componentStack) : undefined,
        route: api ? String(api.path || '') : undefined, method: api ? String(api.method || '') : undefined,
        status: api && Number.isFinite(Number(api.status)) ? Number(api.status) : undefined,
        page, action: b.action ? String(b.action) : undefined,
        breadcrumbs: Array.isArray(b.breadcrumbs) ? b.breadcrumbs.slice(-5).map((x: unknown) => String(x).slice(0, 150)) : undefined,
        userId, companyId: u?.companyId, role: u?.role,
        appVersion: appVersion ? String(appVersion) : undefined, platform: platform ? String(platform) : 'web',
        userAgent: userAgent ? String(userAgent) : undefined, silent,
      });
    })().catch(() => {});

    console.error('[ClientError]', entry);

    try {
      ensureLogDir();
      fs.appendFileSync(LOG_FILE, entry + '\n');
    } catch {
      // File logging optional — don't fail the response
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/errors/log — read last N client errors (dasturchi only).
// XAVFSIZLIK — TOPILMA (audit): izoh "admin only" deb yozilgan bo'lsa
// ham, marshrutning o'zida HECH QANDAY tekshiruv yo'q edi — router
// `optionalAuth` bilan ulangan (POST /log login ekranidan oldin ham
// ishlashi kerakligi uchun), shu sabab HAR QANDAY, hatto kirmagan
// tashrifchi ham oxirgi 100 ta frontend xatolik yozuvini (stack trace,
// URL, user-agent) o'qiy olardi. Bu jurnal companyId bilan belgilanmagan
// — BARCHA firmalarning xatoliklari birga saqlanadi — shu sabab faqat
// dasturchi (platforma darajasidagi admin) ko'rishi kerak, direktor ham
// emas (aks holda boshqa firmalarning ma'lumoti sizib chiqardi).
router.get('/log', requireDeveloper, (req, res) => {
  try {
    ensureLogDir();
    if (!fs.existsSync(LOG_FILE)) return res.json({ lines: [] });

    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean).slice(-100).map(l => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
    res.json({ lines: lines.reverse() });
  } catch {
    res.json({ lines: [] });
  }
});

// ─── Dasturchi paneli → "Xatolar" (faqat dasturchi) ─────────────────────────
const isId = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v);
const LIST_FIELDS = 'fingerprint source kind message where topFrame route method status page count userIds firstSeen lastSeen resolved resolvedAt reopenedCount platform appVersion';

// GET /api/errors/events?source=client&status=open|resolved|all&q=...&limit=50&skip=0
router.get('/events', requireDeveloper, async (req, res) => {
  try {
    const filter: Record<string, unknown> = {};
    const source = String(req.query.source || '');
    if (['server', 'client', 'bot', 'worker'].includes(source)) filter.source = source;
    const status = String(req.query.status || 'open');
    if (status === 'open') filter.resolved = false;
    else if (status === 'resolved') filter.resolved = true;
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ message: re }, { where: re }, { topFrame: re }, { page: re }];
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const skip = Math.max(0, Number(req.query.skip) || 0);
    const [rows, total, open] = await Promise.all([
      ErrorEvent.find(filter).sort({ lastSeen: -1 }).skip(skip).limit(limit).select(LIST_FIELDS).lean(),
      ErrorEvent.countDocuments(filter),
      ErrorEvent.countDocuments({ resolved: false }),
    ]);
    const items = rows.map(({ userIds, ...r }: any) => ({ ...r, id: String(r._id), _id: undefined, users: userIds?.length || 0 }));
    res.json({ items, total, open });
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// GET /api/errors/events/:id — to'liq ma'lumot (stack, kontekst, oxirgi holatlar)
router.get('/events/:id', requireDeveloper, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: "Noto'g'ri ID" });
  try {
    const ev: any = await ErrorEvent.findById(req.params.id).lean();
    if (!ev) return res.status(404).json({ error: 'Topilmadi' });
    const { userIds, companyIds, _id, __v, ...rest } = ev;
    res.json({ ...rest, id: String(_id), users: userIds?.length || 0, companies: companyIds?.length || 0, occurrences: (ev.occurrences || []).slice().reverse() });
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// PATCH /api/errors/events/:id { resolved: boolean } — "Hal qilindi" (qayta chiqsa dasturchiga yana xabar boradi)
router.patch('/events/:id', requireDeveloper, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: "Noto'g'ri ID" });
  const resolved = req.body?.resolved !== false;
  try {
    const ev = await ErrorEvent.findByIdAndUpdate(req.params.id,
      { $set: { resolved, resolvedAt: resolved ? new Date() : null, resolvedBy: resolved ? (req.user?.userId || null) : null } },
      { returnDocument: 'after' }).select('resolved resolvedAt').lean();
    if (!ev) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true, resolved: ev.resolved, resolvedAt: ev.resolvedAt });
  } catch {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
