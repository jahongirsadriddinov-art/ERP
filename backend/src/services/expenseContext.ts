import ObjectModel from '../models/Object';
import User from '../models/User';
import { objectAliases, personAliases, pickCandidate, scoreCandidates, type MatchCandidate } from './nameMatch';

// Ovozli/matnli chiqim uchun firma konteksti (obyektlar, xodimlar) — 60 s keshlanadi (owner 2026-10-23: "ovozli chiqim
// sekin"): har ovozli xabarda Mongo'dan qayta o'qilmaydi, yuklab olish bilan PARALLEL tayyorlanadi.
// Modelga qisqa kalitlar beriladi (O1, P3) — uzun ObjectId'ni "o'ylab topish" xavfi yo'q, token ham kam.

export interface CtxItem extends MatchCandidate { key: string; label: string; active?: boolean }
export interface ExpenseContext { objects: CtxItem[]; people: CtxItem[]; at: number }

const TTL = 60_000;
const cache = new Map<string, { at: number; p: Promise<ExpenseContext> }>();

const ROLE_UZ: Record<string, string> = { direktor: 'direktor', orinbosar: "o'rinbosar", prorab: 'prorab', brigadir: 'brigadir', ishchi: 'ishchi' };

export function buildExpenseContext(objs: any[], users: any[]): ExpenseContext {
  // faol obyektlar oldin (prompt uchun 60 tasi), tugaganlari ham moslashtirishda qatnashadi (avvalgidek)
  const sorted = [...objs].sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed'));
  const objects: CtxItem[] = sorted.map((o, i) => {
    const name = String(o.name || '').trim();
    return { key: `O${i + 1}`, id: String(o._id), name, label: name, aliases: objectAliases(name), active: o.status !== 'completed' };
  }).filter((o) => o.name);
  const people: CtxItem[] = users.filter((u) => u.role !== 'dasturchi').map((u, i) => {
    const first = String(u.firstName || '').trim(), last = String(u.lastName || '').trim();
    const name = `${first} ${last}`.trim();
    return { key: `P${i + 1}`, id: String(u._id), name, label: name, role: u.role, aliases: personAliases(first, last) };
  }).filter((p) => p.name);
  return { objects, people, at: Date.now() };
}

export function getExpenseContext(companyId?: string | null): Promise<ExpenseContext> {
  const k = String(companyId || '');
  if (!k) return Promise.resolve({ objects: [], people: [], at: Date.now() });
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = Promise.all([
    ObjectModel.find({ companyId: k }).select('name status').limit(300).lean().catch(() => []),
    User.find({ companyId: k }).select('firstName lastName role').limit(300).lean().catch(() => []),
  ]).then(([o, u]) => buildExpenseContext(o as any[], u as any[]));
  cache.set(k, { at: Date.now(), p });
  p.catch(() => cache.delete(k));
  return p;
}
export function invalidateExpenseContext(companyId?: string | null) { cache.delete(String(companyId || '')); }
export function _clearExpenseContextCache() { cache.clear(); }

/** Modelga beriladigan ro'yxat qatorlari: "O1: 12-maktab (12)" / "P3: Botirjon Karimov — prorab (botir, karimov)". */
export function promptLists(ctx: ExpenseContext): { objects: string[]; people: string[] } {
  const alias = (c: CtxItem) => (c.aliases || []).filter((a) => a.length >= 3 || /^\d+$/.test(a)).slice(0, 4);
  return {
    objects: ctx.objects.filter((o) => o.active !== false).slice(0, 60)
      .map((o) => `${o.key}: ${o.label}${alias(o).length ? ` (${alias(o).join(', ')})` : ''}`),
    people: ctx.people.slice(0, 80)
      .map((p) => `${p.key}: ${p.label}${p.role ? ` — ${ROLE_UZ[p.role] || p.role}` : ''}${alias(p).length ? ` (${alias(p).join(', ')})` : ''}`),
  };
}

export interface Resolved { match?: CtxItem; choices?: CtxItem[] }

/**
 * Model tanlagan kalit (+ ishonch) va eshitilgan nomni birlashtirib, aniq yozuvni topadi:
 *  - eshitilgan nom fuzzy bo'yicha aniq mos kelsa — o'sha (model boshqasini tanlagan bo'lsa ham, agar u juda ishonchli emas);
 *  - bir nechta deyarli teng nomzod — `choices` (botda tugma bilan so'raladi, taxmin qilinmaydi);
 *  - nom ro'yxatda yo'q, lekin model yuqori ishonch bilan tanlagan (taxallus) — model tanlovi.
 */
export function resolveEntity(list: CtxItem[], heard?: string, key?: string, confidence?: number): Resolved {
  const conf = Number.isFinite(confidence) ? Number(confidence) : 0.5;
  const byKey = key ? list.find((c) => c.key === String(key).trim().toUpperCase()) : undefined;
  const h = String(heard || '').trim();
  if (!h) return byKey && conf >= 0.7 ? { match: byKey } : {};
  const pick = pickCandidate(h, list);
  if (pick.match) {
    const m = list.find((c) => c.id === pick.match!.id)!;
    if (!byKey || byKey.id === m.id) return { match: m };
    const keyScore = scoreCandidates(h, [byKey])[0]?.score || 0;
    if (conf >= 0.8 && keyScore >= 0.6) return { match: byKey };
    if (pick.match.score >= 0.9) return { match: m };
    return { choices: [m, byKey] };
  }
  if (pick.ambiguous) {
    const amb = pick.ambiguous.map((a) => list.find((c) => c.id === a.id)!).filter(Boolean);
    if (byKey && amb.some((a) => a.id === byKey.id) && conf >= 0.75) return { match: byKey };
    return { choices: amb };
  }
  return byKey && conf >= 0.85 ? { match: byKey } : {};
}
