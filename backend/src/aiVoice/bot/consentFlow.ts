import User from '../../models/User';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiChannelConnection from '../../models/AiChannelConnection';
import { setCallConsent } from '../consent';
import { sha256Hex } from '../lib/crypto';
import { isObjectIdString, newBindingCode, randomBase62 } from '../lib/ids';
import { sendToUser, type SendResult } from '../channels/botChannel';
import { getBotInstance } from './instance';
import { ta } from './i18n';
import { answer, closeButtons, consentData, type CallbackActor } from './guard';

// Qo'ng'iroq roziligi (ai:o:<token>:y|n, review A2/B5/B9). Rozilikni FAQAT xodimning o'zi beradi
// (consent.setCallConsent, ConsentLog source:'bot'). "Ha" bosilganda Telegram identifikatori
// query.from.id'dan olinadi va bir martalik bog'lash kodi (AI-4821) ko'rsatiladi — xodim uni AI
// Telegram akkauntiga yozadi, P6 worker kod xeshini (sha256(KOD)) tgUserId bilan solishtiradi.

export const CONSENT_TOKEN_TTL_MS = 7 * 24 * 3600_000;
export const BINDING_CODE_TTL_MS = 48 * 3600_000;
const CONSENT_TOKEN_RE = /^[A-Za-z0-9]{10,32}$/;
const USED_AT = new Date(0);
const TG_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/** Bog'lash kodi xeshi — worker ham aynan shunday hisoblaydi (katta harf, bo'shliqsiz). */
export function bindingCodeHash(code: string): string {
  return sha256Hex(String(code || '').trim().toUpperCase());
}

/** AI Telegram akkaunti username'i: platforma ulanishidan, bo'lmasa env AI_TG_ACCOUNT_USERNAME. */
export async function aiAccountUsername(): Promise<string | null> {
  const conn: any = await AiChannelConnection.findOne({ scope: 'platform', type: 'telegram_user' }).select('username').lean().catch(() => null);
  for (const raw of [conn?.username, process.env.AI_TG_ACCOUNT_USERNAME]) {
    const u = String(raw || '').trim().replace(/^@/, '');
    if (TG_USERNAME_RE.test(u)) return u;
  }
  return null;
}

/**
 * Xodimga rozilik so'rovini yuboradi (P3/P8 ham chaqiradi; botChannel kind:'consent').
 * Yangi token 7 kun amal qiladi; eski token almashtiriladi.
 */
export async function sendConsentRequest(p: { companyId: string; employeeId: string; now?: Date }): Promise<SendResult> {
  const now = p.now || new Date();
  if (!isObjectIdString(p.employeeId)) return { ok: false, code: 'no_user', retryable: false };
  const u: any = await User.findOne({ _id: p.employeeId, companyId: p.companyId, isBlocked: { $ne: true } }).select('language').lean();
  if (!u) return { ok: false, code: 'no_user', retryable: false };
  const token = randomBase62(16);
  await AiEmployeeContact.updateOne(
    { companyId: p.companyId, employeeId: p.employeeId },
    {
      $set: { 'telegram.consentToken': token, 'telegram.consentTokenExpiresAt': new Date(now.getTime() + CONSENT_TOKEN_TTL_MS) },
      $setOnInsert: { companyId: p.companyId, employeeId: p.employeeId },
    },
    { upsert: true },
  );
  await AiEmployeeContact.updateOne(
    { companyId: p.companyId, employeeId: p.employeeId, 'telegram.callConsent': { $in: ['none', null] } },
    { $set: { 'telegram.callConsent': 'requested' } },
  );
  return sendToUser(p.employeeId, ta(u.language, 'consentAsk'), {
    companyId: p.companyId,
    buttons: [[
      { text: ta(u.language, 'consentYes'), callback_data: consentData(token, 'y') },
      { text: ta(u.language, 'consentNo'), callback_data: consentData(token, 'n') },
    ]],
  });
}

export type ConsentPressResult =
  | { r: 'granted'; code: string; account: string | null }
  | { r: 'denied' }
  | { r: 'already' | 'forged' | 'expired' | 'tg_conflict' | 'error' };

/** Rozilik tugmasi: token bir marta ishlatiladi (atomik $unset), keyin setCallConsent. */
export async function recordConsentPress(a: Pick<CallbackActor, 'userId' | 'companyId' | 'fromId'>, token: string, v: string, now = new Date()): Promise<ConsentPressResult> {
  if (!CONSENT_TOKEN_RE.test(token) || (v !== 'y' && v !== 'n')) return { r: 'forged' };
  const ct: any = await AiEmployeeContact.findOne({ 'telegram.consentToken': token }).lean();
  if (!ct || String(ct.employeeId) !== a.userId || String(ct.companyId) !== a.companyId) return { r: 'forged' };
  // Ishlatilgan token muddati USED_AT (epoch) ga qo'yiladi — takroriy bosish "allaqachon" deb javob oladi
  const exp = ct.telegram?.consentTokenExpiresAt ? new Date(ct.telegram.consentTokenExpiresAt).getTime() : -1;
  if (exp === USED_AT.getTime()) return { r: 'already' };
  if (exp <= now.getTime()) return { r: 'expired' };
  const won = await AiEmployeeContact.findOneAndUpdate(
    { _id: ct._id, employeeId: a.userId, companyId: a.companyId, 'telegram.consentToken': token, 'telegram.consentTokenExpiresAt': { $gt: now } },
    { $set: { 'telegram.consentTokenExpiresAt': USED_AT } },
  ).lean();
  if (!won) return { r: 'already' };
  const res = await setCallConsent({
    companyId: a.companyId, employeeId: a.userId, actorUserId: a.userId, value: v === 'y' ? 'granted' : 'revoked',
    source: 'bot', tgUserId: v === 'y' ? a.fromId : undefined, now,
  });
  if (!res.ok) return { r: res.code === 'tg_conflict' ? 'tg_conflict' : 'error' };
  if (v === 'n') {
    await AiEmployeeContact.updateOne({ _id: ct._id }, { $unset: { 'telegram.bindingCodeHash': 1, 'telegram.bindingCodeExpiresAt': 1 } });
    return { r: 'denied' };
  }
  const code = newBindingCode();
  await AiEmployeeContact.updateOne(
    { _id: ct._id },
    { $set: { 'telegram.bindingCodeHash': bindingCodeHash(code), 'telegram.bindingCodeExpiresAt': new Date(now.getTime() + BINDING_CODE_TTL_MS) } },
  );
  return { r: 'granted', code, account: await aiAccountUsername() };
}

export async function handleConsentCallback(query: any, a: CallbackActor, parts: string[]): Promise<boolean> {
  const bot = getBotInstance();
  const out = parts.length === 4 ? await recordConsentPress(a, parts[2], parts[3]) : { r: 'forged' as const };
  switch (out.r) {
    case 'forged': await answer(bot, query.id, ta(a.lang, 'expired'), true); return true;
    case 'expired': await answer(bot, query.id, ta(a.lang, 'expired'), true); await closeButtons(bot, a, query); return true;
    case 'already': await answer(bot, query.id, ta(a.lang, 'already')); return true;
    case 'tg_conflict': await answer(bot, query.id, ta(a.lang, 'consentTgConflict'), true); await closeButtons(bot, a, query); return true;
    case 'error': await answer(bot, query.id, ta(a.lang, 'error'), true); return true;
    case 'denied':
      await answer(bot, query.id, ta(a.lang, 'consentNo'));
      await closeButtons(bot, a, query, ta(a.lang, 'consentDenied'));
      return true;
    case 'granted': {
      await answer(bot, query.id, ta(a.lang, 'consentGranted'));
      await closeButtons(bot, a, query, ta(a.lang, 'consentGranted'));
      if (bot) {
        const text = out.account
          ? ta(a.lang, 'consentBind', { code: out.code, account: `@${out.account}` })
          : ta(a.lang, 'consentBindNoAccount', { code: out.code });
        await bot.sendMessage(a.chatId, text, out.account
          ? { reply_markup: { inline_keyboard: [[{ text: ta(a.lang, 'consentOpenAccount'), url: `https://t.me/${out.account}` }]] } }
          : undefined).catch(() => undefined);
      }
      return true;
    }
  }
  return true;
}
