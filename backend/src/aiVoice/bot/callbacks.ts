import Attendance from '../../models/Attendance';
import { tb, type BotLang } from '../../i18n/bot';
import { confirmPendingAction } from '../tools/executor';
import { respondAttendance, reminderAction } from '../scheduler/api';
import { isObjectIdString } from '../lib/ids';
import { localDate } from '../lib/zonedTime';
import { getBotInstance } from './instance';
import { ta, aiLangOf } from './i18n';
import {
  ATT_TOKEN_RE, CONFIRM_TOKEN_RE, answer, closeButtons, type AttendanceChoice, type CallbackActor,
} from './guard';

// ai:a (davomat), ai:r (eslatma), ai:x (amal tasdig'i) tugmalari. Holat o'tishlari P1 muzlatgan
// paketlararo API orqali (scheduler/api: respondAttendance, reminderAction — P3; executor.confirmPendingAction):
// yozuv SHU xodim va SHU firmaga bog'langan, token muddati, ATOMIK o'tish (takroriy bosish — "allaqachon
// qayd etilgan"). AI Attendance'ni HECH QACHON yozmaydi — tasdiqdan keyin mavjud check-in tugmasi
// (confirm_checkin → jonli joylashuv → geofence) ko'rsatiladi.

const WORKER_ROLES = ['ishchi', 'prorab', 'brigadir'];
const ANSWER: Record<AttendanceChoice, 'confirm' | 'late' | 'decline'> = { c: 'confirm', l: 'late', d: 'decline' };
const LABEL = { c: 'attBtnConfirm', l: 'attBtnLate', d: 'attBtnDecline' } as const;

export type AttendancePressResult = 'ok' | 'already' | 'expired' | 'forged';

/** Davomat tugmasi → scheduler/api.respondAttendance (buttonToken + xodim + firma bog'langan). */
export async function recordAttendancePress(a: Pick<CallbackActor, 'userId' | 'companyId'>, token: string, choice: AttendanceChoice, now = new Date()): Promise<AttendancePressResult> {
  if (!ATT_TOKEN_RE.test(token) || !ANSWER[choice]) return 'forged';
  const r = await respondAttendance({ companyId: a.companyId, employeeId: a.userId, buttonToken: token, answer: ANSWER[choice], via: 'bot', at: now });
  if (r.ok) return r.already ? 'already' : 'ok';
  if (r.code === 'expired' || r.code === 'finalized') return 'expired';
  if (r.code === 'not_implemented') console.warn('[aiVoice/bot] respondAttendance hali amalga oshirilmagan');
  return 'forged';
}

export async function handleAttendanceCallback(query: any, a: CallbackActor, parts: string[]): Promise<boolean> {
  const bot = getBotInstance();
  const [, , token = '', choice = ''] = parts;
  const r = parts.length === 4 ? await recordAttendancePress(a, token, choice as AttendanceChoice) : 'forged';
  if (r === 'forged' || r === 'expired') {
    await answer(bot, query.id, ta(a.lang, 'expired'), true);
    if (r === 'expired') await closeButtons(bot, a, query);
    return true;
  }
  if (r === 'already') { await answer(bot, query.id, ta(a.lang, 'already')); return true; }

  const c = choice as AttendanceChoice;
  await answer(bot, query.id, ta(a.lang, LABEL[c]));
  await closeButtons(bot, a, query, ta(a.lang, 'attChosen', { answer: ta(a.lang, LABEL[c]) }));
  if (!bot) return true;
  if (c === 'd') {
    await bot.sendMessage(a.chatId, ta(a.lang, 'attSavedDecline')).catch(() => undefined);
    return true;
  }
  await bot.sendMessage(a.chatId, ta(a.lang, c === 'c' ? 'attSavedConfirm' : 'attSavedLate')).catch(() => undefined);
  // Mavjud check-in oqimi: faqat ishchi rollari va bugun hali kelmagan bo'lsa
  if (WORKER_ROLES.includes(a.role)) {
    const already = await Attendance.exists({ userId: a.userId, date: localDate(), checkIn: { $exists: true, $nin: [null, ''] } }).catch(() => null);
    if (!already) {
      const lang = (a.lang === 'ru' || a.lang === 'uz-cyrl' ? a.lang : 'uz') as BotLang;
      await bot.sendMessage(a.chatId, ta(a.lang, 'attCheckInHint'), {
        reply_markup: { inline_keyboard: [[{ text: tb(lang, 'kb_checkIn'), callback_data: 'confirm_checkin' }]] },
      }).catch(() => undefined);
    }
  }
  return true;
}

// ───────────── Eslatma: ai:r:<id>:d|s ─────────────
const SNOOZE_MIN = 10;

export type ReminderPressResult = 'done' | 'snoozed' | 'already' | 'forged' | 'expired';

/** Eslatma tugmasi → scheduler/api.reminderAction (faqat eslatma maqsadi, shu firma). */
export async function recordReminderPress(a: Pick<CallbackActor, 'userId' | 'companyId'>, reminderId: string, action: string, now = new Date()): Promise<ReminderPressResult> {
  if (!isObjectIdString(reminderId) || (action !== 'd' && action !== 's')) return 'forged';
  const r = await reminderAction({
    companyId: a.companyId, userId: a.userId, reminderId, action: action === 'd' ? 'done' : 'snooze',
    snoozeMin: SNOOZE_MIN, via: 'bot', at: now,
  });
  if (!r.ok) {
    if (r.code === 'not_implemented') console.warn('[aiVoice/bot] reminderAction hali amalga oshirilmagan');
    return 'forged';
  }
  if (r.already) return 'already';
  return action === 'd' ? 'done' : 'snoozed';
}

export async function handleReminderCallback(query: any, a: CallbackActor, parts: string[]): Promise<boolean> {
  const bot = getBotInstance();
  const r = parts.length === 4 ? await recordReminderPress(a, parts[2], parts[3]) : 'forged';
  if (r === 'forged' || r === 'expired') {
    await answer(bot, query.id, ta(a.lang, 'expired'), true);
    if (r === 'expired') await closeButtons(bot, a, query);
    return true;
  }
  if (r === 'already') { await answer(bot, query.id, ta(a.lang, 'already')); return true; }
  const msg = ta(a.lang, r === 'done' ? 'remDone' : 'remSnoozed');
  await answer(bot, query.id, msg);
  await closeButtons(bot, a, query, msg);
  return true;
}

// ───────────── Amal tasdig'i: ai:x:<token>:y|n ─────────────
export async function handleConfirmCallback(query: any, a: CallbackActor, parts: string[]): Promise<boolean> {
  const bot = getBotInstance();
  const token = parts[2] || '';
  const v = parts[3];
  if (parts.length !== 4 || !CONFIRM_TOKEN_RE.test(token) || (v !== 'y' && v !== 'n')) {
    await answer(bot, query.id, ta(a.lang, 'expired'), true);
    return true;
  }
  // Atomik: needs_confirmation → confirmed/cancelled faqat bitta chaqiruvda; aktyor/firma/kanal bog'langan (B3)
  const out = await confirmPendingAction({
    token, actorUserId: a.userId, companyId: a.companyId, channel: 'bot', accept: v === 'y', lang: aiLangOf(a.lang),
  });
  const gone = out.result.status === 'error' && !out.auditId;
  const text = gone ? ta(a.lang, 'pendingGone') : String(out.result.message || '').slice(0, 3500);
  await answer(bot, query.id, gone ? ta(a.lang, 'pendingGone') : undefined, gone);
  await closeButtons(bot, a, query, gone ? undefined : text);
  if (gone && bot) await bot.sendMessage(a.chatId, text).catch(() => undefined);
  return true;
}
