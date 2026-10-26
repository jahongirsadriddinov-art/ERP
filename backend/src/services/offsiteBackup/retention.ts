// Saqlash siyosati (GFS): rejali (kunlik) to'liq arxivlardan 14 kunlik, 8 haftalik, 12 oylik nusxa qoladi.
// Boshqa sabablar bilan olingan arxivlar (qo'lda, tiklashdan/o'chirishdan oldin, firma nusxalari) — 60 kun.
// Faqat sof funksiya: qaysi kalitlar O'CHIRILISHINI qaytaradi (eng yangisi hech qachon o'chmaydi).

export interface RetentionItem { key: string; createdAt: Date; scheduled: boolean }
export interface RetentionPolicy { daily: number; weekly: number; monthly: number; otherDays: number }
export const DEFAULT_RETENTION: RetentionPolicy = { daily: 14, weekly: 8, monthly: 12, otherDays: 60 };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
/** ISO hafta (dushanba boshlanadi), UTC. */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function selectRetention(items: RetentionItem[], now: Date, policy: RetentionPolicy = DEFAULT_RETENTION): { keep: string[]; prune: string[] } {
  const keep = new Set<string>();
  const sched = items.filter((i) => i.scheduled).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const bucket = (fn: (d: Date) => string, limit: number) => {
    const seen = new Set<string>();
    for (const it of sched) {
      const k = fn(it.createdAt);
      if (seen.has(k)) continue;           // har davr uchun eng yangisi
      if (seen.size >= limit) break;
      seen.add(k);
      keep.add(it.key);
    }
  };
  bucket(dayKey, policy.daily);
  bucket(isoWeekKey, policy.weekly);
  bucket(monthKey, policy.monthly);
  if (sched[0]) keep.add(sched[0].key);
  const cutoff = now.getTime() - policy.otherDays * 86400000;
  for (const it of items) if (!it.scheduled && it.createdAt.getTime() >= cutoff) keep.add(it.key);
  const prune = items.filter((i) => !keep.has(i.key)).map((i) => i.key);
  return { keep: items.filter((i) => keep.has(i.key)).map((i) => i.key), prune };
}
