import ObjectModel from '../../../models/Object';
import User from '../../../models/User';
import Attendance from '../../../models/Attendance';
import Material from '../../../models/Material';
import Transaction from '../../../models/Transaction';
import mongoose from 'mongoose';
import { type AiToolDef, type ToolCtx } from '../types';
import { addDays } from '../../lib/zonedTime';
import {
  cf, ALL_CHANNELS, ALL_ROLES, ASSIST, canSeeObject, denied, FREE_TEXT_KEYS, fullName, isBoss, L, nameRegex,
  notFound, ok, today, UZS_AMOUNT, visibleObjectIds,
} from './common';

// getProjectSummary — obyekt holati: status, joy, prorab, ishchilar soni, bugun kelganlar, material
// talablari soni. Moliya (byudjet, sarf, kirim) — FAQAT rahbarlar (direktor/o'rinbosar/egasi).
// Prorab/brigadir — o'z obyektlari; ishchi — faqat biriktirilgan obyektlari.

async function spendByObject(ctx: ToolCtx, ids: string[], sinceDate?: string): Promise<Map<string, { spent: number; income: number }>> {
  const match: Record<string, unknown> = cf(ctx, {
    status: 'confirmed', type: { $ne: 'transfer' }, projectId: { $in: ids },
    ...(sinceDate ? { date: { $gte: sinceDate } } : {}),
  });
  const rows: any[] = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$projectId',
        spent: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, 0, UZS_AMOUNT] } },
        income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, UZS_AMOUNT, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { spent: Math.round(r.spent || 0), income: Math.round(r.income || 0) }]));
}

export const getProjectSummary: AiToolDef<{ objectId?: string; name?: string }> = {
  name: 'getProjectSummary',
  description: {
    uz: "Obyekt (loyiha) holati: status, joy, prorab, ishchilar soni, bugun kelganlar, material talablari. Rahbarlar uchun byudjet va sarf ham. objectId yoki name berilmasa — ko'ra oladigan obyektlar ro'yxati.",
    ru: 'Состояние объекта: статус, адрес, прораб, число рабочих, пришедшие сегодня, потребности в материалах. Для руководителей — бюджет и расходы. Без objectId/name — список доступных объектов.',
  },
  parameters: {
    type: 'object',
    properties: {
      objectId: { type: 'string', format: 'objectId', description: 'Obyekt ID (ixtiyoriy)' },
      name: { type: 'string', maxLength: 60, description: "Obyekt nomi yoki uning bir qismi (ixtiyoriy)" },
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
    const visible = await visibleObjectIds(ctx);
    const boss = isBoss(ctx);
    const scope: Record<string, unknown> = visible === null ? {} : { _id: { $in: visible } };

    let target: any = null;
    if (args.objectId) {
      if (!canSeeObject(visible, args.objectId)) return denied(ctx);
      target = await ObjectModel.findOne(cf(ctx, { _id: args.objectId })).select('name status location budget foremanId').lean();
      if (!target) return notFound(ctx);
    } else if (args.name) {
      const found: any[] = await ObjectModel.find(cf(ctx, { ...scope, name: nameRegex(args.name) }))
        .select('name status location budget foremanId').limit(10).lean();
      if (!found.length) return notFound(ctx, L(ctx, 'Bunday nomli obyekt topilmadi (yoki sizga ochiq emas).', 'Объект с таким названием не найден (или недоступен).'));
      if (found.length > 1) {
        return ok(L(ctx, `${found.length} ta obyekt mos keldi — qaysi biri?`, `Подходит ${found.length} объектов — какой именно?`),
          { candidates: found.map((o) => ({ id: String(o._id), name: o.name, status: o.status })) });
      }
      target = found[0];
    }

    // ── Ro'yxat rejimi ──
    if (!target) {
      const objs: any[] = await ObjectModel.find(cf(ctx, scope)).select('name status location budget').sort({ updatedAt: -1 }).limit(20).lean();
      const fin = boss && objs.length ? await spendByObject(ctx, objs.map((o) => String(o._id))) : null;
      return ok(L(ctx, `${objs.length} ta obyekt.`, `Объектов: ${objs.length}.`), {
        objects: objs.map((o) => ({
          id: String(o._id), name: o.name, status: o.status, location: o.location || undefined,
          ...(fin ? { budget: o.budget ?? undefined, spent: fin.get(String(o._id))?.spent || 0 } : {}),
        })),
        financeIncluded: !!fin,
      });
    }

    // ── Bitta obyekt ──
    const id = String(target._id);
    const date = today();
    const workers: any[] = await User.find(cf(ctx, { projectIds: id, isBlocked: { $ne: true } })).select('_id').lean();
    const workerIds = workers.map((w) => String(w._id));
    const [foreman, presentToday, matAgg] = await Promise.all([
      target.foremanId ? User.findOne(cf(ctx, { _id: target.foremanId })).select('firstName lastName').lean() : null,
      workerIds.length ? Attendance.countDocuments(cf(ctx, { date, userId: { $in: workerIds }, checkIn: { $exists: true, $ne: null } })) : 0,
      Material.aggregate([
        { $match: cf(ctx, { objectId: new mongoose.Types.ObjectId(id) }) },
        { $group: { _id: null, items: { $sum: 1 }, notFullySent: { $sum: { $cond: [{ $gt: ['$remaining', 0] }, 1, 0] } } } },
      ]),
    ]);
    const data: Record<string, unknown> = {
      id, name: target.name, status: target.status, location: target.location || undefined,
      foremanName: foreman ? fullName(foreman) : undefined,
      workersAssigned: workerIds.length,
      presentToday,
      materialRequirements: { items: matAgg[0]?.items || 0, notFullySent: matAgg[0]?.notFullySent || 0 },
      financeIncluded: boss,
    };
    if (boss) {
      const [all, last30] = await Promise.all([spendByObject(ctx, [id]), spendByObject(ctx, [id], addDays(date, -30))]);
      const spent = all.get(id)?.spent || 0;
      data.finance = {
        currency: 'UZS',
        budget: target.budget ?? undefined,
        spentTotal: spent,
        incomeTotal: all.get(id)?.income || 0,
        spentLast30Days: last30.get(id)?.spent || 0,
        budgetUsedPercent: target.budget ? Math.round((spent / target.budget) * 100) : undefined,
      };
    }
    return ok(L(ctx, "Obyekt ma'lumoti tayyor.", 'Данные объекта готовы.'), data);
  },
};
