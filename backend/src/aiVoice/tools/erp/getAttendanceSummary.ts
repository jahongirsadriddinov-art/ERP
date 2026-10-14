import User from '../../../models/User';
import Attendance from '../../../models/Attendance';
import AiAttendanceConfirmation from '../../../models/AiAttendanceConfirmation';
import { type AiToolDef } from '../types';
import { addDays } from '../../lib/zonedTime';
import {
  cf, ALL_CHANNELS, ALL_ROLES, ASSIST, badArgs, canSeeObject, denied, FREE_TEXT_KEYS, fullName, L, ok, today, visibleObjectIds,
} from './common';
import { attendanceState, hhmmOf } from './getMyTasks';

// getAttendanceSummary — davomat (Attendance) bo'yicha xulosa. Doira:
//  • ishchi — FAQAT o'zi (objectId e'tiborga olinmaydi);
//  • prorab/brigadir — o'z obyektlaridagi xodimlar;
//  • rahbar — butun firma yoki tanlangan obyekt.
// Yozuvi yo'q xodim: o'tgan kun uchun "kelmagan", bugun uchun "hali belgilanmagan". AI tasdiq holatlari ham.
// Telefon raqami HECH QACHON qaytarilmaydi.

const WORKER_ROLES = ['ishchi', 'prorab', 'brigadir'];
const ROWS_MAX = 100;

export const getAttendanceSummary: AiToolDef<{ date?: string; objectId?: string }> = {
  name: 'getAttendanceSummary',
  description: {
    uz: "Davomat xulosasi (sana bo'yicha, standart — bugun). Ishchi faqat o'zinikini, prorab/brigadir o'z obyektlarini, rahbar butun firma yoki obyektni ko'radi.",
    ru: 'Сводка посещаемости за дату (по умолчанию сегодня). Рабочий видит только себя, прораб/бригадир — свои объекты, руководитель — всю фирму или объект.',
  },
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', format: 'date', description: 'YYYY-MM-DD (ixtiyoriy)' },
      objectId: { type: 'string', format: 'objectId', description: 'Obyekt ID (ixtiyoriy)' },
    },
  },
  refs: { objectId: 'Object' },
  kind: 'read',
  confirm: 'never',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  handler: async (ctx, args) => {
    const now = today();
    const date = args.date || now;
    if (date > now) return badArgs(ctx, "Kelajakdagi sana uchun davomat yo'q.", 'Посещаемости за будущую дату нет.');
    if (date < addDays(now, -366)) return badArgs(ctx, "Sana bir yildan eski bo'lmasin.", 'Дата не старше года.');
    const past = date < now;

    // Kimlar hisobga olinadi
    let users: any[];
    let scope: 'self' | 'objects' | 'company' | 'object';
    if (ctx.role === 'ishchi') {
      scope = 'self';
      users = await User.find(cf(ctx, { _id: ctx.userId })).select('firstName lastName role').lean();
    } else {
      const visible = await visibleObjectIds(ctx);
      if (args.objectId && !canSeeObject(visible, args.objectId)) return denied(ctx);
      const objIds = args.objectId ? [args.objectId] : visible;
      scope = args.objectId ? 'object' : visible === null ? 'company' : 'objects';
      const filter: Record<string, unknown> = { role: { $in: WORKER_ROLES }, isBlocked: { $ne: true } };
      if (objIds) filter.projectIds = { $in: objIds };
      users = objIds && !objIds.length ? [] : await User.find(cf(ctx, filter)).select('firstName lastName role').limit(1000).lean();
    }
    const ids = users.map((u) => String(u._id));
    const [records, confs] = await Promise.all([
      ids.length ? Attendance.find(cf(ctx, { date, userId: { $in: ids } })).select('userId checkIn checkOut status workHours').lean() : [],
      ids.length ? AiAttendanceConfirmation.find(cf(ctx, { date, employeeId: { $in: ids } })).select('employeeId status').lean() : [],
    ]);
    const byUser = new Map((records as any[]).map((r) => [String(r.userId), r]));
    const aiByUser = new Map((confs as any[]).map((c) => [String(c.employeeId), c.status]));

    const counts = { eligible: ids.length, working: 0, finished: 0, late: 0, noRecord: 0 };
    const aiStatuses: Record<string, number> = {};
    const rows = users.map((u) => {
      const id = String(u._id);
      const rec: any = byUser.get(id);
      const state = attendanceState(rec);
      if (state === 'WORKING') counts.working++;
      else if (state === 'FINISHED') counts.finished++;
      else counts.noRecord++;
      if (rec?.status === 'late') counts.late++;
      const ai = aiByUser.get(id);
      if (ai) aiStatuses[ai] = (aiStatuses[ai] || 0) + 1;
      return {
        userId: id, name: fullName(u), role: u.role,
        state: state === 'NOT_STARTED' ? (past ? 'ABSENT' : 'NOT_CHECKED_IN') : state,
        checkIn: hhmmOf(rec?.checkIn), checkOut: hhmmOf(rec?.checkOut),
        late: rec?.status === 'late' || undefined, workHours: rec?.workHours ?? undefined,
        aiConfirmation: ai || undefined,
      };
    });
    const present = counts.working + counts.finished;
    return ok(
      L(ctx, `${date}: ${counts.eligible} kishidan ${present} tasi kelgan.`, `${date}: пришли ${present} из ${counts.eligible}.`),
      {
        date, scope, counts: { ...counts, present }, aiStatuses,
        note: past ? undefined : L(ctx, "Bugun yozuvi yo'qlar hali kelmagan bo'lishi mumkin.", 'Без отметки сегодня — возможно, ещё не пришли.'),
        truncated: rows.length > ROWS_MAX,
        rows: rows.slice(0, ROWS_MAX),
      },
    );
  },
};
