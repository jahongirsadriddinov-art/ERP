// Xodimni qo'shish/tahrirlash/o'chirish uchun YAGONA himoya qoidalari — routes/auth.ts
// (PUT/DELETE /api/auth/users/:id), routes/users.ts (DELETE) va routes/ai.ts (/execute)
// bir xil qoidaga tayanadi. Avval har yo'l o'zicha (va har xil) tekshirardi: o'rinbosar
// direktorni o'chira/pasaytira olar, firma egasining telefonini almashtirib (OTP orqali)
// hisobini egallab olishi mumkin edi.
import User from '../models/User';
import { logAudit } from '../services/audit';
import type { AuditAction } from '../models/AuditLog';
import type { Request } from 'express';

export interface GuardCaller {
  userId: string;
  role: string;
  companyId?: string;
  isOwner?: boolean;
  isDeveloper?: boolean;
}

export interface GuardTarget {
  _id: any;
  role: string;
  companyId?: string | null;
  isOwner?: boolean;
}

export interface GuardError { status: number; error: string }

export const ALL_ROLES = ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi', 'dasturchi'];
// direktor va dasturchi lavozimini FAQAT dasturchi (super-admin) belgilaydi
const FIRM_ASSIGNABLE = ['orinbosar', 'prorab', 'brigadir', 'ishchi'];

const isDev = (c: GuardCaller) => !!(c.isDeveloper || c.role === 'dasturchi');
const isTopBoss = (c: GuardCaller) => !!(c.isOwner || c.role === 'direktor');

/** Chaqiruvchi belgilay oladigan lavozimlar ro'yxati */
export function assignableRoles(caller: GuardCaller): string[] {
  if (isDev(caller)) return [...ALL_ROLES];
  if (isTopBoss(caller) || caller.role === 'orinbosar') return [...FIRM_ASSIGNABLE];
  return [];
}

/** Yangi lavozimni tekshiradi. currentRole bilan bir xil bo'lsa — o'zgarish yo'q, o'tkaziladi. */
export function checkRoleAssign(caller: GuardCaller, role: unknown, currentRole?: string): GuardError | null {
  if (role === undefined || role === null || role === '') return null;
  if (currentRole !== undefined && role === currentRole) return null;
  if (typeof role !== 'string' || !ALL_ROLES.includes(role)) return { status: 400, error: "Noma'lum lavozim" };
  if (!assignableRoles(caller).includes(role)) {
    return { status: 403, error: "Bu lavozimni faqat dasturchi paneli orqali belgilash mumkin" };
  }
  return null;
}

/**
 * Chaqiruvchi shu xodimni tahrirlashi/o'chirishi mumkinmi.
 * - o'zini o'chirish va o'z lavozimini o'zgartirish — yo'q;
 * - firma egasi (isOwner) — faqat o'zi (yoki dasturchi);
 * - direktorni — faqat ega yoki direktor (o'rinbosar emas);
 * - dasturchi hisobini — faqat dasturchi;
 * - boshqa firma xodimi — yo'q (404, mavjudligini ham oshkor qilmaymiz).
 */
export function checkTargetAccess(caller: GuardCaller, target: GuardTarget, op: 'update' | 'delete', opts: { roleChange?: boolean } = {}): GuardError | null {
  const self = String(target._id) === String(caller.userId);
  if (self && op === 'delete') return { status: 400, error: "O'z hisobingizni o'chira olmaysiz" };
  if (self && opts.roleChange) return { status: 400, error: "O'z lavozimingizni o'zgartira olmaysiz" };
  if (isDev(caller)) return null;
  if (String(target.companyId || '') !== String(caller.companyId || '')) return { status: 404, error: 'Foydalanuvchi topilmadi' };
  if (self) return null;
  if (target.role === 'dasturchi') return { status: 403, error: "Bu foydalanuvchini o'zgartira olmaysiz" };
  if (target.isOwner) return { status: 403, error: "Firma egasini o'zgartirib yoki o'chirib bo'lmaydi" };
  if (target.role === 'direktor' && !isTopBoss(caller)) return { status: 403, error: "Direktorni faqat firma egasi o'zgartira oladi" };
  return null;
}

/** Telefonni bir xil ko'rinishga keltiradi (bo'sh joylarsiz, + bilan) */
export function formatPhone(raw: unknown): string {
  let p = String(raw ?? '').replace(/\s+/g, '');
  if (p && !p.startsWith('+')) p = '+' + p;
  return p;
}

/** Raqam boshqa (exceptId'dan tashqari) foydalanuvchida bandmi — global unique indeks bilan mos */
export async function phoneTaken(phone: string, exceptId?: string): Promise<boolean> {
  const q: any = { phone };
  if (exceptId) q._id = { $ne: exceptId };
  return !!(await User.exists(q));
}

/** Xodim ustidagi amalni audit jurnaliga yozish (xatoda jim — asosiy amalni buzmaydi) */
export async function auditUserAction(caller: GuardCaller, req: Request | undefined, p: {
  action: AuditAction; entityId: string; description: string; oldValue?: any; newValue?: any;
}): Promise<void> {
  try {
    const actor = await User.findById(caller.userId).select('firstName lastName role').lean();
    await logAudit({
      userId: String(caller.userId),
      userName: actor ? `${actor.firstName} ${actor.lastName || ''}`.trim() : 'Noma\'lum',
      userRole: actor?.role || caller.role,
      entity: 'user',
      companyId: caller.companyId,
      req,
      ...p,
    });
  } catch { /* audit yozuvi asosiy amalni to'xtatmaydi */ }
}
