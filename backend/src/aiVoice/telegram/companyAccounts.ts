import AiCallSession from '../../models/AiCallSession';
import AiTgAccount from '../../models/AiTgAccount';
import AiChannelConnection from '../../models/AiChannelConnection';
import type { WorkerEvent, WorkerStatus } from '../contracts';
import { isObjectIdString } from '../lib/ids';
import { callWorker, WorkerRpcFailure } from './workerRpc';
import { workerConnectedHere, workerHub } from './workerNamespace';

// AI Telegram akkauntlari — UMUMIY hovuz (owner 2026-10-19: "har firma uchun emas, hammaga ishlaydigan; ism
// berilsin, AI shu ismni aytadi"). Dasturchi panelida hohlagancha qo'shiladi; har qo'ng'iroq BO'SH akkaunt orqali ketadi
// (bitta akkaunt — bir vaqtda bitta qo'ng'iroq, Telegram cheklovi), hammasi band/ulanmagan — platforma akkaunti (zaxira).
// Kiruvchi qo'ng'iroqda qo'ng'iroq qiluvchining firmasi ERP botdagi bog'lanishdan (/start + telefon) aniqlanadi.

const TG_ID_RE = /^\d{1,20}$/;
const UN_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
/** Worker health shu muddatda kelgan bo'lsa — akkaunt "tirik". */
const FRESH_MS = 180_000;
export const MAX_POOL_ACCOUNTS = 50;

export interface TgAccountDto {
  id: string; label?: string; status: string; username?: string; displayName?: string; phoneMasked?: string;
  busy: boolean; lastError?: string; connectedAt?: string; floodWaitUntil?: string;
}

const busyIds = async (ids: string[]): Promise<Set<string>> => {
  if (!ids.length) return new Set();
  const rows: any[] = await AiCallSession.find({ isActive: true, channel: 'telegram_call', tgAccountId: { $in: ids } }).select('tgAccountId').lean();
  return new Set(rows.map((r) => String(r.tgAccountId)));
};

export async function listPoolAccounts(): Promise<TgAccountDto[]> {
  const rows: any[] = await AiTgAccount.find({}).sort({ createdAt: 1 }).lean();
  const busy = await busyIds(rows.map((r) => String(r._id)));
  const now = Date.now();
  return rows.map((r) => ({
    id: String(r._id), label: r.label || undefined, status: r.status, username: r.username || undefined,
    displayName: r.displayName || undefined, phoneMasked: r.phoneMasked || undefined, busy: busy.has(String(r._id)),
    lastError: r.status !== 'connected' ? r.lastError || undefined : undefined,
    connectedAt: r.connectedAt ? new Date(r.connectedAt).toISOString() : undefined,
    floodWaitUntil: r.floodWaitUntil && new Date(r.floodWaitUntil).getTime() > now ? new Date(r.floodWaitUntil).toISOString() : undefined,
  }));
}

export async function getAccount(id: string): Promise<any | null> {
  return isObjectIdString(id) ? AiTgAccount.findById(id).lean() : null;
}

/** Workerga hamma firma akkauntlarini bildirish (yangilarini yaratadi). */
export async function syncAccountsToWorker(): Promise<boolean> {
  if (!workerConnectedHere()) return false;
  const ids = (await AiTgAccount.find({}).select('_id').limit(1000).lean()).map((r: any) => String(r._id));
  try {
    await callWorker('accounts.sync', { accounts: ids });
    return true;
  } catch {
    return false;
  }
}

export const cleanAiName = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f<>{}]/g, '').trim().slice(0, 30) || undefined : undefined;

export async function createPoolAccount(name: string | undefined, by: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if ((await AiTgAccount.countDocuments({})) >= MAX_POOL_ACCOUNTS) return { ok: false, error: 'too_many' };
  const doc = await AiTgAccount.create({ label: cleanAiName(name), createdBy: by });
  await syncAccountsToWorker();
  return { ok: true, id: String(doc._id) };
}

export async function setAccountName(id: string, name: string | undefined): Promise<void> {
  const n = cleanAiName(name);
  await AiTgAccount.updateOne({ _id: id }, n ? { $set: { label: n } } : { $unset: { label: 1 } });
}

export async function removePoolAccount(id: string): Promise<{ ok: boolean; error?: string }> {
  if (await AiCallSession.exists({ isActive: true, channel: 'telegram_call', tgAccountId: id })) return { ok: false, error: 'busy' };
  if (workerConnectedHere()) {
    try {
      await callWorker('accounts.remove', { account: id });
    } catch (e) {
      // Worker akkauntni bilmasa ham (sessiya yo'q) — bazadan o'chiramiz
      if (!(e instanceof WorkerRpcFailure && e.code === 'unknown_account')) return { ok: false, error: e instanceof WorkerRpcFailure ? e.code : 'error' };
    }
  } else {
    return { ok: false, error: 'worker_offline' };
  }
  await AiTgAccount.deleteOne({ _id: id });
  return { ok: true };
}

export async function setAccountLogin(id: string, set: Record<string, unknown>, unset: string[] = []): Promise<void> {
  await AiTgAccount.updateOne({ _id: id }, { $set: set, ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, 1])) } : {}) });
}

export async function setAccountConnected(id: string, info: { tgUserId?: string; username?: string; displayName?: string }, by: string): Promise<void> {
  const set: Record<string, unknown> = { status: 'connected', connectedAt: new Date(), connectedBy: by, lastHealthAt: new Date() };
  if (info.tgUserId && TG_ID_RE.test(String(info.tgUserId))) set.tgUserId = String(info.tgUserId);
  if (typeof info.username === 'string' && UN_RE.test(info.username.replace(/^@/, ''))) set.username = info.username.replace(/^@/, '');
  if (typeof info.displayName === 'string' && info.displayName.trim()) set.displayName = info.displayName.trim().slice(0, 80);
  await AiTgAccount.updateOne({ _id: id }, { $set: set, $unset: { lastError: 1 } });
  // Shu Telegram akkaunt platforma akkaunti yoki boshqa firma akkaunti sifatida ham ulangan bo'lsa — darhol ko'rsatamiz
  // (worker ikkinchi sessiyani to'xtatadi; aks holda qo'ng'iroq "band" bo'lib qolardi)
  const tg = typeof set.tgUserId === 'string' ? set.tgUserId : '';
  if (tg) {
    const dupPlatform = await AiChannelConnection.exists({ scope: 'platform', companyId: null, type: 'telegram_user', status: 'connected', tgUserId: tg });
    const dupOther = await AiTgAccount.exists({ _id: { $ne: id }, tgUserId: tg, status: 'connected' });
    if (dupPlatform || dupOther) await AiTgAccount.updateOne({ _id: id }, { $set: { status: 'error', lastError: 'duplicate_account' } });
  }
}

/** Worker health'idagi firma akkauntlari holati. Login jarayonidagi (awaiting_*) holat buzilmaydi. */
export async function recordAccountsHealth(list: WorkerStatus['accounts'], now: Date = new Date()): Promise<void> {
  for (const a of list || []) {
    if (!a || !isObjectIdString(String(a.id))) continue;
    const set: Record<string, unknown> = { lastHealthAt: now };
    const fw = Number(a.floodWaitUntil);
    if (Number.isFinite(fw) && fw > now.getTime()) set.floodWaitUntil = new Date(fw);
    if (a.connected === true) {
      set.status = 'connected';
      if (typeof a.tgUserId === 'string' && TG_ID_RE.test(a.tgUserId)) set.tgUserId = a.tgUserId;
      if (typeof a.username === 'string' && UN_RE.test(a.username)) set.username = a.username;
      await AiTgAccount.updateOne({ _id: a.id }, { $set: set });
    } else if (a.error === 'duplicate_account') {
      // Shu Telegram akkaunt boshqa joyda (platforma yoki boshqa firma akkaunti) ulangan — worker bu sessiyani to'xtatdi
      await AiTgAccount.updateOne({ _id: a.id }, { $set: { ...set, status: 'error', lastError: 'duplicate_account' } });
    } else {
      await AiTgAccount.updateOne({ _id: a.id, status: 'connected' }, { $set: { ...set, status: 'disconnected', lastError: 'worker_not_authorized' } });
      await AiTgAccount.updateOne({ _id: a.id }, { $set: { lastHealthAt: now } });
    }
  }
}

/** Hovuzda ulangan (tirik) akkaunt bormi — kanal mavjudligi uchun. */
export async function poolHasLiveAccount(now: Date = new Date()): Promise<boolean> {
  return !!(await AiTgAccount.exists({
    status: 'connected', lastHealthAt: { $gt: new Date(now.getTime() - FRESH_MS) },
    $or: [{ floodWaitUntil: null }, { floodWaitUntil: { $lte: now } }],
  }));
}

/** Hovuzdagi BO'SH akkaunt (yaratilish tartibida) va uning AI ismi. Yo'q bo'lsa null. */
export async function pickPoolAccount(now: Date = new Date()): Promise<{ id: string; name?: string } | null> {
  const rows: any[] = await AiTgAccount.find({
    status: 'connected', lastHealthAt: { $gt: new Date(now.getTime() - FRESH_MS) },
    $or: [{ floodWaitUntil: null }, { floodWaitUntil: { $lte: now } }],
  }).sort({ createdAt: 1 }).select('_id label').lean();
  if (!rows.length) return null;
  const busy = await busyIds(rows.map((r) => String(r._id)));
  const free = rows.find((r) => !busy.has(String(r._id)));
  return free ? { id: String(free._id), ...(free.label ? { name: String(free.label) } : {}) } : null;
}

export async function accountBusy(id: string): Promise<boolean> {
  return !!(await AiCallSession.exists({ isActive: true, channel: 'telegram_call', tgAccountId: id }));
}

export async function markSessionAccount(sessionId: string, accountId: string | null): Promise<void> {
  if (!accountId) return;
  await AiCallSession.updateOne({ _id: sessionId }, { $set: { tgAccountId: accountId } }).catch(() => undefined);
}

let initialized = false;
export function initCompanyAccounts(): void {
  if (initialized) return;
  initialized = true;
  workerHub.on('up', () => { setTimeout(() => { syncAccountsToWorker().catch(() => undefined); }, 500).unref?.(); });
  workerHub.on('event', (ev: WorkerEvent) => {
    if (ev?.type === 'health' && Array.isArray(ev.status?.accounts)) {
      recordAccountsHealth(ev.status.accounts).catch((e) => console.error('[aiVoice/telegram] akkaunt holati yozilmadi:', (e as Error).message));
    }
  });
}
