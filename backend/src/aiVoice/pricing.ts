// Narxlar jadvali (USD) — taxminiy, AI_PRICING_JSON env bilan almashtiriladi, masalan:
//   {"gemini-3.8-live":{"inPerMTok":0.5,"outPerMTok":2,"audioInPerMin":0.006,"audioOutPerMin":0.024}}
// Natija mikro-dollarda (butun son) — $inc bilan yig'ish uchun aniqroq.
// OpenRouter javobida usage.cost (USD) bo'lsa — jadval emas, o'sha ishlatiladi (costFromUsd).

export interface ModelPrice {
  inPerMTok: number; outPerMTok: number; audioInPerMin: number; audioOutPerMin: number;
  /** Prompt keshidan o'qilgan tokenlar (Claude cache_read). Berilmasa — inPerMTok. */
  cacheReadPerMTok?: number;
}

const DEFAULT_PRICES: Record<string, ModelPrice> = {
  default: { inPerMTok: 0.5, outPerMTok: 2, audioInPerMin: 0.006, audioOutPerMin: 0.024 },
  'gemini-3.8-live': { inPerMTok: 0.5, outPerMTok: 2, audioInPerMin: 0.006, audioOutPerMin: 0.024 },
  'gemini-3.8-flash': { inPerMTok: 0.3, outPerMTok: 2.5, audioInPerMin: 0, audioOutPerMin: 0 },
  'gemini-3.8-flash-tts': { inPerMTok: 0.5, outPerMTok: 10, audioInPerMin: 0, audioOutPerMin: 0 },
  'gemini-3.5-transcribe-live': { inPerMTok: 0, outPerMTok: 0, audioInPerMin: 0.006, audioOutPerMin: 0 },
  // llm-provider.md: Opus 5.5 — $4/M kirish, $20/M chiqish, $0.20/M kesh o'qish
  'claude-opus-5-5': { inPerMTok: 4, outPerMTok: 20, cacheReadPerMTok: 0.2, audioInPerMin: 0, audioOutPerMin: 0 },
};

let rawCache: string | null = null;
let table: Record<string, ModelPrice> = DEFAULT_PRICES;

function prices(): Record<string, ModelPrice> {
  const raw = process.env.AI_PRICING_JSON || '';
  if (raw === rawCache) return table;
  rawCache = raw;
  table = { ...DEFAULT_PRICES };
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      for (const [model, p] of Object.entries(parsed || {})) {
        const v = p as Partial<ModelPrice>;
        const base = table[model] || table.default;
        table[model] = {
          inPerMTok: num(v.inPerMTok, base.inPerMTok), outPerMTok: num(v.outPerMTok, base.outPerMTok),
          audioInPerMin: num(v.audioInPerMin, base.audioInPerMin), audioOutPerMin: num(v.audioOutPerMin, base.audioOutPerMin),
          ...(v.cacheReadPerMTok !== undefined || base.cacheReadPerMTok !== undefined
            ? { cacheReadPerMTok: num(v.cacheReadPerMTok, base.cacheReadPerMTok ?? base.inPerMTok) } : {}),
        };
      }
    } catch {
      console.warn('[aiVoice] AI_PRICING_JSON noto\'g\'ri JSON — standart narxlar ishlatiladi');
    }
  }
  return table;
}
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);

export function priceFor(model: string): ModelPrice {
  const t = prices();
  return t[model] || t.default;
}

export function costUsdMicros(
  model: string,
  u: { tokensIn?: number; tokensOut?: number; cacheReadTokens?: number; audioInSec?: number; audioOutSec?: number },
): number {
  const p = priceFor(model);
  const usd = ((u.tokensIn || 0) / 1e6) * p.inPerMTok
    + ((u.cacheReadTokens || 0) / 1e6) * (p.cacheReadPerMTok ?? p.inPerMTok)
    + ((u.tokensOut || 0) / 1e6) * p.outPerMTok
    + ((u.audioInSec || 0) / 60) * p.audioInPerMin
    + ((u.audioOutSec || 0) / 60) * p.audioOutPerMin;
  return Math.max(0, Math.round(usd * 1e6));
}

/** Provayder qaytargan tayyor narx (USD) → mikro-dollar. */
export function costFromUsd(usd: number): number {
  return typeof usd === 'number' && Number.isFinite(usd) && usd > 0 ? Math.round(usd * 1e6) : 0;
}
