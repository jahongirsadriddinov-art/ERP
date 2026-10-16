import AiUsageMetrics, { AI_USAGE_PROVIDERS, type AiUsageProvider } from '../models/AiUsageMetrics';
import { localDate } from './lib/zonedTime';
import { costFromUsd, costUsdMicros } from './pricing';
import { getSettings } from './settings';

// AI sarfini kunlik yig'ish ($inc upsert): foydalanuvchi qatori + firma bo'yicha jami (userId=null).
// Byudjet nazorati: oylik jami costUsdMicros ≥ monthlyBudgetUsd va hardStop → yangi ishlar rad etiladi.

export type UsageCounters = Partial<{
  sessions: number; audioInSec: number; audioOutSec: number; tokensIn: number; tokensOut: number;
  toolCalls: number; telegramCalls: number; botMessages: number; bytesRelayed: number; costUsdMicros: number;
}>;

export interface UsageKey { companyId: string; userId?: string | null; provider: AiUsageProvider; model: string; at?: Date }

const knownProvider = (p: unknown): AiUsageProvider =>
  (AI_USAGE_PROVIDERS as readonly string[]).includes(p as string) ? (p as AiUsageProvider) : 'none';

/**
 * TextAgent natijasini hisobga olish (P2 provayderlari chaqiradi). OpenRouter `usage.cost` (USD)
 * qaytarsa — shu ishlatiladi, aks holda narx jadvali (pricing.ts) bo'yicha hisoblanadi.
 */
export async function recordTextUsage(
  key: { companyId: string; userId?: string | null; provider: 'gemini' | 'groq' | 'openrouter' | 'claude'; model: string; at?: Date },
  u: { tokensIn?: number; tokensOut?: number; cacheReadTokens?: number; costUsd?: number; toolCalls?: number },
): Promise<void> {
  const cost = typeof u.costUsd === 'number' && Number.isFinite(u.costUsd) && u.costUsd >= 0
    ? costFromUsd(u.costUsd)
    : costUsdMicros(key.model, { tokensIn: u.tokensIn, tokensOut: u.tokensOut, cacheReadTokens: u.cacheReadTokens });
  await recordUsage(key, { tokensIn: u.tokensIn, tokensOut: u.tokensOut, costUsdMicros: cost, toolCalls: u.toolCalls });
}

async function upsertRow(filter: Record<string, unknown>, inc: Record<string, number>) {
  const run = () => AiUsageMetrics.updateOne(filter, { $inc: inc }, { upsert: true });
  try { await run(); } catch (e: any) {
    if (e?.code !== 11000) throw e;
    await run(); // parallel birinchi upsert — endi hujjat bor
  }
}

export async function recordUsage(key: UsageKey, counters: UsageCounters): Promise<void> {
  const inc: Record<string, number> = {};
  for (const [k, v] of Object.entries(counters)) if (typeof v === 'number' && Number.isFinite(v) && v !== 0) inc[k] = v;
  if (!Object.keys(inc).length || !key.companyId) return;
  const day = localDate(key.at || new Date());
  const base = { companyId: key.companyId, day, provider: knownProvider(key.provider), modelId: key.model || 'none' };
  try {
    if (key.userId) await upsertRow({ ...base, userId: String(key.userId) }, inc);
    await upsertRow({ ...base, userId: null }, inc);
    if (inc.costUsdMicros) budgetCache.delete(key.companyId);
  } catch (e) {
    console.error('[aiVoice] usage yozilmadi:', (e as Error).message);
  }
}

/** Joriy oy (Toshkent) bo'yicha firma jami xarajati, mikro-dollarda. */
export async function monthCostMicros(companyId: string, at: Date = new Date()): Promise<number> {
  const month = localDate(at).slice(0, 7);
  const rows = await AiUsageMetrics.aggregate([
    { $match: { companyId, userId: null, day: { $gte: `${month}-01`, $lte: `${month}-31` } } },
    { $group: { _id: null, total: { $sum: '$costUsdMicros' } } },
  ]);
  return Number(rows[0]?.total || 0);
}

const budgetCache = new Map<string, { at: number; over: boolean }>();

/** hardStop yoqilgan va oylik byudjet tugagan bo'lsa — true (10 s kesh). */
export async function budgetExceeded(companyId: string): Promise<boolean> {
  const c = budgetCache.get(companyId);
  if (c && Date.now() - c.at < 10_000) return c.over;
  const s = await getSettings(companyId);
  let over = false;
  if (s.limits.hardStop) {
    const limitMicros = Math.round(s.limits.monthlyBudgetUsd * 1e6);
    over = (await monthCostMicros(companyId)) >= limitMicros;
  }
  budgetCache.set(companyId, { at: Date.now(), over });
  return over;
}

export function invalidateBudget(companyId?: string) {
  if (companyId) budgetCache.delete(companyId); else budgetCache.clear();
}
