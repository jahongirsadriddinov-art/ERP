import { pickCandidate } from '../../../services/nameMatch';
import User from '../../../models/User';
import type { ChannelCtx, ChannelName } from '../../contracts';
import { getChannel } from '../../channels/registry';
import { sendToUser } from '../../channels/botChannel';
import { postChatDm } from '../../lib/chatPost';
import { isObjectIdString, newCorrelationId } from '../../lib/ids';
import { truncateText } from '../../lib/untrusted';
import { getSharedQueue, type JobQueue } from '../../queue/jobQueue';
import { isAiActive } from '../../settings';
import type { AiToolDef, ToolCtx, ToolResult } from '../types';
import { inCompany } from '../types';
import { ALL_CHANNELS, ASSIST, escapeRegex, fullName, L, MANAGER_ROLES, notFound, ok } from './common';

// Aniq xodimga murojaat (owner 2026-10-18): "Testga ayt, menga aloqaga chiqsin", "Aliga xabar yubor",
// "Prorabga qo'ng'iroq qilib ayt ...". Avval AI noto'g'ri tool'ni (notifyManager — O'Z rahbariga) chaqirib,
// direktorda "rahbarga xabar berildi" der, aslida hech kimga yetmasdi.
//  • messageEmployee — xodimning Telegram'iga (ERP bot) + ilova bildirishnomasi. Natija ANIQ: qayerga yetdi.
//  • callEmployee    — AI o'sha xodimga qo'ng'iroq qilib xabarni OVOZ bilan aytadi (Telegram → ilova);
//                      AI akkaunti band bo'lsa (masalan, hozirgi qo'ng'iroq) — navbatda, bir daqiqadan keyin.
//                      Qo'ng'iroq bo'lmasa — xabar botga matn bo'lib boradi.
// Ikkalasi ham boshqa odamga ta'sir qiladi — confirm:'always' (ovozda "Tasdiqlaysizmi?" → answerPendingAction).

export const RELAY_JOB = 'ai.relay_call';

interface Who { id: string; name: string; role: string }

/** Ism bo'yicha xodim (shu firma, bloklanmagan). Bir nechta mos kelsa — ro'yxat (aniqlashtirish uchun). */
export async function findEmployee(ctx: ToolCtx, args: { employeeId?: string; employeeName?: string }): Promise<{ one?: Who; many?: Who[] }> {
  const pick = 'firstName lastName role';
  if (args.employeeId && isObjectIdString(args.employeeId)) {
    const u: any = await User.findOne(inCompany(ctx, { _id: args.employeeId, isBlocked: { $ne: true } })).select(pick).lean();
    return u ? { one: { id: String(u._id), name: fullName(u), role: String(u.role || '') } } : {};
  }
  const q = String(args.employeeName || '').trim().slice(0, 60);
  if (!q) return {};
  const words = q.split(/\s+/).filter((w) => w.length >= 2).slice(0, 3);
  if (!words.length) return {};
  const and = words.map((w) => ({ $or: [{ firstName: new RegExp(escapeRegex(w), 'i') }, { lastName: new RegExp(escapeRegex(w), 'i') }] }));
  const list: any[] = await User.find(inCompany(ctx, { isBlocked: { $ne: true }, $and: and })).select(pick).limit(6).lean();
  const rows = list.filter((u) => String(u._id) !== String(ctx.userId)).map((u) => ({ id: String(u._id), name: fullName(u), role: String(u.role || '') }));
  if (rows.length === 1) return { one: rows[0] };
  // Aniq to'liq moslik bo'lsa — o'sha
  const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase() || r.name.toLowerCase().split(' ')[0] === q.toLowerCase());
  if (exact.length === 1) return { one: exact[0] };
  if (rows.length) return { many: rows };

  // Owner 2026-10-29 (AI jurnali): "Bunday xodim topilmadi" xatosi. Yuqoridagi qidiruv —
  // oddiy regex: nom AYNAN shunday yozilgan bo'lsagina topadi. Ovozli qo'ng'iroqda esa ism
  // kirillda, qo'shimcha bilan ("Ruslanga"), qisqartirilgan ("Aziz" ← "Abdulaziz") yoki xato
  // eshitilgan bo'lishi mumkin. Shu sabab hech nima topilmasa — nameMatch orqali fonetik
  // moslik (transliteratsiya + qo'shimchalarni olib tashlash + Levenshtein) bilan qayta qidiramiz.
  const all: any[] = await User.find(inCompany(ctx, { isBlocked: { $ne: true } })).select(pick).limit(300).lean();
  const cands = all
    .filter((u) => String(u._id) !== String(ctx.userId))
    .map((u) => ({ id: String(u._id), name: fullName(u), role: String(u.role || '') }));
  if (!cands.length) return {};
  const guess = pickCandidate(q, cands);
  if (guess.match) return { one: { id: guess.match.id, name: guess.match.name, role: guess.match.role || '' } };
  if (guess.ambiguous?.length) {
    return { many: guess.ambiguous.map((c) => ({ id: c.id, name: c.name, role: c.role || '' })) };
  }
  return {};
}

function whoMissing(ctx: ToolCtx, r: { many?: Who[] }): ToolResult {
  if (r.many?.length) {
    const names = r.many.map((w) => w.name).join(', ');
    return { status: 'error', message: L(ctx, `Bir nechta xodim topildi: ${names}. Qaysi biri?`, `Найдено несколько: ${names}. Кто именно?`), retryable: false, data: { candidates: r.many.map((w) => ({ id: w.id, name: w.name })) } };
  }
  return notFound(ctx, L(ctx, "Bunday xodim topilmadi — ismini to'liqroq ayting.", 'Сотрудник не найден — уточните имя.'));
}

async function senderName(ctx: ToolCtx): Promise<string> {
  const me: any = await User.findOne(inCompany(ctx, { _id: ctx.userId })).select('firstName lastName role').lean();
  const role = String(me?.role || ctx.role || '');
  const r = role === 'direktor' ? 'direktor' : role === 'orinbosar' ? "o'rinbosar" : role;
  return `${truncateText(fullName(me) || 'Rahbar', 60)}${r ? ` (${r})` : ''}`;
}

type Args = { employeeId?: string; employeeName?: string; message: string };

const params: AiToolDef['parameters'] = {
  type: 'object',
  properties: {
    employeeName: { type: 'string', minLength: 2, maxLength: 60, description: 'Xodim ismi (masalan "Test", "Ali Valiyev")' },
    message: { type: 'string', minLength: 1, maxLength: 400, description: "Yetkaziladigan gap (masalan \"menga aloqaga chiqsin\")" },
  },
  required: ['employeeName', 'message'],
};

export const messageEmployee: AiToolDef<Args> = {
  name: 'messageEmployee',
  description: {
    uz: "ANIQ XODIMGA xabar yuborish (\"Aliga ayt/yubor ...\", \"Testga xabar ber menga aloqaga chiqsin\"): Telegram (ERP bot) + ilova bildirishnomasi. O'z rahbariga emas — buning uchun notifyManager.",
    ru: 'Отправить сообщение КОНКРЕТНОМУ сотруднику («передай Али ...»): Telegram (ERP-бот) + уведомление в приложении.',
  },
  parameters: params,
  kind: 'write',
  confirm: 'always',
  maxRoles: MANAGER_ROLES,
  defaultRoles: MANAGER_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: ['name'],
  auditEntity: 'ai_employee_message',
  auditAction: 'send_push',
  summarize: (a, lng) => (lng === 'ru'
    ? `Сообщение ${a.employeeName || 'сотруднику'}: «${truncateText(a.message, 200)}»`
    : `${a.employeeName || 'Xodim'}ga xabar: «${truncateText(a.message, 200)}»`),
  handler: async (ctx, args) => {
    const r = await findEmployee(ctx, { employeeName: args.employeeName });
    if (!r.one) return whoMissing(ctx, r);
    // Owner 2026-10-19: oddiy CHAT xabari (ilovadagi chatda ko'rinadi) + Telegram + bildirishnoma
    const sent = await postChatDm({ companyId: ctx.companyId, fromUserId: ctx.userId, toUserId: r.one.id, text: truncateText(args.message, 400) });
    if (!sent.ok) {
      return { status: 'error', message: L(ctx, `${r.one.name}ga yetkazib bo'lmadi.`, `Не удалось доставить ${r.one.name}.`), retryable: true };
    }
    const where = sent.telegram ? L(ctx, "ilovadagi chatga va Telegram'iga", 'в чат приложения и в Telegram') : L(ctx, 'ilovadagi chatga (Telegram botga ulanmagan)', 'в чат приложения (бот не подключён)');
    return ok(L(ctx, `${r.one.name}ga xabar yuborildi — ${where}.`, `Сообщение ${r.one.name} отправлено — ${where}.`), { name: r.one.name, telegram: sent.telegram, inApp: true });
  },
};

// ── callEmployee: navbat ishi (AI akkaunti band bo'lishi mumkin) ──
const RELAY_ORDER: ChannelName[] = ['telegram_call', 'inapp_call'];
const registeredOn = new WeakSet<JobQueue>();

export function ensureRelayJob(q: JobQueue | null): void {
  if (!q || registeredOn.has(q)) return;
  registeredOn.add(q);
  if (q.registeredTypes().includes(RELAY_JOB)) return;
  q.register(RELAY_JOB, async ({ job, queue }) => {
    const p = (job.payload || {}) as { text?: string; lang?: 'uz' | 'ru'; fromUserId?: string };
    await runRelay({
      companyId: String(job.companyId || ''), employeeId: String(job.employeeId || ''), correlationId: job.correlationId || newCorrelationId(),
      text: String(p.text || '').slice(0, 500), lang: p.lang === 'ru' ? 'ru' : 'uz', fromUserId: p.fromUserId,
      attemptNo: Number(job.attempts) || 1, maxAttempts: Number(job.maxAttempts) || 3,
    }, queue.now());
  }, { concurrency: 2, maxAttempts: 3, backoffBaseMs: 60_000 });
}

export async function runRelay(p: { companyId: string; employeeId: string; correlationId: string; text: string; lang: 'uz' | 'ru'; attemptNo: number; maxAttempts: number; fromUserId?: string }, now: Date): Promise<'calling' | 'texted' | 'skipped'> {
  if (!p.companyId || !(await isAiActive(p.companyId))) return 'skipped';
  const ctx: ChannelCtx = { companyId: p.companyId, employeeId: p.employeeId, correlationId: p.correlationId, purpose: 'reminder', lang: p.lang, now, attemptNo: p.attemptNo };
  let retry = false;
  for (const name of RELAY_ORDER) {
    const ch = getChannel(name);
    if (!ch) continue;
    try {
      const av = await ch.isAvailable(ctx);
      if (!av.ok) { if (['account_busy', 'worker_not_here', 'flood_wait', 'not_on_this_instance'].includes(String(av.reason))) retry = true; continue; }
      const r = await ch.attempt(ctx, { kind: 'reminder', title: p.lang === 'ru' ? 'Сообщение' : 'Xabar', text: p.text, maxDurationSec: 180 });
      if (r.sessionId || r.outcome === 'answered' || r.outcome === 'delivered') return 'calling';
      if (r.retryAt || r.errorCode === 'account_busy') retry = true;
    } catch {
      retry = true;
    }
  }
  if (retry && p.attemptNo < p.maxAttempts) throw new Error('relay_retry');
  // Qo'ng'iroq bo'lmadi — xabar matn bo'lib boradi (yo'qolmasin): ilovadagi chat (+ Telegram), yuboruvchi nomidan
  const posted = p.fromUserId ? await postChatDm({ companyId: p.companyId, fromUserId: p.fromUserId, toUserId: p.employeeId, text: `📞 ${p.text}` }) : { ok: false };
  if (!posted.ok) await sendToUser(p.employeeId, `📞 ${p.text}`, { companyId: p.companyId }).catch(() => undefined);
  return 'texted';
}

export const callEmployee: AiToolDef<Args> = {
  name: 'callEmployee',
  description: {
    uz: "ANIQ XODIMGA AI qo'ng'iroq qilib gapni OVOZ bilan yetkazadi (\"Aliga qo'ng'iroq qilib ayt ...\", \"Testga telefon qil, menga aloqaga chiqsin\"). Telegram yoki ilova orqali; bo'lmasa — botga matn.",
    ru: 'AI звонит КОНКРЕТНОМУ сотруднику и голосом передаёт сообщение («позвони Али и скажи ...»). Telegram или приложение; иначе — текст в бот.',
  },
  parameters: params,
  kind: 'write',
  confirm: 'always',
  maxRoles: MANAGER_ROLES,
  defaultRoles: MANAGER_ROLES,
  purposes: ASSIST,
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  untrustedKeys: ['name'],
  auditEntity: 'ai_relay_call',
  auditAction: 'create',
  summarize: (a, lng) => (lng === 'ru'
    ? `Позвонить ${a.employeeName || 'сотруднику'} и сказать: «${truncateText(a.message, 200)}»`
    : `${a.employeeName || 'Xodim'}ga qo'ng'iroq qilib aytish: «${truncateText(a.message, 200)}»`),
  handler: async (ctx, args) => {
    const r = await findEmployee(ctx, { employeeName: args.employeeName });
    if (!r.one) return whoMissing(ctx, r);
    const q = getSharedQueue();
    if (!q) return { status: 'error', message: L(ctx, "Qo'ng'iroq xizmati hozir ishlamayapti.", 'Сервис звонков сейчас недоступен.'), retryable: false };
    ensureRelayJob(q);
    const from = await senderName(ctx);
    const lang = ctx.lang === 'ru' ? 'ru' : 'uz';
    const text = lang === 'ru' ? `${from} просил передать: ${truncateText(args.message, 400)}` : `${from} sizga aytishimni so'radi: ${truncateText(args.message, 400)}`;
    const inCall = ctx.channel === 'telegram_call' || ctx.channel === 'inapp_call';
    const runAt = new Date(q.now().getTime() + (inCall ? 20_000 : 3_000));
    await q.enqueue({
      type: RELAY_JOB, companyId: ctx.companyId, employeeId: r.one.id, refId: r.one.id,
      payload: { text, lang, fromUserId: ctx.userId }, runAt, maxAttempts: 3, correlationId: ctx.correlationId,
      dedupeKey: `airelay:${r.one.id}:${Math.floor(runAt.getTime() / 120_000)}`,
    });
    const note = inCall
      ? L(ctx, " (hozirgi qo'ng'iroq tugagach — AI bir vaqtda bitta qo'ng'iroq qiladi)", ' (после текущего звонка — AI звонит по одному)')
      : '';
    return ok(L(ctx, `${r.one.name}ga qo'ng'iroq qilib aytaman${note}. Qo'ng'iroq bo'lmasa — Telegram'iga yozaman.`,
      `Позвоню ${r.one.name} и передам${note}. Если не получится — напишу в Telegram.`), { name: r.one.name });
  },
};

export const CONTACT_TOOLS: AiToolDef[] = [messageEmployee, callEmployee];
