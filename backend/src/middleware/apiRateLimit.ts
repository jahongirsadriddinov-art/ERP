import type { RequestHandler } from 'express';
import { checkRate } from '../utils/rateLimit';

// ── Xavfsizlik: umumiy so'rov chegarasi (IP bo'yicha) — skript bilan API'ni bombardimon qilishdan himoya.
// Oddiy foydalanishda hech qachon yetib bo'lmaydigan (daqiqasiga 600) — faqat suiiste'molni to'xtatadi.
// '/api' ostida o'rnatiladi, shu sabab req.path '/api'siz keladi.
// /bot/webhook istisno: barcha update'lar Telegram'ning bir necha IP'sidan keladi (429 bo'lib qolmasin);
// u o'rniga maxfiy sarlavha bilan himoyalangan (services/botSecurity.ts).
export function isApiRateLimitExempt(path: string): boolean {
  return path === '/health' || path.startsWith('/deploy/latest') || path === '/status' || path === '/bot/webhook';
}

export function createApiRateLimiter(max = 600, windowMs = 60_000, keyPrefix = 'api'): RequestHandler {
  return (req, res, next) => {
    if (isApiRateLimitExempt(req.path)) return next();
    const r = checkRate(`${keyPrefix}:${req.ip}`, max, windowMs);
    if (!r.allowed) { res.setHeader('Retry-After', String(r.retryAfterSec)); res.status(429).json({ error: "Juda ko'p so'rov — biroz kuting" }); return; }
    next();
  };
}
