import { isDailyQuotaError, isQuotaError } from '../lib/geminiKeys';
import { addDays, zonedParts, zonedToUtc } from '../lib/zonedTime';
import { ProviderError } from './providers/types';

// Provayder kvotasi tugaganda foydalanuvchiga QISQA, tushunarli javob (owner 2026-10-16: "AI limitga
// urilyapti"). Gemini bepul tarifining kunlik limiti Tinch okeani vaqti bilan yarim tunda (00:00 PT)
// yangilanadi — Toshkent vaqtiga o'girib aytamiz. Daqiqalik limit — "1 daqiqadan keyin".

export type QuotaKind = 'daily' | 'minute';

/** Xato provayder kvotasi bo'lsa — turi; aks holda null. */
export function quotaKindOf(e: unknown): QuotaKind | null {
  const http429 = e instanceof ProviderError && (e.status === 429 || e.code === 'HTTP_429');
  if (!http429 && !isQuotaError(e)) return null;
  return isDailyQuotaError(e) ? 'daily' : 'minute';
}

/** Kunlik limit qachon tiklanadi (Toshkent vaqti): keyingi 00:00 America/Los_Angeles. */
export function dailyResetAt(now: Date = new Date()): Date {
  const pt = zonedParts(now, 'America/Los_Angeles');
  return zonedToUtc(addDays(pt.date, 1), '00:00', 'America/Los_Angeles');
}

export function quotaMessage(kind: QuotaKind, lang: 'uz' | 'ru', now: Date = new Date()): string {
  if (kind === 'minute') {
    return lang === 'ru'
      ? 'AI сейчас перегружен — попробуйте через минуту.'
      : "AI hozir band — 1 daqiqadan keyin qayta urinib ko'ring.";
  }
  const at = dailyResetAt(now);
  const r = zonedParts(at);
  const today = zonedParts(now).date;
  const day = r.date === today ? (lang === 'ru' ? 'сегодня' : 'bugun') : (lang === 'ru' ? 'завтра' : 'ertaga');
  return lang === 'ru'
    ? `Дневной лимит AI исчерпан, восстановится ${day} в ${r.hhmm}.`
    : `AI kunlik limiti tugadi, ${day} soat ${r.hhmm} da tiklanadi.`;
}
