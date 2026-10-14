// Gemini API kalitlari — AI ovozli tizim uchun YAGONA rotatsiya joyi (review D2). services/gemini.ts
// bilan bir xil env nomlari (GEMINI_API_KEYS vergul bilan yoki GEMINI_API_KEY), lekin u fayl
// o'zgartirilmaydi. ESLATMA (A6): Live kvotasi loyiha/tarif bo'yicha — bitta loyihadagi bir nechta
// kalit sig'imni OSHIRMAYDI; sig'im uchun kalitlar ALOHIDA loyihalardan bo'lishi kerak.
// Kalit qiymatlari hech qachon log qilinmaydi — faqat indeks (#0, #1 ...).

export interface GeminiKey { index: number; key: string; label: string }

let rawCache = '';
let keys: string[] = [];
let cursor = 0;
const cooldownUntil = new Map<number, number>();

function load(): string[] {
  const raw = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  if (raw !== rawCache) {
    rawCache = raw;
    keys = raw.split(',').map((k) => k.trim()).filter(Boolean);
    cursor = 0;
    cooldownUntil.clear();
  }
  return keys;
}

export function geminiKeyCount(): number { return load().length; }
export function geminiConfigured(): boolean { return load().length > 0; }

/** Sovushda bo'lmagan keyingi kalit (hammasi sovushda bo'lsa — eng tez tiklanadigani). */
export function pickGeminiKey(now = Date.now()): GeminiKey | null {
  const list = load();
  if (!list.length) return null;
  let best = -1, bestUntil = Infinity;
  for (let i = 0; i < list.length; i++) {
    const idx = (cursor + i) % list.length;
    const until = cooldownUntil.get(idx) || 0;
    if (until <= now) { best = idx; break; }
    if (until < bestUntil) { bestUntil = until; best = idx; }
  }
  return { index: best, key: list[best], label: `#${best}` };
}

/** Kvota (429/RESOURCE_EXHAUSTED) yoki ruxsat xatosi — kalitni vaqtincha chetga surish. */
export function markGeminiKeyFailed(index: number, cooldownMs = 60_000, now = Date.now()) {
  cooldownUntil.set(index, now + cooldownMs);
  if (index === cursor) cursor = (cursor + 1) % Math.max(1, load().length);
}

/** Ishlagan kalitda qolamiz. */
export function markGeminiKeyOk(index: number) {
  cooldownUntil.delete(index);
  cursor = index;
}

export const isQuotaError = (e: any) => /RESOURCE_EXHAUSTED|\b429\b|quota|rate limit/i.test(String(e?.message || e));
export const isAuthError = (e: any) => /\b(401|403)\b|API key not valid|PERMISSION_DENIED|API_KEY_INVALID/i.test(String(e?.message || e));
export const isTransientError = (e: any) => /\b(500|502|503|504)\b|high demand|overloaded|unavailable|fetch failed|ECONNRESET|ETIMEDOUT|aborted/i.test(String(e?.message || e));

/**
 * fn'ni kalitlar bo'yicha aylantirib chaqiradi: kvota/ruxsat xatosida keyingi kalitga o'tadi.
 * Boshqa xatolar darhol qaytariladi (qayta urinish chaqiruvchining ishi).
 */
export async function withGeminiKey<T>(fn: (key: string) => Promise<T>): Promise<T> {
  const n = geminiKeyCount();
  if (!n) throw new Error('GEMINI_NOT_CONFIGURED');
  let lastErr: unknown = null;
  for (let i = 0; i < n; i++) {
    const k = pickGeminiKey();
    if (!k) break;
    try {
      const r = await fn(k.key);
      markGeminiKeyOk(k.index);
      return r;
    } catch (e) {
      lastErr = e;
      if (isQuotaError(e)) { markGeminiKeyFailed(k.index, 60_000); continue; }
      if (isAuthError(e)) { markGeminiKeyFailed(k.index, 10 * 60_000); continue; }
      throw e;
    }
  }
  throw lastErr ?? new Error('GEMINI_ALL_KEYS_FAILED');
}
