import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import Attendance from '../../models/Attendance';
import User from '../../models/User';
import type { AiSettingsData, AiShift } from '../contracts';
import type { JobQueue } from '../queue/jobQueue';
import { getSettings, isAiActive } from '../settings';
import { newButtonToken, newCorrelationId } from '../lib/ids';
import { parseHHmm, resolveWorkday, zonedParts, zonedToUtc } from '../lib/zonedTime';
import { effectiveOrder, isCallChannel } from './attendanceFlow';
import { enqueueJob, JOBS, keys } from './jobTypes';

// Planner (design §5, review C2/C5/C7 + owner decision 2026-10-13). LEVEL-TRIGGERED: har daqiqalik tick
// "hozir rejalashtirish kerakmi" deb qaraydi (o'tkazib yuborilgan tick yoki qayta ishga tushish zarar qilmaydi);
// reja tasdiqning unique indeksi {companyId, employeeId, date, shiftId} bilan idempotent.
// Ish kuni — EGASI jadvali: skipDates (yo'q) > extraWorkDates (ha) > ISO hafta kunlari.
// callTime + maxLateMin'dan kech — faqat bot xabari (qo'ng'iroqsiz); absentCutoff'dan keyin HECH QACHON.

export type PlanDecision =
  | { plan: true; date: string; mode: 'full' | 'bot_only'; scheduledAt: Date }
  | { plan: false; date: string; reason: 'not_workday' | 'before_call' | 'after_cutoff' };

/** Sof qaror (planner.int.test fake soat bilan tekshiradi). manual — "hozir ishga tushir" (P8 run-now). */
export function planDecision(shift: AiShift, now: Date, opts: { manual?: boolean } = {}): PlanDecision {
  const p = zonedParts(now);
  const date = p.date;
  if (!opts.manual && !resolveWorkday(date, shift).work) return { plan: false, date, reason: 'not_workday' };
  const callMin = parseHHmm(shift.callTime);
  const cutoffMin = parseHHmm(shift.absentCutoff);
  if (p.minutesOfDay >= cutoffMin) return { plan: false, date, reason: 'after_cutoff' };
  if (opts.manual) return { plan: true, date, mode: 'full', scheduledAt: now };
  if (p.minutesOfDay < callMin) return { plan: false, date, reason: 'before_call' };
  const mode = p.minutesOfDay > callMin + Math.max(0, shift.maxLateMin) ? 'bot_only' : 'full';
  const callAt = zonedToUtc(date, shift.callTime);
  return { plan: true, date, mode, scheduledAt: callAt.getTime() > now.getTime() ? callAt : now };
}

/** attendance.tick: har yoqilgan firma va smena uchun reja/yakunlash ishlarini (dedupe bilan) qo'yadi. */
export async function plannerTick(q: JobQueue | null, now: Date): Promise<{ planned: number; finalize: number }> {
  const rows: any[] = await AiAssistantSettings.find({ enabled: true, 'attendance.enabled': true }).select('companyId').limit(5000).lean();
  let planned = 0, finalize = 0;
  for (const r of rows) {
    const companyId = String(r.companyId);
    try {
      if (!(await isAiActive(companyId))) continue;
      const s = await getSettings(companyId);
      if (!s.attendance.enabled) continue;
      for (const shift of s.attendance.shifts) {
        const d = planDecision(shift, now);
        if (d.plan) {
          const res = await enqueueJob(q, {
            type: JOBS.plan, companyId, dedupeKey: keys.plan(companyId, d.date, shift.id),
            payload: { shiftId: shift.id, date: d.date }, runAt: now,
          });
          if (res && !res.duplicate) planned++;
        } else if (d.reason === 'after_cutoff' && resolveWorkday(d.date, shift).work) {
          // Level-triggered yakunlash: reja ishi yo'qolgan/kech bo'lsa ham kun yopiladi (dedupe — bir marta)
          const res = await enqueueJob(q, {
            type: JOBS.finalize, companyId, dedupeKey: keys.finalize(companyId, d.date, shift.id),
            payload: { shiftId: shift.id, date: d.date }, runAt: now,
          });
          if (res && !res.duplicate) finalize++;
        }
      }
    } catch (e) {
      console.error(`[aiVoice/planner] ${companyId} tick xatosi:`, (e as Error).message);
    }
  }
  return { planned, finalize };
}

/** Smenaga mos xodimlar: rol, obyekt (bo'sh = hammasi), bloklanmagan, opt-out(all) emas, bugun hali kelmagan. */
async function eligibleEmployees(companyId: string, shift: AiShift, date: string): Promise<string[]> {
  const users: any[] = await User.find({ companyId, isBlocked: { $ne: true }, role: { $in: shift.roles.filter((r) => r !== ('dasturchi' as any)) } })
    .select('_id projectIds').limit(5000).lean();
  const objs = new Set(shift.objectIds || []);
  let ids = users
    .filter((u) => !objs.size || (u.projectIds || []).some((p: string) => objs.has(String(p))))
    .map((u) => String(u._id));
  if (!ids.length) return ids;
  const out: any[] = await AiEmployeeContact.find({ companyId, employeeId: { $in: ids }, 'optOut.all': true }).select('employeeId').lean();
  const optedOut = new Set(out.map((c) => String(c.employeeId)));
  const inAtt: any[] = await Attendance.find({ userId: { $in: ids }, date, checkIn: { $exists: true, $nin: [null, ''] } }).select('userId').lean();
  const checkedIn = new Set(inAtt.map((a) => String(a.userId)));
  ids = ids.filter((id) => !optedOut.has(id) && !checkedIn.has(id));
  return ids;
}

async function upsertConfirmation(doc: Record<string, unknown>, key: Record<string, unknown>): Promise<{ conf: any; created: boolean }> {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await AiAttendanceConfirmation.updateOne(key, { $setOnInsert: { ...key, ...doc } }, { upsert: true });
      const conf = await AiAttendanceConfirmation.findOne(key).lean();
      return { conf, created: !!r.upsertedCount };
    } catch (e: any) {
      if (e?.code !== 11000 || i === 1) throw e;            // parallel upsert poygasi — bir marta qayta (C5)
    }
  }
  throw new Error('unreachable');
}

export interface PlanResult { created: number; existing: number; mode?: 'full' | 'bot_only'; skipped?: string }

/** attendance.plan: smena uchun bugungi tasdiqlar va birinchi qadamlar. Qayta ishlatish xavfsiz. */
export async function planShift(q: JobQueue | null, p: { companyId: string; shiftId: string; manual?: boolean }, now: Date): Promise<PlanResult> {
  if (!(await isAiActive(p.companyId))) return { created: 0, existing: 0, skipped: 'ai_inactive' };
  const s: AiSettingsData = await getSettings(p.companyId);
  if (!s.attendance.enabled) return { created: 0, existing: 0, skipped: 'attendance_disabled' };
  const shift = s.attendance.shifts.find((x) => x.id === p.shiftId);
  if (!shift) return { created: 0, existing: 0, skipped: 'no_shift' };
  const d = planDecision(shift, now, { manual: p.manual });
  if (!d.plan) return { created: 0, existing: 0, skipped: d.reason };

  const ids = await eligibleEmployees(p.companyId, shift, d.date);
  // Birinchi qadamlarni yoyish: birinchi kanal qo'ng'iroq bo'lsa minGapSec × (i / companyConcurrency), aks holda 1 s (bot limiti)
  const first = effectiveOrder({ fallbackOrder: s.fallbackOrder, planMode: d.mode })[0];
  const gapMs = (i: number) => (first && isCallChannel(first)
    ? Math.floor(i / Math.max(1, s.calls.companyConcurrency)) * s.calls.minGapSec * 1000
    : i * 1000);

  let created = 0, existing = 0;
  for (let i = 0; i < ids.length; i++) {
    const key = { companyId: p.companyId, employeeId: ids[i], date: d.date, shiftId: shift.id };
    const { conf, created: isNew } = await upsertConfirmation({
      objectIds: shift.objectIds || [], scheduledAt: d.scheduledAt, planMode: d.mode, status: 'pending',
      buttonToken: newButtonToken(), correlationId: newCorrelationId(), stepIndex: 0, attempts: [],
    }, key);
    if (isNew) created++; else existing++;
    // Yangi yoki hali boshlanmagan (qulashdan keyin) tasdiq — 0-qadam (dedupe takrorni oldini oladi)
    if (conf && conf.status === 'pending' && conf.stepIndex === 0 && !(conf.attempts || []).length) {
      await enqueueJob(q, {
        type: JOBS.step, refId: String(conf._id), companyId: p.companyId, employeeId: ids[i],
        runAt: new Date(d.scheduledAt.getTime() + gapMs(i)), dedupeKey: keys.step(String(conf._id), 0),
        payload: { stepIndex: 0 }, correlationId: conf.correlationId,
      });
    }
  }
  await enqueueJob(q, {
    type: JOBS.finalize, companyId: p.companyId, dedupeKey: keys.finalize(p.companyId, d.date, shift.id),
    payload: { shiftId: shift.id, date: d.date }, runAt: zonedToUtc(d.date, shift.absentCutoff),
  });
  return { created, existing, mode: d.mode };
}
