import User from '../../../models/User';
import ObjectModel from '../../../models/Object';
import { type AiToolDef, type ToolCtx } from '../types';
import { isObjectIdString } from '../../lib/ids';
import { cf, ALL_CHANNELS, ALL_ROLES, ASSIST, FREE_TEXT_KEYS, fullName, L, nameRegex, notFound, ok } from './common';

// getEmployeeProfile — xodim profili. O'ZI: to'liq (telefon, maosh stavkasi ham). BOSHQALAR: faqat
// ism, lavozim (rol), position, brigada, obyektlar — telefon va maosh HECH QACHON (rahbarga ham).
// Ikki qatlam: handler bularni umuman o'qimaydi + executor redaksiyasi (redactToolOutput).

async function objectsOf(ctx: ToolCtx, ids: unknown[]): Promise<{ id: string; name: string }[]> {
  const valid = (ids || []).filter(isObjectIdString) as string[];
  if (!valid.length) return [];
  const objs: any[] = await ObjectModel.find(cf(ctx, { _id: { $in: valid } })).select('name').limit(20).lean();
  return objs.map((o) => ({ id: String(o._id), name: o.name }));
}

const PUBLIC_FIELDS = 'firstName lastName role position brigade projectIds';

export const getEmployeeProfile: AiToolDef<{ userId?: string; name?: string }> = {
  name: 'getEmployeeProfile',
  description: {
    uz: "Xodim profili. Argumentsiz — o'zimniki (to'liq). Boshqa xodim (userId yoki ism bo'yicha) — faqat ism, lavozim, brigada va obyektlar; telefon va maosh berilmaydi.",
    ru: 'Профиль сотрудника. Без аргументов — мой (полный). Другой сотрудник (по userId или имени) — только имя, должность, бригада и объекты; телефон и зарплата не выдаются.',
  },
  parameters: {
    type: 'object',
    properties: {
      userId: { type: 'string', format: 'objectId', description: 'Xodim ID (ixtiyoriy)' },
      name: { type: 'string', maxLength: 60, description: "Xodim ismi yoki familiyasi (ixtiyoriy)" },
    },
  },
  refs: { userId: 'User' },
  kind: 'read',
  confirm: 'never',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  handler: async (ctx, args) => {
    // ── O'zim ──
    if ((!args.userId && !args.name) || args.userId === ctx.userId) {
      const me: any = await User.findOne(cf(ctx, { _id: ctx.userId }))
        .select('firstName lastName middleName role position brigade projectIds phone baseSalary language telegramChatId isOwner').lean();
      if (!me) return notFound(ctx);
      return ok(L(ctx, 'Sizning profilingiz.', 'Ваш профиль.'), {
        id: String(me._id), self: true,
        name: fullName(me), role: me.role, isOwner: !!me.isOwner, position: me.position || undefined, brigade: me.brigade || undefined,
        phone: me.phone, baseSalary: me.baseSalary ?? undefined, language: me.language || undefined,
        telegramLinked: !!me.telegramChatId,
        objects: await objectsOf(ctx, me.projectIds),
      });
    }

    // ── Boshqa xodim(lar) ──
    let users: any[];
    if (args.userId) {
      const u = await User.findOne(cf(ctx, { _id: args.userId, role: { $ne: 'dasturchi' } })).select(PUBLIC_FIELDS).lean();
      users = u ? [u] : [];
    } else {
      const re = nameRegex(args.name!);
      users = await User.find(cf(ctx, { role: { $ne: 'dasturchi' }, $or: [{ firstName: re }, { lastName: re }] }))
        .select(PUBLIC_FIELDS).limit(10).lean();
    }
    if (!users.length) return notFound(ctx);
    const profiles = await Promise.all(users.map(async (u) => ({
      id: String(u._id), self: String(u._id) === ctx.userId,
      name: fullName(u), role: u.role, position: u.position || undefined, brigade: u.brigade || undefined,
      objects: await objectsOf(ctx, u.projectIds),
    })));
    return ok(
      profiles.length === 1 ? L(ctx, 'Xodim topildi.', 'Сотрудник найден.') : L(ctx, `${profiles.length} ta xodim topildi.`, `Найдено сотрудников: ${profiles.length}.`),
      { profiles, note: L(ctx, "Boshqa xodimlarning telefoni va maoshi berilmaydi.", 'Телефон и зарплата других сотрудников не выдаются.') },
    );
  },
};
