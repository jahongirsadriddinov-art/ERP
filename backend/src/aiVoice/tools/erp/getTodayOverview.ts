import User from '../../../models/User';
import ObjectModel from '../../../models/Object';
import Attendance from '../../../models/Attendance';
import Transaction from '../../../models/Transaction';
import AiReminder from '../../../models/AiReminder';
import type { AiToolDef } from '../types';
import { zonedToUtc, addDays } from '../../lib/zonedTime';
import { cf, ALL_CHANNELS, ASSIST, BOSS_ROLES, L, ok, today, UZS_AMOUNT } from './common';
import { decidableFilter } from './transactionDecisions';

// getTodayOverview — rahbar uchun BITTA chaqiruvda bugungi holat ("bugun nima gap?"): davomat,
// mening qarorimni kutayotganlar, bugungi chiqim/kirim, faol obyektlar, bugungi eslatmalarim.
// Faqat yig'indilar — ism/telefon/maosh yo'q (tafsilot — listEmployees, listPendingApprovals).

const EXPENSE = ['expense', 'material', 'jihozlar', 'transport', 'boshqa', 'oylik'];

export const getTodayOverview: AiToolDef<Record<string, never>> = {
  name: 'getTodayOverview',
  description: {
    uz: "Bugungi umumiy holat (rahbar): davomat, qarorimni kutayotganlar, bugungi chiqim/kirim, faol obyektlar, bugungi eslatmalar.",
    ru: 'Сводка за сегодня (руководитель): явка, ждут моего решения, расходы/доходы сегодня, активные объекты, напоминания.',
  },
  parameters: { type: 'object', properties: {} },
  kind: 'read',
  confirm: 'never',
  maxRoles: BOSS_ROLES,
  defaultRoles: BOSS_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  handler: async (ctx) => {
    const date = today();
    const dayStart = zonedToUtc(date, '00:00');
    const dayEnd = zonedToUtc(addDays(date, 1), '00:00');
    const workers = await User.find(cf(ctx, { role: { $in: ['ishchi', 'brigadir', 'prorab'] }, isBlocked: { $ne: true } })).select('_id').lean();
    const ids = (workers as any[]).map((w) => String(w._id));
    const [att, pendingAgg, pendingAll, money, activeObjects, reminders] = await Promise.all([
      ids.length ? Attendance.find(cf(ctx, { date, userId: { $in: ids }, checkIn: { $exists: true, $ne: null } })).select('status').lean() : [],
      Transaction.aggregate([{ $match: cf(ctx, decidableFilter(ctx)) }, { $group: { _id: null, n: { $sum: 1 }, sum: { $sum: UZS_AMOUNT } } }]),
      Transaction.countDocuments(cf(ctx, { status: 'pending', requiresAdminApproval: true })),
      Transaction.aggregate([
        { $match: cf(ctx, { date, status: { $ne: 'rejected' }, type: { $in: [...EXPENSE, 'income'] } }) },
        { $group: { _id: { $cond: [{ $eq: ['$type', 'income'] }, 'income', 'expense'] }, n: { $sum: 1 }, sum: { $sum: UZS_AMOUNT } } },
      ]),
      ObjectModel.countDocuments(cf(ctx, { status: 'active' })),
      AiReminder.countDocuments(cf(ctx, { targetUserId: ctx.userId, status: 'active', nextFireAt: { $gte: dayStart, $lt: dayEnd } })),
    ]);
    const late = (att as any[]).filter((a) => a.status === 'late').length;
    const m = new Map((money as any[]).map((r) => [r._id, { count: r.n, sum: Math.round(r.sum || 0) }]));
    return ok(L(ctx, 'Bugungi holat tayyor.', 'Сводка за сегодня готова.'), {
      date, currency: 'UZS',
      attendance: { staff: ids.length, checkedIn: att.length, late, notCheckedIn: Math.max(0, ids.length - att.length) },
      awaitingMyDecision: { count: pendingAgg[0]?.n || 0, sum: Math.round(pendingAgg[0]?.sum || 0) },
      expenseApprovalsPendingCompany: pendingAll,
      today: { expense: m.get('expense') || { count: 0, sum: 0 }, income: m.get('income') || { count: 0, sum: 0 } },
      activeObjects,
      myRemindersToday: reminders,
    });
  },
};
