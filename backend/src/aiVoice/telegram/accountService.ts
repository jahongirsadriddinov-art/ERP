import AiCallSession from '../../models/AiCallSession';
import AiChannelConnection from '../../models/AiChannelConnection';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import User from '../../models/User';
import { aiConfig } from '../config';
import type { AiTelegramAccountDto, WorkerEvent, WorkerStatus } from '../contracts';
import { isObjectIdString } from '../lib/ids';
import { ensurePlatformConnection } from '../lib/workerLease';
import { localDate, zonedToUtc } from '../lib/zonedTime';
import { sendToUser } from '../channels/botChannel';
import { getCallConsent } from '../consent';
import { backfillTgLinks, ensureContactTgUserId } from './tgLink';
import { callWorker, WorkerRpcFailure } from './workerRpc';
import { getActiveWorker, workerConnectedHere, workerHub } from './workerNamespace';

// Platforma Telegram akkaunti (AI qo'ng'iroq qiladigan user-account) holati — FAQAT metama'lumot.
// StringSession bu yerda yo'q va hech qachon bo'lmaydi (A5: u faqat worker diskida, shifrlangan).
//  • holat/health: worker 'health' voqeasi → AiChannelConnection;
//  • kunlik chegara: platforma bo'yicha AI_TG_DAILY_CAP + firma kvotasi AI_TG_COMPANY_DAILY_QUOTA (A1);
//  • flood-wait: worker FloodWait xabar qilsa — kanal shu vaqtgacha mavjud emas;
//  • kontaktni aniqlash tartibi (A2): worker keshi/dialoglari → @username → (eski) bog'lash kodi.
//    Ommaviy importContacts YO'Q. Fon aniqlashda bitta import faqat AI_TG_ALLOW_IMPORT=1 bo'lsa, soatiga 3 tagacha;
//    owner 2026-10-16: qo'ng'iroq paytida (call.place) telefon faqat shu qo'ng'iroq uchun, worker soatiga ≤5 import.

const PLATFORM_TG = { scope: 'platform' as const, companyId: null, type: 'telegram_user' as const };
const TG_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const TG_ID_RE = /^\d{1,20}$/;

/** lastHealthAt shu muddat ichida bo'lsa worker "ulangan" (adminRoutes bilan bir xil — 90 s). */
export const WORKER_FRESH_MS = 90_000;
/** Worker shu muddatdan kam vaqt oldin ko'ringan bo'lsa — uzilish vaqtinchalik (qayta navbat, fallback emas). */
export const WORKER_TRANSIENT_MS = 180_000;

const envInt = (name: string, def: number, min: number, max: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== '' && process.env[name] !== undefined ? Math.min(max, Math.max(min, Math.floor(n))) : def;
};

/** Bitta firmaga kuniga ajratilgan Telegram qo'ng'iroqlar (platforma chegarasidan oshmaydi). */
export function companyDailyQuota(): number {
  return Math.min(aiConfig.tgDailyCap, envInt('AI_TG_COMPANY_DAILY_QUOTA', 50, 0, 1000));
}
const importAllowed = () => ['1', 'true', 'yes', 'on'].includes(String(process.env.AI_TG_ALLOW_IMPORT || '').trim().toLowerCase());

export function maskPhone(phone: string): string {
  const d = String(phone || '').replace(/[^\d+]/g, '');
  if (d.length < 7) return '***';
  return `${d.slice(0, 5)}${'*'.repeat(Math.max(3, d.length - 7))}${d.slice(-2)}`;
}

const cleanName = (s: unknown) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 64) || undefined;
const cleanUsername = (s: unknown) => { const u = String(s || '').replace(/^@/, '').trim(); return TG_USERNAME_RE.test(u) ? u : undefined; };

export async function getConnection(): Promise<any | null> {
  return AiChannelConnection.findOne(PLATFORM_TG).lean();
}

export function dailyCount(conn: any, now: Date = new Date()): number {
  return conn?.dailyCallDay === localDate(now) ? Number(conn?.dailyCallCount || 0) : 0;
}

export function workerFresh(conn: any, now: Date = new Date()): boolean {
  return !!conn?.lastHealthAt && now.getTime() - new Date(conn.lastHealthAt).getTime() < WORKER_FRESH_MS;
}

/** Worker yaqinda ko'ringanmi yoki lease hali amalda (boshqa instansiyada bo'lishi mumkin). */
export function workerRecentlySeen(conn: any, now: Date = new Date()): boolean {
  if (conn?.leaseUntil && new Date(conn.leaseUntil).getTime() > now.getTime()) return true;
  return !!conn?.lastHealthAt && now.getTime() - new Date(conn.lastHealthAt).getTime() < WORKER_TRANSIENT_MS;
}

export function floodWaitActive(conn: any, now: Date = new Date()): boolean {
  return !!conn?.floodWaitUntil && new Date(conn.floodWaitUntil).getTime() > now.getTime();
}

export async function accountDto(now: Date = new Date()): Promise<AiTelegramAccountDto> {
  const c: any = await getConnection();
  const w = getActiveWorker();
  return {
    status: c?.status || 'disconnected',
    username: c?.username || undefined,
    displayName: c?.displayName || undefined,
    phoneMasked: c?.phoneMasked || undefined,
    workerConnected: workerConnectedHere() || workerFresh(c, now),
    workerVersion: w?.version || c?.workerVersion || undefined,
    lastHealthAt: c?.lastHealthAt ? new Date(c.lastHealthAt).toISOString() : undefined,
    udpOk: typeof c?.udpProbe?.ok === 'boolean' ? c.udpProbe.ok : undefined,
    floodWaitUntil: floodWaitActive(c, now) ? new Date(c.floodWaitUntil).toISOString() : undefined,
    dailyCallCount: dailyCount(c, now),
    dailyCap: aiConfig.tgDailyCap,
  };
}

// ───────────── Holat yozuvlari ─────────────

/** Worker 'health' voqeasi. Login jarayonidagi (awaiting_*) holat buzilmaydi. */
export async function recordHealth(status: WorkerStatus, now: Date = new Date()): Promise<void> {
  if (!status || typeof status !== 'object') return;
  await ensurePlatformConnection();
  const set: Record<string, unknown> = { lastHealthAt: now };
  if (typeof status.version === 'string') set.workerVersion = status.version.slice(0, 32);
  if (typeof status.udpOk === 'boolean') set.udpProbe = { ok: status.udpOk, at: now };
  const fw = Number(status.floodWaitUntil);
  if (Number.isFinite(fw) && fw > now.getTime()) set.floodWaitUntil = new Date(fw);
  const cur: any = await getConnection();
  if (status.connected === true) {
    set.status = 'connected';
    if (typeof status.tgUserId === 'string' && TG_ID_RE.test(status.tgUserId)) set.tgUserId = status.tgUserId;
    const un = cleanUsername(status.username);
    if (un) set.username = un;
    if (cur?.status !== 'connected') set.connectedAt = now;
  } else if (status.connected === false && cur?.status === 'connected') {
    // Telegram sessiyani bekor qilgan yoki worker sessiyasiz ishga tushgan
    set.status = 'disconnected';
    set.lastError = 'worker_not_authorized';
  }
  await AiChannelConnection.updateOne(PLATFORM_TG, { $set: set });
}

export async function setLoginState(p: { status: 'awaiting_code' | 'awaiting_password' | 'error' | 'disconnected'; phoneMasked?: string; by?: string; lastError?: string }): Promise<void> {
  await ensurePlatformConnection();
  const set: Record<string, unknown> = { status: p.status };
  if (p.phoneMasked) set.phoneMasked = p.phoneMasked;
  if (p.by) set.connectedBy = p.by;
  if (p.lastError) set.lastError = String(p.lastError).slice(0, 200);
  await AiChannelConnection.updateOne(PLATFORM_TG, { $set: set });
}

export async function setConnectedAccount(info: { tgUserId?: string; username?: string; displayName?: string }, by: string, now: Date = new Date()): Promise<void> {
  await ensurePlatformConnection();
  const set: Record<string, unknown> = { status: 'connected', connectedAt: now, connectedBy: by, lastError: null };
  if (info.tgUserId && TG_ID_RE.test(String(info.tgUserId))) set.tgUserId = String(info.tgUserId);
  const un = cleanUsername(info.username);
  if (un) set.username = un;
  const dn = cleanName(info.displayName);
  if (dn) set.displayName = dn;
  await AiChannelConnection.updateOne(PLATFORM_TG, { $set: set });
}

export async function setLoggedOut(by: string): Promise<void> {
  await ensurePlatformConnection();
  await AiChannelConnection.updateOne(PLATFORM_TG, {
    $set: { status: 'disconnected', connectedBy: by },
    $unset: { tgUserId: 1, username: 1, displayName: 1, phoneMasked: 1, connectedAt: 1, lastError: 1 },
  });
}

export async function setFloodWait(untilMs: number): Promise<void> {
  if (!Number.isFinite(untilMs) || untilMs <= Date.now()) return;
  await ensurePlatformConnection();
  await AiChannelConnection.updateOne(PLATFORM_TG, { $max: { floodWaitUntil: new Date(Math.min(untilMs, Date.now() + 7 * 86_400_000)) } });
}

// ───────────── Kunlik chegara va kvota ─────────────

/** Platforma kunlik hisoblagichini atomik oshiradi; chegara to'lgan bo'lsa false. */
export async function reserveDailyCall(now: Date = new Date()): Promise<boolean> {
  await ensurePlatformConnection();
  const day = localDate(now);
  await AiChannelConnection.updateOne({ ...PLATFORM_TG, dailyCallDay: { $ne: day } }, { $set: { dailyCallDay: day, dailyCallCount: 0 } });
  const r = await AiChannelConnection.updateOne(
    { ...PLATFORM_TG, dailyCallDay: day, dailyCallCount: { $lt: aiConfig.tgDailyCap } },
    { $inc: { dailyCallCount: 1 } },
  );
  return r.modifiedCount === 1;
}

/** Qo'ng'iroq umuman terilmagan bo'lsa — rezervni qaytarish. */
export async function releaseDailyCall(now: Date = new Date()): Promise<void> {
  await AiChannelConnection.updateOne(
    { ...PLATFORM_TG, dailyCallDay: localDate(now), dailyCallCount: { $gt: 0 } },
    { $inc: { dailyCallCount: -1 } },
  ).catch(() => undefined);
}

export async function companyCallsToday(companyId: string, now: Date = new Date()): Promise<number> {
  const dayStart = zonedToUtc(localDate(now), '00:00');
  return AiCallSession.countDocuments({ companyId, channel: 'telegram_call', createdAt: { $gte: dayStart } });
}

export async function companyQuotaOk(companyId: string, now: Date = new Date()): Promise<boolean> {
  return (await companyCallsToday(companyId, now)) < companyDailyQuota();
}

// ───────────── Kontakt aniqlash va bog'lash (A2) ─────────────

const lastResolveAttempt = new Map<string, number>();
const RESOLVE_RETRY_MS = 30 * 60_000;
let importWindow: { start: number; count: number } = { start: 0, count: 0 };

/** Bitta xodim kontaktini worker orqali aniqlash. Natija AiEmployeeContact.telegram.resolveStatus'ga yoziladi. */
export async function resolveContact(companyId: string, employeeId: string, now: Date = new Date()): Promise<string> {
  await ensureContactTgUserId(companyId, employeeId);
  const ct: any = await AiEmployeeContact.findOne({ companyId, employeeId }).lean();
  const tg = ct?.telegram;
  if (!tg?.tgUserId || !(await getCallConsent(companyId, employeeId, { contact: ct })).allowed) return 'skipped';
  let allowImport = false;
  let phone: string | undefined;
  if (importAllowed()) {
    if (now.getTime() - importWindow.start > 3600_000) importWindow = { start: now.getTime(), count: 0 };
    if (importWindow.count < 3) {
      const u: any = await User.findOne({ _id: employeeId, companyId }).select('phone').lean();
      if (u?.phone) { phone = String(u.phone); allowImport = true; }
    }
  }
  lastResolveAttempt.set(employeeId, now.getTime());
  try {
    const r = await callWorker('contact.resolve', {
      employeeId, expectedTgUserId: String(tg.tgUserId), username: cleanUsername(tg.username), phone, allowImport,
    });
    if (allowImport) importWindow.count++;
    const set: Record<string, unknown> = {};
    switch (r.status) {
      case 'resolved': set['telegram.resolveStatus'] = 'resolved'; set['telegram.resolvedAt'] = now; set['telegram.checkedAt'] = now; break;
      case 'privacy_restricted': set['telegram.resolveStatus'] = 'privacy_restricted'; break;
      case 'not_found': case 'mismatch': set['telegram.resolveStatus'] = 'not_found'; break;
      case 'flood_wait': if (r.retryAfterSec) await setFloodWait(now.getTime() + r.retryAfterSec * 1000); break;
    }
    if (Object.keys(set).length) {
      await AiEmployeeContact.updateOne({ _id: ct._id, 'telegram.tgUserId': String(tg.tgUserId) }, { $set: set });
    }
    return r.status;
  } catch (e) {
    if (e instanceof WorkerRpcFailure && e.code === 'flood_wait' && e.retryAfterSec) await setFloodWait(now.getTime() + e.retryAfterSec * 1000);
    return e instanceof WorkerRpcFailure ? e.code : 'error';
  }
}

/** Kutilayotgan bog'lash kodlari (xeshlari) workerga yuboriladi — worker DM'dagi kodni bot bilgan tgUserId bilan solishtiradi. */
export async function syncBindings(now: Date = new Date()): Promise<number> {
  if (!workerConnectedHere()) return 0;
  const rows: any[] = await AiEmployeeContact.find({
    'telegram.callConsent': 'granted',
    'telegram.tgUserId': { $type: 'string' },
    'telegram.bindingCodeExpiresAt': { $gt: now },
  }).select('+telegram.bindingCodeHash employeeId telegram.tgUserId telegram.bindingCodeExpiresAt').limit(200).lean();
  let n = 0;
  for (const r of rows) {
    const hash = r.telegram?.bindingCodeHash;
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) continue;
    try {
      await callWorker('binding.expect', {
        employeeId: String(r.employeeId), codeHash: hash, expectedTgUserId: String(r.telegram.tgUserId),
        expiresAt: new Date(r.telegram.bindingCodeExpiresAt).getTime(),
      });
      n++;
    } catch { break; }  // worker uzildi — keyingi safar
  }
  return n;
}

/** Hali aniqlanmagan (rozilik bergan) kontaktlarni bittadan aniqlash — ommaviy emas. */
export async function resolvePendingContacts(now: Date = new Date(), limit = 3): Promise<number> {
  if (!workerConnectedHere()) return 0;
  // Rozilik resolveContact ichida (samarali: firma yoki shaxsiy) tekshiriladi
  const rows: any[] = await AiEmployeeContact.find({
    'telegram.tgUserId': { $type: 'string' },
    'telegram.resolveStatus': { $in: ['unknown', 'not_found', null] },
  }).select('companyId employeeId').limit(50).lean();
  let n = 0;
  for (const r of rows) {
    if (n >= limit) break;
    const last = lastResolveAttempt.get(String(r.employeeId)) || 0;
    if (now.getTime() - last < RESOLVE_RETRY_MS) continue;
    const s = await resolveContact(String(r.companyId), String(r.employeeId), now);
    n++;
    if (s === 'flood_wait' || s === 'worker_offline' || s === 'timeout') break;
  }
  return n;
}

const BOUND_TEXT = {
  uz: "✅ Telegram hisobingiz AI yordamchiga bog'landi. Endi AI sizga Telegram orqali qo'ng'iroq qila oladi.",
  ru: '✅ Ваш Telegram привязан к AI-помощнику. Теперь AI может звонить вам в Telegram.',
};

/** Worker DM'da to'g'ri kodni ko'rdi: faqat bot bilgan tgUserId bilan mos bo'lsa bog'lanadi. */
export async function applyBinding(ev: { employeeId: string; tgUserId: string; username?: string }, now: Date = new Date()): Promise<boolean> {
  if (!isObjectIdString(ev?.employeeId) || !TG_ID_RE.test(String(ev?.tgUserId || ''))) return false;
  const set: Record<string, unknown> = { 'telegram.resolveStatus': 'resolved', 'telegram.resolvedAt': now };
  const un = cleanUsername(ev.username);
  if (un) set['telegram.username'] = un;
  const doc: any = await AiEmployeeContact.findOneAndUpdate(
    {
      employeeId: ev.employeeId, 'telegram.tgUserId': String(ev.tgUserId), 'telegram.callConsent': 'granted',
      'telegram.bindingCodeExpiresAt': { $gt: now },
    },
    { $set: set, $unset: { 'telegram.bindingCodeHash': 1, 'telegram.bindingCodeExpiresAt': 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!doc) return false;
  try {
    const u: any = await User.findById(ev.employeeId).select('language').lean();
    const lang = u?.language === 'ru' ? 'ru' : 'uz';
    await sendToUser(String(ev.employeeId), BOUND_TEXT[lang], { companyId: String(doc.companyId) });
  } catch { /* bildirishnoma ixtiyoriy */ }
  return true;
}

// ───────────── Davriy ishlar va voqealar ─────────────

let lastMaintenanceAt = 0;
let lastBackfillAt = 0;
let maintenanceRunning = false;

/** Bog'lash kodlarini sinxronlash va kontaktlarni aniqlash (≤1 marta/daqiqa, faqat worker shu instansiyada). */
export async function runMaintenance(now: Date = new Date(), opts: { force?: boolean } = {}): Promise<void> {
  if (!workerConnectedHere() || maintenanceRunning) return;
  if (!opts.force && now.getTime() - lastMaintenanceAt < 60_000) return;
  maintenanceRunning = true;
  lastMaintenanceAt = now.getTime();
  try {
    // ERP bot bog'lanishlari → AI kontaktlari (≤1 marta / 10 daqiqa)
    if (now.getTime() - lastBackfillAt >= 10 * 60_000) { lastBackfillAt = now.getTime(); await backfillTgLinks(); }
    await syncBindings(now);
    await resolvePendingContacts(now);
  } catch (e) {
    console.error('[aiVoice/telegram] maintenance xatosi:', (e as Error).message);
  } finally {
    maintenanceRunning = false;
  }
}

let initialized = false;

/** Worker voqealarini tinglash (idempotent). health.registerHandlers va testlar chaqiradi. */
export function initAccountService(): void {
  if (initialized) return;
  initialized = true;
  workerHub.on('event', (ev: WorkerEvent) => {
    if (ev?.type === 'health') {
      recordHealth(ev.status).then(() => runMaintenance()).catch((e) => console.error('[aiVoice/telegram] health yozilmadi:', (e as Error).message));
    } else if (ev?.type === 'binding.matched') {
      applyBinding(ev).catch((e) => console.error('[aiVoice/telegram] binding xatosi:', (e as Error).message));
    }
  });
  workerHub.on('up', () => { setTimeout(() => { runMaintenance(new Date(), { force: true }).catch(() => undefined); }, 1_000).unref?.(); });
}

/** Faqat testlar uchun. */
export function __resetAccountServiceForTests(): void {
  lastResolveAttempt.clear();
  importWindow = { start: 0, count: 0 };
  lastMaintenanceAt = 0;
  lastBackfillAt = 0;
}
