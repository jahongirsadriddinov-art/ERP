import User from '../../models/User';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import { aiConfig } from '../config';
import type { ChannelAdapter, ChannelAttemptResult, ChannelCtx, ChannelRequest } from '../contracts';
import { isObjectIdString } from '../lib/ids';
import { getBotInstance } from '../bot/instance';
import { ta, botLangOf } from '../bot/i18n';
import { attendanceKeyboard, callbackFits, confirmKeyboard, reminderKeyboard } from '../bot/guard';

// Telegram bot kanali (mavjud ERP boti orqali). bot.ts modul darajasida import QILINMAYDI —
// bot obyekti bot/instance.getBotInstance() orqali (DI). Natijalar:
//  • 403 (bot bloklangan) → kontaktga botBlockedAt yoziladi, 'unavailable' (keyingi kanalga);
//  • 429 retry_after → 'failed' + retryAt (navbat shu vaqtdan keyin qayta uradi);
//  • callback_data har biri ≤64 bayt (Telegram), oshsa yuborilmaydi.

export interface InlineButton { text: string; callback_data?: string; url?: string }
export interface SendOpts {
  buttons?: InlineButton[][];
  parseMode?: 'HTML' | 'MarkdownV2';
  /** Berilsa, xodim shu firmada bo'lishi shart (boshqa firmaga yuborilmaydi). */
  companyId?: string;
}

export type SendFailCode = 'no_bot' | 'no_user' | 'no_chat' | 'blocked' | 'rate_limited' | 'chat_not_found' | 'bad_request' | 'not_needed' | 'error';
export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; code: SendFailCode; retryable: boolean; retryAfterSec?: number };

/** Botni bloklagan xodimga qayta urinish oralig'i (u blokdan chiqargan bo'lishi mumkin). */
const BLOCKED_RECHECK_MS = 24 * 3600_000;
const TEXT_MAX = 4096;

/** node-telegram-bot-api xatosidan HTTP kodi va retry_after (log'ga matn/token chiqmaydi). */
export function classifyTelegramError(e: any): { status?: number; retryAfterSec?: number; description: string } {
  const body = e?.response?.body;
  const desc = String(body?.description || e?.message || '');
  let status: number | undefined = Number(body?.error_code || e?.response?.statusCode) || undefined;
  if (!status) {
    const m = /\b(4\d\d|5\d\d)\b/.exec(desc);
    if (m) status = Number(m[1]);
  }
  let retryAfterSec: number | undefined = Number(body?.parameters?.retry_after) || undefined;
  if (!retryAfterSec && status === 429) {
    const m = /retry after (\d+)/i.exec(desc);
    retryAfterSec = m ? Number(m[1]) : undefined;
  }
  return { status, retryAfterSec, description: desc.slice(0, 200) };
}

export function buttonsValid(buttons?: InlineButton[][]): boolean {
  if (!buttons) return true;
  if (!Array.isArray(buttons)) return false;
  return buttons.every((row) => Array.isArray(row) && row.every((b) =>
    b && typeof b.text === 'string' && b.text.length > 0
    && (b.callback_data !== undefined ? callbackFits(b.callback_data) : typeof b.url === 'string' && /^https:\/\//.test(b.url))));
}

async function markBotBlocked(companyId: string, employeeId: string, now = new Date()) {
  await AiEmployeeContact.updateOne(
    { companyId, employeeId },
    { $set: { botBlockedAt: now }, $setOnInsert: { companyId, employeeId } },
    { upsert: true },
  ).catch(() => undefined);
}

/**
 * Xodimga bot xabari. Muvaffaqiyatda Telegram message_id (string). Hech qachon throw qilmaydi.
 */
export async function sendToUser(userId: string, text: string, opts: SendOpts = {}): Promise<SendResult> {
  const bot = getBotInstance();
  if (!bot) return { ok: false, code: 'no_bot', retryable: true };
  if (!buttonsValid(opts.buttons)) return { ok: false, code: 'bad_request', retryable: false };
  if (!isObjectIdString(userId)) return { ok: false, code: 'no_user', retryable: false };
  const u: any = await User.findById(userId).select('telegramChatId companyId isBlocked').lean().catch(() => null);
  if (!u || u.isBlocked) return { ok: false, code: 'no_user', retryable: false };
  const companyId = u.companyId ? String(u.companyId) : '';
  if (opts.companyId && companyId !== String(opts.companyId)) return { ok: false, code: 'no_user', retryable: false };
  if (!u.telegramChatId) return { ok: false, code: 'no_chat', retryable: false };
  try {
    const msg = await bot.sendMessage(u.telegramChatId, String(text || '').slice(0, TEXT_MAX), {
      ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
      ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
      disable_web_page_preview: true,
    });
    if (companyId) {
      // Blokdan chiqargan — belgini tozalaymiz (faqat bor bo'lsa yoziladi)
      await AiEmployeeContact.updateOne({ companyId, employeeId: String(u._id), botBlockedAt: { $exists: true } }, { $unset: { botBlockedAt: 1 } }).catch(() => undefined);
    }
    return { ok: true, messageId: String(msg?.message_id ?? '') };
  } catch (e) {
    const { status, retryAfterSec, description } = classifyTelegramError(e);
    if (status === 403) {
      if (companyId) await markBotBlocked(companyId, String(u._id));
      return { ok: false, code: 'blocked', retryable: false };
    }
    if (status === 429) return { ok: false, code: 'rate_limited', retryable: true, retryAfterSec: Math.min(3600, Math.max(1, retryAfterSec || 5)) };
    if (status === 400 && /chat not found|user not found|deactivated/i.test(description)) return { ok: false, code: 'chat_not_found', retryable: false };
    if (status === 400) return { ok: false, code: 'bad_request', retryable: false };
    console.warn('[aiVoice/botChannel] yuborish xatosi:', status || '-', description.slice(0, 80));
    return { ok: false, code: 'error', retryable: true };
  }
}

/** Kanal mantig'i uchun: xodim shu firmada, bloklanmagan, Telegram'ga ulangan va botni bloklamagan. */
async function availability(c: ChannelCtx): Promise<{ ok: boolean; reason?: string; lang?: string }> {
  if (!aiConfig.enabled) return { ok: false, reason: 'disabled' };
  if (!getBotInstance()) return { ok: false, reason: 'no_bot' };
  if (!isObjectIdString(c.employeeId)) return { ok: false, reason: 'no_user' };
  const u: any = await User.findOne({ _id: c.employeeId, companyId: c.companyId }).select('telegramChatId isBlocked language').lean();
  if (!u || u.isBlocked) return { ok: false, reason: 'no_user' };
  if (!u.telegramChatId) return { ok: false, reason: 'no_chat' };
  const ct: any = await AiEmployeeContact.findOne({ companyId: c.companyId, employeeId: c.employeeId }).select('botBlockedAt optOut').lean();
  const blockedAt = ct?.botBlockedAt ? new Date(ct.botBlockedAt).getTime() : 0;
  if (blockedAt && c.now.getTime() - blockedAt < BLOCKED_RECHECK_MS) return { ok: false, reason: 'bot_blocked' };
  if (ct?.optOut?.all) return { ok: false, reason: 'opt_out' };
  if (c.purpose === 'reminder' && ct?.optOut?.reminders) return { ok: false, reason: 'opt_out' };
  return { ok: true, lang: u.language };
}

function compose(c: ChannelCtx, r: ChannelRequest, lang: unknown): { text: string; buttons?: InlineButton[][] } | { error: string } {
  const given = r.buttons?.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data })));
  const head = (t?: string) => [r.title, t].filter((x) => typeof x === 'string' && x.trim()).join('\n');
  switch (r.kind) {
    case 'attendance': {
      const buttons = given ?? (r.buttonToken ? attendanceKeyboard(r.buttonToken, lang) : undefined);
      if (!buttons) return { error: 'missing_button_token' };
      return { text: head(r.text) || ta(lang, 'attAsk'), buttons };
    }
    case 'reminder': {
      const buttons = given ?? (c.reminderId ? reminderKeyboard(c.reminderId, lang) : undefined);
      return { text: r.title ? head(r.text) : ta(lang, 'remTitle', { text: String(r.text || '') }), buttons };
    }
    case 'pending_action': {
      const buttons = given ?? (r.buttonToken ? confirmKeyboard(r.buttonToken, lang) : undefined);
      if (!buttons) return { error: 'missing_button_token' };
      return { text: ta(lang, 'pendingAsk', { summary: head(r.text) }), buttons };
    }
    default: {
      const text = head(r.text);
      if (!text) return { error: 'empty_text' };
      return { text, buttons: given };
    }
  }
}

export const botChannel: ChannelAdapter = {
  name: 'bot_message',

  async isAvailable(c) {
    const a = await availability(c).catch(() => ({ ok: false, reason: 'error' }));
    return a.ok ? { ok: true } : { ok: false, reason: a.reason };
  },

  async attempt(c, r): Promise<ChannelAttemptResult> {
    const a = await availability(c).catch(() => ({ ok: false, reason: 'error' } as { ok: boolean; reason?: string; lang?: string }));
    if (!a.ok) return { outcome: 'unavailable', retryable: a.reason === 'no_bot' || a.reason === 'error', errorCode: a.reason };
    const lang = botLangOf(a.lang || c.lang);   // botdagi tanlangan til (uz-cyrl ham) ustun

    if (r.kind === 'consent') {
      // Rozilik so'rovi o'z token'i bilan (ai:o) — consentFlow yaratadi (sikl bo'lmasligi uchun dinamik)
      const { sendConsentRequest } = await import('../bot/consentFlow');
      const s = await sendConsentRequest({ companyId: c.companyId, employeeId: c.employeeId, now: c.now });
      return mapSend(s, c.now);
    }
    const m = compose(c, r, lang);
    if ('error' in m) return { outcome: 'failed', retryable: false, errorCode: m.error };
    const s = await sendToUser(c.employeeId, m.text, { buttons: m.buttons, companyId: c.companyId });
    return mapSend(s, c.now);
  },
};

function mapSend(s: SendResult, now: Date): ChannelAttemptResult {
  if (s.ok) return { outcome: 'delivered', retryable: false, messageId: s.messageId };
  switch (s.code) {
    case 'rate_limited':
      return { outcome: 'failed', retryable: true, errorCode: 'rate_limited', retryAt: new Date(now.getTime() + (s.retryAfterSec || 5) * 1000) };
    case 'blocked': return { outcome: 'unavailable', retryable: false, errorCode: 'bot_blocked' };
    case 'no_user': case 'no_chat': case 'chat_not_found': return { outcome: 'unavailable', retryable: false, errorCode: s.code };
    case 'no_bot': return { outcome: 'unavailable', retryable: true, errorCode: 'no_bot' };
    case 'bad_request': return { outcome: 'failed', retryable: false, errorCode: 'bad_request' };
    // Owner 2026-10-16: rozilik so'rovi endi yuborilmaydi (kompaniya roziligi)
    case 'not_needed': return { outcome: 'unavailable', retryable: false, errorCode: 'not_needed' };
    default: return { outcome: 'failed', retryable: true, errorCode: 'telegram_error' };
  }
}

export default botChannel;
