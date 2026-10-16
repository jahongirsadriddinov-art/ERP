import AiEmployeeContact from '../../models/AiEmployeeContact';
import User from '../../models/User';
import { getCallConsent } from '../consent';
import { aiConfig, INSTANCE_ID } from '../config';
import type { ChannelAdapter, ChannelAttemptResult, ChannelCtx, ChannelRequest } from '../contracts';
import { isObjectIdString } from '../lib/ids';
import { telegramCapacity } from '../sessions';
import { getVoiceSessionManager } from '../voice/sessionManager';
import {
  companyQuotaOk, dailyCount, floodWaitActive, getConnection, releaseDailyCall, reserveDailyCall, workerRecentlySeen,
} from '../telegram/accountService';
import { registerBridge, TelegramTransport, unregisterBridge } from '../telegram/callBridge';
import { callWorker, WorkerRpcFailure } from '../telegram/workerRpc';
import { ensureContactTgUserId } from '../telegram/tgLink';
import { workerConnectedHere } from '../telegram/workerNamespace';

// Telegram qo'ng'iroq kanali (AI platforma user-account'i orqali, Python worker).
// Mavjudlik (design §5 + review A1/A2/C3):
//  • akkaunt 'connected', flood-wait yo'q, platforma kunlik chegarasi va firma kvotasi to'lmagan;
//  • xodim: samarali rozilik (consent.getCallConsent — firma roziligi yoki eski shaxsiy), opt-out yo'q, tgUserId
//    ERP bot bog'lanishidan (tgLink); peer noma'lum bo'lsa worker shu qo'ng'iroqda telefon bo'yicha aniqlaydi;
//  • worker shu instansiyada ulangan. Worker VAQTINCHA uzilgan bo'lsa (yaqinda ko'ringan yoki lease amalda)
//    — fallback emas: attempt() 'unavailable' + retryAt (+15 s) qaytaradi va runner qayta navbatga qo'yadi.
// Qo'ng'iroq natijasi keyin call.state voqeasi (callBridge → finishSession → onSessionsEnded) orqali keladi.

const DEFER_MS = 15_000;
const BUSY_DEFER_MS = 60_000;

type Avail = { ok: true } | { ok: false; reason: string };

/** not_found holatidagi xodimni qo'ng'iroq paytida qayta aniqlash oralig'i (worker import chegarasi bor). */
const RECHECK_NOT_FOUND_MS = 6 * 3600_000;

type Peer = { tgUserId: string; resolved: boolean; username?: string };

async function check(c: ChannelCtx, now: Date): Promise<Avail & { peer?: Peer }> {
  if (!aiConfig.enabled) return { ok: false, reason: 'disabled' };
  if (!c || typeof c.companyId !== 'string' || !c.companyId || !isObjectIdString(c.employeeId)) return { ok: false, reason: 'bad_ctx' };
  const conn: any = await getConnection();
  if (!conn || conn.status !== 'connected') return { ok: false, reason: 'account_not_connected' };
  if (floodWaitActive(conn, now)) return { ok: false, reason: 'flood_wait' };
  if (dailyCount(conn, now) >= aiConfig.tgDailyCap) return { ok: false, reason: 'daily_cap' };
  // Owner 2026-10-16: tgUserId ERP bot bog'lanishidan (kod shart emas)
  const tgUserId = await ensureContactTgUserId(c.companyId, c.employeeId);
  const ct: any = await AiEmployeeContact.findOne({ companyId: c.companyId, employeeId: c.employeeId })
    .select('telegram.tgUserId telegram.username telegram.resolveStatus telegram.checkedAt telegram.callConsent optOut').lean();
  const consent = await getCallConsent(c.companyId, c.employeeId, { contact: ct });
  if (!consent.allowed) return { ok: false, reason: consent.reason || 'no_consent' };
  const tg = ct?.telegram;
  if (!tgUserId || tg?.tgUserId !== tgUserId) return { ok: false, reason: 'not_bound' };
  const st = String(tg?.resolveStatus || 'unknown');
  if (st === 'privacy_restricted' || st === 'blocked') return { ok: false, reason: st };
  // not_found — yaqinda tekshirilgan bo'lsa kutamiz; aks holda worker qo'ng'iroq paytida qayta aniqlaydi
  if (st === 'not_found' && tg?.checkedAt && now.getTime() - new Date(tg.checkedAt).getTime() < RECHECK_NOT_FOUND_MS) {
    return { ok: false, reason: 'not_resolved' };
  }
  if (!workerConnectedHere() && !workerRecentlySeen(conn, now)) return { ok: false, reason: 'worker_offline' };
  if (!(await companyQuotaOk(c.companyId, now))) return { ok: false, reason: 'company_quota' };
  return { ok: true, peer: { tgUserId, resolved: st === 'resolved', username: typeof tg?.username === 'string' ? tg.username : undefined } };
}

/** Peer noma'lum bo'lsa — SHU qo'ng'iroq uchun xodim telefoni (worker bitta importContacts qiladi, id mos kelishi shart). */
async function employeePhone(c: ChannelCtx): Promise<string | undefined> {
  const u: any = await User.findOne({ _id: c.employeeId, companyId: c.companyId }).select('phone').lean();
  const ph = typeof u?.phone === 'string' ? u.phone.replace(/[^\d+]/g, '') : '';
  return /^\+?\d{9,15}$/.test(ph) ? ph : undefined;
}

async function placeCall(c: ChannelCtx, sessionId: string, peer: Peer, ring: number, max: number, now: Date) {
  const base = { sessionId, tgUserId: peer.tgUserId, timeoutSec: ring, maxDurationSec: max, ...(peer.username ? { username: peer.username } : {}) };
  // Avval telefonsiz (worker: kesh → dialoglar → username); worker peer'ni bilmasa — bir marta telefon bilan
  let phoneSent = false;
  let res = await callWorker('call.place', base);
  if (!res?.accepted && res?.reason === 'peer_unknown') {
    const phone = await employeePhone(c);
    if (phone) {
      phoneSent = true;
      res = await callWorker('call.place', { ...base, phone });
    }
  }
  const filter = { companyId: c.companyId, employeeId: c.employeeId, 'telegram.tgUserId': peer.tgUserId };
  if (res?.accepted && !peer.resolved) {
    await AiEmployeeContact.updateOne(filter, { $set: { 'telegram.resolveStatus': 'resolved', 'telegram.resolvedAt': now, 'telegram.checkedAt': now } });
  } else if (!res?.accepted && (res?.reason === 'peer_unknown' || res?.reason === 'peer_mismatch')) {
    await AiEmployeeContact.updateOne(filter, { $set: { 'telegram.resolveStatus': phoneSent ? 'not_found' : 'unknown', 'telegram.checkedAt': now } });
  }
  return res;
}

const unavailable = (errorCode: string, retryAt?: Date): ChannelAttemptResult =>
  ({ outcome: 'unavailable', retryable: !!retryAt, errorCode, ...(retryAt ? { retryAt } : {}) });

export const telegramCallChannel: ChannelAdapter = {
  name: 'telegram_call',

  async isAvailable(c) {
    const r = await check(c, c?.now instanceof Date ? c.now : new Date());
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },

  async attempt(c: ChannelCtx, r: ChannelRequest): Promise<ChannelAttemptResult> {
    const now = new Date();
    const av = await check(c, now);
    if (!av.ok) return unavailable(av.reason);
    // C3: worker socket'i boshqa instansiyada yoki qayta ulanmoqda — fallback emas, qayta navbat
    if (!workerConnectedHere()) return unavailable('worker_not_here', new Date(now.getTime() + DEFER_MS));
    // A1: akkaunt bo'yicha bir vaqtda 1 ta qo'ng'iroq
    if (!(await telegramCapacity())) return unavailable('account_busy', new Date(now.getTime() + BUSY_DEFER_MS));
    if (!(await reserveDailyCall(now))) return unavailable('daily_cap');

    const settings = { ring: Math.min(90, Math.max(15, Number(r?.ringTimeoutSec) || 45)), max: Math.min(600, Math.max(30, Number(r?.maxDurationSec) || 120)) };
    const transport = new TelegramTransport();
    let started;
    try {
      started = await getVoiceSessionManager().start({
        companyId: c.companyId, employeeId: c.employeeId, purpose: c.purpose, channel: 'telegram_call', lang: c.lang,
        ptt: false, transport, attemptKey: c.attemptKey, confirmationId: c.confirmationId, attemptNo: c.attemptNo,
        workerInstanceId: INSTANCE_ID,
        // Jiringlash vaqtini worker o'lchaydi (aniq natija bilan); menejer taymeri — faqat zaxira (+20 s)
        ringTimeoutSec: settings.ring + 20, maxDurationSec: settings.max,
      });
    } catch (e) {
      await releaseDailyCall(now);
      console.error('[aiVoice/telegram] ovozli sessiya ochilmadi:', (e as Error).message);
      return { outcome: 'failed', retryable: true, errorCode: 'session_error' };
    }
    if (!started.ok) {
      await releaseDailyCall(now);
      switch (started.reason) {
        case 'busy': return { outcome: 'busy', retryable: true, errorCode: 'busy' };
        // A6: Live sig'imi to'lgan — kaskadga emas, kutib qayta urinish
        case 'platform_cap': case 'company_cap': return unavailable(started.reason, new Date(now.getTime() + BUSY_DEFER_MS));
        case 'error': return { outcome: 'failed', retryable: true, errorCode: 'session_error' };
        default: return unavailable(started.reason);
      }
    }

    const handle = started.handle;
    transport.bind(handle.sessionId);
    registerBridge({ sessionId: handle.sessionId, handle, employeeId: c.employeeId, companyId: c.companyId });
    try {
      const res = await placeCall(c, handle.sessionId, av.peer!, settings.ring, settings.max, now);
      if (!res?.accepted) {
        unregisterBridge(handle.sessionId);
        await handle.end('error').catch(() => undefined);
        await releaseDailyCall(now);
        const reason = String(res?.reason || 'rejected').slice(0, 60);
        if (reason === 'busy_worker') return unavailable('account_busy', new Date(now.getTime() + BUSY_DEFER_MS));
        return { outcome: 'unavailable', retryable: false, sessionId: handle.sessionId, errorCode: reason };
      }
    } catch (e) {
      unregisterBridge(handle.sessionId);
      await handle.end('error').catch(() => undefined);
      await releaseDailyCall(now);
      const code = e instanceof WorkerRpcFailure ? e.code : 'error';
      // Worker shu orada uzildi — vaqtinchalik: qayta navbat
      if (code === 'worker_offline' || code === 'timeout') return unavailable(`worker_${code}`, new Date(now.getTime() + DEFER_MS));
      return { outcome: 'failed', retryable: true, sessionId: handle.sessionId, errorCode: code };
    }
    // Natija call.state orqali keladi; zaxira — runner'ning call_timeout ishi
    return {
      outcome: 'no_answer', retryable: true, sessionId: handle.sessionId,
      awaitResponseUntil: new Date(now.getTime() + (settings.ring + settings.max) * 1000),
    };
  },
};

export default telegramCallChannel;
