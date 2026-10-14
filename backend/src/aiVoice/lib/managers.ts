import User from '../../models/User';
import ObjectModel from '../../models/Object';
import { isObjectIdString } from './ids';

// Xodimning rahbar(lar)ini aniqlash — notifyManager tool'i (P2) va managerChannel (P3) uchun
// YAGONA joy (review D3). QAT'IY: faqat SHU firma ichida (notifyAdmins emas — u avval barcha
// firmalarning direktorlariga yuborardi). Bloklangan foydalanuvchilar va xodimning o'zi chiqariladi.
//  1) xodim biriktirilgan obyektlarning prorabi (Object.foremanId);
//  2) bo'lmasa — firma direktori/o'rinbosari/egasi.

export interface ManagerRef {
  userId: string;
  name: string;
  role: string;
  telegramChatId?: string;
  via: 'foreman' | 'boss';
}

export async function resolveManagers(companyId: string, employeeId: string): Promise<ManagerRef[]> {
  if (!companyId || !employeeId) return [];
  const emp: any = isObjectIdString(employeeId)
    ? await User.findOne({ _id: employeeId, companyId }).select('projectIds companyId').lean()
    : null;
  if (!emp) return [];

  const toRef = (u: any, via: ManagerRef['via']): ManagerRef => ({
    userId: String(u._id),
    name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim(),
    role: u.role,
    telegramChatId: u.telegramChatId || undefined,
    via,
  });

  const projectIds = (emp.projectIds || []).filter(isObjectIdString);
  if (projectIds.length) {
    const objs: any[] = await ObjectModel.find({ _id: { $in: projectIds }, companyId }).select('foremanId').lean();
    const foremanIds = [...new Set(objs.map((o) => o.foremanId).filter(isObjectIdString))].filter((id) => id !== String(employeeId));
    if (foremanIds.length) {
      const foremen: any[] = await User.find({ _id: { $in: foremanIds }, companyId, isBlocked: { $ne: true } })
        .select('firstName lastName role telegramChatId').lean();
      if (foremen.length) return foremen.map((u) => toRef(u, 'foreman'));
    }
  }

  const bosses: any[] = await User.find({
    companyId,
    _id: { $ne: employeeId },
    isBlocked: { $ne: true },
    $or: [{ role: { $in: ['direktor', 'orinbosar'] } }, { isOwner: true }],
  }).select('firstName lastName role telegramChatId isOwner').lean();
  // Barqaror tartib: egasi/direktor birinchi
  bosses.sort((a, b) => rank(a) - rank(b));
  return bosses.map((u) => toRef(u, 'boss'));
}

const rank = (u: any) => (u.isOwner ? 0 : u.role === 'direktor' ? 1 : 2);

/**
 * Rahbarlarga ilova ichidagi bildirishnoma ('ai' turi). createNotification push'ni o'zi yuboradi —
 * alohida sendPushToUser chaqirilmaydi (review A15: ikki marta push bo'lardi). Bot xabari — P3/P4 kanalida.
 * notifications.ts kechiktirib yuklanadi (socket.ts'ni modul darajasida tortmaslik uchun).
 */
export async function notifyManagersInApp(
  companyId: string,
  employeeId: string,
  msg: { title: string; body: string; entity?: string; entityId?: string; url?: string },
): Promise<ManagerRef[]> {
  const managers = await resolveManagers(companyId, employeeId);
  if (!managers.length) return managers;
  const { createNotification } = await import('../../services/notifications');
  for (const m of managers) {
    await createNotification({
      recipientId: m.userId, companyId, type: 'ai',
      title: msg.title.slice(0, 120), body: msg.body.slice(0, 500),
      entity: msg.entity, entityId: msg.entityId, url: msg.url,
    });
  }
  return managers;
}
