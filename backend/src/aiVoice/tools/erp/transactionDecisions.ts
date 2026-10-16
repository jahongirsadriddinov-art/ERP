import Transaction from '../../../models/Transaction';
import User from '../../../models/User';
import ObjectModel from '../../../models/Object';
import type { AiToolDef, ToolCtx, ToolResult } from '../types';
import { isObjectIdString } from '../../lib/ids';
import { cf, ALL_CHANNELS, ALL_ROLES, ASSIST, denied, FREE_TEXT_KEYS, fullName, isBoss, L, notFound, ok } from './common';

// Tasdiqlash qarorlari (owner 2026-10-16: "tasdiqla desam — tasdiqlasin").
//  • listPendingApprovals — men qaror qila oladigan kutilayotgan yozuvlar (qabul qilish + admin tasdig'i);
//  • approveTransaction / rejectTransaction — services/transactionActions.ts (sayt route'i bilan AYNAN bir
//    xil qoidalar: approverId tanlangan bo'lsa faqat o'sha, rol, shu firma; atomik — ikki marta bajarilmaydi).
// Bu foydalanuvchining O'Z qarori (ownDecision) — tugma talab qilinmaydi, lekin AiActionAudit + AuditLog yoziladi.
// Agent bu tool'larni faqat foydalanuvchining shu navbatdagi aniq so'rovi bo'lsa bajaradi (brain/agent.ts).
// Erkin matn (tavsif, ism, material) — untrusted; xabar (message) matniga hech qachon qo'shilmaydi.

const LIMIT = 15;
const money = (n: unknown) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} so'm`;
const TX_FIELDS = 'type amount uzsAmount currency date description materialName quantity unit projectId createdById fromUserId toUserId approverId requiresAdminApproval createdAt';

async function namesFor(ctx: ToolCtx, rows: any[]) {
  const userIds = [...new Set(rows.flatMap((t) => [t.createdById, t.fromUserId]).filter(isObjectIdString))];
  const objIds = [...new Set(rows.map((t) => t.projectId).filter(isObjectIdString))];
  const [users, objs] = await Promise.all([
    userIds.length ? User.find(cf(ctx, { _id: { $in: userIds } })).select('firstName lastName').lean() : [],
    objIds.length ? ObjectModel.find(cf(ctx, { _id: { $in: objIds } })).select('name').lean() : [],
  ]);
  return {
    user: new Map((users as any[]).map((u) => [String(u._id), fullName(u)])),
    obj: new Map((objs as any[]).map((o) => [String(o._id), o.name as string])),
  };
}

export function pendingRow(t: any, n: { user: Map<string, string>; obj: Map<string, string> }, me: string) {
  const requester = t.createdById || t.fromUserId;
  return {
    id: String(t._id),
    kind: t.requiresAdminApproval ? 'expense_approval' : 'receipt',
    type: t.type,
    amount: Math.round(Number(t.uzsAmount ?? t.amount) || 0) || undefined,
    date: t.date,
    description: t.description || undefined,
    materialName: t.materialName || undefined,
    quantity: t.quantity ?? undefined,
    unit: t.unit || undefined,
    requesterName: requester ? n.user.get(String(requester)) : undefined,
    objectName: t.projectId ? n.obj.get(String(t.projectId)) : undefined,
    approverIsMe: t.requiresAdminApproval ? String(t.approverId || '') === me || !t.approverId : undefined,
  };
}

/** Men qaror qila oladigan kutilayotgan yozuvlar filtri (route qoidalari bilan bir xil). */
export function decidableFilter(ctx: ToolCtx): Record<string, unknown> {
  const or: Record<string, unknown>[] = [{ toUserId: ctx.userId, requiresAdminApproval: { $ne: true } }];
  if (isBoss(ctx)) {
    or.push({
      requiresAdminApproval: true,
      $or: [{ approverId: ctx.userId }, { approverId: { $exists: false } }, { approverId: null }, { approverId: '' }],
    });
  }
  return { status: 'pending', $or: or };
}

export const listPendingApprovals: AiToolDef<Record<string, never>> = {
  name: 'listPendingApprovals',
  description: {
    uz: "Men tasdiqlashim yoki rad etishim mumkin bo'lgan kutilayotgan yozuvlar (chiqim tasdig'i, menga yuborilgan material/pul). id'lar approveTransaction/rejectTransaction uchun.",
    ru: 'Ожидающие записи, которые я могу утвердить или отклонить (расходы на утверждение, присланные мне материалы/деньги). id — для approveTransaction/rejectTransaction.',
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
    const filter = cf(ctx, decidableFilter(ctx));
    const [rows, total, otherApprover] = await Promise.all([
      Transaction.find(filter).select(TX_FIELDS).sort({ createdAt: -1 }).limit(LIMIT).lean(),
      Transaction.countDocuments(filter),
      isBoss(ctx)
        ? Transaction.countDocuments(cf(ctx, { status: 'pending', requiresAdminApproval: true, approverId: { $nin: [ctx.userId, null, ''], $exists: true } }))
        : Promise.resolve(0),
    ]);
    const n = await namesFor(ctx, rows as any[]);
    const items = (rows as any[]).map((t) => pendingRow(t, n, ctx.userId));
    const sum = items.reduce((s, i) => s + (i.amount || 0), 0);
    return ok(
      L(ctx, `Sizning qaroringizni ${total} ta yozuv kutmoqda.`, `Вашего решения ждут ${total} записей.`),
      { total, shown: items.length, sumShown: sum, items, ...(otherApprover ? { awaitingOtherApprover: otherApprover } : {}) },
    );
  },
};

function failResult(ctx: ToolCtx, code: string): ToolResult {
  switch (code) {
    case 'not_found': return notFound(ctx);
    case 'already': return { status: 'error', message: L(ctx, "Bu yozuv allaqachon ko'rib chiqilgan — qayta bajarilmadi.", 'Запись уже обработана — повторно не выполнено.'), retryable: false };
    case 'not_required': return { status: 'error', message: L(ctx, "Bu yozuv rahbar tasdig'ini talab qilmaydi.", 'Эта запись не требует утверждения руководителем.'), retryable: false };
    case 'not_approver': return denied(ctx, L(ctx, "Bu chiqim uchun boshqa tasdiqlovchi tanlangan — faqat o'sha odam qaror qiladi.", 'Для этого расхода выбран другой утверждающий — решает только он.'));
    default: return denied(ctx, L(ctx, "Bu yozuv bo'yicha qaror qilish huquqingiz yo'q.", 'У вас нет права принимать решение по этой записи.'));
  }
}

type TxSvc = typeof import('../../../services/transactionActions');
// Servis bot.ts'ni import qiladi — AI modullari uni faqat kerak bo'lganda yuklaydi (registry/testlar uchun)
const svc = (): Promise<TxSvc> => import('../../../services/transactionActions');

export const approveTransaction: AiToolDef<{ transactionId: string; note?: string; defect?: string }> = {
  name: 'approveTransaction',
  description: {
    uz: "Kutilayotgan yozuvni TASDIQLASH (foydalanuvchi aniq \"tasdiqla\" desa). Rahbar — chiqim tasdig'i; qabul qiluvchi — kelgan material/pulni qabul qilish. Avval listPendingApprovals'dan id oling.",
    ru: 'УТВЕРДИТЬ ожидающую запись (если пользователь явно просит). Руководитель — утверждение расхода; получатель — приём материала/денег. id — из listPendingApprovals.',
  },
  parameters: {
    type: 'object',
    properties: {
      transactionId: { type: 'string', format: 'objectId' },
      note: { type: 'string', maxLength: 200, description: 'Izoh (ixtiyoriy)' },
      defect: { type: 'string', maxLength: 200, description: 'Qabul qilishda nuqson (ixtiyoriy)' },
    },
    required: ['transactionId'],
  },
  refs: { transactionId: 'Transaction' },
  kind: 'write',
  confirm: 'never',
  ownDecision: true,
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  auditEntity: 'transaction',
  auditAction: 'approve',
  untrustedKeys: FREE_TEXT_KEYS,
  summarize: (a, lang) => (lang === 'ru' ? `Утвердить запись ${a.transactionId}` : `Yozuvni tasdiqlash ${a.transactionId}`),
  handler: async (ctx, args) => {
    const txFilter = cf(ctx, { _id: args.transactionId });
    const tx: any = await Transaction.findOne(txFilter).select('requiresAdminApproval toUserId').lean();
    if (!tx) return notFound(ctx);
    const s = await svc();
    const base = { txFilter, actorUserId: ctx.userId, actorCompanyId: ctx.companyId };
    let r;
    if (tx.requiresAdminApproval) r = await s.approveTransactionAction({ ...base, note: args.note });
    else if (String(tx.toUserId || '') === ctx.userId) r = await s.confirmTransactionAction({ ...base, defect: args.defect });
    else return failResult(ctx, 'not_allowed');
    if (!r.ok) return failResult(ctx, r.code);
    const t = r.tx;
    return ok(
      L(ctx, `Tasdiqlandi: ${money(t.uzsAmount ?? t.amount)} (${t.type}).`, `Утверждено: ${money(t.uzsAmount ?? t.amount)} (${t.type}).`),
      { id: String(t._id), status: 'confirmed', type: t.type, amount: Math.round(Number(t.uzsAmount ?? t.amount) || 0), description: t.description || undefined },
    );
  },
};

export const rejectTransaction: AiToolDef<{ transactionId: string; reason: string }> = {
  name: 'rejectTransaction',
  description: {
    uz: "Kutilayotgan yozuvni RAD ETISH (foydalanuvchi aniq so'rasa). Sabab majburiy — so'rang, o'ylab topmang.",
    ru: 'ОТКЛОНИТЬ ожидающую запись (если пользователь явно просит). Причина обязательна — спросите, не выдумывайте.',
  },
  parameters: {
    type: 'object',
    properties: {
      transactionId: { type: 'string', format: 'objectId' },
      reason: { type: 'string', minLength: 2, maxLength: 300, description: 'Rad etish sababi' },
    },
    required: ['transactionId', 'reason'],
  },
  refs: { transactionId: 'Transaction' },
  kind: 'write',
  confirm: 'never',
  ownDecision: true,
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  auditEntity: 'transaction',
  auditAction: 'reject',
  untrustedKeys: FREE_TEXT_KEYS,
  summarize: (a, lang) => (lang === 'ru' ? `Отклонить запись ${a.transactionId}` : `Yozuvni rad etish ${a.transactionId}`),
  handler: async (ctx, args) => {
    const s = await svc();
    const r = await s.rejectTransactionAction({ txFilter: cf(ctx, { _id: args.transactionId }), actorUserId: ctx.userId, actorCompanyId: ctx.companyId, note: args.reason });
    if (!r.ok) return failResult(ctx, r.code);
    const t = r.tx;
    return ok(
      L(ctx, `Rad etildi: ${money(t.uzsAmount ?? t.amount)} (${t.type}).`, `Отклонено: ${money(t.uzsAmount ?? t.amount)} (${t.type}).`),
      { id: String(t._id), status: 'rejected', type: t.type },
    );
  },
};

export const DECISION_TOOLS: AiToolDef[] = [listPendingApprovals, approveTransaction, rejectTransaction];
