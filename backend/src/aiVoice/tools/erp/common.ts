import User from '../../../models/User';
import ObjectModel from '../../../models/Object';
import type { AiRole, Purpose, ToolChannel, ToolCtx, ToolResult } from '../types';
import { inCompany } from '../types';
import { isObjectIdString } from '../../lib/ids';
import { localDate } from '../../lib/zonedTime';
import { assignedObjectIdsFor } from '../../../middleware/objectScope';

// ERP tool'lari uchun umumiy yordamchilar. QOIDA: har bir so'rov inCompany(ctx) bilan AN'IQ
// firma filtriga ega (scoped()ga tayanilmaydi); ko'rinish doirasi (obyektlar) shu yerda hisoblanadi.

export const ALL_ROLES: AiRole[] = ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'];
export const BOSS_ROLES: AiRole[] = ['direktor', 'orinbosar'];
export const MANAGER_ROLES: AiRole[] = ['direktor', 'orinbosar', 'prorab', 'brigadir'];
/** Barcha kanallar: veb, bot, ilova ichidagi qo'ng'iroq, Telegram qo'ng'irog'i (yozuv tasdig'i bot tugmasi orqali). */
export const ALL_CHANNELS: ToolChannel[] = ['web', 'bot', 'inapp_call', 'telegram_call'];
export const ASSIST: Purpose[] = ['assistant'];
/**
 * Natijadagi erkin matn kalitlari — executor ularni {"untrusted_text"} ga o'raydi (B4).
 * 'note' bu yerda YO'Q: tool'lar uni o'zi yozadi (ishonchli izoh); foydalanuvchi matni hech qachon 'note'da qaytmaydi.
 */
export const FREE_TEXT_KEYS = [
  'name', 'objectName', 'location', 'text', 'description', 'position', 'brigade',
  'materialName', 'unit', 'title', 'foremanName', 'targetName', 'ownerName', 'recipientName', 'objectLabel',
];

export type Lang = 'uz' | 'ru';
export const lang = (ctx: Pick<ToolCtx, 'lang'>): Lang => (ctx.lang === 'ru' ? 'ru' : 'uz');
export const L = (ctx: Pick<ToolCtx, 'lang'>, uz: string, ru: string) => (lang(ctx) === 'ru' ? ru : uz);

export const isBoss = (ctx: Pick<ToolCtx, 'role' | 'isOwner'>) => !!ctx.isOwner || BOSS_ROLES.includes(ctx.role);

export const ok = (message: string, data?: unknown): ToolResult => ({ status: 'ok', message, retryable: false, ...(data !== undefined ? { data } : {}) });
export const notFound = (ctx: Pick<ToolCtx, 'lang'>, msg?: string): ToolResult =>
  ({ status: 'not_found', message: msg || L(ctx, 'Topilmadi.', 'Не найдено.'), retryable: false });
export const denied = (ctx: Pick<ToolCtx, 'lang'>, msg?: string): ToolResult =>
  ({ status: 'denied', message: msg || L(ctx, "Bu ma'lumotni ko'rishga ruxsat yo'q.", 'Нет доступа к этим данным.'), retryable: false });
export const badArgs = (ctx: Pick<ToolCtx, 'lang'>, uz: string, ru: string): ToolResult =>
  ({ status: 'error', message: L(ctx, uz, ru), retryable: false });

export const fullName = (u: any): string => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();

/** Regex maxsus belgilarini qochiradi (foydalanuvchi/model matnidan qidiruv). */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function nameRegex(q: string): RegExp {
  return new RegExp(escapeRegex(q.trim().slice(0, 60)), 'i');
}

export const today = (at: Date = new Date()) => localDate(at);

export async function loadMe(ctx: ToolCtx): Promise<any | null> {
  return User.findOne(inCompany(ctx, { _id: ctx.userId })).select('firstName lastName role projectIds isOwner').lean();
}

/**
 * Foydalanuvchi ko'ra oladigan obyektlar. null — cheklovsiz (rahbar: butun firma).
 * Prorab/brigadir: o'zi prorab bo'lgan (foremanId) yoki biriktirilgan (projectIds) obyektlar; ishchi: projectIds.
 */
export async function visibleObjectIds(ctx: ToolCtx): Promise<string[] | null> {
  if (isBoss(ctx)) return null;
  // Yagona manba (owner 2026-10-23): sayt, bot va AI bir xil obyekt doirasini ishlatadi (middleware/objectScope.ts)
  const me: any = await loadMe(ctx);
  if (!me) return [];
  const ids = await assignedObjectIdsFor({ _id: ctx.userId, role: ctx.role, isOwner: false, companyId: ctx.companyId, projectIds: me.projectIds });
  return ids || [];
}

export function canSeeObject(visible: string[] | null, objectId: string): boolean {
  return visible === null || visible.includes(String(objectId));
}

/** Pul summasi — UZS (valyutali yozuvda uzsAmount, aks holda amount). */
export const UZS_AMOUNT = { $ifNull: ['$uzsAmount', { $ifNull: ['$amount', 0] }] };

export const OBJECT_STATUS: Record<string, { uz: string; ru: string }> = {
  active: { uz: 'faol', ru: 'активный' },
  paused: { uz: "to'xtatilgan", ru: 'приостановлен' },
  completed: { uz: 'tugagan', ru: 'завершён' },
};

/**
 * inCompany() + mongoose filtr turlari bilan moslik (strict filter tiplari enum maydonlarda
 * oddiy satrni qabul qilmaydi). Mantiq o'zgarmaydi: companyId har doim ctx'dan.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cf = (ctx: Pick<ToolCtx, 'companyId'>, filter: Record<string, unknown> = {}): any => inCompany(ctx, filter);

/**
 * System prompt uchun "mening obyektlarim" (rolga moslash): rahbar — firmaning faol obyektlari,
 * boshqalar — ko'ra oladigan obyektlari. Faqat nomlar (≤5) va jami soni; nomlar prompt'da sanitize qilinadi.
 */
export async function promptObjects(ctx: ToolCtx, limit = 5): Promise<{ names: string[]; total: number }> {
  const visible = await visibleObjectIds(ctx);
  if (visible !== null && !visible.length) return { names: [], total: 0 };
  const filter = visible === null ? { status: 'active' } : { _id: { $in: visible } };
  const [rows, total] = await Promise.all([
    ObjectModel.find(cf(ctx, filter)).select('name').sort({ updatedAt: -1 }).limit(limit).lean(),
    ObjectModel.countDocuments(cf(ctx, filter)),
  ]);
  return { names: (rows as any[]).map((o) => String(o.name || '')).filter(Boolean), total };
}
