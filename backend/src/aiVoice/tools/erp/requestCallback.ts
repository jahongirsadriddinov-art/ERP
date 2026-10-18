import User from '../../../models/User';
import type { ChannelCtx, ChannelName } from '../../contracts';
import { getChannel } from '../../channels/registry';
import { newCorrelationId } from '../../lib/ids';
import { addDays, zonedParts, zonedToUtc } from '../../lib/zonedTime';
import { getSharedQueue, type JobQueue } from '../../queue/jobQueue';
import { isAiActive } from '../../settings';
import type { AiToolDef, ToolCtx } from '../types';
import { ALL_ROLES, ASSIST, L, ok } from './common';

// requestCallback — "menga qo'ng'iroq qil", "Telegramdan bir minutdan keyin qo'ng'iroq qil" (owner
// 2026-10-16: AI "qo'ng'iroq qila olmayman" derdi). AI foydalanuvchining O'ZIGA qo'ng'iroqni navbatga
// qo'yadi — mavjud kanal adapterlari orqali (telegram_call / inapp_call, purpose 'assistant').
//  • Chaqiruv paytida kanallar tekshiriladi: Telegram (firma roziligi + ERP botga ulangan + worker) yoki ilova
//    (foydalanuvchi onlayn). Hech biri bo'lmasa — ANIQ nima yetishmasligini aytadi. Hech qachon "qila olmayman" emas.
//  • Owner 2026-10-16: rozilikni rahbariyat firma uchun beradi — xodimdan rozilik/bog'lash kodi so'ralmaydi.
//  • Faqat o'ziga (boshqa odamga emas) — tasdiq tugmasi kerak emas. Chat kanallaridan (web/bot).
// Ish turi 'ai.callback' — navbatga birinchi chaqiruvda va registerErpTools'dan keyin ro'yxatga olinadi.

export const CALLBACK_JOB = 'ai.callback';
const MAX_AHEAD_MS = 7 * 24 * 3600_000;
const START_DELAY_MS = 5_000;          // AI javobi foydalanuvchiga yetib borsin
const IN_CALL_MIN_DELAY_MS = 45_000;    // qo'ng'iroq ichidan: avval joriy qo'ng'iroq tugasin
const SOON_MS = 90_000;                 // shundan yaqin — "hozir" (kanal hozir mavjud bo'lishi kerak)
const CALL_CHANNELS: ChannelName[] = ['inapp_call', 'telegram_call'];
/** Bir oz kutib o'tib ketadigan sabablar — qo'ng'iroq baribir navbatga qo'yiladi. */
const TRANSIENT = new Set(['not_on_this_instance', 'flood_wait', 'account_busy', 'worker_not_here']);
/** Ilova yopiq/fonda (owner 2026-10-19: "Telegram'dan ilovaga qil" ishlamasdi) — push yuborib, ochilishini kutamiz. */
const APP_WAKE = new Set(['offline', 'not_visible']);

async function wakeApp(ctx: ChannelCtx): Promise<void> {
  await getChannel('push')?.attempt(ctx, {
    kind: 'test',
    title: ctx.lang === 'ru' ? '📞 AI хочет позвонить' : "📞 AI qo'ng'iroq qilmoqchi",
    text: ctx.lang === 'ru' ? 'Откройте приложение — звонок начнётся сразу.' : "Ilovani oching — qo'ng'iroq darhol boshlanadi.",
  }).catch(() => undefined);
}

export function callbackOrder(pref: 'inapp' | 'telegram' | undefined, from: ToolCtx['channel']): ChannelName[] {
  const first: ChannelName = pref === 'telegram' ? 'telegram_call' : pref === 'inapp' ? 'inapp_call'
    : from === 'bot' || from === 'telegram_call' ? 'telegram_call' : 'inapp_call';
  return [first, ...CALL_CHANNELS.filter((c) => c !== first)];
}

/**
 * "when" → UTC. Vaqt zonasi ko'rsatilmagan ISO ("2026-10-16T15:00") va "15:00" — Toshkent vaqti
 * (model ko'pincha zonasiz beradi; serverda UTC deb o'qilsa 5 soat xato bo'lardi). "15:00" o'tib
 * ketgan bo'lsa — ertaga.
 */
export function parseWhen(s: string, now: Date): Date | null {
  const v = String(s || '').trim();
  if (!v) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  const full = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(v);
  if (full) {
    const hh = Number(full[2]), mm = Number(full[3]);
    if (hh > 23 || mm > 59) return null;
    return zonedToUtc(full[1] as any, `${String(hh).padStart(2, '0')}:${full[3]}` as any);
  }
  const hm = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (hm) {
    const hh = Number(hm[1]), mm = Number(hm[2]);
    if (hh > 23 || mm > 59) return null;
    const today = zonedParts(now).date;
    const t = zonedToUtc(today, `${String(hh).padStart(2, '0')}:${hm[2]}` as any);
    return t.getTime() < now.getTime() - 60_000 ? zonedToUtc(addDays(today, 1), `${String(hh).padStart(2, '0')}:${hm[2]}` as any) : t;
  }
  return null;
}

type Lg = { lang?: string };

/** Kanal nima uchun mavjud emasligini foydalanuvchiga tushunarli qilib (nima qilish kerak). */
export function missingText(ch: ChannelName, reason: string, c: Lg): string {
  const l = (uz: string, ru: string) => L(c as any, uz, ru);
  if (ch === 'telegram_call') {
    switch (reason) {
      case 'no_consent': return l("AI qo'ng'iroqlari rahbariyat tomonidan o'chirilgan", 'звонки AI отключены руководством');
      case 'not_bound': return l("ERP botiga telefon raqamingizni ulashing (shunda Telegram'ingiz ulanadi)", 'поделитесь номером телефона в ERP-боте (так подключится ваш Telegram)');
      case 'not_resolved': return l("AI Telegram'ingizni hali topa olmadi — ERP botidagi telefon raqamingiz Telegram raqamingiz bilan bir xil bo'lsin", 'AI пока не нашёл ваш Telegram — номер в ERP-боте должен совпадать с номером Telegram');
      case 'blocked': return l("Telegram'da AI akkauntini blokdan chiqaring", 'разблокируйте AI-аккаунт в Telegram');
      case 'privacy_restricted': return l("Telegram maxfiylik sozlamasida qo'ng'iroqlarga ruxsat bering", 'разрешите звонки в настройках конфиденциальности Telegram');
      case 'opt_out': return l("rahbariyat siz uchun AI qo'ng'iroqlarini o'chirgan", 'руководство отключило для вас звонки AI');
      case 'account_not_connected': return l("AI Telegram akkaunti hali ulanmagan (administrator ulaydi)", 'Telegram-аккаунт AI ещё не подключён (подключает администратор)');
      case 'worker_offline': return l("Telegram qo'ng'iroq xizmati hozir o'chiq", 'сервис звонков Telegram сейчас выключен');
      case 'daily_cap': case 'company_quota': return l("bugungi Telegram qo'ng'iroqlar limiti tugagan", 'дневной лимит звонков Telegram исчерпан');
      case 'not_registered': return l("Telegram qo'ng'iroqlari hali yoqilmagan", 'звонки Telegram ещё не включены');
      default: return l("Telegram qo'ng'irog'i hozir mavjud emas", 'звонок в Telegram сейчас недоступен');
    }
  }
  switch (reason) {
    case 'offline': return l("ilova yoki sayt yopiq — ilovani oching", 'приложение закрыто — откройте приложение');
    case 'not_visible': return l("ilova oynasini ochiq qoldiring", 'держите окно приложения открытым');
    case 'opt_out': return l("rahbariyat siz uchun AI qo'ng'iroqlarini o'chirgan", 'руководство отключило для вас звонки AI');
    case 'not_registered': return l("ilova ichidagi qo'ng'iroq hali yoqilmagan", 'звонки в приложении ещё не включены');
    default: return l("ilova ichidagi qo'ng'iroq hozir mavjud emas", 'звонок в приложении сейчас недоступен');
  }
}

export interface Precheck { available: ChannelName[]; reasons: Partial<Record<ChannelName, string>> }

/** Kanallarni tekshiradi (qo'ng'iroq qilmaydi). */
export async function precheckChannels(c: ChannelCtx, order: ChannelName[]): Promise<Precheck> {
  const out: Precheck = { available: [], reasons: {} };
  for (const name of order) {
    const ch = getChannel(name);
    if (!ch) { out.reasons[name] = 'not_registered'; continue; }
    try {
      const av = await ch.isAvailable(c);
      if (av.ok) out.available.push(name); else out.reasons[name] = av.reason || 'unavailable';
    } catch {
      out.reasons[name] = 'unavailable';
    }
  }
  return out;
}

const registeredOn = new WeakSet<JobQueue>();

/** Navbatga 'ai.callback' ishlovchisini qo'shadi (idempotent). */
export function ensureCallbackJob(q: JobQueue | null): void {
  if (!q || registeredOn.has(q)) return;
  registeredOn.add(q);
  if (q.registeredTypes().includes(CALLBACK_JOB)) return;
  q.register(CALLBACK_JOB, async ({ job, queue }) => {
    const p = (job.payload || {}) as { order?: ChannelName[]; lang?: 'uz' | 'ru'; reason?: string };
    await runCallback({
      companyId: String(job.companyId || ''), employeeId: String(job.employeeId || ''), correlationId: job.correlationId || newCorrelationId(),
      order: (p.order || []).filter((c) => CALL_CHANNELS.includes(c)), lang: p.lang === 'ru' ? 'ru' : 'uz',
      attemptNo: Number(job.attempts) || 1, maxAttempts: Number(job.maxAttempts) || 2,
      reason: typeof p.reason === 'string' ? p.reason.slice(0, 300) : undefined,
    }, queue.now());
  }, { concurrency: 2, maxAttempts: 6, backoffBaseMs: 15_000 });
}

export type CallbackOutcome = 'calling' | 'retry' | 'unreachable' | 'skipped';

/** Ish bajarilishi: birinchi mavjud qo'ng'iroq kanali; hech biri bo'lmasa — bot xabari bilan aniq sababi. */
export async function runCallback(p: {
  companyId: string; employeeId: string; correlationId: string; order: ChannelName[]; lang: 'uz' | 'ru'; attemptNo: number; maxAttempts: number;
  /** Nima uchun qayta qo'ng'iroq (owner 2026-10-19: AI qo'ng'iroq boshida sababini aytsin). */
  reason?: string;
}, now: Date): Promise<CallbackOutcome> {
  if (!p.companyId || !(await isAiActive(p.companyId))) return 'skipped';
  const u = await User.findOne({ _id: p.employeeId, companyId: p.companyId, isBlocked: { $ne: true } }).select('_id').lean().catch(() => null);
  if (!u) return 'skipped';
  const ctx: ChannelCtx = { companyId: p.companyId, employeeId: p.employeeId, correlationId: p.correlationId, purpose: 'assistant', lang: p.lang, now, attemptNo: p.attemptNo };
  let retry = false;
  const reasons: Partial<Record<ChannelName, string>> = {};
  for (const name of p.order) {
    const ch = getChannel(name);
    if (!ch) { reasons[name] = 'not_registered'; continue; }
    try {
      const av = await ch.isAvailable(ctx);
      if (!av.ok) {
        reasons[name] = av.reason || 'unavailable';
        if (TRANSIENT.has(String(av.reason))) retry = true;
        // Ilova yopiq — birinchi urinishda push, keyin ochilishini kutib qayta urinamiz
        if (name === 'inapp_call' && APP_WAKE.has(String(av.reason))) {
          retry = true;
          if (p.attemptNo === 1) await wakeApp(ctx);
        }
        continue;
      }
      const r = await ch.attempt(ctx, { kind: 'test', maxDurationSec: 600, ...(p.reason ? { text: p.reason } : {}) });
      if (r.sessionId || r.outcome === 'answered' || r.outcome === 'delivered') return 'calling';
      if (r.retryable || r.retryAt) retry = true;
      reasons[name] = r.errorCode || r.outcome;
    } catch (e) {
      retry = true;
      console.error('[aiVoice/callback] kanal xatosi:', (e as Error).message);
    }
  }
  if (retry && p.attemptNo < p.maxAttempts) throw new Error('callback_retry');
  // Qo'ng'iroq bo'lmadi — botda aniq sababini qisqa aytamiz (foydalanuvchi kutib qolmasin)
  const why = p.order.filter((c) => reasons[c]).map((c) => missingText(c, String(reasons[c]), p)).slice(0, 2).join('; ');
  await getChannel('bot_message')?.attempt(ctx, {
    kind: 'test',
    text: p.lang === 'ru' ? `AI не смог позвонить. Что нужно: ${why || 'попробуйте позже'}.` : `AI qo'ng'iroq qila olmadi. Nima kerak: ${why || "keyinroq urinib ko'ring"}.`,
  }).catch(() => undefined);
  return 'unreachable';
}

export const requestCallback: AiToolDef<{ channel?: 'inapp' | 'telegram'; delayMinutes?: number; when?: string; reason?: string }> = {
  name: 'requestCallback',
  description: {
    uz: "Foydalanuvchining O'ZIGA AI qo'ng'irog'i (\"menga qo'ng'iroq qil\"). channel: telegram yoki inapp (ilova); delayMinutes — necha daqiqadan keyin (\"bir minutdan keyin\" = 1); when — aniq vaqt (\"15:30\" yoki ISO, Toshkent). Hech biri bo'lmasa — hozir.",
    ru: 'Звонок AI самому пользователю («позвони мне»). channel: telegram или inapp; delayMinutes — через сколько минут; when — точное время («15:30» или ISO, Ташкент). Иначе — сейчас.',
  },
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', enum: ['inapp', 'telegram'] },
      delayMinutes: { type: 'integer', minimum: 0, maximum: 10080, description: 'Necha daqiqadan keyin' },
      when: { type: 'string', maxLength: 40, description: "Aniq vaqt: \"15:30\" yoki \"2026-10-16T15:30\" (Toshkent)" },
      reason: { type: 'string', maxLength: 300, description: "NIMA UCHUN qo'ng'iroq: suhbat mavzusi yoki eslatiladigan narsa (masalan \"sement buyurtmasini eslatish\", \"hisobotni gaplashish\"). Qo'ng'iroq boshida AI shuni aytadi." },
    },
  },
  kind: 'write',
  confirm: 'never',
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ASSIST,
  // Owner 2026-10-18: qo'ng'iroq ICHIDA ham ("1 minutdan keyin qayta qo'ng'iroq qil") — avval faqat chatdan edi
  channels: ['web', 'bot', 'telegram_call', 'inapp_call'],
  behavior: 'BLOCKING',
  auditEntity: 'ai_callback',
  auditAction: 'create',
  summarize: (a, lang) => {
    const at = a.when || (a.delayMinutes ? `+${a.delayMinutes} min` : '');
    return lang === 'ru' ? `Звонок AI${at ? ' ' + at : ''}` : `AI qo'ng'irog'i${at ? ' ' + at : ''}`;
  },
  handler: async (ctx, args) => {
    const q = getSharedQueue();
    if (!q) return { status: 'error', message: L(ctx, "Qo'ng'iroq xizmati hozir ishga tushmagan (server AI rejimida emas). Administratorga ayting.", 'Сервис звонков сейчас не запущен. Сообщите администратору.'), retryable: false };
    ensureCallbackJob(q);
    const now = q.now();
    // Qo'ng'iroq ichidan so'ralsa — joriy qo'ng'iroq tugashiga vaqt qolsin (kamida 45 s)
    const inCall = ctx.channel === 'telegram_call' || ctx.channel === 'inapp_call';
    let runAt = new Date(now.getTime() + (inCall ? IN_CALL_MIN_DELAY_MS : START_DELAY_MS));
    if (args.when) {
      const t = parseWhen(args.when, now);
      if (!t) return { status: 'error', message: L(ctx, "Vaqtni tushunmadim — masalan \"15:30\" deb ayting.", 'Не понял время — скажите, например, «15:30».'), retryable: false };
      if (t.getTime() > runAt.getTime()) runAt = t;
    } else if (args.delayMinutes) {
      runAt = new Date(Math.max(runAt.getTime(), now.getTime() + args.delayMinutes * 60_000));
    }
    if (runAt.getTime() - now.getTime() > MAX_AHEAD_MS) return { status: 'error', message: L(ctx, "Ko'pi bilan 7 kun oldinga qo'yish mumkin.", 'Не более чем на 7 дней вперёд.'), retryable: false };

    let order = callbackOrder(args.channel, ctx.channel);
    const lang = ctx.lang === 'ru' ? 'ru' : 'uz';
    const soon = runAt.getTime() - now.getTime() <= SOON_MS;
    const chCtx: ChannelCtx = { companyId: ctx.companyId, employeeId: ctx.userId, correlationId: ctx.correlationId, purpose: 'assistant', lang, now, attemptNo: 1 };
    const pre = await precheckChannels(chCtx, order);
    const first = order[0];
    const firstReason = pre.reasons[first];
    const transient = order.some((c) => TRANSIENT.has(String(pre.reasons[c])))
      // Ilova so'ralgan, lekin yopiq — push yuboriladi va ochilishi kutiladi (rad etilmaydi)
      || (order[0] === 'inapp_call' && APP_WAKE.has(String(pre.reasons.inapp_call)));

    // Qo'ng'iroq ichida kanal "band" ko'rinadi (aynan shu qo'ng'iroq) — bu to'siq emas
    if (soon && !pre.available.length && !transient && !inCall) {
      const need = order.map((c) => missingText(c, String(pre.reasons[c]), ctx));
      const msg = L(ctx, `Hozir qo'ng'iroq bo'lmaydi: ${need.join('; ')}.`, `Сейчас звонок невозможен: ${need.join('; ')}.`);
      return { status: 'error', message: msg, retryable: false, data: { missing: pre.reasons } };
    }
    // Hozir mavjud kanal birinchi bo'lsin (so'ralgan kanal mavjud bo'lmasa — boshqasi orqali)
    // (ilova aniq so'ralgan va u faqat yopiq bo'lsa — Telegram'ga almashtirmaymiz: push yuborib ilovani kutamiz)
    const wantsAppWake = args.channel === 'inapp' && APP_WAKE.has(String(pre.reasons.inapp_call));
    if (soon && pre.available.length && !pre.available.includes(first) && !wantsAppWake) order = [pre.available[0], ...order.filter((c) => c !== pre.available[0])];

    const r = await q.enqueue({
      type: CALLBACK_JOB, companyId: ctx.companyId, employeeId: ctx.userId, refId: ctx.userId,
      payload: {
        order, lang,
        // Sabab bo'lmasa ham AI qo'ng'iroqda nega qo'ng'iroq qilayotganini aytadi
        reason: (args.reason && String(args.reason).trim().slice(0, 300))
          || L(ctx, `foydalanuvchi ${args.when ? `soat ${args.when} da` : args.delayMinutes ? `${args.delayMinutes} daqiqadan keyin` : 'keyinroq'} qayta qo'ng'iroq qilishni so'ragan`, `пользователь попросил перезвонить ${args.when ? `в ${args.when}` : args.delayMinutes ? `через ${args.delayMinutes} мин` : 'позже'}`),
      },
      runAt, maxAttempts: 6, correlationId: ctx.correlationId,
      // Bir foydalanuvchiga 2 daqiqalik oynada bitta qo'ng'iroq (takror bosish / model takrori)
      dedupeKey: `aicb:${ctx.userId}:${Math.floor(runAt.getTime() / 120_000)}`,
    });
    const at = zonedParts(runAt);
    const via = order[0] === 'telegram_call' ? L(ctx, 'Telegram orqali', 'через Telegram') : L(ctx, 'ilova ichida', 'в приложении');
    let msg = soon
      ? L(ctx, `Hozir ${via} qo'ng'iroq qilaman.`, `Сейчас позвоню ${via}.`)
      : L(ctx, `${at.date === zonedParts(now).date ? '' : at.date + ' '}soat ${at.hhmm} da ${via} qo'ng'iroq qilaman.`, `Позвоню ${via} ${at.date === zonedParts(now).date ? '' : at.date + ' '}в ${at.hhmm}.`);
    if (order[0] !== first && firstReason) {
      const why = missingText(first, firstReason, ctx);
      msg += ' ' + (first === 'telegram_call'
        ? L(ctx, `(Telegram orqali emas: ${why}.)`, `(Не через Telegram: ${why}.)`)
        : L(ctx, `(Ilova orqali emas: ${why}.)`, `(Не в приложении: ${why}.)`));
    }
    if (order[0] === 'inapp_call' && APP_WAKE.has(String(pre.reasons.inapp_call)) && !pre.available.includes('inapp_call')) {
      msg = L(ctx, "Ilovaga bildirishnoma yuboraman — ilovani ochishingiz bilan qo'ng'iroq qilaman (2 daqiqa kutaman).",
        'Отправлю уведомление — позвоню, как только откроете приложение (жду 2 минуты).');
    } else if (!soon && !pre.available.length) {
      msg += ' ' + L(ctx, `Hozircha: ${missingText(order[0], String(pre.reasons[order[0]]), ctx)}.`, `Пока что: ${missingText(order[0], String(pre.reasons[order[0]]), ctx)}.`);
    }
    return ok(msg, { scheduledAt: runAt.toISOString(), localTime: at.hhmm, channel: order[0], duplicate: !!r?.duplicate });
  },
};
