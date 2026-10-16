import mongoose from 'mongoose';
import ObjectModel from '../../../models/Object';
import User from '../../../models/User';
import Attendance from '../../../models/Attendance';
import Material from '../../../models/Material';
import Transaction from '../../../models/Transaction';
import type { AiToolDef } from '../types';
import {
  cf, ALL_CHANNELS, ALL_ROLES, ASSIST, canSeeObject, denied, FREE_TEXT_KEYS, fullName, isBoss, L, nameRegex, notFound, ok, today,
  UZS_AMOUNT, visibleObjectIds,
} from './common';

// getObjectDetails — bitta obyekt bo'yicha batafsil: materiallar (kerak/yuborilgan/qolgan), prorab,
// ishchilar (ism, rol, bugun kelganmi). Byudjet/sarf — FAQAT rahbar. Faqat ko'ra oladigan obyektlar.
// Telefon/maosh qaytarilmaydi.

const MAT_LIMIT = 15;
const WORKER_LIMIT = 30;

export const getObjectDetails: AiToolDef<{ objectId?: string; name?: string; material?: string }> = {
  name: 'getObjectDetails',
  description: {
    uz: "Obyekt tafsiloti: materiallar (kerak/yuborilgan/yana kerak), prorab, ishchilar va bugun kelganlar; rahbarga byudjet va sarf. objectId yoki name kerak.",
    ru: 'Детали объекта: материалы (нужно/отправлено/осталось), прораб, рабочие и кто пришёл сегодня; руководителю — бюджет и расходы. Нужен objectId или name.',
  },
  parameters: {
    type: 'object',
    properties: {
      objectId: { type: 'string', format: 'objectId' },
      name: { type: 'string', maxLength: 60, description: 'Obyekt nomi (qismi)' },
      material: { type: 'string', maxLength: 60, description: 'Faqat shu material (ixtiyoriy)' },
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
    let obj: any = null;
    if (args.objectId) {
      if (!canSeeObject(visible, args.objectId)) return denied(ctx);
      obj = await ObjectModel.findOne(cf(ctx, { _id: args.objectId })).select('name status location budget foremanId').lean();
    } else if (args.name) {
      const found: any[] = await ObjectModel.find(cf(ctx, { ...(visible === null ? {} : { _id: { $in: visible } }), name: nameRegex(args.name) }))
        .select('name status location budget foremanId').limit(5).lean();
      if (found.length > 1) {
        return ok(L(ctx, 'Bir nechta obyekt mos keldi — qaysi biri?', 'Подходит несколько объектов — какой?'), { candidates: found.map((o) => ({ id: String(o._id), name: o.name })) });
      }
      obj = found[0] || null;
    } else {
      return { status: 'error', message: L(ctx, 'Qaysi obyekt? Nomini ayting.', 'Какой объект? Назовите его.'), retryable: false };
    }
    if (!obj) return notFound(ctx, L(ctx, 'Obyekt topilmadi (yoki sizga ochiq emas).', 'Объект не найден (или недоступен).'));

    const id = String(obj._id);
    const date = today();
    const matFilter: Record<string, unknown> = { objectId: new mongoose.Types.ObjectId(id), ...(args.material ? { name: nameRegex(args.material) } : {}) };
    const [foreman, workers, mats, matCount] = await Promise.all([
      obj.foremanId ? User.findOne(cf(ctx, { _id: obj.foremanId })).select('firstName lastName').lean() : null,
      User.find(cf(ctx, { projectIds: id, isBlocked: { $ne: true } })).select('firstName lastName role').limit(WORKER_LIMIT).lean(),
      Material.find(cf(ctx, matFilter)).select('name unit needed sent remaining').sort({ remaining: -1 }).limit(MAT_LIMIT).lean(),
      Material.countDocuments(cf(ctx, matFilter)),
    ]);
    const wIds = (workers as any[]).map((w) => String(w._id));
    const att: any[] = wIds.length
      ? await Attendance.find(cf(ctx, { date, userId: { $in: wIds } })).select('userId checkIn status').lean() : [];
    const attBy = new Map(att.map((a) => [String(a.userId), a]));
    const workerRows = (workers as any[]).map((w) => {
      const a = attBy.get(String(w._id));
      return { name: fullName(w), role: w.role, today: a?.checkIn ? (a.status === 'late' ? 'late' : 'present') : 'not_checked_in' };
    });
    const data: Record<string, unknown> = {
      id, name: obj.name, status: obj.status, location: obj.location || undefined,
      foremanName: foreman ? fullName(foreman) : undefined,
      workers: { total: wIds.length, presentToday: workerRows.filter((w) => w.today !== 'not_checked_in').length, list: workerRows },
      materials: {
        total: matCount, shown: mats.length,
        items: (mats as any[]).map((m) => ({ materialName: m.name, unit: m.unit, needed: m.needed, sent: m.sent, remaining: m.remaining })),
      },
      financeIncluded: boss,
    };
    if (boss) {
      const agg: any[] = await Transaction.aggregate([
        { $match: cf(ctx, { projectId: id, status: 'confirmed', type: { $nin: ['transfer', 'income'] } }) },
        { $group: { _id: null, spent: { $sum: UZS_AMOUNT } } },
      ]);
      const spent = Math.round(agg[0]?.spent || 0);
      data.finance = {
        currency: 'UZS', budget: obj.budget ?? undefined, spent,
        budgetLeft: obj.budget ? obj.budget - spent : undefined,
        budgetUsedPercent: obj.budget ? Math.round((spent / obj.budget) * 100) : undefined,
      };
    }
    return ok(L(ctx, 'Obyekt tafsiloti tayyor.', 'Детали объекта готовы.'), data);
  },
};
