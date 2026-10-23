import ObjectModel from '../models/Object';
import User from '../models/User';
import { getTenant, type TenantContext } from './tenantContext';

/**
 * OBYEKT DOIRASI (owner 2026-10-23): direktor, o'rinbosar va firma egasidan BOSHQA har bir rol
 * (prorab, brigadir, ishchi, kelajakdagi istalgan rol — deny-list emas, allow-list) FAQAT o'ziga
 * biriktirilgan obyektlarni ko'radi va faqat shular ichida ishlaydi.
 *
 * Biriktirish = User.projectIds (xodim kartasida tanlangan obyektlar) + Object.foremanId (obyekt prorabi).
 * Server tomoni: ro'yxatlar shu ro'yxat bilan filtrlanadi, boshqa obyektga murojaat — 404/403.
 */

export const BOSS_ROLES = ['direktor', 'orinbosar'];

/** Rahbarmi (obyekt doirasi qo'llanmaydi)? Dasturchi ham cheklanmaydi (u firma ichiga umuman kirmaydi). */
export function isObjectBoss(t: Pick<TenantContext, 'role' | 'isOwner' | 'isDeveloper'> | undefined | null): boolean {
  if (!t) return true; // autentifikatsiyasiz eski yo'l — eski xatti-harakat
  return !!t.isDeveloper || !!t.isOwner || BOSS_ROLES.includes(String(t.role));
}

const isOid = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);

/**
 * Berilgan foydalanuvchiga biriktirilgan obyektlar (faqat o'z firmasi ichida). Rahbar uchun null (cheklovsiz).
 * Tenant kontekstidan tashqarida (bot, AI) ham ishlatiladi — shu sabab userId/companyId aniq beriladi.
 */
export async function assignedObjectIdsFor(user: { _id?: unknown; id?: unknown; role?: string; isOwner?: boolean; companyId?: string | null; projectIds?: unknown[] } | null | undefined): Promise<string[] | null> {
  if (!user) return [];
  if (user.isOwner || BOSS_ROLES.includes(String(user.role)) || user.role === 'dasturchi') return null;
  const uid = String(user._id ?? user.id ?? '');
  const own = ((user.projectIds || []) as unknown[]).map(String).filter(isOid);
  const or: Record<string, unknown>[] = [];
  if (uid) or.push({ foremanId: uid });
  if (own.length) or.push({ _id: { $in: own } });
  if (!or.length) return [];
  const filter: Record<string, unknown> = { $or: or, companyId: user.companyId ?? null };
  const objs: any[] = await ObjectModel.find(filter).select('_id').lean();
  return objs.map((o) => String(o._id));
}

type MemoCtx = TenantContext & { __objIds?: Promise<string[] | null> };

/** Joriy so'rov egasining obyektlari (null — cheklovsiz). So'rov davomida bir marta hisoblanadi. */
export function allowedObjectIds(): Promise<string[] | null> {
  const t = getTenant() as MemoCtx | undefined;
  if (isObjectBoss(t)) return Promise.resolve(null);
  if (!t!.__objIds) {
    t!.__objIds = (async () => {
      const me: any = await User.findById(t!.userId).select('role isOwner companyId projectIds').lean().catch(() => null);
      if (!me) return [];
      return assignedObjectIdsFor({ ...me, companyId: t!.companyId ?? me.companyId ?? null });
    })();
  }
  return t!.__objIds;
}

/** Joriy foydalanuvchi shu obyekt bilan ishlay oladimi? (rahbar — har doim). */
export async function canAccessObject(objectId: unknown): Promise<boolean> {
  const ids = await allowedObjectIds();
  if (ids === null) return true;
  return !!objectId && ids.includes(String(objectId));
}

/**
 * Ro'yxat filtri: rahbar — {} ; boshqalar — { [field]: { $in: ids } }.
 * includeUnassigned — obyektga bog'lanmagan yozuvlar ham (masalan o'zi kiritgan obyektsiz chiqim).
 */
export async function objectFilter(field = 'objectId', opts: { includeUnassigned?: boolean } = {}): Promise<Record<string, unknown>> {
  const ids = await allowedObjectIds();
  if (ids === null) return {};
  if (opts.includeUnassigned) return { $or: [{ [field]: { $in: ids } }, { [field]: null }, { [field]: '' }] };
  return { [field]: { $in: ids } };
}

/** Body'dagi ixtiyoriy obyekt ID'si: bo'sh bo'lsa ruxsat; berilgan bo'lsa — biriktirilganlardan biri bo'lishi shart. */
export async function optionalObjectAllowed(objectId: unknown): Promise<boolean> {
  if (objectId === undefined || objectId === null || objectId === '') return true;
  return canAccessObject(objectId);
}

/**
 * Bot va boshqa tenant kontekstisiz joylar uchun: foydalanuvchi ko'ra oladigan obyektlar so'rovi (firma + doira).
 * extra._id berilsa — faqat u biriktirilgan bo'lsa topiladi.
 */
export async function objectQueryForUser(user: any, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = user?.companyId ? { companyId: user.companyId } : { _id: null };
  if (!user?.companyId) return { ...extra, ...base };
  const ids = await assignedObjectIdsFor(user).catch(() => [] as string[]);
  if (ids === null) return { ...base, ...extra };
  const pick = extra._id !== undefined ? (ids.includes(String(extra._id)) ? String(extra._id) : null) : { $in: ids };
  return { ...base, ...extra, _id: pick };
}

export const OBJECT_FORBIDDEN = { error: "Bu obyekt sizga biriktirilmagan" };
