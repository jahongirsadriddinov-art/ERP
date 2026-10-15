import AiAssistantSettings from '../../models/AiAssistantSettings';
import AiAttendanceConfirmation from '../../models/AiAttendanceConfirmation';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import Attendance from '../../models/Attendance';
import User from '../../models/User';
import type { AiSettingsData, AiShift } from '../contracts';
import type { JobQueue } from '../queue/jobQueue';
import {
  effectiveShift, getSettings, isAiActive, loadEmployeeOverrides, type EmployeeScheduleOverride,
} from '../settings';
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

/**
 * Smena + shaxsiy jadvallardan kelib chiqadigan "variantlar" (#5): har xil so'rov vaqti / ish kunlari.
 * Shaxsiy jadval bo'lmasa — faqat smenaning o'zi (eski xatti-harakat o'zgarmaydi).
 */
export function shiftVariants(shift: AiShift, overrides: Iterable<EmployeeScheduleOverride>): AiShift[] {
  const out = new Map<string, AiShift>();
  const add = (v: AiShift) => {
    const k = `${v.callTime}|${v.absentCutoff}|${v.workdays.join(',')}`;
    if (!out.has(k)) out.set(k, v);
  };
  add(shift);
  for (const ov of overrides) add(effectiveShift(shift, ov));
  return [...out.values()];
}

/** Variant uchun reja/yakunlash kaliti: smena vaqtiga teng bo'lsa — eski kalit (orqaga moslik). */
const planKey = (c: string, d: string, shift: AiShift, v: AiShift) =>
  (v.callTime === shift.callTime ? keys.plan(c, d, shift.id) : keys.planAt(c, d, shift.id, v.callTime));
const finKey = (c: string, d: string, shift: AiShift, cutoff: string) =>
  (cutoff === shift.absentCutoff ? keys.finalize(c, d, shift.id) : keys.finalizeAt(c, d, shift.id, cutoff));

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
      const overrides = [...(await loadEmployeeOverrides(companyId)).values()];
      for (const shift of s.attendance.shifts) {
        const seen = new Set<string>();
        for (const v of shiftVariants(shift, overrides)) {
          const d = planDecision(v, now);
          if (d.plan) {
            const key = planKey(companyId, d.date, shift, v);
            if (seen.has(key)) continue;
            seen.add(key);
            const res = await enqueueJob(q, {
              type: JOBS.plan, companyId, dedupeKey: key, payload: { shiftId: shift.id, date: d.date }, runAt: now,
            });
            if (res && !res.duplicate) planned++;
          } else if (d.reason === 'after_cutoff' && resolveWorkday(d.date, v).work) {
            // Level-triggered yakunlash: reja ishi yo'qolgan/kech bo'lsa ham kun yopiladi (dedupe — bir marta)
            const key = finKey(companyId, d.date, shift, v.absentCutoff);
            if (seen.has(key)) continue;
            seen.add(key);
            const res = await enqueueJob(q, {
              type: JOBS.finalize, companyId, dedupeKey: key,
              payload: { shiftId: shift.id, date: d.date, cutoff: v.absentCutoff }, runAt: now,
            });
            if (res && !res.duplicate) finalize++;
          }
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

/**
 * attendance.plan: smena uchun bugungi tasdiqlar va birinchi qadamlar. Qayta ishlatish xavfsiz.
 * Har xodim uchun qaror O'Z amaldagi jadvali bo'yicha (#5): shaxsiy jadvalli xodim o'z ish kunida, o'z
 * vaqtida rejalashtiriladi; vaqti hali kelmaganlar keyingi (o'z vaqtidagi) reja ishida olinadi.
 */
export async function planShift(q: JobQueue | null, p: { companyId: string; shiftId: string; manual?: boolean }, now: Date): Promise<PlanResult> {
  if (!(await isAiActive(p.companyId))) return { created: 0, existing: 0, skipped: 'ai_inactive' };
  const s: AiSettingsData = await getSettings(p.companyId);
  if (!s.attendance.enabled) return { created: 0, existing: 0, skipped: 'attendance_disabled' };
  const shift = s.attendance.shifts.find((x) => x.id === p.shiftId);
  if (!shift) return { created: 0, existing: 0, skipped: 'no_shift' };
  const base = planDecision(shift, now, { manual: p.manual });
  // Shaxsiy jadval yo'q va smena bo'yicha vaqt emas — xodimlarni so'ramaymiz (arzon yo'l)
  const anyOverride = !!(await AiEmployeeContact.exists({ companyId: p.companyId, 'scheduleOverride.weekdays.0': { $exists: true } }));
  if (!base.plan && !anyOverride) return { created: 0, existing: 0, skipped: base.reason };

  const all = await eligibleEmployees(p.companyId, shift, base.date);
  const overrides = anyOverride ? await loadEmployeeOverrides(p.companyId, all) : new Map<string, EmployeeScheduleOverride>();
  const todo: { id: string; eff: AiShift; d: Extract<PlanDecision, { plan: true }> }[] = [];
  for (const id of all) {
    const eff = effectiveShift(shift, overrides.get(id));
    const d = eff === shift ? base : planDecision(eff, now, { manual: p.manual });
    if (d.plan) todo.push({ id, eff, d });
  }
  if (!todo.length && !base.plan) return { created: 0, existing: 0, skipped: base.reason };

  // Birinchi qadamlarni yoyish: birinchi kanal qo'ng'iroq bo'lsa minGapSec × (i / companyConcurrency), aks holda 1 s (bot limiti)
  const gapMs = (i: number, mode: 'full' | 'bot_only') => {
    const first = effectiveOrder({ fallbackOrder: s.fallbackOrder, planMode: mode })[0];
    return first && isCallChannel(first)
      ? Math.floor(i / Math.max(1, s.calls.companyConcurrency)) * s.calls.minGapSec * 1000
      : i * 1000;
  };

  let created = 0, existing = 0;
  const cutoffs = new Set<string>();
  if (base.plan) cutoffs.add(shift.absentCutoff);
  for (let i = 0; i < todo.length; i++) {
    const { id, eff, d } = todo[i];
    const key = { companyId: p.companyId, employeeId: id, date: d.date, shiftId: shift.id };
    const { conf, created: isNew } = await upsertConfirmation({
      objectIds: shift.objectIds || [], scheduledAt: d.scheduledAt, planMode: d.mode, status: 'pending',
      workStart: eff.workStart, absentCutoff: eff.absentCutoff,
      buttonToken: newButtonToken(), correlationId: newCorrelationId(), stepIndex: 0, attempts: [],
    }, key);
    if (isNew) created++; else existing++;
    cutoffs.add(conf?.absentCutoff || shift.absentCutoff);
    // Yangi yoki hali boshlanmagan (qulashdan keyin) tasdiq — 0-qadam (dedupe takrorni oldini oladi)
    if (conf && conf.status === 'pending' && conf.stepIndex === 0 && !(conf.attempts || []).length) {
      await enqueueJob(q, {
        type: JOBS.step, refId: String(conf._id), companyId: p.companyId, employeeId: id,
        runAt: new Date(d.scheduledAt.getTime() + gapMs(i, d.mode)), dedupeKey: keys.step(String(conf._id), 0),
        payload: { stepIndex: 0 }, correlationId: conf.correlationId,
      });
    }
  }
  // Har bir yakunlash vaqti uchun bitta ish (shaxsiy jadvalli xodimlar o'z vaqtida yakunlanadi)
  for (const cutoff of cutoffs) {
    await enqueueJob(q, {
      type: JOBS.finalize, companyId: p.companyId, dedupeKey: finKey(p.companyId, base.date, shift, cutoff),
      payload: { shiftId: shift.id, date: base.date, cutoff }, runAt: zonedToUtc(base.date, cutoff),
    });
  }
  const mode = base.plan ? base.mode : todo[0]?.d.mode;
  return { created, existing, ...(mode ? { mode } : {}) };
}
