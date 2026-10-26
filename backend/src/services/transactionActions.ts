import Transaction from '../models/Transaction';
import Material from '../models/Material';
import User from '../models/User';
import { bot } from './bot';
import { stamped } from '../middleware/scope';
import { emitToUser } from './socket';
import { tb, BotLang } from '../i18n/bot';
import { sendEmail } from './email';
import { logAudit } from './audit';
import { sendPushToUser } from './push';

// Tranzaksiya qarorlari (tasdiqlash / admin tasdig'i / rad etish) — routes/transactions.ts va AI
// tool'lari (aiVoice/tools/erp/transactionDecisions.ts) UMUMIY mantiqi. Qoidalar route bilan aynan bir xil:
//  • confirm — FAQAT qabul qiluvchi (tx.toUserId);
//  • approve — faqat direktor/o'rinbosar; approverId tanlangan bo'lsa — FAQAT o'sha odam;
//  • reject — qabul qiluvchi yoki admin; admin uchun approverId tanlangan bo'lsa — faqat o'sha.
// Holat o'tishi ATOMIK (status:'pending' sharti bilan findOneAndUpdate): ikki marta bosish / AI va
// sayt bir vaqtda — faqat bittasi bajaradi, ikkinchisi 409 oladi. Bildirishnomalar avvalgidek.

export type TxActionCode =
  | 'not_found' | 'already' | 'not_required' | 'unauthenticated' | 'not_recipient' | 'not_admin' | 'not_approver'
  | 'not_allowed';

export type TxActionResult =
  | { ok: true; tx: any }
  | { ok: false; status: number; error: string; code: TxActionCode };

export interface TxActionInput {
  /** Tranzaksiya filtri: route — scoped({_id}), AI — {_id, companyId} (aniq firma). */
  txFilter: Record<string, unknown>;
  actorUserId?: string;
  /** Berilsa — aktyor shu firmadan qidiriladi (AI yo'li). Route'da berilmaydi (avvalgi xatti-harakat). */
  actorCompanyId?: string;
  note?: string;
  defect?: string;
  req?: any;
}

const fail = (status: number, error: string, code: TxActionCode): TxActionResult => ({ ok: false, status, error, code });
const todayIso = () => new Date().toISOString().split('T')[0];

async function loadActor(i: TxActionInput): Promise<any | null> {
  if (!i.actorUserId) return null;
  if (i.actorCompanyId) return User.findOne({ _id: i.actorUserId, companyId: i.actorCompanyId }).catch(() => null);
  return User.findById(i.actorUserId).catch(() => null);
}

/** Model post-save hook'i (byudjet nazorati) atomik yangilanishda ishlamaydi — xuddi o'shani chaqiramiz. */
function runSaveInsights(doc: any) {
  import('./expenseInsights').then((m) => m.onExpenseSaved(doc.toObject(), false)).catch(() => {});
}

/** Faqat 'pending' bo'lsa o'tkazadi; boshqa so'rov oldin ulgurgan bo'lsa — null. */
async function transition(txFilter: Record<string, unknown>, id: unknown, update: Record<string, unknown>) {
  const doc = await Transaction.findOneAndUpdate({ ...txFilter, _id: id, status: 'pending' } as any, update, { returnDocument: 'after' });
  if (doc) runSaveInsights(doc);
  return doc;
}

/** Qabul qiluvchi tasdig'i (yukxat/transfer). Material qoldig'i va bog'liq chiqim yaratiladi. */
export async function confirmTransactionAction(i: TxActionInput): Promise<TxActionResult> {
  const found = await Transaction.findOne(i.txFilter);
  if (!found) return fail(404, 'Topilmadi', 'not_found');
  if (found.status !== 'pending') return fail(409, 'Bu allaqachon qayta ishlangan', 'already');
  const actingUserId = i.actorUserId;
  if (!actingUserId || String(found.toUserId) !== String(actingUserId)) {
    return fail(403, 'Faqat qabul qiluvchi tasdiqlashi mumkin', 'not_recipient');
  }
  // XAVFSIZLIK (audit 2026-10-22): rahbar tasdig'ini talab qiladigan chiqim qabul qiluvchi tasdig'i bilan
  // "tasdiqlangan" bo'lib qolmasin — aks holda ishchi o'zini (yoki sherigini) qabul qiluvchi qilib, istalgan
  // summani rahbarsiz tasdiqlab yuborardi. Bunday yozuv faqat /approve (tanlangan rahbar) orqali yopiladi.
  if (found.requiresAdminApproval) {
    return fail(403, "Bu chiqimni avval rahbar tasdiqlashi kerak", 'not_approver');
  }
  const confirmedDate = todayIso();
  const tx: any = await transition(i.txFilter, found._id, {
    $set: { status: 'confirmed', confirmedById: actingUserId, confirmedDate, ...(i.defect ? { defect: i.defect } : {}) },
  });
  if (!tx) return fail(409, 'Bu allaqachon qayta ishlangan', 'already');

  // Material yuborilgan/qolgan soni + Moliyada ko'rinishi uchun bog'liq chiqim
  let expenseTx: any = null;
  if (tx.type === 'transfer' && tx.projectId && tx.materialName && tx.quantity) {
    try {
      // XAVFSIZLIK (audit 2026-10-19): faqat shu firmaning materiali
      const matScope = tx.companyId ? { companyId: tx.companyId } : {};
      await Material.findOneAndUpdate(
        { objectId: tx.projectId, name: tx.materialName, ...matScope },
        { $inc: { sent: tx.quantity, remaining: -tx.quantity } },
      );
      // Yuboruvchi kiritgan narx (tx.price) katalogdagi Material.price'dan ustuvor
      const mat = await Material.findOne({ objectId: tx.projectId, name: tx.materialName, ...matScope });
      const unitPrice = tx.price ?? mat?.price;
      if (unitPrice) {
        // AI yo'lida tenant konteksti bo'lmasligi mumkin — firma tranzaksiyaning o'zidan (route'da ular bir xil)
        const companyStamp = tx.companyId ? { companyId: tx.companyId } : {};
        expenseTx = await Transaction.create(stamped({
          ...companyStamp,
          type: 'material',
          status: 'confirmed',
          date: tx.date,
          amount: unitPrice * tx.quantity,
          description: `Material: ${tx.materialName} (${tx.quantity} ${tx.unit})`,
          projectId: tx.projectId,
          createdById: tx.fromUserId,
          toUserId: tx.toUserId,
          confirmedById: actingUserId,
          confirmedDate: tx.confirmedDate,
          sourceTransferId: String(tx._id),
        }));
      }
    } catch (matErr) {
      console.error('Material update error:', matErr);
    }
  }

  // Realtime — ochiq veb-sessiyalar darhol yangilansin
  const payload = { ...tx.toObject(), id: tx._id };
  if (tx.toUserId) emitToUser(String(tx.toUserId), 'transaction:update', payload);
  if (tx.fromUserId) emitToUser(String(tx.fromUserId), 'transaction:update', payload);
  if (expenseTx) {
    const expPayload = { ...expenseTx.toObject(), id: expenseTx._id };
    if (tx.fromUserId) emitToUser(String(tx.fromUserId), 'transaction:new', expPayload);
    if (tx.toUserId) emitToUser(String(tx.toUserId), 'transaction:new', expPayload);
  }

  // Yuboruvchiga xabar (Telegram + Push + Email)
  try {
    const fromUserId = tx.fromUserId || tx.createdById;
    if (fromUserId) {
      const fromUser = await User.findById(fromUserId).catch(() => null) ||
                       await User.findOne({ _id: fromUserId }).catch(() => null);
      if (fromUser) {
        const label = (tx.type === 'transfer' ? tx.materialName : tx.description) || '—';
        if (fromUser.telegramChatId) {
          await bot.sendMessage(fromUser.telegramChatId, tb(fromUser.language as BotLang | undefined, 'simpleConfirmedNotify', { label })).catch(console.error);
        }
        sendPushToUser(String(fromUser._id), { title: '✅ Tasdiqlandi', body: label, tag: 'confirmed' }).catch(() => {});
        if (fromUser.email && tx.type !== 'transfer') {
          await sendEmail(fromUser.email, 'Tranzaksiya tasdiqlandi — QurilishERP', `
              <h2>Tranzaksiya tasdiqlandi ✅</h2>
              <p><b>${label}</b> — ${(tx.amount || 0).toLocaleString()} so'm</p>
              <p>Sana: ${tx.confirmedDate}</p>
            `).catch(console.error);
        }
      }
    }
  } catch (notifErr) {
    console.error('Telegram/Email notification error:', notifErr);
  }
  return { ok: true, tx };
}

/** Admin chiqim tasdig'i (expense approval chain). */
export async function approveTransactionAction(i: TxActionInput): Promise<TxActionResult> {
  const found = await Transaction.findOne(i.txFilter);
  if (!found) return fail(404, 'Topilmadi', 'not_found');
  if (found.status !== 'pending') return fail(409, 'Bu allaqachon qayta ishlangan', 'already');
  if (!found.requiresAdminApproval) return fail(400, 'Bu tranzaksiya admin tasdiqlashini talab qilmaydi', 'not_required');
  const actingUserId = i.actorUserId;
  if (!actingUserId) return fail(401, 'Autentifikatsiya talab etiladi', 'unauthenticated');

  const actor = await loadActor(i);
  if (!actor || !['direktor', 'orinbosar'].includes(actor.role)) {
    return fail(403, 'Faqat direktor yoki orinbosar tasdiqlashi mumkin', 'not_admin');
  }
  // ANIQ tasdiqlovchi tanlangan bo'lsa — FAQAT o'sha odam; eski (approverId'siz) yozuvlar — har qanday admin
  if (found.approverId && String(found.approverId) !== String(actingUserId)) {
    return fail(403, 'Bu chiqimni faqat tanlangan tasdiqlovchi tasdiqlay oladi', 'not_approver');
  }

  const historyEntry = {
    userId: actingUserId,
    name: `${actor.firstName} ${actor.lastName || ''}`.trim(),
    role: actor.role,
    action: 'approved' as const,
    date: todayIso(),
    note: i.note || '',
  };
  const tx: any = await transition(i.txFilter, found._id, {
    $set: { status: 'confirmed', confirmedById: actingUserId, confirmedDate: todayIso() },
    $push: { approvalHistory: historyEntry },
  });
  if (!tx) return fail(409, 'Bu allaqachon qayta ishlangan', 'already');

  await logAudit({
    userId: actingUserId,
    userName: historyEntry.name,
    userRole: actor.role,
    action: 'approve',
    entity: 'transaction',
    entityId: String(tx._id),
    description: `Chiqim tasdiqlandi: ${tx.description || '—'} — ${(tx.amount || 0).toLocaleString()} so'm`,
    newValue: { status: 'confirmed', approvedBy: historyEntry.name },
    companyId: actor.companyId,
    req: i.req,
  });

  const payload = { ...tx.toObject(), id: tx._id };
  if (tx.createdById) emitToUser(String(tx.createdById), 'transaction:update', payload);
  if (tx.toUserId) emitToUser(String(tx.toUserId), 'transaction:update', payload);

  // Yaratuvchiga email
  try {
    const creatorId = tx.createdById || tx.toUserId;
    if (creatorId) {
      const creator = await User.findById(creatorId).catch(() => null);
      if (creator?.email) {
        await sendEmail(creator.email, 'Chiqim tasdiqlandi — QurilishERP', `
          <h2>Chiqim tasdiqlandi ✅</h2>
          <p><b>${tx.description || '—'}</b> — ${(tx.amount || 0).toLocaleString()} so'm</p>
          <p>Tasdiqlagan: ${historyEntry.name} (${actor.role})</p>
          <p>Sana: ${historyEntry.date}</p>
        `).catch(console.error);
      }
    }
  } catch {}

  // Telegram + Push
  try {
    const creatorId = tx.createdById || tx.toUserId;
    if (creatorId) {
      const creator = await User.findById(creatorId).catch(() => null);
      if (creator) {
        const label = tx.description || '—';
        if (creator.telegramChatId) {
          await bot.sendMessage(creator.telegramChatId, `✅ Chiqimingiz tasdiqlandi: *${label}* — ${(tx.amount || 0).toLocaleString()} so'm`, { parse_mode: 'Markdown' }).catch(console.error);
        }
        sendPushToUser(String(creator._id), {
          title: '✅ Chiqim tasdiqlandi',
          body: `${label} — ${(tx.amount || 0).toLocaleString()} so'm`,
          tag: 'confirmed',
        }).catch(() => {});
      }
    }
  } catch {}
  return { ok: true, tx };
}

/** Rad etish — qabul qiluvchi yoki admin. */
export async function rejectTransactionAction(i: TxActionInput): Promise<TxActionResult> {
  const found = await Transaction.findOne(i.txFilter);
  if (!found) return fail(404, 'Topilmadi', 'not_found');
  if (found.status !== 'pending') return fail(409, 'Bu allaqachon qayta ishlangan', 'already');
  const actingUserId = i.actorUserId;
  if (!actingUserId) return fail(401, 'Autentifikatsiya talab etiladi', 'unauthenticated');

  const actor = await loadActor(i);
  const isAdmin = !!actor && ['direktor', 'orinbosar'].includes(actor.role);
  const isRecipient = String(found.toUserId) === String(actingUserId);
  if (!isAdmin && !isRecipient) return fail(403, 'Faqat qabul qiluvchi yoki admin rad etishi mumkin', 'not_allowed');
  // ANIQ tasdiqlovchi tanlangan bo'lsa — faqat o'sha admin (qabul qiluvchi yo'li bunga bog'liq emas)
  if (isAdmin && found.approverId && String(found.approverId) !== String(actingUserId)) {
    return fail(403, 'Bu chiqimni faqat tanlangan tasdiqlovchi rad eta oladi', 'not_approver');
  }

  const update: Record<string, unknown> = { $set: { status: 'rejected' } };
  if (found.requiresAdminApproval && actor) {
    update.$push = {
      approvalHistory: {
        userId: actingUserId,
        name: `${actor.firstName} ${actor.lastName || ''}`.trim(),
        role: actor.role,
        action: 'rejected',
        date: todayIso(),
        note: i.note || '',
      },
    };
  }
  const tx: any = await transition(i.txFilter, found._id, update);
  if (!tx) return fail(409, 'Bu allaqachon qayta ishlangan', 'already');

  const payload = { ...tx.toObject(), id: tx._id };
  if (tx.toUserId) emitToUser(String(tx.toUserId), 'transaction:update', payload);
  if (tx.fromUserId) emitToUser(String(tx.fromUserId), 'transaction:update', payload);

  try {
    const fromUserId = tx.fromUserId || tx.createdById;
    if (fromUserId) {
      const fromUser = await User.findById(fromUserId).catch(() => null) ||
                       await User.findOne({ _id: fromUserId }).catch(() => null);
      if (fromUser) {
        const label = (tx.type === 'transfer' ? tx.materialName : tx.description) || '—';
        if (fromUser.telegramChatId) {
          await bot.sendMessage(fromUser.telegramChatId, tb(fromUser.language as BotLang | undefined, 'simpleRejectedNotify', { label })).catch(console.error);
        }
        sendPushToUser(String(fromUser._id), { title: '❌ Rad etildi', body: label, tag: 'rejected' }).catch(() => {});
      }
    }
  } catch (notifErr) {
    console.error('Telegram notification error:', notifErr);
  }
  return { ok: true, tx };
}
