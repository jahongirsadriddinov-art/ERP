import AiCallSession from '../../../models/AiCallSession';
import User from '../../../models/User';
import { finishSession } from '../../sessions';
import type { ChannelCtx, ChannelName } from '../../contracts';
import { getChannel } from '../../channels/registry';
import { captureError } from '../../../services/errorTracker';
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
/** Qorovul: qo'ng'iroq ishi navbatga tushdi-yu, hech narsa bo'lmasa — shu ish xabar beradi. */
export const CALLBACK_WATCH_JOB = 'ai.callback.watch';
/** Shuncha vaqtdan keyin tekshiriladi (qayta urinishlarga ham vaqt qolsin). */
const WATCH_AFTER_MS = 180_000;
const MAX_AHEAD_MS = 7 * 24 * 3600_000;
const START_DELAY_MS = 5_000;          // AI javobi foydalanuvchiga yetib borsin
const IN_CALL_MIN_DELAY_MS = 45_000;    // qo'ng'iroq ichidan: avval joriy qo'ng'iroq tugasin
const SOON_MS = 90_000;                 // shundan yaqin — "hozir" (kanal hozir mavjud bo'lishi kerak)
const CALL_CHANNELS: ChannelName[] = ['inapp_call', 'telegram_call'];
/** Bir oz kutib o'tib ketadigan sabablar — qo'ng'iroq baribir navbatga qo'yiladi. */
const TRANSIENT = new Set(['not_on_this_instance', 'flood_wait', 'account_busy', 'worker_not_here', 'peer_limited', 'import_limited', 'rate_limited']);
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
  // Sabab qo'shimcha tafsilot bilan kelishi mumkin: "account_restricted:spam_limited:<ms>"
  // (owner 2026-10-29: "qilolmasa nimaga ligini aniq aytsin").
  const [head, detail, untilMs] = String(reason || '').split(':');
  if (head === 'account_restricted') {
    const kind = detail === 'spam_limited'
      ? l('spam cheklovi', 'спам-ограничение')
      : detail === 'frozen' ? l('muzlatilgan', 'заморожен')
      : detail === 'banned' ? l('bloklangan', 'заблокирован')
      : detail === 'unauthorized' ? l('tizimdan chiqib ketgan', 'разлогинен')
      : l('cheklov', 'ограничение');
    const when = Number(untilMs) > Date.now()
      ? ` (${new Date(Number(untilMs)).toLocaleString(c.lang === 'ru' ? 'ru-RU' : 'uz-UZ', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ${l('gacha', 'до')})`
      : '';
    return l(`AI Telegram akkauntiga ${kind} qo'yilgan${when} — shu sababli qo'ng'iroq qila olmayapti`,
      `На Telegram-аккаунте AI ${kind}${when} — поэтому звонок невозможен`);
  }
  if (ch === 'telegram_call') {
    switch (reason) {
      case 'no_consent': return l("AI qo'ng'iroqlari rahbariyat tomonidan o'chirilgan", 'звонки AI отключены руководством');
      case 'not_bound': return l("ERP botiga telefon raqamingizni ulashing (shunda Telegram'ingiz ulanadi)", 'поделитесь номером телефона в ERP-боте (так подключится ваш Telegram)');
      case 'peer_limited':
      case 'import_limited':
        // Worker raqamni Telegram akkauntiga kontakt sifatida kiritishi kerak;
        // bu ataylab soatiga bir necha marta bilan cheklangan (akkaunt bloklanmasin).
        return l("raqamingiz AI Telegram akkauntiga hali kiritilmagan — bu soatlik cheklov bilan navbatda turibdi, tez orada o'zi bo'ladi",
          'ваш номер ещё не добавлен в Telegram-аккаунт AI — стоит в очереди из-за часового лимита, скоро будет');
      case 'flood_wait': return l("Telegram vaqtinchalik cheklov qo'ygan — biroz kutish kerak", 'Telegram временно ограничил — нужно немного подождать');
      case 'not_resolved': return l("AI Telegram'ingizni hali topa olmadi — ERP botidagi telefon raqamingiz Telegram raqamingiz bilan bir xil bo'lsin", 'AI пока не нашёл ваш Telegram — номер в ERP-боте должен совпадать с номером Telegram');
      case 'blocked': return l("Telegram'da AI akkauntini blokdan chiqaring", 'разблокируйте AI-аккаунт в Telegram');
      case 'privacy_restricted': return l("Telegram maxfiylik sozlamasida qo'ng'iroqlarga ruxsat bering", 'разрешите звонки в настройках конфиденциальности Telegram');
      case 'opt_out': return l("rahbariyat siz uchun AI qo'ng'iroqlarini o'chirgan", 'руководство отключило для вас звонки AI');
      case 'account_not_connected': return l("AI Telegram akkaunti hali ulanmagan (administrator ulaydi)", 'Telegram-аккаунт AI ещё не подключён (подключает администратор)');
      case 'worker_offline': return l("Telegram qo'ng'iroq xizmati hozir o'chiq", 'сервис звонков Telegram сейчас выключен');
      case 'daily_cap': case 'company_quota': return l("bugungi Telegram qo'ng'iroqlar limiti tugagan", 'дневной лимит звонков Telegram исчерпан');
      case 'busy': return l("oldingi qo'ng'iroq hali tugamagan", 'предыдущий звонок ещё не завершён');
      case 'account_busy': return l("AI hozir boshqa qo'ng'iroqda", 'AI сейчас в другом звонке');
      case 'worker_offline': case 'worker_not_here': return l("Telegram qo'ng'iroq xizmati qayta ulanmoqda", 'сервис звонков Telegram переподключается');
      case 'not_registered': return l("Telegram qo'ng'iroqlari hali yoqilmagan", 'звонки Telegram ещё не включены');
      default: return l("Telegram qo'ng'irog'i hozir mavjud emas", 'звонок в Telegram сейчас недоступен');
    }
  }
  switch (reason) {
    case 'offline': return l("ilova yoki sayt yopiq — ilovani oching", 'приложение закрыто — откройте приложение');
    case 'not_visible': return l("ilova oynasini ochiq qoldiring", 'держите окно приложения открытым');
    case 'busy': return l("oldingi qo'ng'iroq hali tugamagan", 'предыдущий звонок ещё не завершён');
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
  // DIQQAT: bu yerda "allaqachon ro'yxatda" deb butun funksiyadan chiqib ketib
  // bo'lmaydi — pastdagi qorovul ishlovchisi ham ro'yxatga olinmay qolardi.
  // Shuning uchun har bir tur ALOHIDA tekshiriladi.
  if (!q.registeredTypes().includes(CALLBACK_JOB)) {
  q.register(CALLBACK_JOB, async ({ job, queue }) => {
    // Kutilmagan xato (baza uzilishi, kod xatosi) runCallback ichidagi xabarlarga
    // yetib bormasdan tashlanardi — foydalanuvchi esa jim qolardi. Oxirgi urinishda
    // bu ham aytiladi (owner 2026-10-30: "xatolikni ham aytmayapti").
    const lastTry = (Number(job.attempts) || 1) >= (Number(job.maxAttempts) || 2);
    const p = (job.payload || {}) as { order?: ChannelName[]; lang?: 'uz' | 'ru'; reason?: string; userRequested?: boolean };
    await runCallback({
      companyId: String(job.companyId || ''), employeeId: String(job.employeeId || ''), correlationId: job.correlationId || newCorrelationId(),
      order: (p.order || []).filter((c) => CALL_CHANNELS.includes(c)), lang: p.lang === 'ru' ? 'ru' : 'uz',
      attemptNo: Number(job.attempts) || 1, maxAttempts: Number(job.maxAttempts) || 2,
      reason: typeof p.reason === 'string' ? p.reason.slice(0, 300) : undefined,
      // Foydalanuvchi o'zi so'raganmi (requestCallback) yoki AI o'zi chaqiryaptimi
      // (companyAlerts) — rozilik tekshiruvi shunga qarab farq qiladi.
      userRequested: !!p.userRequested,
    }, queue.now()).catch(async (e) => {
      const msg = String((e as Error)?.message || e);
      if (msg === 'callback_retry' || !lastTry) throw e;
      console.error('[aiVoice/callback] kutilmagan xato:', msg.slice(0, 200));
      await notifyCallbackFailure(String(job.companyId || ''), String(job.employeeId || ''), p.lang === 'ru' ? 'ru' : 'uz', msg);
      throw e;
    });
  }, { concurrency: 2, maxAttempts: 6, backoffBaseMs: 15_000 });
  }

  // ── QOROVUL ──────────────────────────────────────────────────────────────
  // Owner 2026-10-30: AI "hozir Telegram orqali qo'ng'iroq qilaman" dedi (bu
  // vositaning O'Z xabari, ya'ni ish navbatga ROSTDAN tushgan), lekin na
  // qo'ng'iroq keldi, na xato xabari. runCallback ichidagi har bir yo'l xabar
  // beradi — demak ish UMUMAN BAJARILMAGAN (navbat turib qolgan, server qayta
  // ishga tushgan, ishlovchi ro'yxatga olinmagan va h.k.). Bunday holatda
  // hech kim hech narsa aytmaydi va foydalanuvchi abadiy kutadi.
  //
  // Endi har bir qo'ng'iroq ishi bilan birga shu qorovul qo'yiladi: 3 daqiqadan
  // keyin ishning HOLATINI o'qiydi va bajarilmagan bo'lsa — holati bilan birga
  // aytadi. Shu tariqa "jim qolish" holati butunlay yo'qoladi.
  if (!q.registeredTypes().includes(CALLBACK_WATCH_JOB)) {
    q.register(CALLBACK_WATCH_JOB, async ({ job }) => {
      const p = (job.payload || {}) as { jobId?: string; lang?: 'uz' | 'ru' };
      const lang = p.lang === 'ru' ? 'ru' : 'uz';
      const companyId = String(job.companyId || '');
      const employeeId = String(job.employeeId || '');
      if (!p.jobId || !companyId || !employeeId) return;

      const AiJob = (await import('../../../models/AiJob')).default;
      const target: any = await AiJob.findById(p.jobId).select('status attempts maxAttempts lastError runAt').lean().catch(() => null);

      // 'done' — runCallback oxirigacha ishladi: yo qo'ng'iroq qildi, yo sababini aytdi
      if (target?.status === 'done') return;

      const state = !target ? "yozuv yo'q"
        : `${target.status}, urinish ${target.attempts || 0}/${target.maxAttempts || 0}${target.lastError ? `, oxirgi xato: ${String(target.lastError).slice(0, 120)}` : ''}`;
      console.warn(`[aiVoice/callback] QOROVUL: ish ${p.jobId} bajarilmadi — ${state}`);

      const text = lang === 'ru'
        ? `Звонок так и не состоялся из-за технической причины. Мы уже знаем об этом (${state}).`
        : `Qo'ng'iroq texnik sabab tufayli amalga oshmadi. Xato qayd etildi (${state}).`;
      await getChannel('bot_message')?.attempt({
        companyId, employeeId, correlationId: job.correlationId || newCorrelationId(),
        purpose: 'assistant', lang, now: new Date(), attemptNo: 1,
      }, { kind: 'test', text }).catch(() => undefined);

      void captureError({
        source: 'server', kind: 'ai-callback',
        message: `Qo'ng'iroq ishi bajarilmadi (qorovul): ${state}`.slice(0, 300),
        route: '/ai/callback', method: 'POST', companyId, userId: employeeId, silent: true,
      });
    }, { concurrency: 1, maxAttempts: 2 });
  }
}

/** Qo'ng'iroq ishiga qorovul qo'yadi. Xatosi asosiy oqimni hech qachon buzmaydi. */
async function armWatchdog(q: JobQueue, p: { jobId: string; companyId: string; employeeId: string; lang: 'uz' | 'ru'; runAt: Date; correlationId?: string }): Promise<void> {
  try {
    await q.enqueue({
      type: CALLBACK_WATCH_JOB, companyId: p.companyId, employeeId: p.employeeId, refId: p.jobId,
      payload: { jobId: p.jobId, lang: p.lang },
      runAt: new Date(p.runAt.getTime() + WATCH_AFTER_MS),
      maxAttempts: 2, correlationId: p.correlationId,
      dedupeKey: `aicbw:${p.jobId}`,
    });
  } catch (e) {
    console.warn("[aiVoice/callback] qorovul qo'yilmadi:", String((e as Error)?.message || e).slice(0, 120));
  }
}

export type CallbackOutcome = 'calling' | 'retry' | 'unreachable' | 'skipped';

/** Kutilmagan xatoda foydalanuvchiga xabar + Xatolar paneliga yozuv. */
async function notifyCallbackFailure(companyId: string, employeeId: string, lang: 'uz' | 'ru', why: string): Promise<void> {
  const ctx: ChannelCtx = {
    companyId, employeeId, correlationId: newCorrelationId(),
    purpose: 'assistant', lang, now: new Date(), attemptNo: 1,
  };
  await getChannel('bot_message')?.attempt(ctx, {
    kind: 'test',
    text: lang === 'ru' ? 'AI не смог позвонить из-за технической ошибки. Мы уже знаем об этом.'
      : "AI texnik xato tufayli qo'ng'iroq qila olmadi. Xato qayd etildi.",
  }).catch(() => undefined);
  void captureError({
    source: 'server', kind: 'ai-callback',
    message: `Qo'ng'iroq ishi xato bilan tugadi: ${why}`.slice(0, 300),
    route: '/ai/callback', method: 'POST', companyId, userId: employeeId, silent: true,
  });
}

/**
 * Xodimning bazada "faol" qolgan, lekin hech qayerda tirik bo'lmagan qo'ng'iroq sessiyasi — yopiladi
 * (aks holda "bitta xodim — bitta faol qo'ng'iroq" qoidasi qayta qo'ng'iroqni 'busy' qilib qo'yadi).
 * Haqiqatan davom etayotgan qo'ng'iroqqa tegilmaydi (shu jarayonda tirik yoki yaqinda yangilangan).
 */
export async function reapStaleSessionOf(companyId: string, employeeId: string, now: Date): Promise<boolean> {
  const s: any = await AiCallSession.findOne({ companyId, employeeId, isActive: true }).select('_id updatedAt answeredAt').lean().catch(() => null);
  if (!s) return false;
  const sid = String(s._id);
  // sessionManager kechiktirib yuklanadi (tools ↔ voice import sikli bo'lmasin)
  const { getVoiceSessionManager } = await import('../../voice/sessionManager');
  if (getVoiceSessionManager().get(sid)) return false;                     // shu jarayonda tirik
  if (s.updatedAt && now.getTime() - new Date(s.updatedAt).getTime() < 45_000) return false;
  const ok = await finishSession(sid, s.answeredAt ? 'interrupted' : 'failed', 'callback:stale', { errorCode: 'stale', now }).catch(() => null);
  return !!ok;
}

/** Qayta urinish yordam bermaydigan sabablar: holat soatlab yoki rahbar aralashmaguncha o'zgarmaydi. */
const HOPELESS = /^(account_restricted|not_bound|not_resolved|no_consent|opt_out|privacy_restricted|blocked|account_not_connected|not_registered|daily_cap|company_quota|developer_unsupported)/;

/** Ish bajarilishi: birinchi mavjud qo'ng'iroq kanali; hech biri bo'lmasa — bot xabari bilan aniq sababi. */
export async function runCallback(p: {
  companyId: string; employeeId: string; correlationId: string; order: ChannelName[]; lang: 'uz' | 'ru'; attemptNo: number; maxAttempts: number;
  /** Nima uchun qayta qo'ng'iroq (owner 2026-10-19: AI qo'ng'iroq boshida sababini aytsin). */
  reason?: string;
  /** Foydalanuvchining o'zi so'ragan qo'ng'iroq — firma roziligi sozlamasi to'smaydi. */
  userRequested?: boolean;
}, now: Date): Promise<CallbackOutcome> {
  const ctx: ChannelCtx = { companyId: p.companyId, employeeId: p.employeeId, correlationId: p.correlationId, purpose: 'assistant', lang: p.lang, now, attemptNo: p.attemptNo, userRequested: !!p.userRequested };
  // Owner 2026-10-29: "AI baribir telefon qilmayapti, botga ham kelmayapti — xato nima,
  // nega qo'ng'iroq qilmagani?". Sabab shu yerda edi: quyidagi ikki tekshiruv JIM
  // 'skipped' qaytarardi — na qo'ng'iroq bo'lardi, na biror xabar. Foydalanuvchi esa
  // "hozir qo'ng'iroq qilaman" degan va'dani olib, abadiy kutib qolardi.
  // Endi HAR QANDAY to'xtash sababi botda aytiladi.
  const tell = async (text: string) => {
    const ok = await getChannel('bot_message')?.attempt(ctx, { kind: 'test', text })
      .then((r) => r?.outcome === 'delivered' || r?.outcome === 'answered')
      .catch(() => false);
    if (!ok) console.warn('[aiVoice/callback] sababni botda ayta olmadik:', text.slice(0, 120));
    // Owner 2026-10-30: "haliyam qaytib telefon qilmayapti, xatolikni ham aytmayapti".
    // Bot xabari yetib bormasligi mumkin (bloklangan, chat yo'q, Telegram xatosi) —
    // shunda sabab BUTUNLAY yo'qolardi. Endi u Dasturchi paneli → Xatolar bo'limiga
    // ham tushadi, ya'ni hech qachon izsiz qolmaydi.
    void captureError({
      source: 'server', kind: 'ai-callback',
      message: `Qo'ng'iroq bajarilmadi: ${text}`.slice(0, 300),
      route: '/ai/callback', method: 'POST',
      companyId: String(p.companyId || ''), userId: String(p.employeeId || ''),
      silent: true,     // Telegramga yana xabar ketmasin — foydalanuvchiga allaqachon aytilgan
    });
  };

  if (!p.companyId || !(await isAiActive(p.companyId))) {
    await tell(p.lang === 'ru' ? 'AI-звонки сейчас отключены для компании.' : "Qo'ng'iroq bo'lmadi: firmada AI hozir o'chiq.");
    return 'skipped';
  }
  const u = await User.findOne({ _id: p.employeeId, companyId: p.companyId, isBlocked: { $ne: true } }).select('_id').lean().catch(() => null);
  if (!u) {
    await tell(p.lang === 'ru' ? 'Звонок не выполнен: сотрудник не найден или заблокирован.' : "Qo'ng'iroq bo'lmadi: xodim topilmadi yoki bloklangan.");
    return 'skipped';
  }
  console.log(`[aiVoice/callback] ish boshlandi urinish=${p.attemptNo}/${p.maxAttempts} kanal=${p.order.join('>')}`);
  await reapStaleSessionOf(p.companyId, p.employeeId, now).catch(() => false);
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
  console.warn(`[aiVoice/callback] urinish ${p.attemptNo}/${p.maxAttempts}: ${JSON.stringify(reasons)}`);
  // Owner 2026-10-29: AI "hozir Telegram orqali telefon qilaman" dedi, lekin na qo'ng'iroq
  // keldi, na biror xabar. Sabab: akkauntga spam cheklovi qo'yilgan edi — bu bir necha
  // soatlik holat, lekin tizim shunga qaramay 6 marta qayta urinardi va foydalanuvchi
  // shuncha vaqt javobsiz kutardi. Qayta urinish FOYDA BERMAYDIGAN sabablarda darhol
  // to'xtab, sababini aytamiz (kutib qolishdan ko'ra, bilib turish yaxshi).
  const allHopeless = p.order.length > 0 && p.order.every((c) => reasons[c] && HOPELESS.test(String(reasons[c])));
  if (allHopeless) retry = false;
  if (retry && p.attemptNo < p.maxAttempts) {
    // Owner 2026-10-30: AI "hozir qo'ng'iroq qilaman" dedi va JIM qoldi.
    // Sabab: kechiktiriladigan holatda (masalan worker jurnalidagi
    // "tgw.peers: import chegarasi (soatiga 3) — ...0710 keyinroq") tizim
    // jimgina qayta urinardi — 6 urinish, orada kutish, foydalanuvchi esa
    // hech narsa bilmasdi. Endi BIRINCHI urinishdayoq sababi aytiladi,
    // qayta urinish esa baribir davom etadi.
    if (p.attemptNo === 1) {
      const why = p.order.filter((c) => reasons[c]).map((c) => missingText(c, String(reasons[c]), p)).slice(0, 2).join('; ');
      await tell(p.lang === 'ru'
        ? `Звонок пока не прошёл: ${why || 'временное ограничение'}. Продолжаю пробовать и позвоню, как только получится.`
        : `Qo'ng'iroq hozircha bo'lmadi: ${why || "vaqtinchalik cheklov"}. Urinishda davom etaman — imkon bo'lishi bilan qo'ng'iroq qilaman.`);
    }
    throw new Error('callback_retry');
  }
  // Qo'ng'iroq bo'lmadi — botda aniq sababini qisqa aytamiz (foydalanuvchi kutib qolmasin)
  const why = p.order.filter((c) => reasons[c]).map((c) => missingText(c, String(reasons[c]), p)).slice(0, 2).join('; ');
  await tell(p.lang === 'ru' ? `AI не смог позвонить. Что нужно: ${why || 'попробуйте позже'}.` : `AI qo'ng'iroq qila olmadi. Nima kerak: ${why || "keyinroq urinib ko'ring"}.`);
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
    // Foydalanuvchining O'ZI so'ragan qo'ng'iroq — firma roziligi sozlamasi ("AI xodimlarga
    // qo'ng'iroq qilsinmi") buni to'smaydi: so'rashning o'zi rozilik (owner 2026-10-28).
    const chCtx: ChannelCtx = { companyId: ctx.companyId, employeeId: ctx.userId, correlationId: ctx.correlationId, purpose: 'assistant', lang, now, attemptNo: 1, userRequested: true };
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
        order, lang, userRequested: true,
        // Sabab bo'lmasa ham AI qo'ng'iroqda nega qo'ng'iroq qilayotganini aytadi
        reason: (args.reason && String(args.reason).trim().slice(0, 300))
          || L(ctx, `foydalanuvchi ${args.when ? `soat ${args.when} da` : args.delayMinutes ? `${args.delayMinutes} daqiqadan keyin` : 'keyinroq'} qayta qo'ng'iroq qilishni so'ragan`, `пользователь попросил перезвонить ${args.when ? `в ${args.when}` : args.delayMinutes ? `через ${args.delayMinutes} мин` : 'позже'}`),
      },
      runAt, maxAttempts: 6, correlationId: ctx.correlationId,
      // Bir foydalanuvchiga 2 daqiqalik oynada bitta qo'ng'iroq (takror bosish / model takrori)
      dedupeKey: `aicb:${ctx.userId}:${Math.floor(runAt.getTime() / 120_000)}`,
    });
    // Navbatga tushganini logda ko'rsatamiz: "qo'ng'iroq qilaman" deyilgan, lekin ish
    // umuman yaratilmagan holatni (takror/dedupe) shusiz aniqlab bo'lmaydi.
    console.log(`[aiVoice/callback] navbatga qo'yildi id=${r.id} takror=${r.duplicate} kanal=${order.join('>')} vaqt=${runAt.toISOString()}`);
    // Ish bajarilmay qolsa — qorovul xabar beradi (yuqoridagi izohga qarang)
    if (!r.duplicate) await armWatchdog(q, { jobId: r.id, companyId: ctx.companyId, employeeId: ctx.userId, lang, runAt, correlationId: ctx.correlationId });
    if (r.duplicate) {
      return ok(L(ctx, "Qo'ng'iroq allaqachon navbatda — bir necha soniyada bo'ladi.",
        'Звонок уже в очереди — будет через несколько секунд.'));
    }
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
