import Attendance from '../../models/Attendance';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import type { JobQueue } from '../queue/jobQueue';
import { localDate } from '../lib/zonedTime';
import { cancelSteps } from './jobTypes';

// Reconciler (design §5, review C6): haqiqiy check-in (Attendance.checkIn) — yagona haqiqat manbai.
// checked_in HAR QANDAY holatdan ustun, shu jumladan yakunlangan 'absent'dan ham (kun oxirigacha).
// AI hech qachon Attendance yozmaydi — faqat o'qiydi.

export interface ReconcileFilter { companyId?: string; date?: string; confirmationIds?: string[] }

function checkInDate(v: unknown, fallback: Date): Date {
  const d = v ? new Date(String(v)) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
}

/** Bitta tasdiqni check-in bo'yicha yangilaydi (qadam oldi tekshiruvi ham shuni ishlatadi). true — o'zgardi. */
export async function markCheckedIn(confId: string, att: { _id: unknown; checkIn?: unknown }, now: Date, q?: JobQueue | null): Promise<boolean> {
  const r = await AiAttendanceConfirmation.updateOne(
    { _id: confId, status: { $ne: 'checked_in' } },
    { $set: { status: 'checked_in', checkInAt: checkInDate(att.checkIn, now), attendanceId: String(att._id), nextActionAt: null } },
  );
  if (r.modifiedCount === 1) { await cancelSteps(q, confId); return true; }
  return false;
}

/** Bugungi (yoki berilgan sanadagi) tasdiqlar uchun check-in'larni topib checked_in qiladi. */
export async function reconcileCheckIns(now: Date, filter: ReconcileFilter = {}, q?: JobQueue | null): Promise<number> {
  const date = filter.date || localDate(now);
  const f: Record<string, unknown> = { date, status: { $ne: 'checked_in' } };
  if (filter.companyId) f.companyId = filter.companyId;
  if (filter.confirmationIds) f._id = { $in: filter.confirmationIds };
  const confs: any[] = await AiAttendanceConfirmation.find(f).select('_id employeeId companyId').limit(5000).lean();
  if (!confs.length) return 0;
  const userIds = [...new Set(confs.map((c) => String(c.employeeId)))];
  const atts: any[] = await Attendance.find({ userId: { $in: userIds }, date, checkIn: { $exists: true, $nin: [null, ''] } })
    .select('_id userId checkIn companyId').lean();
  const byUser = new Map(atts.map((a) => [String(a.userId), a]));
  let changed = 0;
  for (const c of confs) {
    const a = byUser.get(String(c.employeeId));
    if (!a) continue;
    // Attendance boshqa firmaga tegishli bo'lsa (companyId yozilgan) — hisobga olinmaydi
    if (a.companyId && String(a.companyId) !== String(c.companyId)) continue;
    if (await markCheckedIn(String(c._id), a, now, q)) changed++;
  }
  return changed;
}
