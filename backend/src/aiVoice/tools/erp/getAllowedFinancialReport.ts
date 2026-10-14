import Transaction from '../../../models/Transaction';
import ObjectModel from '../../../models/Object';
import { type AiToolDef } from '../types';
import { addDays } from '../../lib/zonedTime';
import { cf, ALL_CHANNELS, ASSIST, BOSS_ROLES, FREE_TEXT_KEYS, L, ok, today, UZS_AMOUNT } from './common';

// getAllowedFinancialReport — FAQAT rahbarlar (direktor/o'rinbosar/egasi; kod shifti maxRoles).
// Faqat YIG'INDI: turlar va obyektlar bo'yicha jami, kirim, tasdiq kutayotganlar. Shaxs bo'yicha
// maosh, ism, tranzaksiya tavsiflari QAYTARILMAYDI ('oylik' — faqat umumiy toifa summasi).
// routes/ai.ts buildFinanceContext qayta ishlatilmaydi (u 90 kunlik barcha yozuvni xotiraga yuklaydi).

type Period = 'this_month' | 'last_month' | 'last_30_days' | 'last_90_days' | 'this_year';
const PERIODS: Period[] = ['this_month', 'last_month', 'last_30_days', 'last_90_days', 'this_year'];

export function periodRange(p: Period, now: string = today()): { from: string; to: string } {
  const [y, m] = now.split('-').map(Number);
  const mm = (n: number) => String(n).padStart(2, '0');
  switch (p) {
    case 'last_month': {
      const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1;
      return { from: `${ly}-${mm(lm)}-01`, to: addDays(`${y}-${mm(m)}-01`, -1) };
    }
    case 'last_30_days': return { from: addDays(now, -29), to: now };
    case 'last_90_days': return { from: addDays(now, -89), to: now };
    case 'this_year': return { from: `${y}-01-01`, to: now };
    default: return { from: `${y}-${mm(m)}-01`, to: now };
  }
}

const round = (n: unknown) => Math.round(Number(n) || 0);

export const getAllowedFinancialReport: AiToolDef<{ period?: Period; objectId?: string }> = {
  name: 'getAllowedFinancialReport',
  description: {
    uz: "Moliyaviy xulosa (faqat rahbar): davr bo'yicha jami chiqim/kirim, turlar va obyektlar kesimida, tasdiq kutayotgan chiqimlar. Shaxsiy maoshlar ko'rsatilmaydi.",
    ru: 'Финансовая сводка (только руководитель): расходы/доходы за период по типам и объектам, расходы на утверждении. Без зарплат по людям.',
  },
  parameters: {
    type: 'object',
    properties: {
      period: { type: 'string', enum: PERIODS, description: 'Standart: this_month' },
      objectId: { type: 'string', format: 'objectId', description: 'Faqat shu obyekt (ixtiyoriy)' },
    },
  },
  refs: { objectId: 'Object' },
  kind: 'read',
  confirm: 'never',
  maxRoles: BOSS_ROLES,
  defaultRoles: BOSS_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  handler: async (ctx, args) => {
    const period: Period = args.period || 'this_month';
    const { from, to } = periodRange(period);
    const base: Record<string, unknown> = { type: { $ne: 'transfer' }, date: { $gte: from, $lte: to } };
    if (args.objectId) base.projectId = args.objectId;
    const confirmed = cf(ctx, { ...base, status: 'confirmed' });

    const [byType, byObject, pending] = await Promise.all([
      Transaction.aggregate([
        { $match: confirmed },
        { $group: { _id: '$type', sum: { $sum: UZS_AMOUNT }, count: { $sum: 1 } } },
      ]),
      args.objectId ? Promise.resolve([] as any[]) : Transaction.aggregate([
        { $match: { ...confirmed, type: { $nin: ['transfer', 'income'] }, projectId: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$projectId', spent: { $sum: UZS_AMOUNT } } },
        { $sort: { spent: -1 } },
        { $limit: 10 },
      ]),
      Transaction.aggregate([
        { $match: cf(ctx, { ...base, status: 'pending', requiresAdminApproval: true }) },
        { $group: { _id: null, sum: { $sum: UZS_AMOUNT }, count: { $sum: 1 } } },
      ]),
    ]);

    let expense = 0, income = 0, count = 0;
    const expenseByType: Record<string, number> = {};
    for (const r of byType as any[]) {
      count += r.count || 0;
      if (r._id === 'income') income += r.sum || 0;
      else { expense += r.sum || 0; expenseByType[String(r._id)] = round(r.sum); }
    }
    const objIds = (byObject as any[]).map((r) => String(r._id));
    const objs: any[] = objIds.length ? await ObjectModel.find(cf(ctx, { _id: { $in: objIds } })).select('name budget').lean() : [];
    const objMap = new Map(objs.map((o) => [String(o._id), o]));

    return ok(L(ctx, `Moliyaviy xulosa: ${from} — ${to}.`, `Финансовая сводка: ${from} — ${to}.`), {
      currency: 'UZS', period, from, to,
      ...(args.objectId ? { objectId: args.objectId } : {}),
      totals: { expense: round(expense), income: round(income), net: round(income - expense), transactions: count },
      expenseByType,
      topObjectsBySpend: (byObject as any[])
        .filter((r) => objMap.has(String(r._id)))
        .map((r) => ({ objectId: String(r._id), objectName: objMap.get(String(r._id))?.name, spent: round(r.spent), budget: objMap.get(String(r._id))?.budget ?? undefined })),
      pendingApproval: { count: (pending as any[])[0]?.count || 0, sum: round((pending as any[])[0]?.sum) },
      note: L(ctx, "Faqat tasdiqlangan amallar; o'tkazmalar (transfer) kirmaydi; shaxsiy maoshlar ko'rsatilmaydi.",
        'Только подтверждённые операции; переводы не учитываются; зарплаты по людям не показываются.'),
    });
  },
};
