import AiEmployeeContact from '../models/AiEmployeeContact';
import ConsentLog from '../models/ConsentLog';
import User from '../models/User';
import { isObjectIdString } from './lib/ids';

// Qo'ng'iroq roziligi va opt-out — YAGONA yozish joyi (review B9). Rozilikni FAQAT xodimning o'zi
// o'zgartiradi: bot tugmasi (P4, ai:o:) yoki /me PATCH (P3). Admin yo'llari bu funksiyani chaqirmaydi
// (PATCH /employees consent/optOut maydonlarini rad etadi — P8). Har o'zgarish ConsentLog'ga yoziladi.

export type ConsentSource = 'bot' | 'me' | 'voice';
export type ConsentChangeResult =
  | { ok: true }
  | { ok: false; code: 'not_self' | 'not_found' | 'tg_conflict' | 'bad_request' };

const CALL_CONSENT_VERSION = 'ai_call_v1';
const OPT_OUT_VERSION = 'ai_opt_out_v1';

async function employeeInCompany(companyId: string, employeeId: string): Promise<boolean> {
  if (!isObjectIdString(employeeId)) return false;
  return !!(await User.exists({ _id: employeeId, companyId, isBlocked: { $ne: true } }));
}

/**
 * Qo'ng'iroq roziligi. actorUserId === employeeId bo'lishi SHART. tgUserId (bot'dagi query.from.id)
 * berilsa bog'lanadi — bitta Telegram identifikatori ikki xodimga bog'lanmaydi (unique partial indeks).
 */
export async function setCallConsent(p: {
  companyId: string; employeeId: string; actorUserId: string; value: 'granted' | 'revoked'; source: ConsentSource;
  tgUserId?: string; ip?: string; userAgent?: string; now?: Date;
}): Promise<ConsentChangeResult> {
  if (String(p.actorUserId) !== String(p.employeeId)) return { ok: false, code: 'not_self' };
  if (p.value !== 'granted' && p.value !== 'revoked') return { ok: false, code: 'bad_request' };
  if (p.tgUserId !== undefined && !/^\d{1,20}$/.test(String(p.tgUserId))) return { ok: false, code: 'bad_request' };
  if (!(await employeeInCompany(p.companyId, p.employeeId))) return { ok: false, code: 'not_found' };
  const now = p.now || new Date();
  const set: Record<string, unknown> = { 'telegram.callConsent': p.value, 'telegram.consentAt': now };
  if (p.tgUserId) set['telegram.tgUserId'] = String(p.tgUserId);
  try {
    await AiEmployeeContact.updateOne(
      { companyId: p.companyId, employeeId: p.employeeId },
      { $set: set, $setOnInsert: { companyId: p.companyId, employeeId: p.employeeId } },
      { upsert: true },
    );
  } catch (e: any) {
    if (e?.code === 11000) return { ok: false, code: 'tg_conflict' };
    throw e;
  }
  await ConsentLog.create({
    userId: p.employeeId, companyId: p.companyId, consentType: 'ai_call', version: CALL_CONSENT_VERSION,
    acceptedAt: now, value: p.value, source: p.source, telegramUserId: p.tgUserId, ip: p.ip, userAgent: p.userAgent,
  });
  return { ok: true };
}

/** Opt-out (qo'ng'iroqlar / eslatmalar / hammasi). Faqat o'zi uchun. */
export async function setOptOut(p: {
  companyId: string; employeeId: string; actorUserId: string; source: ConsentSource;
  calls?: boolean; reminders?: boolean; all?: boolean; now?: Date;
}): Promise<ConsentChangeResult> {
  if (String(p.actorUserId) !== String(p.employeeId)) return { ok: false, code: 'not_self' };
  const set: Record<string, unknown> = {};
  for (const k of ['calls', 'reminders', 'all'] as const) {
    if (p[k] === undefined) continue;
    if (typeof p[k] !== 'boolean') return { ok: false, code: 'bad_request' };
    set[`optOut.${k}`] = p[k];
  }
  if (!Object.keys(set).length) return { ok: false, code: 'bad_request' };
  if (!(await employeeInCompany(p.companyId, p.employeeId))) return { ok: false, code: 'not_found' };
  const now = p.now || new Date();
  set['optOut.at'] = now;
  set['optOut.via'] = p.source;
  await AiEmployeeContact.updateOne(
    { companyId: p.companyId, employeeId: p.employeeId },
    { $set: set, $setOnInsert: { companyId: p.companyId, employeeId: p.employeeId } },
    { upsert: true },
  );
  const anyOut = p.calls === true || p.reminders === true || p.all === true;
  await ConsentLog.create({
    userId: p.employeeId, companyId: p.companyId, consentType: 'ai_opt_out', version: OPT_OUT_VERSION,
    acceptedAt: now, value: anyOut ? 'opt_out' : 'opt_in', source: p.source,
  });
  return { ok: true };
}
