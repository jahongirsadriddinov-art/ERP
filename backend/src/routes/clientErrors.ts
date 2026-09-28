import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requireDeveloper } from '../middleware/auth';
import { checkRate } from '../utils/rateLimit';

const router = Router();

const LOG_FILE = path.join(process.cwd(), 'logs', 'client-errors.log');

function ensureLogDir() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Monitoring: YANGI turdagi frontend xatosi (oxirgi 6 soatda ko'rilmagan) — dasturchiga botda
// darhol xabar. Raqamlar/ID'lar olib tashlangan "imzo" bo'yicha guruhlanadi; soatiga ≤15 ta xabar.
const seenErrors = new Map<string, { at: number; count: number }>();
async function alertIfNew(message: string, platform: string, version: string, url: string, userId: string, kind: string) {
  const sig = crypto.createHash('sha1').update(message.replace(/\d+/g, '#').replace(/[0-9a-f]{24}/gi, 'ID').slice(0, 300)).digest('hex');
  const prev = seenErrors.get(sig);
  const now = Date.now();
  if (prev && now - prev.at < 6 * 60 * 60 * 1000) { prev.count++; return; }
  seenErrors.set(sig, { at: now, count: 1 });
  if (seenErrors.size > 500) seenErrors.delete(seenErrors.keys().next().value as string);
  if (!checkRate('clienterr-alert', 15, 60 * 60 * 1000).allowed) return;
  const { notifyDeveloper } = await import('../services/bot');
  const path = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
  await notifyDeveloper(`🐞 Yangi frontend xatosi (${platform}${version ? ' ' + version : ''}${kind ? ', ' + kind : ''})\n${message.slice(0, 300)}\n📄 ${path || '—'}${userId ? `\n👤 ${userId}` : ''}`);
}

// POST /api/errors/log — receives frontend error reports
router.post('/log', (req, res) => {
  try {
    const { message, stack, url, userAgent, timestamp, appVersion, platform, userId, kind } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });
    const rl = checkRate(`clienterr:${req.ip}`, 30, 10 * 60 * 1000);
    if (!rl.allowed) return res.status(429).json({ error: 'too many' });

    const entry = JSON.stringify({
      timestamp: timestamp || new Date().toISOString(),
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 5000) : undefined,
      url: url ? String(url).slice(0, 500) : undefined,
      userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined,
      appVersion: appVersion ? String(appVersion).slice(0, 40) : undefined,
      platform: platform ? String(platform).slice(0, 20) : undefined,
      userId: userId ? String(userId).slice(0, 40) : undefined,
    });

    console.error('[ClientError]', entry);
    alertIfNew(String(message), String(platform || 'web'), String(appVersion || ''), String(url || ''), userId ? String(userId) : '', String(kind || '')).catch(() => {});

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
