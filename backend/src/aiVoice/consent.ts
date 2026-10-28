import AiEmployeeContact from '../models/AiEmployeeContact';
import ConsentLog from '../models/ConsentLog';
import User from '../models/User';
import { isObjectIdString } from './lib/ids';
import { getSettings } from './settings';

// Qo'ng'iroq roziligi va opt-out — YAGONA yozish/o'qish joyi.
// Owner 2026-10-16 (B9 o'rniga): rozilikni firma (egasi/direktor/o'rinbosar) BARCHA xodimlar nomidan beradi —
// AiAssistantSettings.calls.companyConsent (standart true). Samarali rozilik = companyConsent YOKI eski shaxsiy
// 'granted', MINUS opt-out (rahbar xodim uchun qo'yadi; eski xodim opt-out'lari ham hurmat qilinadi).
// Xodimlar AI sozlamalarini o'zgartirmaydi (/me PATCH — faqat rahbarlar o'zi uchun). Har o'zgarish ConsentLog'ga.

export type ConsentSource = 'bot' | 'me' | 'voice' | 'admin';

// ───────────── Samarali rozilik (yagona yordamchi) ─────────────
export type CallConsentReason = 'no_consent' | 'opt_out';
export interface CallConsentState {
  allowed: boolean;
  reason?: CallConsentReason;
  /** Rozilik manbai: firma sozlamasi yoki eski shaxsiy rozilik. */
  source?: 'company' | 'personal';
}

/** Firma sozlamasidan kompaniya roziligi (yo'q/noto'g'ri — standart true). */
export function companyConsentOf(settings: { calls?: { companyConsent?: unknown } } | null | undefined): boolean {
  return settings?.calls?.companyConsent !== false;
}

/**
 * Sof qaror (DB'siz). incoming=true — xodim o'zi qo'ng'iroq qilmoqda: faqat optOut.all to'sadi
 * (optOut.calls — AI'ning o'zi qo'ng'iroq qilmasligi haqida).
 */
export function evaluateCallConsent(companyConsent: boolean, ct: any, opts: { incoming?: boolean } = {}): CallConsentState {
  const personal = ct?.telegram?.callConsent === 'granted';
  // Owner 2026-10-28: xodim O'ZI qo'ng'iroq qilganda firma roziligi SHART EMAS — nomer terishning
  // o'zi rozilik. Sozlama ("Xodimlarga AI qo'ng'iroq qilishiga ruxsat") faqat AI'ning O'ZI qo'ng'iroq
  // qilishiga tegishli; ilgari u kiruvchi qo'ng'iroqni ham to'sib, xodim AI'ga qo'ng'iroq qilganda
  // worker "no_consent" bilan rad etardi (hech qanday tushuntirishsiz). optOut.all baribir to'sadi.
  if (!opts.incoming && !companyConsent && !personal) return { allowed: false, reason: 'no_consent' };
  const out = ct?.optOut;
  if (out?.all || (!opts.incoming && out?.calls)) return { allowed: false, reason: 'opt_out' };
  return { allowed: true, source: companyConsent ? 'company' : 'personal' };
}

/** DB'dan: firma sozlamasi + xodim kontakti. ct berilsa qayta o'qilmaydi. */
export async function getCallConsent(
  companyId: string, employeeId: string, opts: { incoming?: boolean; contact?: any } = {},
): Promise<CallConsentState> {
  const [settings, ct] = await Promise.all([
    getSettings(companyId),
    opts.contact !== undefined ? opts.contact
      : AiEmployeeContact.findOne({ companyId, employeeId }).select('telegram.callConsent optOut').lean(),
  ]);
  return evaluateCallConsent(companyConsentOf(settings), ct, opts);
}

/** Bir nechta firma uchun kompaniya roziligi (ro'yxatlar uchun). */
export async function companyConsentMap(companyIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  await Promise.all([...new Set(companyIds)].map(async (id) => { out.set(id, companyConsentOf(await getSettings(id))); }));
  return out;
}

/** Firma qo'ng'iroq roziligi o'zgarishi — ConsentLog (huquqiy iz). Sozlama o'zi settings.saveSettings orqali. */
export async function logCompanyConsent(p: { companyId: string; actorUserId: string; value: boolean; ip?: string; userAgent?: string; now?: Date }): Promise<void> {
  await ConsentLog.create({
    userId: p.actorUserId, companyId: p.companyId, consentType: 'ai_call_company', version: COMPANY_CONSENT_VERSION,
    acceptedAt: p.now || new Date(), value: p.value ? 'granted' : 'revoked', source: 'admin', ip: p.ip, userAgent: p.userAgent,
  });
}

/**
 * Rahbar xodim uchun opt-out qo'yadi/olib tashlaydi (admin PATCH /employees). Ruxsat tekshiruvi — chaqiruvchida
 * (o'rinbosar egasi/direktorni o'zgartira olmaydi).
 */
export async function setOptOutByBoss(p: {
  companyId: string; employeeId: string; actorUserId: string; calls?: boolean; reminders?: boolean; all?: boolean; now?: Date;
}): Promise<ConsentChangeResult> {
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
  set['optOut.via'] = `admin:${String(p.actorUserId).slice(0, 24)}`;
  await AiEmployeeContact.updateOne(
    { companyId: p.companyId, employeeId: p.employeeId },
    { $set: set, $setOnInsert: { companyId: p.companyId, employeeId: p.employeeId } },
    { upsert: true },
  );
  const anyOut = p.calls === true || p.reminders === true || p.all === true;
  await ConsentLog.create({
    userId: p.employeeId, companyId: p.companyId, consentType: 'ai_opt_out', version: OPT_OUT_VERSION,
    acceptedAt: now, value: anyOut ? 'opt_out' : 'opt_in', source: 'admin',
  });
  return { ok: true };
}
export type ConsentChangeResult =
  | { ok: true }
  | { ok: false; code: 'not_self' | 'not_found' | 'tg_conflict' | 'bad_request' };

const CALL_CONSENT_VERSION = 'ai_call_v1';
const OPT_OUT_VERSION = 'ai_opt_out_v1';
const COMPANY_CONSENT_VERSION = 'ai_call_company_v1';

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
