import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import User from '../../models/User';
import type { ChannelCtx } from '../contracts';
import { getChannel } from '../channels/registry';
import type { JobQueue } from '../queue/jobQueue';
import { getSettings, isAiActive } from '../settings';
import { resolveManagers } from '../lib/managers';
import { onFinalize } from './attendanceFlow';
import { cancelSteps, enqueueJob, JOBS, keys } from './jobTypes';
import { reconcileCheckIns } from './reconciler';
import { pickLang, tx } from './texts';

// absentCutoff'da yakunlash (design §5): avval reconcile (oxirgi check-in'lar), keyin checked_in va
// declined'dan boshqa hammasi → 'absent' (Attendance YOZILMAYDI). Rahbarlarga yig'ma xabar — har rahbar
// uchun alohida ish (dedupe att:sum:…:<rahbar>), rahbarlar FAQAT shu firmadan (lib/managers).
// Keyinroq check-in bo'lsa reconciler baribir 'checked_in' qiladi (C6).

export async function finalizeShift(q: JobQueue | null, p: { companyId: string; shiftId: string; date: string }, now: Date): Promise<{ finalized: number; absent: number }> {
  if (!(await isAiActive(p.companyId))) return { finalized: 0, absent: 0 };
  await reconcileCheckIns(now, { companyId: p.companyId, date: p.date }, q);
  const confs: any[] = await AiAttendanceConfirmation.find({ companyId: p.companyId, date: p.date, shiftId: p.shiftId, finalizedAt: null })
    .select('_id status employeeId').lean();
  let finalized = 0;
  for (const c of confs) {
    const next = onFinalize(c);
    const r = await AiAttendanceConfirmation.updateOne(
      { _id: c._id, finalizedAt: null, status: c.status },               // reconciler bilan poyga — holat CAS
      { $set: { status: next, finalizedAt: now, nextActionAt: null } },
    );
    if (r.modifiedCount === 1) { finalized++; await cancelSteps(q, String(c._id)); }
  }

  // Yig'ma: kun yakunidagi holat bo'yicha (takroriy finalize ham bir xil ro'yxat beradi — dedupe kaliti bitta)
  const rows: any[] = await AiAttendanceConfirmation.find({ companyId: p.companyId, date: p.date, shiftId: p.shiftId, status: { $in: ['absent', 'declined'] } })
    .select('employeeId status').lean();
  const byManager = new Map<string, { absent: string[]; declined: string[] }>();
  for (const r of rows) {
    const managers = await resolveManagers(p.companyId, String(r.employeeId));
    for (const m of managers) {
      const e = byManager.get(m.userId) || { absent: [], declined: [] };
      (r.status === 'absent' ? e.absent : e.declined).push(String(r.employeeId));
      byManager.set(m.userId, e);
    }
  }
  for (const [managerId, list] of byManager) {
    await enqueueJob(q, {
      type: JOBS.summary, companyId: p.companyId, employeeId: managerId, runAt: now,
      dedupeKey: keys.summary(p.companyId, p.date, p.shiftId, managerId),
      payload: { managerId, date: p.date, absent: list.absent, declined: list.declined },
    });
  }
  return { finalized, absent: rows.filter((r) => r.status === 'absent').length };
}

/** attendance.summary: bitta rahbarga yig'ma xabar (bot + ilova/push) — rahbar shu firmada bo'lishi SHART. */
export async function sendManagerSummary(p: { companyId: string; managerId: string; date: string; absent: string[]; declined: string[] }, now: Date): Promise<boolean> {
  const mgr: any = await User.findOne({ _id: p.managerId, companyId: p.companyId, isBlocked: { $ne: true } }).select('language').lean().catch(() => null);
  if (!mgr) return false;
  const ids = [...new Set([...(p.absent || []), ...(p.declined || [])])];
  // Ro'yxatdagi xodimlar ham shu firmadan bo'lishi shart (boshqa firma ismi hech qachon chiqmaydi)
  const users: any[] = await User.find({ _id: { $in: ids }, companyId: p.companyId }).select('firstName lastName').lean();
  const nameOf = new Map(users.map((u) => [String(u._id), [u.firstName, u.lastName].filter(Boolean).join(' ').trim()]));
  const names = (list: string[]) => list.map((id) => nameOf.get(id)).filter(Boolean).join(', ');
  const settings = await getSettings(p.companyId);
  const lang = pickLang(mgr.language, settings.language);
  const t = tx(lang);
  const lines = [names(p.absent) && t.sumAbsent(names(p.absent)), names(p.declined) && t.sumDeclined(names(p.declined))].filter(Boolean);
  if (!lines.length) return false;
  const req = { kind: 'manager_alert' as const, title: t.sumTitle(p.date), text: `${t.sumTitle(p.date)}\n${lines.join('\n')}` };
  const ctx: ChannelCtx = { companyId: p.companyId, employeeId: p.managerId, correlationId: `att-sum:${p.date}`, purpose: 'attendance', lang, now, attemptNo: 1 };
  let delivered = false;
  for (const name of ['push', 'bot_message'] as const) {
    const ch = getChannel(name);
    if (!ch) continue;
    try {
      if (!(await ch.isAvailable(ctx)).ok) continue;
      const r = await ch.attempt(ctx, req);
      delivered = delivered || r.outcome === 'delivered';
    } catch (e) {
      console.error('[aiVoice/finalize] yig\'ma xabar xatosi:', (e as Error).message);
    }
  }
  return delivered;
}
