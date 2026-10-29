import AiEmployeeContact from '../../models/AiEmployeeContact';
import AiInstance from '../../models/AiInstance';
import { aiConfig, INSTANCE_ID, LIMITS } from '../config';
import type { ChannelAdapter, ChannelAttemptResult, ChannelCtx, ChannelRequest } from '../contracts';
import { isObjectIdString } from '../lib/ids';
import { hasFreshPresence, ringUser, userHasSocketHere } from '../socket/inAppSocket';

// In-app AI qo'ng'irog'i (ilova/sayt, Socket.IO + VoiceSessionManager). Mavjudlik (review A11/C3):
//  • AI yoqilgan, xodim qo'ng'iroqlardan voz kechmagan (optOut.calls/all);
//  • foydalanuvchining SHU instansiyada socket'i bor va kamida bittasi ko'rinadigan, presence < 60 s;
//  • socket'i yo'q, lekin boshqa tirik instansiya bor (deploy overlap) — fallback emas: 'unavailable'
//    + retryAt (+15 s), runner deferMax gacha qayta urinadi.
// Qo'ng'iroq 30 s jiringlaydi; natija keyin finishSession → onSessionsEnded orqali keladi (C1).

const DEFER_MS = 15_000;
const BUSY_DEFER_MS = 60_000;
const RING_SEC = 30;

type Avail = { ok: true } | { ok: false; reason: string; retryAt?: Date };

async function otherInstanceAlive(now: Date): Promise<boolean> {
  try {
    return !!(await AiInstance.exists({ instanceId: { $ne: INSTANCE_ID }, lastBeatAt: { $gt: new Date(now.getTime() - LIMITS.instanceStaleMs) } }));
  } catch { return false; }
}

async function check(c: ChannelCtx, now: Date): Promise<Avail> {
  if (!aiConfig.enabled) return { ok: false, reason: 'disabled' };
  if (!c || typeof c.companyId !== 'string' || !c.companyId || !isObjectIdString(c.employeeId)) return { ok: false, reason: 'bad_ctx' };
  const ct: any = await AiEmployeeContact.findOne({ companyId: c.companyId, employeeId: c.employeeId }).select('optOut').lean();
  // userRequested — foydalanuvchi o'zi so'ragan qo'ng'iroq: optOut.calls ("AI meni chaqirmasin") to'smaydi
  if (ct?.optOut?.all || (!c.userRequested && ct?.optOut?.calls)) return { ok: false, reason: 'opt_out' };
  if (!userHasSocketHere(c.employeeId, c.companyId)) {
    if (await otherInstanceAlive(now)) return { ok: false, reason: 'not_on_this_instance', retryAt: new Date(now.getTime() + DEFER_MS) };
    return { ok: false, reason: 'offline' };
  }
  if (!hasFreshPresence(c.employeeId, c.companyId, now.getTime())) return { ok: false, reason: 'not_visible' };
  return { ok: true };
}

const unavailable = (errorCode: string, retryAt?: Date): ChannelAttemptResult =>
  ({ outcome: 'unavailable', retryable: !!retryAt, errorCode, ...(retryAt ? { retryAt } : {}) });

export const inAppCallChannel: ChannelAdapter = {
  name: 'inapp_call',

  async isAvailable(c) {
    const r = await check(c, c?.now instanceof Date ? c.now : new Date());
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },

  async attempt(c: ChannelCtx, r: ChannelRequest): Promise<ChannelAttemptResult> {
    const now = new Date();
    const av = await check(c, now);
    if (!av.ok) return unavailable(av.reason, av.retryAt);
    const maxDurationSec = r?.maxDurationSec ? Math.min(600, Math.max(30, Math.round(Number(r.maxDurationSec) || 120))) : undefined;
    let res;
    try {
      res = await ringUser({
        companyId: c.companyId, employeeId: c.employeeId, purpose: c.purpose, lang: c.lang === 'ru' ? 'ru' : 'uz',
        attemptKey: c.attemptKey, confirmationId: c.confirmationId, attemptNo: c.attemptNo,
        ringTimeoutSec: RING_SEC, maxDurationSec, requestText: r?.kind === 'reminder' || r?.kind === 'test' ? r.text : undefined,
      });
    } catch (e) {
      console.error('[aiVoice/inapp] qo\'ng\'iroq ochilmadi:', (e as Error).message);
      return { outcome: 'failed', retryable: true, errorCode: 'session_error' };
    }
    if (!res.ok) {
      switch (res.reason) {
        case 'busy': return { outcome: 'busy', retryable: true, errorCode: 'busy' };
        // A6: Live sig'imi to'lgan — kaskadga emas, kutib qayta urinish
        case 'platform_cap': case 'company_cap': return unavailable(res.reason, new Date(now.getTime() + BUSY_DEFER_MS));
        case 'error': return { outcome: 'failed', retryable: true, errorCode: 'session_error' };
        default: return unavailable(res.reason);
      }
    }
    const total = RING_SEC + (maxDurationSec ?? 600) + 30;
    return {
      outcome: 'no_answer', retryable: true, sessionId: res.handle.sessionId,
      awaitResponseUntil: new Date(now.getTime() + total * 1000),
    };
  },
};

export default inAppCallChannel;
