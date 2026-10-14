import mongoose from 'mongoose';
import Material from '../../../models/Material';
import ObjectModel from '../../../models/Object';
import { type AiToolDef } from '../types';
import {
  cf, ALL_CHANNELS, ASSIST, canSeeObject, denied, FREE_TEXT_KEYS, isBoss, L, MANAGER_ROLES, nameRegex, ok, visibleObjectIds,
} from './common';

// getInventoryBalance — MUHIM: models/Material OMBOR QOLDIG'I EMAS. U har bir obyekt uchun material
// TALABLARI ro'yxati: kerak (needed), yuborilgan (sent), yana yuborilishi kerak (remaining).
// Natija nomlari shunga mos ("requirements"), "note" maydoni modelga buni aniq aytadi.
// Narx (price) — faqat rahbarlarga. Prorab/brigadir — faqat o'z obyektlari.

const LIMIT = 60;

export const getInventoryBalance: AiToolDef<{ objectId?: string; material?: string }> = {
  name: 'getInventoryBalance',
  description: {
    uz: "Obyekt(lar) bo'yicha material TALABLARI: kerak / yuborilgan / yana kerak (qolgan). Bu ombor qoldig'i EMAS. objectId va material nomi ixtiyoriy.",
    ru: 'ПОТРЕБНОСТИ объектов в материалах: нужно / отправлено / ещё нужно. Это НЕ складской остаток. objectId и название материала необязательны.',
  },
  parameters: {
    type: 'object',
    properties: {
      objectId: { type: 'string', format: 'objectId', description: 'Obyekt ID (ixtiyoriy)' },
      material: { type: 'string', maxLength: 60, description: 'Material nomi yoki qismi (ixtiyoriy)' },
    },
  },
  refs: { objectId: 'Object' },
  kind: 'read',
  confirm: 'never',
  maxRoles: MANAGER_ROLES,
  defaultRoles: MANAGER_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  handler: async (ctx, args) => {
    const visible = await visibleObjectIds(ctx);
    if (args.objectId && !canSeeObject(visible, args.objectId)) return denied(ctx);
    const objectIds = args.objectId ? [args.objectId] : visible;
    if (objectIds && !objectIds.length) {
      return ok(L(ctx, "Sizga biriktirilgan obyekt yo'q.", 'У вас нет назначенных объектов.'), { requirements: [] });
    }
    const filter: Record<string, unknown> = {};
    if (objectIds) filter.objectId = { $in: objectIds.map((id) => new mongoose.Types.ObjectId(id)) };
    if (args.material) filter.name = nameRegex(args.material);

    const rows: any[] = await Material.find(cf(ctx, filter))
      .select('objectId name needed sent remaining unit price').sort({ remaining: -1 }).limit(LIMIT + 1).lean();
    const objIds = [...new Set(rows.map((r) => String(r.objectId)))];
    const objs: any[] = objIds.length ? await ObjectModel.find(cf(ctx, { _id: { $in: objIds } })).select('name').lean() : [];
    const objName = new Map(objs.map((o) => [String(o._id), o.name]));
    const boss = isBoss(ctx);

    const requirements = rows.slice(0, LIMIT).map((r) => ({
      objectId: String(r.objectId),
      objectName: objName.get(String(r.objectId)),
      materialName: r.name,
      unit: r.unit,
      needed: r.needed,
      sent: r.sent,
      stillNeeded: r.remaining,
      ...(boss && typeof r.price === 'number' ? { unitPrice: r.price } : {}),
    }));
    return ok(
      L(ctx, `${requirements.length} ta material talabi topildi (ombor qoldig'i emas).`, `Найдено потребностей: ${requirements.length} (не складской остаток).`),
      {
        note: L(ctx,
          "Bu ombor qoldig'i EMAS: obyekt uchun kerakli, yuborilgan va yana yuborilishi kerak bo'lgan miqdor. Omborda qancha borligi ERP'da yuritilmaydi.",
          'Это НЕ складской остаток: сколько нужно объекту, сколько отправлено и сколько ещё нужно. Складской учёт в ERP не ведётся.'),
        truncated: rows.length > LIMIT,
        requirements,
      },
    );
  },
};
