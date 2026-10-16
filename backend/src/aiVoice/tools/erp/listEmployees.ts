import User from '../../../models/User';
import ObjectModel from '../../../models/Object';
import Attendance from '../../../models/Attendance';
import type { AiToolDef } from '../types';
import { isObjectIdString } from '../../lib/ids';
import { zonedParts } from '../../lib/zonedTime';
import {
  cf, ALL_CHANNELS, ASSIST, canSeeObject, denied, FREE_TEXT_KEYS, fullName, isBoss, L, MANAGER_ROLES, nameRegex, ok, today, visibleObjectIds,
} from './common';

// listEmployees — xodimlar: ism, rol, obyekt(lar), bugungi davomat. Telefon, maosh, Telegram — YO'Q.
// Rahbar — butun firma; prorab/brigadir — o'z obyektlaridagi xodimlar; ishchi — kod shifti bo'yicha rad.

const LIMIT = 30;
const ROLES = ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'] as const;
const TODAY = ['present', 'late', 'not_checked_in'] as const;

interface Args { objectId?: string; role?: typeof ROLES[number]; name?: string; today?: typeof TODAY[number] }

export const listEmployees: AiToolDef<Args> = {
  name: 'listEmployees',
  description: {
    uz: "Xodimlar ro'yxati: ism, rol, obyekt, bugun kelganmi (vaqti). Filtr: obyekt, rol, ism, bugungi holat. Telefon/maosh yo'q.",
    ru: 'Список сотрудников: имя, роль, объект, пришёл ли сегодня. Фильтры: объект, роль, имя, статус сегодня. Без телефонов/зарплат.',
  },
  parameters: {
    type: 'object',
    properties: {
      objectId: { type: 'string', format: 'objectId' },
      role: { type: 'string', enum: [...ROLES] },
      name: { type: 'string', maxLength: 60 },
      today: { type: 'string', enum: [...TODAY], description: 'Bugungi holat bo\'yicha filtr' },
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
    const visible = isBoss(ctx) ? null : await visibleObjectIds(ctx);
    if (args.objectId && !canSeeObject(visible, args.objectId)) return denied(ctx);
    const filter: Record<string, unknown> = { isBlocked: { $ne: true } };
    if (args.objectId) filter.projectIds = args.objectId;
    else if (visible !== null) {
      if (!visible.length) return ok(L(ctx, "Sizga biriktirilgan obyekt yo'q.", 'Нет закреплённых объектов.'), { total: 0, items: [] });
      filter.projectIds = { $in: visible };
    }
    if (args.role) filter.role = args.role;
    if (args.name) filter.$or = [{ firstName: nameRegex(args.name) }, { lastName: nameRegex(args.name) }];

    const users: any[] = await User.find(cf(ctx, filter)).select('firstName lastName role projectIds').sort({ firstName: 1 }).limit(200).lean();
    const date = today();
    const ids = users.map((u) => String(u._id));
    const objIds = [...new Set(users.flatMap((u) => (u.projectIds || []) as unknown[]).filter(isObjectIdString))] as string[];
    const [att, objs] = await Promise.all([
      ids.length ? Attendance.find(cf(ctx, { date, userId: { $in: ids } })).select('userId checkIn status').lean() : [],
      objIds.length ? ObjectModel.find(cf(ctx, { _id: { $in: objIds } })).select('name').lean() : [],
    ]);
    const attBy = new Map((att as any[]).map((a) => [String(a.userId), a]));
    const on = new Map((objs as any[]).map((o) => [String(o._id), o.name as string]));
    let rows = users.map((u) => {
      const a = attBy.get(String(u._id));
      const st = a?.checkIn ? (a.status === 'late' ? 'late' : 'present') : 'not_checked_in';
      const t = a?.checkIn ? new Date(a.checkIn) : null;
      return {
        id: String(u._id), name: fullName(u), role: u.role,
        objects: ((u.projectIds || []) as string[]).map((p) => on.get(String(p))).filter(Boolean).slice(0, 3).map((objectName) => ({ objectName })),
        today: st, ...(t && !Number.isNaN(t.getTime()) ? { checkInAt: zonedParts(t).hhmm } : {}),
      };
    });
    const counts = { present: 0, late: 0, not_checked_in: 0 } as Record<string, number>;
    for (const r of rows) counts[r.today]++;
    if (args.today) rows = rows.filter((r) => r.today === args.today);
    return ok(L(ctx, `${rows.length} ta xodim.`, `Сотрудников: ${rows.length}.`), {
      date, total: rows.length, todayCounts: counts, shown: Math.min(rows.length, LIMIT), items: rows.slice(0, LIMIT),
    });
  },
};
