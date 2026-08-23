import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireDeveloper } from '../middleware/auth';

const router = Router();

const LOG_FILE = path.join(process.cwd(), 'logs', 'client-errors.log');

function ensureLogDir() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// POST /api/errors/log — receives frontend error reports
router.post('/log', (req, res) => {
  try {
    const { message, stack, url, userAgent, timestamp } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });

    const entry = JSON.stringify({
      timestamp: timestamp || new Date().toISOString(),
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 5000) : undefined,
      url: url ? String(url).slice(0, 500) : undefined,
      userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined,
    });

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

export default router;
