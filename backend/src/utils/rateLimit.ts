/**
 * Oddiy in-memory rate limiter (yangi dependency shart emas).
 * Sliding-window: berilgan kalit uchun oynada max urinishdan oshsa false qaytaradi.
 * Bitta process uchun yetarli; ko'p replikada Redis kerak bo'ladi (kelajakda).
 */
interface Hit { count: number; resetAt: number; }
const store = new Map<string, Hit>();

// Vaqti-vaqti bilan eskirgan kalitlarni tozalaymiz (xotira oqmasin).
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of store) {
    if (v.resetAt <= now) store.delete(k);
  }
}

/**
 * @returns { allowed, retryAfterSec } — allowed=false bo'lsa limitdan oshgan.
 */
export function checkRate(key: string, max: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);
  const hit = store.get(key);
  if (!hit || hit.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (hit.count >= max) {
    return { allowed: false, retryAfterSec: Math.ceil((hit.resetAt - now) / 1000) };
  }
  hit.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}
