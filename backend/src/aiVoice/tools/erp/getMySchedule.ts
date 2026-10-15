import ObjectModel from '../../../models/Object';
import Attendance from '../../../models/Attendance';
import AiReminder from '../../../models/AiReminder';
import AiAttendanceConfirmation from '../../../models/AiAttendanceConfirmation';
import type { AiShift } from '../../contracts';
import { type AiToolDef } from '../types';
import { effectiveShift, getEmployeeOverride, getSettings } from '../../settings';
import { isObjectIdString } from '../../lib/ids';
import { addDays, endOfLocalDay, isoWeekdayOf, resolveWorkday, shiftHHmm, zonedToUtc } from '../../lib/zonedTime';
import { cf, ALL_CHANNELS, ALL_ROLES, badArgs, FREE_TEXT_KEYS, L, loadMe, ok, today } from './common';
import { attendanceState, hhmmOf } from './getMyTasks';

// getMySchedule — ish jadvalim: AI sozlamalaridagi smena (ish boshlanishi, kechikish chegarasi,
// ish kunimi — skipDates/extraWorkDates/hafta kunlari), bugungi davomat, obyektlarim va eslatmalar.
// Davomat qo'ng'irog'i (attendance maqsadi) ham shu tool'ni ishlata oladi.

const MAX_DAYS = 60;

/** Xodimga mos smenalar: rol mos va (obyektlar bo'sh yoki kesishadi). */
export function shiftsFor(shifts: AiShift[], role: string, projectIds: string[]): AiShift[] {
  return shifts.filter((s) => (s.roles as string[]).includes(role)
    && (!s.objectIds.length || s.objectIds.some((id) => projectIds.includes(id))));
}

export const getMySchedule: AiToolDef<{ date?: string }> = {
  name: 'getMySchedule',
  description: {
    uz: "Mening ish jadvalim: ish boshlanish vaqti, kechikish chegarasi, bu kun ish kunimi (bayram/qo'shimcha ish kuni hisobga olinadi), davomat holati, obyektlarim va eslatmalar. date berilmasa — bugun.",
    ru: 'Мой график: начало работы, порог опоздания, рабочий ли день (с учётом праздников и доп. дней), отметка, мои объекты и напоминания. Без date — сегодня.',
  },
  parameters: {
    type: 'object',
    properties: { date: { type: 'string', format: 'date', description: 'YYYY-MM-DD (Toshkent vaqti), ixtiyoriy' } },
  },
  kind: 'read',
  confirm: 'never',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ['assistant', 'attendance'],
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  handler: async (ctx, args) => {
    const now = today();
    const date = args.date || now;
    if (date < addDays(now, -MAX_DAYS) || date > addDays(now, MAX_DAYS)) {
      return badArgs(ctx, `Sana bugundan ±${MAX_DAYS} kun oralig'ida bo'lishi kerak.`, `Дата должна быть в пределах ±${MAX_DAYS} дней.`);
    }
    const [me, settings, override] = await Promise.all([loadMe(ctx), getSettings(ctx.companyId), getEmployeeOverride(ctx.companyId, ctx.userId)]);
    const projectIds = ((me?.projectIds || []) as unknown[]).filter(isObjectIdString) as string[];
    const role = me?.role || ctx.role;
    // Shaxsiy ish jadvali (owner 2026-10-15, #5) bo'lsa — xodimning o'z kunlari va vaqti
    const shifts = shiftsFor(settings.attendance.shifts, role, projectIds).map((s) => effectiveShift(s, override));

    const [objects, att, conf, rems] = await Promise.all([
      projectIds.length
        ? ObjectModel.find(cf(ctx, { _id: { $in: projectIds } })).select('name location status').limit(20).lean()
        : Promise.resolve([] as any[]),
      date <= now ? Attendance.findOne(cf(ctx, { userId: ctx.userId, date })).select('checkIn checkOut status workHours').lean() : null,
      AiAttendanceConfirmation.findOne(cf(ctx, { employeeId: ctx.userId, date })).select('status').lean(),
      AiReminder.find(cf(ctx, {
        targetUserId: ctx.userId, status: 'active',
        nextFireAt: { $gte: zonedToUtc(date, '00:00'), $lt: endOfLocalDay(date) },
      })).select('text nextFireAt').sort({ nextFireAt: 1 }).limit(10).lean(),
    ]);

    const a: any = att;
    const data = {
      date,
      isoWeekday: isoWeekdayOf(date),
      timezone: 'Asia/Tashkent',
      shifts: shifts.map((s) => {
        const wd = resolveWorkday(date, s);
        return {
          name: s.name,
          workday: wd.work,
          workdayReason: wd.reason,
          workStart: s.workStart,
          lateAfter: shiftHHmm(s.workStart, s.lateAfterMin),
          absentCutoff: s.absentCutoff,
          workdays: s.workdays,
          ...(override ? { personalSchedule: true } : {}),
          ...(settings.attendance.enabled ? { aiCheckTime: s.callTime } : {}),
        };
      }),
      ...(shifts.length ? {} : {
        note: L(ctx, "Siz uchun AI ish jadvali (smena) sozlanmagan — rahbaringizdan so'rang.", 'Для вас не настроен график (смена) — уточните у руководителя.'),
      }),
      attendance: date <= now ? {
        state: attendanceState(a), checkIn: hhmmOf(a?.checkIn), checkOut: hhmmOf(a?.checkOut),
        workHours: a?.workHours ?? undefined, aiConfirmation: (conf as any)?.status || undefined,
      } : undefined,
      objects: (objects as any[]).map((o) => ({ id: String(o._id), name: o.name, location: o.location || undefined, status: o.status })),
      reminders: (rems as any[]).map((r) => ({ id: String(r._id), text: r.text, at: hhmmOf(r.nextFireAt) })),
    };
    const first = data.shifts[0];
    const msg = first
      ? (first.workday
        ? L(ctx, `${date}: ish kuni, ish ${first.workStart} da boshlanadi.`, `${date}: рабочий день, начало в ${first.workStart}.`)
        : L(ctx, `${date}: ish kuni emas.`, `${date}: нерабочий день.`))
      : L(ctx, 'Smena sozlanmagan.', 'Смена не настроена.');
    return ok(msg, data);
  },
};
