import ObjectModel from '../models/Object';
import Material from '../models/Material';
import Transaction from '../models/Transaction';

// ─── Plan-fakt (owner 2026-10-19: "asosiysi") ───────────────────────────────────────────────────────────────────
// Har obyekt: byudjet (yoki smeta jami) ↔ haqiqiy sarf, material (kerak ↔ yetkazilgan), muddat (reja ↔ o'tgan vaqt),
// bajarilish foizi (qo'lda > AI foto-baho > material nisbati) va prognoz: shu sur'atda yakuniy narx va tugash sanasi.

export type PlanFactStatus = 'ok' | 'risk' | 'late' | 'over_budget' | 'no_plan';

export interface PlanFact {
  objectId: string;
  name: string;
  status: PlanFactStatus;
  budget: number | null;
  spent: number;
  pendingSpend: number;
  spentPct: number | null;          // sarf / byudjet
  progressPct: number;              // bajarilish
  progressSource: 'manual' | 'ai_photo' | 'materials' | 'none';
  materialPct: number | null;       // yetkazilgan / kerak
  timePct: number | null;           // o'tgan vaqt / reja muddati
  startDate: string | null;
  endDate: string | null;
  forecastCost: number | null;
  forecastOverrun: number | null;   // forecastCost - budget (musbat — oshib ketadi)
  forecastEnd: string | null;
  delayDays: number | null;         // musbat — kechikadi
  materials: { needed: number; sent: number; items: number; behind: Array<{ name: string; unit: string; needed: number; sent: number }> };
  notes: string[];
}

const SPEND_TYPES = ['expense', 'material', 'jihozlar', 'transport', 'boshqa', 'oylik'];
const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

export function computePlanFact(o: any, mats: any[], spend: { confirmed: number; pending: number }, now = new Date()): PlanFact {
  const notes: string[] = [];
  const budgetRaw = Number(o.budget) || Number(o.smeta?.meta?.totalWithoutVat) || 0;
  const budget = budgetRaw > 0 ? budgetRaw : null;
  const needed = mats.reduce((s, m) => s + (Number(m.needed) || 0), 0);
  const sent = mats.reduce((s, m) => s + Math.min(Number(m.sent) || 0, Number(m.needed) || Infinity), 0);
  const materialPct = needed > 0 ? clampPct((sent / needed) * 100) : null;

  let progressPct = 0;
  let progressSource: PlanFact['progressSource'] = 'none';
  if (typeof o.progressManual === 'number' && o.progressManual >= 0) { progressPct = clampPct(o.progressManual); progressSource = 'manual'; }
  else if (typeof o.progressAi?.percent === 'number') { progressPct = clampPct(o.progressAi.percent); progressSource = 'ai_photo'; }
  else if (materialPct !== null) { progressPct = materialPct; progressSource = 'materials'; }
  if (o.status === 'completed') { progressPct = 100; }

  const start = o.startDate ? new Date(o.startDate) : null;
  const end = o.endDate ? new Date(o.endDate) : null;
  let timePct: number | null = null;
  if (start && end && end > start) timePct = clampPct(((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100);

  const spentPct = budget ? clampPct((spend.confirmed / budget) * 100) : null;

  // Prognoz — bajarilish 5% dan oshgandagina ma'noli (boshlang'ich xarajatlar buzib ko'rsatmasin)
  let forecastCost: number | null = null;
  let forecastEnd: string | null = null;
  let delayDays: number | null = null;
  if (progressPct >= 5 && progressPct < 100) {
    forecastCost = Math.round(spend.confirmed / (progressPct / 100));
    if (start) {
      const elapsed = now.getTime() - start.getTime();
      if (elapsed > 0) {
        const fe = new Date(start.getTime() + elapsed / (progressPct / 100));
        forecastEnd = isoDay(fe);
        if (end) delayDays = Math.round((fe.getTime() - end.getTime()) / DAY);
      }
    }
  } else if (progressPct >= 100) {
    forecastCost = spend.confirmed;
  }
  const forecastOverrun = budget && forecastCost !== null ? forecastCost - budget : null;

  let status: PlanFactStatus = 'ok';
  if (!budget && !end) status = 'no_plan';
  if (budget && spend.confirmed > budget) { status = 'over_budget'; notes.push('Byudjetdan oshib ketdi'); }
  else if (forecastOverrun !== null && budget && forecastOverrun > budget * 0.05) { status = 'risk'; notes.push(`Shu sur'atda byudjetdan ~${Math.round((forecastOverrun / budget) * 100)}% oshadi`); }
  if (end && now > end && progressPct < 100) { status = status === 'over_budget' ? status : 'late'; notes.push('Reja muddati o\'tib ketdi'); }
  else if (delayDays !== null && delayDays > 7 && status === 'ok') { status = 'risk'; notes.push(`~${delayDays} kun kechikishi mumkin`); }
  if (timePct !== null && timePct - progressPct > 20 && status === 'ok') { status = 'risk'; notes.push('Ish vaqtdan orqada'); }
  if (materialPct !== null && progressSource !== 'materials' && progressPct - materialPct > 25) notes.push('Material yetkazish ish sur\'atidan orqada');

  const behind = mats
    .filter((m) => (Number(m.needed) || 0) > 0 && (Number(m.sent) || 0) < (Number(m.needed) || 0) * 0.5)
    .sort((a, b) => (b.needed - b.sent) - (a.needed - a.sent))
    .slice(0, 5)
    .map((m) => ({ name: String(m.name), unit: String(m.unit || ''), needed: Number(m.needed) || 0, sent: Number(m.sent) || 0 }));

  return {
    objectId: String(o._id), name: String(o.name || ''), status, budget,
    spent: Math.round(spend.confirmed), pendingSpend: Math.round(spend.pending), spentPct,
    progressPct, progressSource, materialPct, timePct,
    startDate: start ? isoDay(start) : null, endDate: end ? isoDay(end) : null,
    forecastCost, forecastOverrun, forecastEnd, delayDays,
    materials: { needed: Math.round(needed), sent: Math.round(sent), items: mats.length, behind },
    notes,
  };
}

/** Bir yoki bir nechta obyekt uchun (firma doirasidagi filtr chaqiruvchidan keladi). */
export async function planFactFor(objectFilter: Record<string, unknown>, now = new Date()): Promise<PlanFact[]> {
  const objects: any[] = await ObjectModel.find(objectFilter)
    .select('name status budget smeta.meta startDate endDate progressManual progressAi companyId').lean();
  if (!objects.length) return [];
  const ids = objects.map((o) => o._id);
  const idStr = ids.map(String);
  const [mats, spendRows] = await Promise.all([
    Material.find({ objectId: { $in: ids } }).select('objectId name unit needed sent').lean(),
    Transaction.aggregate([
      { $match: { projectId: { $in: idStr }, type: { $in: SPEND_TYPES }, status: { $in: ['confirmed', 'pending'] } } },
      { $group: { _id: { p: '$projectId', s: '$status' }, sum: { $sum: { $ifNull: ['$uzsAmount', '$amount'] } } } },
    ]),
  ]);
  const matsBy = new Map<string, any[]>();
  for (const m of mats as any[]) {
    const k = String(m.objectId);
    if (!matsBy.has(k)) matsBy.set(k, []);
    matsBy.get(k)!.push(m);
  }
  const spendBy = new Map<string, { confirmed: number; pending: number }>();
  for (const r of spendRows as any[]) {
    const k = String(r._id.p);
    const cur = spendBy.get(k) || { confirmed: 0, pending: 0 };
    if (r._id.s === 'confirmed') cur.confirmed += Number(r.sum) || 0; else cur.pending += Number(r.sum) || 0;
    spendBy.set(k, cur);
  }
  return objects.map((o) => computePlanFact(o, matsBy.get(String(o._id)) || [], spendBy.get(String(o._id)) || { confirmed: 0, pending: 0 }, now));
}
