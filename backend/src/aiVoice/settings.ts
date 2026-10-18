import AiAssistantSettings from '../models/AiAssistantSettings';
import AiEmployeeContact from '../models/AiEmployeeContact';
import Company from '../models/Company';
import User from '../models/User';
import { companyHasFeature } from '../middleware/requireFeature';
import { runWithTenant } from '../middleware/tenantContext';
import { aiConfig, AI_TIMEZONE, LIMITS } from './config';
import { AI_ROLES, CHANNEL_NAMES, type AiSchedulePatch, type AiSettingsData, type AiShift, type ChannelName } from './contracts';
import { isObjectIdString } from './lib/ids';
import { addDays, isHHmm, isIsoDate, localDate, parseHHmm, shiftHHmm } from './lib/zonedTime';
import { validateToolsMatrix } from './tools/rbac';
import { DEFAULT_AVATAR, DEFAULT_PERSONA, mergeAvatar, mergePersona, validateAvatar, validatePersona } from './persona';

// AI sozlamalari: standart qiymatlar bilan birlashtirish, 10 s kesh, isAiActive, PUT validatori
// (kod chegaralari: timezone qulflangan, recordAudio=false, tools matritsasi shiftdan oshmaydi).

export const AI_FEATURE_KEY = 'ai_assistant';

/** Suhbat/transkriptlar bazada shuncha kun turadi, keyin faylga arxivlanib o'chiriladi (owner 2026-10-15). */
export const TRANSCRIPT_DB_DAYS = 7;
/** AiCallEvent TTL (transcriptRetentionDays) kamida shuncha — arxiv ishi bir necha kun to'xtasa ham ma'lumot yo'qolmaydi. */
export const TRANSCRIPT_TTL_MIN_DAYS = 14;

export function defaultShift(id = 'main'): AiShift {
  return {
    id, name: 'Asosiy smena', objectIds: [], roles: ['ishchi', 'prorab', 'brigadir'],
    workStart: '08:00', callLeadMin: 0, callTime: '08:00',
    workdays: [1, 2, 3, 4, 5, 6], lateAfterMin: 15, absentCutoff: '12:00', buttonWaitMin: 10,
    maxLateMin: 60, skipDates: [], extraWorkDates: [],
  };
}

export function defaultSettings(companyId: string): AiSettingsData {
  return {
    companyId,
    enabled: false,
    language: 'uz',
    voiceName: 'Kore',
    timezone: AI_TIMEZONE,
    persona: { ...DEFAULT_PERSONA },
    avatar: { ...DEFAULT_AVATAR },
    attendance: { enabled: false, suppressLegacyMorningReminder: true, orinbosarCanEditSchedule: true, shifts: [defaultShift()] },
    calls: {
      maxAttemptsPerChannel: 2, backoffMin: [3, 10], ringTimeoutSec: 45, maxDurationSec: 120,
      assistantMaxDurationSec: 600, companyConcurrency: 3, minGapSec: 20, quietHours: { from: '21:00', to: '07:00' },
      companyConsent: true,
    },
    // A1: bot xabari doim 1-qadam, Telegram qo'ng'irog'i faqat eskalatsiya
    fallbackOrder: ['bot_message', 'telegram_call', 'inapp_call', 'push', 'notify_manager'],
    reminders: { defaultLeadMin: 0, defaultChannels: ['bot_message', 'push'], maxActivePerUser: 50 },
    tools: { byRole: {}, allowOffShiftAssistant: false },
    provider: { primary: 'gemini_live', fallback: 'gemini_cascade' },
    // llm-provider.md (owner 2026-10-13): Gemini asosiy → OpenRouter zaxira; Claude faqat kalit bo'lsa
    brain: { provider: 'gemini', fallback: 'openrouter', effort: 'low' },
    limits: {
      userSessionsPerHour: 6, companyMinutesPerDay: 120, monthlyBudgetUsd: 20, hardStop: true,
      botMsgsPer10Min: 20, toolCallsPerSession: 30, workerCallCooldownSec: 90,
    },
    privacy: { recordAudio: false, transcriptRetentionDays: 30, auditRetentionDays: 365 },
    version: 0,
  };
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = <T>(v: unknown, ok: (x: unknown) => boolean, def: T): T => (ok(v) ? (v as T) : def);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const bool = (v: unknown) => typeof v === 'boolean';
const str = (v: unknown) => typeof v === 'string';
const arr = (v: unknown) => Array.isArray(v);

/** AI so'rov vaqti = workStart − callLeadMin (yarim tundan oldinga o'tmaydi). */
export function deriveCallTime(workStart: string, callLeadMin: number): string {
  return shiftHHmm(workStart, -Math.max(0, callLeadMin || 0));
}

const leadOk = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 180;

function mergeShift(s: any, i: number): AiShift {
  const d = defaultShift(isObj(s) && str(s.id) ? s.id : `shift${i + 1}`);
  if (!isObj(s)) return d;
  // Eski yozuvlar: faqat callTime bo'lsa — u ish boshlanishi deb olinadi
  const workStart = isHHmm(s.workStart) ? s.workStart : isHHmm(s.callTime) ? s.callTime : d.workStart;
  const callLeadMin = pick(s.callLeadMin, leadOk, d.callLeadMin);
  return {
    id: d.id,
    name: pick(s.name, str, d.name),
    objectIds: pick(s.objectIds, arr, d.objectIds),
    roles: pick(s.roles, arr, d.roles),
    workStart,
    callLeadMin,
    callTime: deriveCallTime(workStart, callLeadMin),
    workdays: pick(s.workdays, arr, d.workdays),
    lateAfterMin: pick(s.lateAfterMin, num, d.lateAfterMin),
    absentCutoff: pick(s.absentCutoff, isHHmm, d.absentCutoff),
    buttonWaitMin: pick(s.buttonWaitMin, num, d.buttonWaitMin),
    maxLateMin: pick(s.maxLateMin, num, d.maxLateMin),
    skipDates: pick(s.skipDates, arr, d.skipDates),
    extraWorkDates: pick(s.extraWorkDates, arr, d.extraWorkDates),
  };
}

/** Bazadagi (yoki qisman) hujjatni to'liq shaklga keltiradi. Noto'g'ri turdagi qiymat → standart. */
export function mergeDefaults(companyId: string, doc: any): AiSettingsData {
  const d = defaultSettings(companyId);
  if (!isObj(doc)) return d;
  const att = isObj(doc.attendance) ? doc.attendance : {};
  const calls = isObj(doc.calls) ? doc.calls : {};
  const rem = isObj(doc.reminders) ? doc.reminders : {};
  const tools = isObj(doc.tools) ? doc.tools : {};
  const prov = isObj(doc.provider) ? doc.provider : {};
  const brain = isObj(doc.brain) ? doc.brain : {};
  const lim = isObj(doc.limits) ? doc.limits : {};
  const priv = isObj(doc.privacy) ? doc.privacy : {};
  return {
    companyId,
    enabled: pick(doc.enabled, bool, d.enabled),
    language: pick(doc.language, (v) => v === 'uz' || v === 'ru' || v === 'auto', d.language),
    voiceName: pick(doc.voiceName, str, d.voiceName),
    timezone: AI_TIMEZONE,                                           // C7: qulflangan
    ...(str(doc.disclosureText) && doc.disclosureText ? { disclosureText: doc.disclosureText } : {}),
    persona: mergePersona(doc.persona),
    avatar: mergeAvatar(doc.avatar),
    attendance: {
      enabled: pick(att.enabled, bool, d.attendance.enabled),
      suppressLegacyMorningReminder: pick(att.suppressLegacyMorningReminder, bool, d.attendance.suppressLegacyMorningReminder),
      orinbosarCanEditSchedule: pick(att.orinbosarCanEditSchedule, bool, d.attendance.orinbosarCanEditSchedule),
      shifts: arr(att.shifts) ? att.shifts.map(mergeShift) : d.attendance.shifts,
    },
    calls: {
      maxAttemptsPerChannel: pick(calls.maxAttemptsPerChannel, num, d.calls.maxAttemptsPerChannel),
      backoffMin: pick(calls.backoffMin, arr, d.calls.backoffMin),
      ringTimeoutSec: pick(calls.ringTimeoutSec, num, d.calls.ringTimeoutSec),
      maxDurationSec: pick(calls.maxDurationSec, num, d.calls.maxDurationSec),
      assistantMaxDurationSec: pick(calls.assistantMaxDurationSec, num, d.calls.assistantMaxDurationSec),
      companyConcurrency: pick(calls.companyConcurrency, num, d.calls.companyConcurrency),
      minGapSec: pick(calls.minGapSec, num, d.calls.minGapSec),
      quietHours: isObj(calls.quietHours) && isHHmm(calls.quietHours.from) && isHHmm(calls.quietHours.to)
        ? { from: calls.quietHours.from, to: calls.quietHours.to } : d.calls.quietHours,
      companyConsent: pick(calls.companyConsent, bool, d.calls.companyConsent),
    },
    fallbackOrder: arr(doc.fallbackOrder) && doc.fallbackOrder.length ? doc.fallbackOrder : d.fallbackOrder,
    reminders: {
      defaultLeadMin: pick(rem.defaultLeadMin, num, d.reminders.defaultLeadMin),
      defaultChannels: pick(rem.defaultChannels, arr, d.reminders.defaultChannels),
      maxActivePerUser: pick(rem.maxActivePerUser, num, d.reminders.maxActivePerUser),
    },
    tools: {
      byRole: isObj(tools.byRole) ? tools.byRole : {},
      allowOffShiftAssistant: pick(tools.allowOffShiftAssistant, bool, d.tools.allowOffShiftAssistant),
    },
    provider: {
      primary: pick(prov.primary, (v) => v === 'gemini_live' || v === 'gemini_cascade', d.provider.primary),
      fallback: pick(prov.fallback, (v) => v === 'gemini_cascade' || v === 'none', d.provider.fallback),
      ...(str(prov.liveModel) ? { liveModel: prov.liveModel } : {}),
      ...(str(prov.textModel) ? { textModel: prov.textModel } : {}),
      ...(str(prov.ttsModel) ? { ttsModel: prov.ttsModel } : {}),
      ...(str(prov.transcribeModel) ? { transcribeModel: prov.transcribeModel } : {}),
    },
    brain: {
      provider: pick(brain.provider, (v) => v === 'gemini' || v === 'claude', d.brain.provider),
      fallback: pick(brain.fallback, (v) => v === 'openrouter' || v === 'none', d.brain.fallback),
      effort: pick(brain.effort, (v) => v === 'low' || v === 'medium' || v === 'high', d.brain.effort),
    },
    limits: {
      userSessionsPerHour: pick(lim.userSessionsPerHour, num, d.limits.userSessionsPerHour),
      companyMinutesPerDay: pick(lim.companyMinutesPerDay, num, d.limits.companyMinutesPerDay),
      monthlyBudgetUsd: pick(lim.monthlyBudgetUsd, num, d.limits.monthlyBudgetUsd),
      hardStop: pick(lim.hardStop, bool, d.limits.hardStop),
      botMsgsPer10Min: pick(lim.botMsgsPer10Min, num, d.limits.botMsgsPer10Min),
      toolCallsPerSession: pick(lim.toolCallsPerSession, num, d.limits.toolCallsPerSession),
      workerCallCooldownSec: pick(lim.workerCallCooldownSec, num, d.limits.workerCallCooldownSec ?? 90),
    },
    privacy: {
      recordAudio: false,                                            // v1: qulflangan
      // Owner 2026-10-15: suhbatlar 7 kundan keyin arxivlanadi; TTL faqat zaxira — arxivdan oldin o'chirmasin
      transcriptRetentionDays: Math.max(TRANSCRIPT_TTL_MIN_DAYS, pick(priv.transcriptRetentionDays, num, d.privacy.transcriptRetentionDays)),
      auditRetentionDays: pick(priv.auditRetentionDays, num, d.privacy.auditRetentionDays),
    },
    version: pick(doc.version, num, 0),
    ...(str(doc.updatedBy) ? { updatedBy: doc.updatedBy } : {}),
  };
}

// ───────────── Kesh ─────────────
const cache = new Map<string, { at: number; data: AiSettingsData }>();
let cacheTtlMs = LIMITS.settingsCacheMs;

export async function getSettings(companyId: string): Promise<AiSettingsData> {
  const c = cache.get(companyId);
  if (c && Date.now() - c.at < cacheTtlMs) return c.data;
  const doc = await AiAssistantSettings.findOne({ companyId }).lean();
  const data = mergeDefaults(companyId, doc);
  cache.set(companyId, { at: Date.now(), data });
  return data;
}

export function invalidateSettings(companyId?: string) {
  if (companyId) { cache.delete(companyId); companyStateCache.delete(companyId); } else { cache.clear(); companyStateCache.clear(); }
}

/** Faqat testlar uchun. */
export function __setSettingsCacheTtlForTests(ms: number) { cacheTtlMs = ms; }

// ───────────── Firma holati (status + tarif funksiyasi), ≤10 s kesh ─────────────
export interface CompanyAiState { exists: boolean; active: boolean; hasFeature: boolean; name: string }
const companyStateCache = new Map<string, { at: number; data: CompanyAiState }>();

/** Fail-closed: firma topilmasa, faol bo'lmasa yoki tarifda ai_assistant bo'lmasa — false. */
export async function getCompanyAiState(companyId: string): Promise<CompanyAiState> {
  const c = companyStateCache.get(companyId);
  if (c && Date.now() - c.at < cacheTtlMs) return c.data;
  let data: CompanyAiState = { exists: false, active: false, hasFeature: false, name: '' };
  if (isObjectIdString(companyId)) {
    const co: any = await Company.findById(companyId).select('status name').lean();
    if (co) {
      // Mavjud fail-closed tekshiruv (requireFeature.companyHasFeature) — shu firma konteksti ichida
      const hasFeature = await runWithTenant({ userId: 'ai-system', role: 'system', companyId, isDeveloper: false },
        () => companyHasFeature(AI_FEATURE_KEY));
      data = {
        exists: true,
        active: (co.status || 'ACTIVE') === 'ACTIVE',
        hasFeature,
        name: String(co.name || ''),
      };
    }
  }
  companyStateCache.set(companyId, { at: Date.now(), data });
  return data;
}

/** AI shu firma uchun ishlay oladimi: global env + sozlama + firma holati + tarif. */
export async function isAiActive(companyId: string): Promise<boolean> {
  if (!aiConfig.enabled || !companyId) return false;
  const st = await getCompanyAiState(companyId);
  if (!st.exists || !st.active || !st.hasFeature) return false;
  return (await getSettings(companyId)).enabled;
}

// ───────────── Validator (PUT /settings, P8) ─────────────
const TOP_KEYS = new Set(['enabled', 'language', 'voiceName', 'timezone', 'disclosureText', 'persona', 'avatar', 'attendance', 'calls',
  'fallbackOrder', 'reminders', 'tools', 'provider', 'brain', 'limits', 'privacy', 'version', 'companyId', 'updatedBy']);
const MODEL_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Kompaniya qo'ng'iroq roziligini kim o'zgartira oladi (owner 2026-10-16). */
export function canEditCompanyConsent(editor: { role: string; isOwner: boolean }): boolean {
  return editor.isOwner || editor.role === 'direktor' || editor.role === 'orinbosar';
}

const intIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const numIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function uniqueValid<T>(list: unknown, valid: (x: unknown) => boolean): list is T[] {
  return Array.isArray(list) && list.every(valid) && new Set(list as unknown[]).size === list.length;
}

function validateShift(s: AiShift, i: number, errors: string[]) {
  const p = `attendance.shifts[${i}]`;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(s.id)) errors.push(`${p}.id: noto'g'ri`);
  if (typeof s.name !== 'string' || s.name.length > 60) errors.push(`${p}.name: ≤60 belgi`);
  if (!Array.isArray(s.objectIds) || s.objectIds.length > 200 || !s.objectIds.every(isObjectIdString)) errors.push(`${p}.objectIds: noto'g'ri`);
  if (!uniqueValid(s.roles, (r) => (AI_ROLES as unknown[]).includes(r)) || !s.roles.length) errors.push(`${p}.roles: noto'g'ri`);
  if (!isHHmm(s.workStart)) errors.push(`${p}.workStart: HH:mm`);
  if (!leadOk(s.callLeadMin)) errors.push(`${p}.callLeadMin: 0..180`);
  else if (isHHmm(s.workStart) && parseHHmm(s.workStart) < s.callLeadMin) errors.push(`${p}.callLeadMin: so'rov vaqti yarim tundan oldin bo'lib qoladi`);
  if (!isHHmm(s.absentCutoff)) errors.push(`${p}.absentCutoff: HH:mm`);
  if (isHHmm(s.workStart) && isHHmm(s.absentCutoff) && parseHHmm(s.absentCutoff) <= parseHHmm(s.workStart)) {
    errors.push(`${p}.absentCutoff: workStart'dan keyin bo'lishi kerak`);
  }
  // Kamida bitta hafta kuni (bot, ilova va sayt bir xil qoida): hammasini o'chirish tasodifan davomatni to'xtatmasin
  if (!uniqueValid(s.workdays, (d) => intIn(d, 1, 7)) || !s.workdays.length) errors.push(`${p}.workdays: 1..7 (ISO), takrorsiz, kamida bittasi`);
  if (!intIn(s.lateAfterMin, 0, 240)) errors.push(`${p}.lateAfterMin: 0..240`);
  if (!intIn(s.buttonWaitMin, 1, 120)) errors.push(`${p}.buttonWaitMin: 1..120`);
  if (!intIn(s.maxLateMin, 0, 360)) errors.push(`${p}.maxLateMin: 0..360`);
  for (const k of ['skipDates', 'extraWorkDates'] as const) {
    const list = s[k];
    if (!uniqueValid(list, isIsoDate) || list.length > 366) errors.push(`${p}.${k}: YYYY-MM-DD, takrorsiz, ≤366`);
  }
  if (Array.isArray(s.skipDates) && Array.isArray(s.extraWorkDates) && s.skipDates.some((d) => s.extraWorkDates.includes(d))) {
    errors.push(`${p}: bir sana ham skipDates, ham extraWorkDates'da bo'lishi mumkin emas`);
  }
}

export type SettingsValidation = { ok: true; value: AiSettingsData } | { ok: false; errors: string[] };

/**
 * Qisman yangilanishni joriy sozlamaga qo'llaydi va to'liq natijani tekshiradi.
 * Massivlar (shifts, fallbackOrder ...) to'liq almashtiriladi.
 */
export function validateSettingsUpdate(
  patch: unknown,
  current: AiSettingsData,
  editor: { role: string; isOwner: boolean },
): SettingsValidation {
  const errors: string[] = [];
  if (!isObj(patch)) return { ok: false, errors: ["so'rov tanasi object bo'lishi kerak"] };
  for (const k of Object.keys(patch)) if (!TOP_KEYS.has(k)) errors.push(`${k}: noma'lum maydon`);
  if (patch.timezone !== undefined && patch.timezone !== AI_TIMEZONE) errors.push(`timezone: v1'da faqat ${AI_TIMEZONE}`);
  if (isObj(patch.privacy) && patch.privacy.recordAudio !== undefined && patch.privacy.recordAudio !== false) {
    errors.push("privacy.recordAudio: v1'da yoqib bo'lmaydi");
  }
  if (patch.tools !== undefined && !isObj(patch.tools)) errors.push('tools: object kerak');
  if (isObj(patch.tools)) errors.push(...validateToolsMatrix(patch.tools.byRole as any, current.tools.byRole, editor));
  const topBoss = editor.isOwner || editor.role === 'direktor';
  if (isObj(patch.attendance) && patch.attendance.orinbosarCanEditSchedule !== undefined
    && patch.attendance.orinbosarCanEditSchedule !== current.attendance.orinbosarCanEditSchedule && !topBoss) {
    errors.push("attendance.orinbosarCanEditSchedule: faqat direktor yoki firma egasi o'zgartira oladi");
  }

  const sec = (k: string) => (isObj(patch[k]) ? patch[k] : undefined);
  for (const k of ['attendance', 'calls', 'reminders', 'provider', 'brain', 'limits', 'privacy']) {
    if (patch[k] !== undefined && !isObj(patch[k])) errors.push(`${k}: object kerak`);
  }
  const merged: any = {
    ...current,
    ...pickDefined(patch, ['enabled', 'language', 'voiceName', 'disclosureText', 'fallbackOrder']),
    persona: isObj(patch.persona) ? { ...(current.persona || DEFAULT_PERSONA), ...patch.persona } : current.persona,
    avatar: isObj(patch.avatar) ? { ...(current.avatar || DEFAULT_AVATAR), ...patch.avatar } : current.avatar,
    attendance: { ...current.attendance, ...(sec('attendance') || {}) },
    calls: { ...current.calls, ...(sec('calls') || {}) },
    reminders: { ...current.reminders, ...(sec('reminders') || {}) },
    tools: { ...current.tools, ...(sec('tools') || {}), byRole: { ...current.tools.byRole, ...((sec('tools')?.byRole as object) || {}) } },
    provider: { ...current.provider, ...(sec('provider') || {}) },
    brain: { ...current.brain, ...(sec('brain') || {}) },
    limits: { ...current.limits, ...(sec('limits') || {}) },
    privacy: { ...current.privacy, ...(sec('privacy') || {}), recordAudio: false },
    timezone: AI_TIMEZONE,
    companyId: current.companyId,
    version: current.version,
  };

  if (!bool(merged.enabled)) errors.push('enabled: boolean');
  if (!['uz', 'ru', 'auto'].includes(merged.language)) errors.push('language: uz|ru|auto');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(merged.voiceName))) errors.push("voiceName: noto'g'ri");
  if (merged.disclosureText !== undefined && (typeof merged.disclosureText !== 'string' || merged.disclosureText.length > 300)) errors.push('disclosureText: ≤300 belgi');
  validatePersona(patch.persona === undefined ? undefined : merged.persona, errors);
  validateAvatar(patch.avatar === undefined ? undefined : merged.avatar, errors);

  const a = merged.attendance;
  if (!bool(a.enabled) || !bool(a.suppressLegacyMorningReminder) || !bool(a.orinbosarCanEditSchedule)) errors.push('attendance: boolean maydonlar');
  if (!Array.isArray(a.shifts) || a.shifts.length > 10) errors.push('attendance.shifts: ≤10 ta');
  else {
    a.shifts = a.shifts.map((s: any, i: number) => {
      if (!isObj(s)) return s;
      const base = { ...defaultShift(String(s.id ?? `shift${i + 1}`)), ...s };
      // Eski mijoz faqat callTime yuborsa — u ish boshlanishi; callTime keyin qayta hisoblanadi
      if (s.workStart === undefined && s.callTime !== undefined) base.workStart = s.callTime;
      return base;
    });
    a.shifts.forEach((s: any, i: number) => (isObj(s) ? validateShift(s as AiShift, i, errors) : errors.push(`attendance.shifts[${i}]: object kerak`)));
    const ids = a.shifts.map((s: any) => s?.id);
    if (new Set(ids).size !== ids.length) errors.push('attendance.shifts: id takrorlangan');
  }

  const c = merged.calls;
  if (!intIn(c.maxAttemptsPerChannel, 1, 5)) errors.push('calls.maxAttemptsPerChannel: 1..5');
  if (!Array.isArray(c.backoffMin) || !c.backoffMin.length || c.backoffMin.length > 5 || !c.backoffMin.every((x: unknown) => intIn(x, 1, 120))) errors.push('calls.backoffMin: 1..5 ta, 1..120');
  if (!intIn(c.ringTimeoutSec, 15, 90)) errors.push('calls.ringTimeoutSec: 15..90');
  if (!intIn(c.maxDurationSec, 30, 600)) errors.push('calls.maxDurationSec: 30..600');
  if (!intIn(c.assistantMaxDurationSec, 60, 1800)) errors.push('calls.assistantMaxDurationSec: 60..1800');
  if (!intIn(c.companyConcurrency, 1, 10)) errors.push('calls.companyConcurrency: 1..10');
  if (!intIn(c.minGapSec, 0, 600)) errors.push('calls.minGapSec: 0..600');
  if (!isObj(c.quietHours) || !isHHmm(c.quietHours.from) || !isHHmm(c.quietHours.to)) errors.push('calls.quietHours: HH:mm');
  if (typeof c.companyConsent !== 'boolean') errors.push('calls.companyConsent: boolean');
  // Owner 2026-10-16: kompaniya roziligini FAQAT egasi/direktor/o'rinbosar o'zgartiradi (dasturchi ham emas)
  else if (c.companyConsent !== current.calls.companyConsent && !canEditCompanyConsent(editor)) {
    errors.push("calls.companyConsent: faqat firma egasi, direktor yoki o'rinbosar o'zgartira oladi");
  }

  if (!uniqueValid<ChannelName>(merged.fallbackOrder, (x) => (CHANNEL_NAMES as unknown[]).includes(x)) || !merged.fallbackOrder.length) {
    errors.push("fallbackOrder: takrorsiz, ma'lum kanallar");
  }

  const r = merged.reminders;
  if (!intIn(r.defaultLeadMin, 0, 1440)) errors.push('reminders.defaultLeadMin: 0..1440');
  if (!uniqueValid(r.defaultChannels, (x) => (CHANNEL_NAMES as unknown[]).includes(x))) errors.push('reminders.defaultChannels: noto\'g\'ri');
  if (!intIn(r.maxActivePerUser, 1, 200)) errors.push('reminders.maxActivePerUser: 1..200');

  if (!bool(merged.tools.allowOffShiftAssistant)) errors.push('tools.allowOffShiftAssistant: boolean');

  const pv = merged.provider;
  if (!['gemini_live', 'gemini_cascade'].includes(pv.primary)) errors.push('provider.primary: noto\'g\'ri');
  if (!['gemini_cascade', 'none'].includes(pv.fallback)) errors.push('provider.fallback: noto\'g\'ri');
  for (const k of ['liveModel', 'textModel', 'ttsModel', 'transcribeModel']) {
    if (pv[k] !== undefined && pv[k] !== '' && !MODEL_RE.test(String(pv[k]))) errors.push(`provider.${k}: model nomi noto'g'ri`);
    if (pv[k] === '') delete pv[k];
  }
  for (const k of Object.keys(pv)) {
    if (!['primary', 'fallback', 'liveModel', 'textModel', 'ttsModel', 'transcribeModel'].includes(k)) errors.push(`provider.${k}: ruxsat etilmagan (kalitlar sozlamada saqlanmaydi)`);
  }

  const br = merged.brain;
  if (!['gemini', 'claude'].includes(br.provider)) errors.push("brain.provider: gemini|claude");
  if (!['openrouter', 'none'].includes(br.fallback)) errors.push('brain.fallback: openrouter|none');
  if (!['low', 'medium', 'high'].includes(br.effort)) errors.push('brain.effort: low|medium|high');
  for (const k of Object.keys(br)) {
    if (!['provider', 'fallback', 'effort'].includes(k)) errors.push(`brain.${k}: ruxsat etilmagan (kalit/model sozlamada saqlanmaydi)`);
  }

  const l = merged.limits;
  if (!intIn(l.userSessionsPerHour, 0, 60)) errors.push('limits.userSessionsPerHour: 0..60');
  if (!intIn(l.companyMinutesPerDay, 0, 10_000)) errors.push('limits.companyMinutesPerDay: 0..10000');
  if (!numIn(l.monthlyBudgetUsd, 0, 10_000)) errors.push('limits.monthlyBudgetUsd: 0..10000');
  if (!bool(l.hardStop)) errors.push('limits.hardStop: boolean');
  if (!intIn(l.botMsgsPer10Min, 1, 200)) errors.push('limits.botMsgsPer10Min: 1..200');
  if (!intIn(l.toolCallsPerSession, 1, 100)) errors.push('limits.toolCallsPerSession: 1..100');
  if (l.workerCallCooldownSec !== undefined && !intIn(l.workerCallCooldownSec, 0, 600)) errors.push('limits.workerCallCooldownSec: 0..600');

  const pr = merged.privacy;
  if (!intIn(pr.transcriptRetentionDays, 1, 365)) errors.push('privacy.transcriptRetentionDays: 1..365');
  if (!intIn(pr.auditRetentionDays, 30, 3650)) errors.push('privacy.auditRetentionDays: 30..3650');

  if (errors.length) return { ok: false, errors };
  const value = mergeDefaults(current.companyId, merged);
  if (!canEditSchedule(editor, current) && JSON.stringify(value.attendance.shifts) !== JSON.stringify(current.attendance.shifts)) {
    return { ok: false, errors: ["attendance.shifts: ish jadvalini o'zgartirishga ruxsat yo'q"] };
  }
  return { ok: true, value };
}

function pickDefined(o: Record<string, any>, keys: string[]) {
  const out: Record<string, any> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

export type SaveResult = { ok: true; value: AiSettingsData } | { ok: false; conflict: true; current: AiSettingsData };

/** Optimistik saqlash: expectedVersion mos kelmasa — conflict (409). */
export async function saveSettings(companyId: string, next: AiSettingsData, expectedVersion: number, updatedBy: string): Promise<SaveResult> {
  const { companyId: _c, version: _v, updatedBy: _u, ...body } = next;
  const $set = { ...body, timezone: AI_TIMEZONE, updatedBy };
  // Bo'shatilgan ixtiyoriy maydon bazadan ham o'chirilsin (aks holda eski matn qaytib chiqardi — owner 2026-10-19)
  const $unset: Record<string, 1> = {};
  if (!body.disclosureText) { delete ($set as any).disclosureText; $unset.disclosureText = 1; }
  let doc: any = null;
  try {
    doc = await AiAssistantSettings.findOneAndUpdate(
      { companyId, ...(expectedVersion === 0 ? { $or: [{ version: 0 }, { version: { $exists: false } }] } : { version: expectedVersion }) },
      { $set, $inc: { version: 1 }, ...(Object.keys($unset).length ? { $unset } : {}) },
      { returnDocument: 'after', upsert: expectedVersion === 0, setDefaultsOnInsert: false },
    ).lean();
  } catch (e: any) {
    if (e?.code !== 11000) throw e;  // upsert poygasi: boshqa yozuv allaqachon yaratildi
  }
  invalidateSettings(companyId);
  if (!doc) return { ok: false, conflict: true, current: await getSettings(companyId) };
  const value = mergeDefaults(companyId, doc);
  cache.set(companyId, { at: Date.now(), data: value });
  return { ok: true, value };
}

// ───────────── Ish jadvali (owner decision 2026-10-13) ─────────────
// Jadvalni egasi/direktor (va bayroq yoqilgan bo'lsa o'rinbosar) bot, ilova yoki saytdan o'zgartiradi.
// Uchala yuza ham shu yagona funksiyadan o'tadi: validatsiya + optimistik versiya.

export function canEditSchedule(editor: { role: string; isOwner: boolean }, settings: Pick<AiSettingsData, 'attendance'>): boolean {
  if (editor.isOwner || editor.role === 'direktor') return true;
  return editor.role === 'orinbosar' && !!settings.attendance.orinbosarCanEditSchedule;
}

/** 31 kundan eski sanalar ro'yxatdan tushiriladi (≤366 chegarasiga yetmaslik uchun). */
const SCHEDULE_PAST_KEEP_DAYS = 31;

export function applySchedulePatch(shift: AiShift, patch: AiSchedulePatch, today: string): AiShift {
  const next: AiShift = { ...shift, skipDates: [...shift.skipDates], extraWorkDates: [...shift.extraWorkDates] };
  if (patch.workStart !== undefined) next.workStart = patch.workStart;
  if (patch.callLeadMin !== undefined) next.callLeadMin = patch.callLeadMin;
  if (patch.workdays !== undefined) next.workdays = [...new Set(patch.workdays)].sort((a, b) => a - b) as AiShift['workdays'];
  const add = (list: string[], v: string) => { if (!list.includes(v)) list.push(v); };
  const del = (list: string[], v: string) => { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); };
  // Bir sana faqat bitta ro'yxatda bo'ladi: qo'shilganda boshqasidan olib tashlanadi
  for (const d of patch.addSkipDates || []) { add(next.skipDates, d); del(next.extraWorkDates, d); }
  for (const d of patch.addExtraWorkDates || []) { add(next.extraWorkDates, d); del(next.skipDates, d); }
  for (const d of patch.removeSkipDates || []) del(next.skipDates, d);
  for (const d of patch.removeExtraWorkDates || []) del(next.extraWorkDates, d);
  const keepFrom = addDays(today, -SCHEDULE_PAST_KEEP_DAYS);
  next.skipDates = next.skipDates.filter((d) => !isIsoDate(d) || d >= keepFrom).sort();
  next.extraWorkDates = next.extraWorkDates.filter((d) => !isIsoDate(d) || d >= keepFrom).sort();
  next.callTime = isHHmm(next.workStart) ? deriveCallTime(next.workStart, next.callLeadMin) : next.callTime;
  return next;
}

export type ScheduleUpdateResult =
  | { ok: true; value: AiSettingsData; shift: AiShift }
  | { ok: false; code: 'forbidden' | 'not_found' | 'invalid' | 'conflict'; errors?: string[] };

/**
 * Ish jadvalini yangilash (P4 bot menyusi, P8 UI). editor.userId bo'yicha rol/egalik DB'dan qayta o'qiladi
 * (editor.role/isOwner faqat chaqiruvchining taxmini). Versiya to'qnashuvida bir marta qayta urinadi.
 */
export async function updateSchedule(
  companyId: string,
  shiftId: string,
  patch: AiSchedulePatch,
  editor: { userId: string; role: string; isOwner: boolean },
  now: Date = new Date(),
): Promise<ScheduleUpdateResult> {
  if (!isObj(patch)) return { ok: false, code: 'invalid', errors: ["patch object bo'lishi kerak"] };
  for (const k of ['addSkipDates', 'removeSkipDates', 'addExtraWorkDates', 'removeExtraWorkDates'] as const) {
    const v = patch[k];
    if (v !== undefined && (!Array.isArray(v) || v.length > 60 || !v.every(isIsoDate))) return { ok: false, code: 'invalid', errors: [`${k}: YYYY-MM-DD`] };
  }
  // Tahrirlovchi DB'dan QAYTA o'qiladi (JWT/sessiyadagi eski rol yoki egalikka ishonilmaydi — B2)
  const u: any = isObjectIdString(editor?.userId)
    ? await User.findById(editor.userId).select('role isOwner isBlocked companyId').lean()
    : null;
  if (!u || u.isBlocked || String(u.companyId || '') !== String(companyId) || u.role === 'dasturchi') return { ok: false, code: 'forbidden' };
  const who = { userId: String(u._id), role: String(u.role), isOwner: !!u.isOwner };
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await getSettingsFresh(companyId);
    if (!canEditSchedule(who, current)) return { ok: false, code: 'forbidden' };
    const idx = current.attendance.shifts.findIndex((sh) => sh.id === shiftId);
    if (idx < 0) return { ok: false, code: 'not_found' };
    const shifts = current.attendance.shifts.map((sh, i) => (i === idx ? applySchedulePatch(sh, patch, localDate(now)) : sh));
    const v = validateSettingsUpdate({ attendance: { shifts } }, current, who);
    if (!v.ok) return { ok: false, code: 'invalid', errors: v.errors };
    const saved = await saveSettings(companyId, v.value, current.version, who.userId);
    if (saved.ok) return { ok: true, value: saved.value, shift: saved.value.attendance.shifts[idx] };
  }
  return { ok: false, code: 'conflict' };
}

/** Keshsiz o'qish (yozishdan oldin). */
export async function getSettingsFresh(companyId: string): Promise<AiSettingsData> {
  cache.delete(companyId);
  return getSettings(companyId);
}

// ───────────── Faqat dasturchi boshqaradigan bo'limlar (owner 2026-10-15) ─────────────
// "AI miyasi" (brain + ovoz provayderi/modellari) va "Limit va xarajat" firma UI'sidan olib tashlandi:
// firma admini ularni ko'rmaydi va o'zgartira olmaydi — faqat /api/ai-voice/platform (dasturchi).
export const DEVELOPER_ONLY_KEYS = ['brain', 'provider', 'limits'] as const;
export type CompanySettingsView = Omit<AiSettingsData, typeof DEVELOPER_ONLY_KEYS[number]>;

/** Firma adminiga qaytariladigan sozlama: dasturchi bo'limlarisiz. */
export function companySettingsView(s: AiSettingsData): CompanySettingsView {
  const { brain: _b, provider: _p, limits: _l, ...rest } = s;
  return rest;
}

/** Patch'dagi dasturchi bo'limlari (bo'sh massiv — yo'q). */
export function developerOnlyKeysIn(patch: unknown): string[] {
  return isObj(patch) ? DEVELOPER_ONLY_KEYS.filter((k) => patch[k] !== undefined) : [];
}

// ───────────── Xodimning shaxsiy ish jadvali (owner 2026-10-15, #5) ─────────────
// Firma smenasidan tashqari xodimga o'z ish kunlari (ISO) va ixtiyoriy ish boshlanishi berilishi mumkin.
// Ustuvorlik o'zgarmaydi: skipDates (bayram) > extraWorkDates > hafta kunlari — faqat hafta kunlari va
// boshlanish vaqti xodimniki. absentCutoff smenadagi oraliq bilan birga suriladi (08:00/12:00 → 10:00/14:00).

export interface EmployeeScheduleOverride { weekdays: number[]; workStart?: string }

/** Bazadagi qiymatni tozalaydi; yaroqsiz bo'lsa — null (firma jadvali amal qiladi). */
export function normalizeOverride(v: unknown): EmployeeScheduleOverride | null {
  if (!isObj(v) || !Array.isArray(v.weekdays)) return null;
  const weekdays = [...new Set(v.weekdays.filter((d: unknown) => intIn(d, 1, 7)) as number[])].sort((a, b) => a - b);
  if (!weekdays.length) return null;
  return { weekdays, ...(isHHmm(v.workStart) ? { workStart: v.workStart } : {}) };
}

/** Xodim uchun amaldagi smena (override bo'lmasa — smenaning o'zi). */
export function effectiveShift(shift: AiShift, override?: unknown): AiShift {
  const ov = normalizeOverride(override);
  if (!ov) return shift;
  const workStart = ov.workStart || shift.workStart;
  const delta = parseHHmm(workStart) - parseHHmm(shift.workStart);
  return {
    ...shift,
    workdays: ov.weekdays as AiShift['workdays'],
    workStart,
    callTime: deriveCallTime(workStart, shift.callLeadMin),
    absentCutoff: delta ? shiftHHmm(shift.absentCutoff, delta) : shift.absentCutoff,
  };
}

/**
 * Shaxsiy jadval validatori — firma jadvali bilan BIR XIL qoidalar (validateShift) har bir smenaga
 * qo'llangan holda tekshiriladi. null — o'chirish (firma jadvaliga qaytish).
 */
export function validateEmployeeOverride(v: unknown, settings: Pick<AiSettingsData, 'attendance'>): string[] {
  if (v === null) return [];
  if (!isObj(v)) return ["scheduleOverride: object yoki null bo'lishi kerak"];
  const errors: string[] = [];
  for (const k of Object.keys(v)) if (k !== 'weekdays' && k !== 'workStart') errors.push(`scheduleOverride.${k}: noma'lum maydon`);
  if (!uniqueValid(v.weekdays, (d) => intIn(d, 1, 7)) || !v.weekdays.length) errors.push("scheduleOverride.weekdays: 1..7 (ISO), takrorsiz, kamida bittasi");
  if (v.workStart !== undefined && v.workStart !== null && !isHHmm(v.workStart)) errors.push('scheduleOverride.workStart: HH:mm');
  if (errors.length) return errors;
  const ov = normalizeOverride(v)!;
  settings.attendance.shifts.forEach((sh, i) => {
    const eff = effectiveShift(sh, ov);
    const errs: string[] = [];
    validateShift(eff, i, errs);
    // Surilgan absentCutoff yarim tundan o'tib qisilgan bo'lsa ham xato (kun oxirida yakunlash buziladi)
    if (ov.workStart && parseHHmm(sh.absentCutoff) + parseHHmm(ov.workStart) - parseHHmm(sh.workStart) > 23 * 60 + 59) {
      errs.push(`attendance.shifts[${i}].absentCutoff: ish boshlanishi juda kech`);
    }
    for (const e of errs) errors.push(`scheduleOverride (${sh.name || sh.id}): ${e.replace(/^attendance\.shifts\[\d+\][.:]?\s*/, '')}`);
  });
  return [...new Set(errors)];
}

/** Bitta xodimning shaxsiy jadvali (meRoutes, bot, tool'lar uchun). */
export async function getEmployeeOverride(companyId: string, employeeId: string): Promise<EmployeeScheduleOverride | null> {
  if (!companyId || !employeeId) return null;
  const c: any = await AiEmployeeContact.findOne({ companyId, employeeId }).select('scheduleOverride').lean();
  return normalizeOverride(c?.scheduleOverride);
}

/** Firmadagi barcha shaxsiy jadvallar (employeeId → override); ids berilsa — faqat ular. */
export async function loadEmployeeOverrides(companyId: string, ids?: string[]): Promise<Map<string, EmployeeScheduleOverride>> {
  const filter: Record<string, unknown> = { companyId, 'scheduleOverride.weekdays.0': { $exists: true } };
  if (ids) filter.employeeId = { $in: ids };
  const rows: any[] = await AiEmployeeContact.find(filter).select('employeeId scheduleOverride').limit(5000).lean();
  const out = new Map<string, EmployeeScheduleOverride>();
  for (const r of rows) {
    const ov = normalizeOverride(r.scheduleOverride);
    if (ov) out.set(String(r.employeeId), ov);
  }
  return out;
}
