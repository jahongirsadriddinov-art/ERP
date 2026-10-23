import AiCallSession, { type AiCallStatus } from '../../models/AiCallSession';
import AiEmployeeContact from '../../models/AiEmployeeContact';
import {
  AIV_SERVER_EVENTS, AUDIO_FRAME_HEADER_BYTES, AUDIO_FRAME_MAX_BYTES, AUDIO_FRAMES_PER_SEC_MAX, decodeAudioFrame, encodeAudioFrame,
  type AivEndReason, type WorkerCallEndReason, type WorkerEvent,
} from '../contracts';
import { finishSession, onSessionsEnded } from '../sessions';
import type { VoiceSessionHandle, VoiceTransport } from '../voice/types';
import { setFloodWait } from './accountService';
import { callWorker } from './workerRpc';
import { sendWorkerAudio, workerHub } from './workerNamespace';

// Telegram qo'ng'irog'i ↔ VoiceSessionManager ko'prigi (P5 menejeri voice/types.ts interfeysi orqali).
//
// Audio kadr sarlavhasidagi 16 baytli UUID: call.place parametrlarida correlationId yo'q (contracts muzlatilgan),
// shuning uchun ikki tomon ham sessionId'dan (24 hex = 12 bayt) olingan "kadr UUID"ni ishlatadi:
// sessionId + '00000000' → UUID ko'rinishi (worker ham aynan shunday hisoblaydi — app/bridge.py session_frame_uuid).
// Backend → worker: 24 kHz PCM16LE; worker → backend: 16 kHz PCM16LE (worker o'zi 48 kHz'ga/dan o'tkazadi).
// Faqat sarlavhadan iborat kadr (PCM yo'q, seq = 0xFFFFFFFF) — "buferni tozalash" (barge-in) belgisi.

export const FLUSH_SEQ = 0xffffffff;
const WORKER_LOST_GRACE_MS = 20_000;   // worker o'zi ham 20 s'da Telethon'ni uzadi (A4)
const MAX_PCM_PER_FRAME = (AUDIO_FRAME_MAX_BYTES - AUDIO_FRAME_HEADER_BYTES) & ~1;

export function sessionFrameUuid(sessionId: string): string {
  if (!/^[0-9a-fA-F]{24}$/.test(sessionId)) throw new Error('BAD_SESSION_ID');
  const h = (sessionId + '00000000').toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface Bridge {
  sessionId: string;
  frameUuid: string;
  handle: VoiceSessionHandle;
  employeeId: string;
  companyId: string;
  answered: boolean;
  ended: boolean;
  lostTimer?: NodeJS.Timeout;
  inWin: { start: number; count: number };
}

const bridges = new Map<string, Bridge>();
const byUuid = new Map<string, string>();

/** VoiceTransport (kind 'telegram'): menejer chiqargan 24 kHz audio → worker. sessionId start'dan keyin bog'lanadi. */
export class TelegramTransport implements VoiceTransport {
  readonly kind = 'telegram' as const;
  private sessionId: string | null = null;
  private frameUuid: string | null = null;
  private seq = 0;
  private closed = false;

  bind(sessionId: string): void {
    this.sessionId = sessionId;
    this.frameUuid = sessionFrameUuid(sessionId);
  }

  sendAudio(pcm24k: Buffer): void {
    if (this.closed || !this.frameUuid || !pcm24k?.length) return;
    const pcm = pcm24k.length % 2 === 0 ? pcm24k : pcm24k.subarray(0, pcm24k.length - 1);
    for (let off = 0; off < pcm.length; off += MAX_PCM_PER_FRAME) {
      const part = pcm.subarray(off, Math.min(pcm.length, off + MAX_PCM_PER_FRAME));
      if (!part.length) continue;
      sendWorkerAudio(encodeAudioFrame(this.frameUuid, this.seq, part));
      this.seq = (this.seq + 1) % FLUSH_SEQ;
    }
  }

  flushAudio(): void {
    if (this.closed || !this.frameUuid) return;
    const h = Buffer.alloc(AUDIO_FRAME_HEADER_BYTES);
    Buffer.from(this.frameUuid.replace(/-/g, ''), 'hex').copy(h, 0);
    h.writeUInt32LE(FLUSH_SEQ, 16);
    sendWorkerAudio(h);
  }

  // Telegram qo'ng'irog'ida UI yo'q. Faqat AI gapi — video avatar subtitri uchun workerga (debounce 400 ms).
  private capTimer: NodeJS.Timeout | null = null;
  private capText = '';
  sendEvent(event: string, payload: unknown): void {
    if (this.closed || !this.sessionId || event !== AIV_SERVER_EVENTS.transcript) return;
    const p = payload as { role?: string; text?: string };
    if (p?.role !== 'assistant' || !p.text) return;
    this.capText = String(p.text).slice(-400);
    if (this.capTimer) return;
    this.capTimer = setTimeout(() => {
      this.capTimer = null;
      if (this.closed || !this.sessionId || !this.capText) return;
      callWorker('call.caption', { sessionId: this.sessionId, text: this.capText }).catch(() => undefined);
    }, 400);
    this.capTimer.unref?.();
  }

  activity(a: { tool: string; phase: 'start' | 'end'; status?: string }): void {
    if (this.closed || !this.sessionId) return;
    callWorker('call.avatar', { sessionId: this.sessionId, tool: String(a.tool).slice(0, 40), phase: a.phase, ...(a.status ? { status: String(a.status).slice(0, 24) } : {}) })
      .catch(() => undefined);
  }

  close(reason: AivEndReason): void {
    if (this.closed) return;
    this.closed = true;
    if (this.capTimer) { clearTimeout(this.capTimer); this.capTimer = null; }
    const sid = this.sessionId;
    if (!sid) return;
    const b = bridges.get(sid);
    // Ko'prik yo'q (terilmagan / worker o'zi yakunlagan / worker yo'qolgan) yoki yakunlangan — hangup shart emas
    if (!b || b.ended) return;
    b.ended = true;
    dropBridge(sid);
    callWorker('call.hangup', { sessionId: sid, reason: String(reason).slice(0, 40) }).catch(() => undefined);
  }
}

export function registerBridge(p: { sessionId: string; handle: VoiceSessionHandle; employeeId: string; companyId: string }): void {
  const frameUuid = sessionFrameUuid(p.sessionId);
  bridges.set(p.sessionId, { ...p, frameUuid, answered: false, ended: false, inWin: { start: 0, count: 0 } });
  byUuid.set(frameUuid, p.sessionId);
}

function dropBridge(sessionId: string): void {
  const b = bridges.get(sessionId);
  if (!b) return;
  if (b.lostTimer) clearTimeout(b.lostTimer);
  bridges.delete(sessionId);
  byUuid.delete(b.frameUuid);
}

/** Qo'ng'iroq terilmadi (call.place rad etildi) — ko'prik olib tashlanadi, hangup yuborilmaydi. */
export function unregisterBridge(sessionId: string): void {
  const b = bridges.get(sessionId);
  if (b) b.ended = true;
  dropBridge(sessionId);
}

export function activeBridgeCount(): number { return bridges.size; }

/** Yangi sessiya ko'prigi ro'yxatga olinguncha (start → registerBridge) tegilmaydigan muddat. */
const STALE_MIN_AGE_MS = 15_000;

/**
 * Worker "bo'shman" degan paytda chaqiriladi (worker shu instansiyada): bazada faol, lekin bu yerda
 * ko'prigi yo'q (yoki ulangan deb belgilangan, ammo worker'da qo'ng'iroq yo'q) Telegram sessiyalari —
 * tugagan qo'ng'iroq qoldig'i; darhol yopiladi, keyingi qo'ng'iroq 'busy' bo'lmasin (owner 2026-10-17).
 */
export async function reapStaleTelegramSessions(now: Date = new Date()): Promise<number> {
  const docs: any[] = await AiCallSession.find({ channel: 'telegram_call', isActive: true, createdAt: { $lt: new Date(now.getTime() - STALE_MIN_AGE_MS) } })
    .select('_id answeredAt').limit(20).lean();
  let n = 0;
  for (const d of docs) {
    const sid = String(d._id);
    const b = bridges.get(sid);
    if (b && !b.answered) continue;                   // terilmoqda / jiringlamoqda — tirik
    // Yaqinda ulangan — voqealar poygasi (health eski holat bilan kelgan bo'lishi mumkin)
    if (b && d.answeredAt && now.getTime() - new Date(d.answeredAt).getTime() < STALE_MIN_AGE_MS) continue;
    if (b) { b.ended = true; dropBridge(sid); b.handle.end('error').catch(() => undefined); }
    const m = mapEndReason('network', !!d.answeredAt);
    if (await finishSession(sid, m.status, 'tg:stale', { errorCode: 'stale', now })) n++;
  }
  if (n) console.warn(`[aiVoice/telegram] ${n} ta osilib qolgan Telegram sessiyasi yopildi`);
  return n;
}

// ───────────── Natijalarni xaritalash ─────────────

/** Worker tugash sababi → AiCallSession holati (P3 mapSessionStatus shu holatdan kanal natijasini oladi). */
export function mapEndReason(reason: WorkerCallEndReason | undefined, answered: boolean): { status: Exclude<AiCallStatus, 'queued' | 'dialing' | 'ringing' | 'connected'>; aiv: AivEndReason } {
  switch (reason) {
    case 'completed':
    case 'hangup': return answered ? { status: 'completed', aiv: 'hangup' } : { status: 'no_answer', aiv: 'timeout' };
    case 'busy': return { status: 'busy', aiv: 'busy' };
    case 'declined': return { status: 'declined', aiv: 'declined' };
    case 'timeout': return { status: 'no_answer', aiv: 'timeout' };
    // Qayta urinib foyda yo'q — 'cancelled' (P3: failed, retryable:false) → keyingi kanal
    case 'privacy': case 'blocked': case 'outdated': case 'flood_wait': case 'spam_limited': case 'account_frozen': return { status: 'cancelled', aiv: 'error' };
    case 'network': case 'error': default:
      return answered ? { status: 'interrupted', aiv: 'error' } : { status: 'failed', aiv: 'error' };
  }
}

async function applyEndSideEffects(b: { employeeId: string; companyId: string }, reason?: WorkerCallEndReason): Promise<void> {
  if (reason === 'privacy' || reason === 'blocked') {
    await AiEmployeeContact.updateOne(
      { companyId: b.companyId, employeeId: b.employeeId },
      { $set: { 'telegram.resolveStatus': reason === 'privacy' ? 'privacy_restricted' : 'blocked' } },
    );
  }
}

// ───────────── Worker voqealari ─────────────

// Qo'ng'iroq ulanmaganda (media / tarmoq) — zaxira xabar (telegram/callFailureNotice.ts; health.ts ulaydi)
export type CallFailureNotifier = (p: { sessionId: string; employeeId: string; companyId: string; reason: string; stage?: string }) => Promise<void>;
let failureNotifier: CallFailureNotifier | null = null;
export function setCallFailureNotifier(fn: CallFailureNotifier | null): void { failureNotifier = fn; }

export async function handleCallState(ev: Extract<WorkerEvent, { type: 'call.state' }>, now: Date = new Date()): Promise<void> {
  const sid = String(ev?.sessionId || '');
  if (!/^[0-9a-fA-F]{24}$/.test(sid)) return;
  const b = bridges.get(sid);
  if (!b) {
    // Bu instansiya bilmaydigan qo'ng'iroq (masalan backend qayta ishga tushgan) — yopamiz
    if (ev.state !== 'ended') callWorker('call.hangup', { sessionId: sid, reason: 'orphan' }).catch(() => undefined);
    else {
      const s: any = await AiCallSession.findOne({ _id: sid, channel: 'telegram_call', isActive: true }).select('answeredAt').lean();
      if (s) { const m = mapEndReason(ev.reason, !!s.answeredAt); await finishSession(sid, m.status, `tg:${ev.reason || 'ended'}`, { errorCode: ev.reason, now }); }
    }
    return;
  }
  if (b.ended) return;
  switch (ev.state) {
    case 'dialing':
      await AiCallSession.updateOne({ _id: sid, isActive: true, status: { $in: ['queued', 'dialing'] } }, { $set: { status: 'dialing', startedAt: now } });
      return;
    case 'ringing':
      await AiCallSession.updateOne({ _id: sid, isActive: true, status: { $in: ['queued', 'dialing', 'ringing'] } }, { $set: { status: 'ringing', ringingAt: now } });
      return;
    case 'accepted':
      // Javob berildi, media hali ulanmagan — "Ошибка соединения" shu va 'connected' orasida bo'ladi
      console.info(`[aiVoice/telegram] call_event=accepted sid=…${sid.slice(-6)}`);
      return;
    case 'connected':
      if (b.answered) return;
      b.answered = true;
      await AiCallSession.updateOne({ _id: sid, isActive: true }, { $set: { status: 'connected', answeredAt: now } });
      try { await b.handle.connected(); } catch (e) { console.error('[aiVoice/telegram] connected xatosi:', (e as Error).message); }
      return;
    case 'ended': {
      b.ended = true;
      // Ulanmaslik bosqichi (worker diagnostikasi) — faqat qisqa kod, endReason'da ko'rinadi
      const stage = typeof ev.stage === 'string' && /^[a-z0-9_]{1,24}$/.test(ev.stage) ? `@${ev.stage}` : '';
      const m = mapEndReason(ev.reason, b.answered);
      const failedToConnect = !b.answered && (ev.reason === 'network' || ev.reason === 'error');
      if (failedToConnect) {
        // Tuzilgan log — keyingi ulanmaslikda aniq sabab (bosqich, xato sinfi, urinishlar) ko'rinsin
        const cls = typeof ev.errorClass === 'string' ? ev.errorClass.replace(/[^\w.]/g, '').slice(0, 40) : '';
        console.warn(`[aiVoice/telegram] call_event=failed sid=…${sid.slice(-6)} reason=${ev.reason} stage=${ev.stage || '-'} attempts=${Number(ev.attempts) || 1}${cls ? ` err=${cls}` : ''}`);
      }
      try {
        await applyEndSideEffects(b, ev.reason);
        // Avval aniq holat bilan yakunlanadi; menejerning keyingi finishSession'i no-op bo'ladi
        await finishSession(sid, m.status, `tg:${ev.reason || 'ended'}${stage}`, { errorCode: ev.reason, now });
      } finally {
        dropBridge(sid);
        try { await b.handle.end(m.aiv); } catch { /* allaqachon yopilgan */ }
      }
      // Qo'ng'iroq ulanmadi — bot orqali matnli xabar (zaxira kanal); hech qachon otmaydi
      if (failedToConnect && failureNotifier) {
        failureNotifier({ sessionId: sid, employeeId: b.employeeId, companyId: b.companyId, reason: ev.reason!, stage: ev.stage })
          .catch((e) => console.error('[aiVoice/telegram] zaxira xabar:', (e as Error).message));
      }
      return;
    }
  }
}

export function handleWorkerAudio(buf: Buffer): void {
  const f = decodeAudioFrame(buf);
  if (!f) return;
  const sid = byUuid.get(f.correlationId);
  const b = sid ? bridges.get(sid) : undefined;
  if (!b || b.ended) return;
  const now = Date.now();
  if (now - b.inWin.start >= 1000) b.inWin = { start: now, count: 0 };
  if (++b.inWin.count > AUDIO_FRAMES_PER_SEC_MAX) return;
  b.handle.pushAudio(f.pcm);
}

/** Worker uzildi: 20 s ichida qaytmasa — barcha ko'prik qo'ng'iroqlar yakunlanadi (worker ham shu vaqtda o'zini to'xtatadi). */
function onWorkerDown(): void {
  for (const b of bridges.values()) {
    if (b.lostTimer || b.ended) continue;
    b.lostTimer = setTimeout(() => {
      b.lostTimer = undefined;
      if (b.ended) return;
      b.ended = true;
      const m = mapEndReason('network', b.answered);
      finishSession(b.sessionId, m.status, 'tg:worker_lost', { errorCode: 'worker_lost' })
        .catch(() => undefined)
        .finally(() => { dropBridge(b.sessionId); b.handle.end('error').catch(() => undefined); });
    }, WORKER_LOST_GRACE_MS);
    b.lostTimer.unref?.();
  }
}

function onWorkerUp(): void {
  for (const b of bridges.values()) {
    if (b.lostTimer) { clearTimeout(b.lostTimer); b.lostTimer = undefined; }
  }
}

let initialized = false;

/** Worker voqealari va sessiya yakunlarini tinglash (idempotent). */
export function initCallBridge(): void {
  if (initialized) return;
  initialized = true;
  workerHub.on('event', (ev: WorkerEvent) => {
    if (ev?.type !== 'call.state') return;
    if (ev.reason === 'flood_wait') setFloodWait(Date.now() + 10 * 60_000).catch(() => undefined);
    handleCallState(ev).catch((e) => console.error('[aiVoice/telegram] call.state xatosi:', (e as Error).message));
  });
  workerHub.on('audio', handleWorkerAudio);
  workerHub.on('video', handleWorkerVideo);
  workerHub.on('down', onWorkerDown);
  workerHub.on('up', onWorkerUp);
  // Sessiya tashqaridan yakunlansa (sweep, blok, max_duration) — Telegram qo'ng'irog'i ham yopiladi
  onSessionsEnded((list) => {
    for (const s of list) {
      if (s.channel !== 'telegram_call') continue;
      const b = bridges.get(s.sessionId);
      if (!b || b.ended) continue;
      b.ended = true;
      dropBridge(s.sessionId);
      callWorker('call.hangup', { sessionId: s.sessionId, reason: String(s.reason).slice(0, 40) }).catch(() => undefined);
    }
  });
}

/** Suhbatdosh kamerasi kadri (worker → backend): 16 bayt UUID + 4 bayt + JPEG. Faqat ulangan qo'ng'iroq. */
export function handleWorkerVideo(buf: Buffer): void {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return;
  const h = buf.subarray(0, 16).toString('hex');
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  const sid = byUuid.get(uuid);
  const b = sid ? bridges.get(sid) : undefined;
  if (!b || b.ended || !b.answered) return;
  b.handle.pushVideo?.(buf.subarray(20));
}

/** Faqat testlar uchun. */
export function __resetCallBridgeForTests(): void {
  for (const id of [...bridges.keys()]) dropBridge(id);
}
