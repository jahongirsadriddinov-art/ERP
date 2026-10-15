import AiEmployeeContact from '../../models/AiEmployeeContact';
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
import { workerConnectedHere } from '../telegram/workerNamespace';

// Telegram qo'ng'iroq kanali (AI platforma user-account'i orqali, Python worker).
// Mavjudlik (design §5 + review A1/A2/C3):
//  • akkaunt 'connected', flood-wait yo'q, platforma kunlik chegarasi va firma kvotasi to'lmagan;
//  • xodim: callConsent 'granted', bot bilgan tgUserId bor, kontakt 'resolved', opt-out yo'q;
//  • worker shu instansiyada ulangan. Worker VAQTINCHA uzilgan bo'lsa (yaqinda ko'ringan yoki lease amalda)
//    — fallback emas: attempt() 'unavailable' + retryAt (+15 s) qaytaradi va runner qayta navbatga qo'yadi.
// Qo'ng'iroq natijasi keyin call.state voqeasi (callBridge → finishSession → onSessionsEnded) orqali keladi.

const DEFER_MS = 15_000;
const BUSY_DEFER_MS = 60_000;

type Avail = { ok: true } | { ok: false; reason: string };

async function check(c: ChannelCtx, now: Date): Promise<Avail & { tgUserId?: string }> {
  if (!aiConfig.enabled) return { ok: false, reason: 'disabled' };
  if (!c || typeof c.companyId !== 'string' || !c.companyId || !isObjectIdString(c.employeeId)) return { ok: false, reason: 'bad_ctx' };
  const conn: any = await getConnection();
  if (!conn || conn.status !== 'connected') return { ok: false, reason: 'account_not_connected' };
  if (floodWaitActive(conn, now)) return { ok: false, reason: 'flood_wait' };
  if (dailyCount(conn, now) >= aiConfig.tgDailyCap) return { ok: false, reason: 'daily_cap' };
  const ct: any = await AiEmployeeContact.findOne({ companyId: c.companyId, employeeId: c.employeeId })
    .select('telegram.tgUserId telegram.resolveStatus telegram.callConsent optOut').lean();
  const tg = ct?.telegram;
  if (!tg || tg.callConsent !== 'granted') return { ok: false, reason: 'no_consent' };
  if (ct.optOut?.all || ct.optOut?.calls) return { ok: false, reason: 'opt_out' };
  if (typeof tg.tgUserId !== 'string' || !/^\d{1,20}$/.test(tg.tgUserId)) return { ok: false, reason: 'not_bound' };
  if (tg.resolveStatus !== 'resolved') return { ok: false, reason: tg.resolveStatus === 'privacy_restricted' ? 'privacy_restricted' : 'not_resolved' };
  if (!workerConnectedHere() && !workerRecentlySeen(conn, now)) return { ok: false, reason: 'worker_offline' };
  if (!(await companyQuotaOk(c.companyId, now))) return { ok: false, reason: 'company_quota' };
  return { ok: true, tgUserId: tg.tgUserId };
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
      const res = await callWorker('call.place', { sessionId: handle.sessionId, tgUserId: av.tgUserId!, timeoutSec: settings.ring, maxDurationSec: settings.max });
      if (!res?.accepted) {
        unregisterBridge(handle.sessionId);
        await handle.end('error').catch(() => undefined);
        await releaseDailyCall(now);
        const reason = String(res?.reason || 'rejected').slice(0, 60);
        if (reason === 'busy_worker') return unavailable('account_busy', new Date(now.getTime() + BUSY_DEFER_MS));
        if (reason === 'peer_unknown') {
          await AiEmployeeContact.updateOne({ companyId: c.companyId, employeeId: c.employeeId }, { $set: { 'telegram.resolveStatus': 'unknown' } });
        }
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
