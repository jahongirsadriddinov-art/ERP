// Gemini API kalitlari — AI ovozli tizim uchun YAGONA rotatsiya joyi (review D2). services/gemini.ts
// bilan bir xil env nomlari (GEMINI_API_KEYS vergul bilan yoki GEMINI_API_KEY), lekin u fayl
// o'zgartirilmaydi. ESLATMA (A6): Live kvotasi loyiha/tarif bo'yicha — bitta loyihadagi bir nechta
// kalit sig'imni OSHIRMAYDI; sig'im uchun kalitlar ALOHIDA loyihalardan bo'lishi kerak.
// Kalit qiymatlari hech qachon log qilinmaydi — faqat indeks (#0, #1 ...).
//
// Owner 2026-10-16 ("AI limitga urilyapti"): kvota MODEL bo'yicha (kalit × model) hisoblanadi —
// shuning uchun sovush (cooldown) `scope` (odatda model nomi) bilan alohida. 429 → shu kalit shu
// model uchun 60 s chetda; kunlik limit (PerDay) → 10 daqiqa; ruxsat xatosi → kalit butunlay 10 daqiqa.
// Hamma kalit sovushda bo'lsa — tarmoqqa chiqmasdan darhol GeminiQuotaError (chaqiruvchi keyingi
// model / OpenRouter'ga o'tadi).

export interface GeminiKey { index: number; key: string; label: string }

const MINUTE_COOLDOWN_MS = 60_000;
const DAILY_COOLDOWN_MS = 10 * 60_000;
const AUTH_COOLDOWN_MS = 10 * 60_000;

let rawCache = '';
let keys: string[] = [];
let cursor = 0;
/** `${index}|${scope}` → sovush tugash vaqti; scope '*' — kalit hamma model uchun (ruxsat xatosi). */
const cooldownUntil = new Map<string, number>();
const dailyHit = new Map<string, boolean>();

function load(): string[] {
  // HAMMA kalitlar: GEMINI_API_KEYS (vergul bilan) + GEMINI_API_KEY (takrorlarsiz) — owner kalit qo'shsa, darhol rotatsiyaga kiradi
  const raw = `${process.env.GEMINI_API_KEYS || ''},${process.env.GEMINI_API_KEY || ''}`;
  if (raw !== rawCache) {
    rawCache = raw;
    keys = [...new Set(raw.split(',').map((k) => k.trim()).filter(Boolean))];
    cursor = 0;
    cooldownUntil.clear();
    dailyHit.clear();
  }
  return keys;
}

const slot = (index: number, scope = '') => `${index}|${scope}`;
function until(index: number, scope: string): number {
  return Math.max(cooldownUntil.get(slot(index, '*')) || 0, cooldownUntil.get(slot(index, scope)) || 0);
}

export function geminiKeyCount(): number { return load().length; }
export function geminiConfigured(): boolean { return load().length > 0; }

/** Sovushda bo'lmagan keyingi kalit (hammasi sovushda bo'lsa — eng tez tiklanadigani). */
export function pickGeminiKey(now = Date.now(), scope = ''): GeminiKey | null {
  const list = load();
  if (!list.length) return null;
  let best = -1, bestUntil = Infinity;
  for (let i = 0; i < list.length; i++) {
    const idx = (cursor + i) % list.length;
    const u = until(idx, scope);
    if (u <= now) { best = idx; break; }
    if (u < bestUntil) { bestUntil = u; best = idx; }
  }
  return { index: best, key: list[best], label: `#${best}` };
}

/** Kvota (429/RESOURCE_EXHAUSTED) yoki ruxsat xatosi — kalitni vaqtincha chetga surish. */
export function markGeminiKeyFailed(index: number, cooldownMs = MINUTE_COOLDOWN_MS, now = Date.now(), scope = '') {
  cooldownUntil.set(slot(index, scope), now + cooldownMs);
  if (index === cursor) cursor = (cursor + 1) % Math.max(1, load().length);
}

/** Ishlagan kalitda qolamiz. */
export function markGeminiKeyOk(index: number, scope = '') {
  cooldownUntil.delete(slot(index, scope));
  dailyHit.delete(slot(index, scope));
  cursor = index;
}

export const isQuotaError = (e: any) => /RESOURCE_EXHAUSTED|\b429\b|quota|rate limit/i.test(String(e?.message || e));
/** Kunlik (RPD) limit — Google xabarida "PerDay" kvota identifikatori bo'ladi. */
export const isDailyQuotaError = (e: any) => !!e?.daily || /PerDay|per[ _-]?day|daily/i.test(String(e?.message || e));
export const isAuthError = (e: any) => /\b(401|403)\b|API key not valid|PERMISSION_DENIED|API_KEY_INVALID/i.test(String(e?.message || e));
export const isTransientError = (e: any) => /\b(500|502|503|504)\b|high demand|overloaded|unavailable|fetch failed|ECONNRESET|ETIMEDOUT|aborted/i.test(String(e?.message || e));

/** Barcha kalitlar (shu model uchun) kvotada. `daily` — hech bo'lmasa bittasi kunlik limitga yetgan. */
export class GeminiQuotaError extends Error {
  constructor(public daily: boolean, public retryAt: Date) {
    super(`GEMINI_QUOTA 429 RESOURCE_EXHAUSTED${daily ? ' PerDay' : ''}`);
    this.name = 'GeminiQuotaError';
  }
}

export interface WithKeyOpts {
  scope?: string; now?: () => number;
  /** Kvota/ruxsatdan boshqa xatoda ham keyingi kalitga o'tish (Live, owner 2026-10-19: "birinchisi ochilmasa darhol
   *  boshqa API'ga o'tsin"). Shu kalit shu model uchun `otherCooldownMs` chetda turadi; hammasi yiqilsa — oxirgi xato. */
  rotateOnAnyError?: boolean;
  otherCooldownMs?: number;
}

/**
 * fn'ni kalitlar bo'yicha aylantirib chaqiradi: kvota/ruxsat xatosida keyingi kalitga o'tadi.
 * Sovushdagi kalitlar O'TKAZIB yuboriladi; hech biri qolmasa — GeminiQuotaError (tarmoqsiz).
 * Boshqa xatolar darhol qaytariladi (qayta urinish chaqiruvchining ishi).
 */
export async function withGeminiKey<T>(fn: (key: string) => Promise<T>, opts: WithKeyOpts = {}): Promise<T> {
  const list = load();
  const n = list.length;
  if (!n) throw new Error('GEMINI_NOT_CONFIGURED');
  const scope = opts.scope || '';
  const now = opts.now || Date.now;
  const tried = new Set<number>();
  let anyDaily = false;
  let otherErr: unknown = null;
  for (let i = 0; i < n; i++) {
    const k = pickGeminiKey(now(), scope);
    if (!k || tried.has(k.index) || until(k.index, scope) > now()) break;
    tried.add(k.index);
    try {
      const r = await fn(k.key);
      markGeminiKeyOk(k.index, scope);
      return r;
    } catch (e) {
      if (isAuthError(e)) { markGeminiKeyFailed(k.index, AUTH_COOLDOWN_MS, now(), '*'); continue; }
      if (isQuotaError(e)) {
        const daily = isDailyQuotaError(e);
        if (daily) { anyDaily = true; dailyHit.set(slot(k.index, scope), true); }
        markGeminiKeyFailed(k.index, daily ? DAILY_COOLDOWN_MS : MINUTE_COOLDOWN_MS, now(), scope);
        continue;
      }
      if (opts.rotateOnAnyError && i < n - 1) {
        otherErr = e;
        markGeminiKeyFailed(k.index, opts.otherCooldownMs ?? 30_000, now(), scope);
        continue;
      }
      throw e;
    }
  }
  // Kvotadan boshqa sabab bilan yiqilgan bo'lsa — o'sha haqiqiy xato (menejer to'g'ri tasniflasin)
  if (otherErr) throw otherErr;
  // Hammasi sovushda: eng tez tiklanish vaqti; kunlik — agar biror kalit shu model uchun kunlik limitda bo'lsa
  let soonest = Infinity;
  for (let i = 0; i < n; i++) {
    soonest = Math.min(soonest, until(i, scope));
    if (dailyHit.get(slot(i, scope))) anyDaily = true;
  }
  throw new GeminiQuotaError(anyDaily, new Date(Number.isFinite(soonest) && soonest > 0 ? soonest : now() + MINUTE_COOLDOWN_MS));
}

/** Faqat testlar uchun. */
export function __resetGeminiKeysForTests(): void { rawCache = '\u0000'; cooldownUntil.clear(); dailyHit.clear(); cursor = 0; }
