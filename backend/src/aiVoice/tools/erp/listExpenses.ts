import Transaction from '../../../models/Transaction';
import User from '../../../models/User';
import ObjectModel from '../../../models/Object';
import type { AiToolDef } from '../types';
import { isObjectIdString } from '../../lib/ids';
import { addDays } from '../../lib/zonedTime';
import { periodRange } from './getAllowedFinancialReport';
import {
  cf, ALL_CHANNELS, ALL_ROLES, ASSIST, canSeeObject, denied, FREE_TEXT_KEYS, fullName, isBoss, L, nameRegex, notFound, ok, today, visibleObjectIds,
} from './common';

// listExpenses — chiqimlar ro'yxati (owner 2026-10-16: "AI hamma narsani bilsin").
// Rahbar — butun firma; boshqalar — faqat O'ZI kiritgan chiqimlar. Maosh (oylik) yozuvlari KIRMAYDI —
// shaxsiy maosh hech kimga aytilmaydi (jami — getAllowedFinancialReport'da). Tavsif/ism — untrusted.

type Period = 'today' | 'this_week' | 'this_month' | 'last_month' | 'last_30_days';
const PERIODS: Period[] = ['today', 'this_week', 'this_month', 'last_month', 'last_30_days'];
const TYPES = ['expense', 'material', 'jihozlar', 'transport', 'boshqa'] as const;
const STATUSES = ['pending', 'confirmed', 'rejected'] as const;
const LIMIT = 15;

function range(p: Period, now: string): { from: string; to: string } {
  if (p === 'today') return { from: now, to: now };
  if (p === 'this_week') return { from: addDays(now, -6), to: now };
  return periodRange(p, now);
}

interface Args { period?: Period; objectId?: string; objectName?: string; type?: typeof TYPES[number]; status?: typeof STATUSES[number] }

export const listExpenses: AiToolDef<Args> = {
  name: 'listExpenses',
  description: {
    uz: "Chiqimlar ro'yxati va jami (davr, obyekt, tur, holat bo'yicha). Rahbar — butun firma, boshqalar — o'zi kiritganlari. Maoshlar kirmaydi.",
    ru: 'Список расходов и итог (период, объект, тип, статус). Руководитель — вся фирма, остальные — свои. Без зарплат.',
  },
  parameters: {
    type: 'object',
    properties: {
      period: { type: 'string', enum: PERIODS, description: 'Standart this_month' },
      objectId: { type: 'string', format: 'objectId' },
      objectName: { type: 'string', maxLength: 60, description: 'Obyekt nomi (qismi)' },
      type: { type: 'string', enum: [...TYPES] },
      status: { type: 'string', enum: [...STATUSES] },
    },
  },
  refs: { objectId: 'Object' },
  kind: 'read',
  confirm: 'never',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  handler: async (ctx, args) => {
    const boss = isBoss(ctx);
    const now = today();
    const { from, to } = range(args.period || 'this_month', now);
    const filter: Record<string, unknown> = {
      type: args.type ? args.type : { $in: [...TYPES] },
      date: { $gte: from, $lte: to },
      ...(args.status ? { status: args.status } : {}),
    };
    if (!boss) filter.createdById = ctx.userId;

    let objectId = args.objectId;
    if (!objectId && args.objectName) {
      const visible = await visibleObjectIds(ctx);
      const objs: any[] = await ObjectModel.find(cf(ctx, { ...(visible === null ? {} : { _id: { $in: visible } }), name: nameRegex(args.objectName) }))
        .select('name').limit(5).lean();
      if (!objs.length) return notFound(ctx, L(ctx, 'Bunday obyekt topilmadi.', 'Объект не найден.'));
      if (objs.length > 1) return ok(L(ctx, 'Bir nechta obyekt mos keldi — qaysi biri?', 'Подходит несколько объектов — какой?'), { candidates: objs.map((o) => ({ id: String(o._id), name: o.name })) });
      objectId = String(objs[0]._id);
    }
    if (objectId) {
      if (!boss && !canSeeObject(await visibleObjectIds(ctx), objectId)) return denied(ctx);
      filter.projectId = objectId;
    }

    const f = cf(ctx, filter);
    const [rows, agg] = await Promise.all([
      Transaction.find(f).select('type status amount uzsAmount date description projectId createdById requiresAdminApproval').sort({ date: -1, createdAt: -1 }).limit(LIMIT).lean(),
      Transaction.aggregate([{ $match: f }, { $group: { _id: '$status', n: { $sum: 1 }, sum: { $sum: { $ifNull: ['$uzsAmount', { $ifNull: ['$amount', 0] }] } } } }]),
    ]);
    const objIds = [...new Set((rows as any[]).map((r) => r.projectId).filter(isObjectIdString))];
    const userIds = boss ? [...new Set((rows as any[]).map((r) => r.createdById).filter(isObjectIdString))] : [];
    const [objs, users] = await Promise.all([
      objIds.length ? ObjectModel.find(cf(ctx, { _id: { $in: objIds } })).select('name').lean() : [],
      userIds.length ? User.find(cf(ctx, { _id: { $in: userIds } })).select('firstName lastName').lean() : [],
    ]);
    const on = new Map((objs as any[]).map((o) => [String(o._id), o.name]));
    const un = new Map((users as any[]).map((u) => [String(u._id), fullName(u)]));
    const byStatus: Record<string, { count: number; sum: number }> = {};
    let count = 0, sum = 0;
    for (const a of agg as any[]) {
      byStatus[a._id] = { count: a.n, sum: Math.round(a.sum || 0) };
      count += a.n;
      if (a._id !== 'rejected') sum += Math.round(a.sum || 0);
    }
    return ok(L(ctx, `${from} — ${to}: ${count} ta chiqim.`, `${from} — ${to}: расходов ${count}.`), {
      period: { from, to }, scope: boss ? 'company' : 'own', currency: 'UZS',
      total: { count, sumExcludingRejected: sum }, byStatus,
      items: (rows as any[]).map((r) => ({
        id: String(r._id), date: r.date, type: r.type, status: r.status,
        amount: Math.round(Number(r.uzsAmount ?? r.amount) || 0),
        description: r.description || undefined,
        objectName: r.projectId ? on.get(String(r.projectId)) : undefined,
        ...(boss && r.createdById ? { ownerName: un.get(String(r.createdById)) } : {}),
        ...(r.requiresAdminApproval && r.status === 'pending' ? { awaitingApproval: true } : {}),
      })),
      shown: rows.length,
    });
  },
};
