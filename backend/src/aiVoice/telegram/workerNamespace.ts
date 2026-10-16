import { EventEmitter } from 'events';
import type { Namespace, Server, Socket } from 'socket.io';
import AiChannelConnection from '../../models/AiChannelConnection';
import { aiConfig, INSTANCE_ID } from '../config';
import {
  AIV_WORKER_NAMESPACE, AUDIO_FRAME_MAX_BYTES, WORKER_EVENTS,
  type IncomingCallAck, type IncomingCallRequest, type LeaseAck, type WorkerAuthAck, type WorkerAuthRequest, type WorkerEvent,
} from '../contracts';
import { issueWorkerChallenge, verifyWorkerAuth, workerAuthConfigured } from '../lib/workerAuth';
import { acquireWorkerLease, releaseWorkerLease, renewWorkerLease } from '../lib/workerLease';

// Telegram qo'ng'iroq worker'i uchun "/aiv-worker" namespace (contracts.ts WORKER_EVENTS).
// services/socket.ts initSocket'da io yaratilgandan keyin registerAiWorkerNamespace(io) ni chaqiradi.
//
// Qoidalar (review A4/A5/A10/C3):
//  • faqat websocket transporti; handshake'da workerId/version;
//  • Ed25519 challenge-response (lib/workerAuth) — server nonce bir martalik; 15 s ichida
//    autentifikatsiyadan o'tmagan socket uziladi;
//  • fencing lease (lib/workerLease): bitta vaqtda faqat BITTA worker lease ushlaydi, ikkinchisi lease
//    tugaguncha (+10 s) rad etiladi; lease egasi socket'i shu instansiyada bo'lsa — workerConnectedHere();
//  • backend lease'ni worker NOMIDAN bo'shatmaydi — worker Telethon'ni uzgandan keyin o'zi bo'shatadi.
// Worker voqealari (call.state/health/binding.matched) va audio kadrlar workerHub orqali tarqatiladi
// (callBridge/accountService tinglaydi) — bu fayl ularni import qilmaydi (aylanma import yo'q).

export interface ActiveWorker { socket: Socket; workerId: string; version: string; leaseId: string }

interface ConnState { workerId: string; version: string; authed: boolean; authTimer?: NodeJS.Timeout }

const WORKER_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
export const WORKER_AUTH_TIMEOUT_MS = 15_000;
const EVENT_MAX_PER_SEC = 50;

/** Hodisalar: 'event' (WorkerEvent), 'audio' (Buffer), 'up' (ActiveWorker), 'down' ({workerId, reason}). */
export const workerHub = new EventEmitter();
workerHub.setMaxListeners(50);

let nsp: Namespace | null = null;
let active: ActiveWorker | null = null;

// "Ochiq muloqot": kiruvchi qo'ng'iroq qarori (incomingCalls.ts o'rnatadi — aylanma import bo'lmasin)
type IncomingHandler = (req: IncomingCallRequest) => Promise<IncomingCallAck>;
let incomingHandler: IncomingHandler | null = null;
export function setIncomingCallHandler(h: IncomingHandler | null): void { incomingHandler = h; }

/** Shu instansiyada lease egasi bo'lgan, ulangan worker (RPC va audio uchun). */
export function getActiveWorker(): ActiveWorker | null {
  if (active && !active.socket.connected) active = null;
  return active;
}

/** Shu instansiyada autentifikatsiyadan o'tgan worker ulanganmi (JobQueue requires:'worker' filtri, C3). */
export function workerConnectedHere(): boolean {
  return !!getActiveWorker();
}

/** Workerga binary audio kadr yuborish (faqat lease egasiga). */
export function sendWorkerAudio(frame: Buffer): boolean {
  const w = getActiveWorker();
  if (!w) return false;
  w.socket.emit(WORKER_EVENTS.audio, frame);
  return true;
}

function setActive(socket: Socket, st: ConnState, leaseId: string): void {
  const prev = active;
  if (prev && prev.socket !== socket && prev.socket.connected) {
    // Eski socket (uzilib qayta ulangan worker'ning osilgan ulanishi) — endi lease egasi emas
    prev.socket.disconnect(true);
  }
  active = { socket, workerId: st.workerId, version: st.version, leaseId };
  workerHub.emit('up', active);
}

function clearActive(socket: Socket, reason: string): void {
  if (active && active.socket === socket) {
    const workerId = active.workerId;
    active = null;
    workerHub.emit('down', { workerId, reason });
  }
}

const ackFn = (ack: unknown): ((v: unknown) => void) => (typeof ack === 'function' ? (ack as (v: unknown) => void) : () => undefined);

function onConnection(socket: Socket): void {
  const hs = (socket.handshake.auth || {}) as Record<string, unknown>;
  const st: ConnState = { workerId: String(hs.workerId || ''), version: String(hs.version || '').slice(0, 32), authed: false };

  st.authTimer = setTimeout(() => { if (!st.authed) socket.disconnect(true); }, WORKER_AUTH_TIMEOUT_MS);
  st.authTimer.unref?.();

  issueWorkerChallenge(st.workerId)
    .then((ch) => socket.emit(WORKER_EVENTS.challenge, ch))
    .catch(() => socket.disconnect(true));

  socket.on(WORKER_EVENTS.auth, async (req: WorkerAuthRequest, ack: unknown) => {
    const reply = ackFn(ack);
    if (st.authed) return reply({ ok: true } satisfies WorkerAuthAck);
    if (!req || req.workerId !== st.workerId) {
      reply({ ok: false, error: 'bad_request' } satisfies WorkerAuthAck);
      socket.disconnect(true);
      return;
    }
    try {
      const r = await verifyWorkerAuth(req);
      if (!r.ok) {
        reply({ ok: false, error: r.error } satisfies WorkerAuthAck);
        socket.disconnect(true);
        return;
      }
      st.authed = true;
      if (st.authTimer) clearTimeout(st.authTimer);
      reply({ ok: true } satisfies WorkerAuthAck);
    } catch {
      reply({ ok: false, error: 'error' } satisfies WorkerAuthAck);
      socket.disconnect(true);
    }
  });

  socket.on(WORKER_EVENTS.leaseAcquire, async (_p: unknown, ack: unknown) => {
    const reply = ackFn(ack);
    if (!st.authed) return reply({ ok: false, reason: 'unauthenticated' } satisfies LeaseAck);
    try {
      const r = await acquireWorkerLease({ workerId: st.workerId, workerVersion: st.version, instanceId: INSTANCE_ID });
      if (r.ok) setActive(socket, st, r.leaseId);
      reply(r);
    } catch {
      reply({ ok: false, reason: 'error', retryAfterMs: 5_000 } satisfies LeaseAck);
    }
  });

  socket.on(WORKER_EVENTS.leaseRenew, async (p: { leaseId?: unknown }, ack: unknown) => {
    const reply = ackFn(ack);
    if (!st.authed) return reply({ ok: false, reason: 'unauthenticated' } satisfies LeaseAck);
    const leaseId = typeof p?.leaseId === 'string' ? p.leaseId : '';
    try {
      const r = await renewWorkerLease(leaseId);
      if (r.ok) {
        // Qayta ulangan worker o'z lease'ini davom ettirdi — egasi endi shu instansiya
        if (!active || active.socket !== socket || active.leaseId !== leaseId) {
          await AiChannelConnection.updateOne(
            { scope: 'platform', companyId: null, type: 'telegram_user', leaseId },
            { $set: { workerInstanceId: INSTANCE_ID, workerId: st.workerId, workerVersion: st.version } },
          );
          setActive(socket, st, leaseId);
        }
      } else if (active?.socket === socket) {
        clearActive(socket, 'lease_lost');
      }
      reply(r);
    } catch {
      reply({ ok: false, reason: 'error', retryAfterMs: 2_000 } satisfies LeaseAck);
    }
  });

  socket.on(WORKER_EVENTS.leaseRelease, async (p: { leaseId?: unknown }, ack: unknown) => {
    const reply = ackFn(ack);
    if (!st.authed) return reply({ ok: false });
    const leaseId = typeof p?.leaseId === 'string' ? p.leaseId : '';
    try {
      const ok = await releaseWorkerLease(leaseId);
      if (active?.socket === socket && active.leaseId === leaseId) clearActive(socket, 'released');
      reply({ ok });
    } catch {
      reply({ ok: false });
    }
  });

  // Voqealar va audio — faqat lease egasidan (boshqa ulanishlar e'tiborsiz)
  let winStart = Date.now();
  let winCount = 0;
  const overRate = () => {
    const now = Date.now();
    if (now - winStart >= 1000) { winStart = now; winCount = 0; }
    return ++winCount > EVENT_MAX_PER_SEC;
  };

  socket.on(WORKER_EVENTS.event, (ev: WorkerEvent, ack: unknown) => {
    const reply = ackFn(ack);
    if (!st.authed || active?.socket !== socket || !ev || typeof ev !== 'object' || overRate()) return reply({ ok: false });
    workerHub.emit('event', ev);
    reply({ ok: true });
  });

  socket.on(WORKER_EVENTS.incomingCall, async (req: IncomingCallRequest, ack: unknown) => {
    const reply = ackFn(ack);
    if (!st.authed || active?.socket !== socket || !req || typeof req !== 'object' || overRate()) return reply({ accept: false, reason: 'not_leased' } satisfies IncomingCallAck);
    if (!incomingHandler) return reply({ accept: false, reason: 'not_ready' } satisfies IncomingCallAck);
    try {
      reply(await incomingHandler(req));
    } catch (e) {
      console.error("[aiVoice/telegram] kiruvchi qo'ng'iroq xatosi:", (e as Error)?.name || 'Error');
      reply({ accept: false, reason: 'error' } satisfies IncomingCallAck);
    }
  });

  socket.on(WORKER_EVENTS.audio, (buf: unknown) => {
    if (!st.authed || active?.socket !== socket) return;
    if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array)) return;
    if (buf.length > AUDIO_FRAME_MAX_BYTES) return;
    workerHub.emit('audio', Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  });

  socket.on('disconnect', () => {
    if (st.authTimer) clearTimeout(st.authTimer);
    clearActive(socket, 'disconnect');
  });
}

export function registerAiWorkerNamespace(io: Server): void {
  if (!aiConfig.enabled) return;
  if (nsp) return;
  nsp = io.of(AIV_WORKER_NAMESPACE);
  nsp.use((socket, next) => {
    // A10: long-polling binary'ni base64 qiladi va kechikish qo'shadi — faqat websocket
    if (socket.conn.transport.name !== 'websocket') return next(new Error('websocket_only'));
    if (!workerAuthConfigured()) return next(new Error('not_configured'));
    const hs = (socket.handshake.auth || {}) as Record<string, unknown>;
    if (typeof hs.workerId !== 'string' || !WORKER_ID_RE.test(hs.workerId)) return next(new Error('bad_handshake'));
    if (hs.version !== undefined && typeof hs.version !== 'string') return next(new Error('bad_handshake'));
    next();
  });
  nsp.on('connection', onConnection);
}

/**
 * SIGTERM drain: lease egasiga lease.revoked yuboriladi (worker qo'ng'iroqni yopib Telethon'ni uzadi,
 * keyin yangi instansiyaga ulanib lease'ni o'zi bo'shatadi va qayta oladi), namespace yopiladi.
 * Lease bu yerda bo'shatilmaydi — fencing faqat worker Telethon'ni uzgandan keyin (A4).
 */
export async function closeWorkerNamespace(): Promise<void> {
  const n = nsp;
  nsp = null;
  const w = active;
  if (w?.socket.connected) {
    try { w.socket.emit(WORKER_EVENTS.leaseRevoked, { leaseId: w.leaseId }); } catch { /* yopilmoqda */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (w) clearActive(w.socket, 'shutdown');
  if (n) {
    n.disconnectSockets(true);
    n.removeAllListeners();
  }
}

/** Faqat testlar uchun: modul holatini tozalash (namespace qayta ro'yxatga olinishi uchun). */
export function __resetWorkerNamespaceForTests(): void {
  nsp = null;
  active = null;
}
