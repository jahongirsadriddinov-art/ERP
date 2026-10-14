import AiRateCounter from '../../models/AiRateCounter';

// Mongo'da saqlanadigan qat'iy oynali rate limit — qayta ishga tushish va ko'p instansiyada
// ham to'g'ri ishlaydi (in-memory checkRate o'rniga, faqat AI uchun). Semafor EMAS (B12).

export interface RateResult { allowed: boolean; count: number; limit: number; retryAfterSec: number }

/**
 * `key` bo'yicha `windowMs` oynada `max` tagacha ruxsat beradi. Har chaqiruv hisoblagichni oshiradi.
 * Bir vaqtdagi birinchi upsert'lar E11000 berishi mumkin — bir marta qayta urinadi.
 */
export async function hitRate(key: string, max: number, windowMs: number, now: Date = new Date()): Promise<RateResult> {
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  const docKey = `${key}:${start}`;
  const expiresAt = new Date(start + windowMs * 2);
  const run = () => AiRateCounter.findOneAndUpdate(
    { key: docKey },
    { $inc: { count: 1 }, $setOnInsert: { windowStart: new Date(start), expiresAt } },
    { upsert: true, returnDocument: 'after', lean: true },
  );
  let doc: any;
  try { doc = await run(); } catch (e: any) {
    if (e?.code !== 11000) throw e;
    doc = await run();
  }
  const count = Number(doc?.count || 0);
  const allowed = count <= max;
  return { allowed, count, limit: max, retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((start + windowMs - now.getTime()) / 1000)) };
}

/** Hisoblagichni oshirmasdan joriy holatni o'qiydi. */
export async function peekRate(key: string, windowMs: number, now: Date = new Date()): Promise<number> {
  const start = Math.floor(now.getTime() / windowMs) * windowMs;
  const doc: any = await AiRateCounter.findOne({ key: `${key}:${start}` }).lean();
  return Number(doc?.count || 0);
}
