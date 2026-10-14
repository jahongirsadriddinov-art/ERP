import Transaction from '../../../models/Transaction';
import ObjectModel from '../../../models/Object';
import Attendance from '../../../models/Attendance';
import AiReminder from '../../../models/AiReminder';
import AiAttendanceConfirmation from '../../../models/AiAttendanceConfirmation';
import { type AiToolDef } from '../types';
import { endOfLocalDay, zonedParts, zonedToUtc } from '../../lib/zonedTime';
import { isObjectIdString } from '../../lib/ids';
import { cf, ALL_CHANNELS, ALL_ROLES, ASSIST, FREE_TEXT_KEYS, isBoss, L, loadMe, ok, today } from './common';

// getMyTasks — ERP'da alohida "Vazifa" (Task) modeli YO'Q. Shu sabab mavjud ma'lumotdan yig'iladi:
//  • biriktirilgan obyektlar (User.projectIds; prorab uchun foremanId ham);
//  • men tasdiqlashim kerak bo'lgan tranzaksiyalar (toUserId = men, status pending);
//  • rahbar uchun: admin tasdig'ini kutayotgan chiqimlar (approverId = men yoki tasdiqlovchi tanlanmagan);
//  • o'zimning tasdiq kutayotgan chiqimlarim soni;
//  • bugungi davomat holati va AI tasdig'i; bugungi faol eslatmalar.
// Natijada "note" — vazifalar moduli yo'qligini ochiq aytadi (model o'ylab topmasin).

const LIMIT = 10;

export function attendanceState(rec: any): 'NOT_STARTED' | 'WORKING' | 'FINISHED' {
  if (rec?.checkIn && rec?.checkOut) return 'FINISHED';
  if (rec?.checkIn) return 'WORKING';
  return 'NOT_STARTED';
}

export const hhmmOf = (iso?: string | Date | null) => (iso ? zonedParts(new Date(iso)).hhmm : undefined);

const txRow = (t: any) => ({
  id: String(t._id), type: t.type, amount: t.uzsAmount ?? t.amount ?? undefined, date: t.date,
  description: t.description || t.materialName || undefined,
});

export const getMyTasks: AiToolDef<Record<string, never>> = {
  name: 'getMyTasks',
  description: {
    uz: "Mening bugungi ishlarim: biriktirilgan obyektlar, men tasdiqlashim kerak bo'lgan tranzaksiyalar, rahbar uchun tasdiq kutayotgan chiqimlar, bugungi davomat holati va eslatmalar. (Alohida vazifalar moduli yo'q.)",
    ru: 'Мои дела на сегодня: назначенные объекты, транзакции на моё подтверждение, расходы на утверждение (для руководителя), отметка за сегодня и напоминания. (Отдельного модуля задач нет.)',
  },
  parameters: { type: 'object', properties: {} },
  kind: 'read',
  confirm: 'never',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: FREE_TEXT_KEYS,
  handler: async (ctx) => {
    const date = today();
    const me: any = await loadMe(ctx);
    const own = ((me?.projectIds || []) as unknown[]).filter(isObjectIdString) as string[];
    const objOr: Record<string, unknown>[] = [{ foremanId: ctx.userId }];
    if (own.length) objOr.push({ _id: { $in: own } });
    const boss = isBoss(ctx);

    const [objects, toConfirm, toApprove, myAwaiting, att, conf, rems] = await Promise.all([
      ObjectModel.find(cf(ctx, { $or: objOr })).select('name status').limit(20).lean(),
      Transaction.find(cf(ctx, { status: 'pending', toUserId: ctx.userId }))
        .select('type amount uzsAmount date description materialName').sort({ createdAt: -1 }).limit(LIMIT).lean(),
      boss
        ? Transaction.find(cf(ctx, {
          status: 'pending', requiresAdminApproval: true,
          $or: [{ approverId: ctx.userId }, { approverId: { $exists: false } }, { approverId: null }, { approverId: '' }],
        })).select('type amount uzsAmount date description materialName').sort({ createdAt: -1 }).limit(LIMIT).lean()
        : Promise.resolve([] as any[]),
      Transaction.countDocuments(cf(ctx, { status: 'pending', requiresAdminApproval: true, createdById: ctx.userId })),
      Attendance.findOne(cf(ctx, { userId: ctx.userId, date })).select('checkIn checkOut status').lean(),
      AiAttendanceConfirmation.findOne(cf(ctx, { employeeId: ctx.userId, date })).select('status').lean(),
      AiReminder.find(cf(ctx, {
        targetUserId: ctx.userId, status: 'active',
        nextFireAt: { $gte: zonedToUtc(date, '00:00'), $lt: endOfLocalDay(date) },
      })).select('text nextFireAt').sort({ nextFireAt: 1 }).limit(LIMIT).lean(),
    ]);

    const a: any = att;
    const data = {
      date,
      note: L(ctx,
        "ERP'da alohida vazifalar (Task) moduli yo'q — ro'yxat obyektlar, tranzaksiyalar, davomat va eslatmalardan yig'ilgan.",
        'В ERP нет отдельного модуля задач — список собран из объектов, транзакций, отметок и напоминаний.'),
      objects: (objects as any[]).map((o) => ({ id: String(o._id), name: o.name, status: o.status })),
      transactionsToConfirm: (toConfirm as any[]).map(txRow),
      expensesToApprove: (toApprove as any[]).map(txRow),
      myExpensesAwaitingApproval: myAwaiting,
      attendanceToday: {
        state: attendanceState(a),
        checkIn: hhmmOf(a?.checkIn), checkOut: hhmmOf(a?.checkOut),
        aiConfirmation: (conf as any)?.status || undefined,
      },
      remindersToday: (rems as any[]).map((r) => ({ id: String(r._id), text: r.text, at: hhmmOf(r.nextFireAt) })),
    };
    const total = data.transactionsToConfirm.length + data.expensesToApprove.length + data.remindersToday.length
      + (data.attendanceToday.state === 'NOT_STARTED' ? 1 : 0);
    return ok(L(ctx, `Bugun e'tibor talab qiladigan ${total} ta narsa topildi.`, `Найдено ${total} пунктов, требующих внимания.`), data);
  },
};
