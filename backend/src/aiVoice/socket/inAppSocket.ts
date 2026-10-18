import type { Socket } from 'socket.io';
import AiCallSession from '../../models/AiCallSession';
import { WORKER_ROLES, isOnShift } from '../../middleware/workGate';
import { aiConfig } from '../config';
import {
  AIV_CLIENT_EVENTS as C, AIV_SERVER_EVENTS as S, AUDIO_FRAME_MAX_BYTES, AUDIO_FRAMES_PER_SEC_MAX,
  decodeAudioFrame, encodeAudioFrame,
  type AiLang, type AivConfirmActionAck, type AivEndReason, type AivErrorCode, type AivIncoming, type AivSessionAck, type Purpose,
} from '../contracts';
import { isObjectIdString } from '../lib/ids';
import { checkUserCallLimit, callLimitMessage } from '../voice/callLimits';
import { sanitizeForPrompt } from '../lib/untrusted';
import { getCompanyAiState, getSettings } from '../settings';
import { confirmPendingAction } from '../tools/executor';
import { getVoiceSessionManager, resolveVoiceLang } from '../voice/sessionManager';
import type { StartVoiceSessionResult, VoiceSessionHandle, VoiceTransport } from '../voice/types';

// In-app ovozli qo'ng'iroq — asosiy "/" namespace'dagi aiv:* hodisalari (contracts.ts AIV_*).
// services/socket.ts har ulanishda registerAiVoiceSocket(socket) ni chaqiradi; socket.data
// (userId/companyId/role) u yerda JWT + DB orqali tekshirilgan (P0). AI o'chiq — tinglovchi yo'q.
//
// Qoidalar (review A10/A11, P5):
//  • faqat websocket transporti (long-polling binary'ni base64 qiladi) — aks holda unsupported_transport;
//  • audio kadr ≤8 KB, juft PCM uzunligi, ≤60 kadr/s (socket bo'yicha), FAQAT sessiyaga bog'langan socket'dan;
//  • aiv:start (foydalanuvchi o'zi qo'ng'iroq qiladi — chat AI kontakti yoki yordamchi tugmasi):
//    voice/callLimits (rahbarlarga limit yo'q, ishchilarga tanaffus), ishchi rollar smenadan tashqarida rad;
//  • AI qo'ng'irog'i (attendance/reminder) foydalanuvchining shu instansiyadagi barcha socket'lariga
//    aiv:incoming; birinchi aiv:accept yutadi (sinxron — atomik), qolgan tablar 'answered_elsewhere';
//  • presence: aiv:presence {visible} — mavjudlik = visible && lastSeen < 60 s (A11);
//  • ulanish uzilsa 15 s kutiladi (mijoz qayta ulanib aiv:accept bilan qayta bog'lanadi), keyin yakun.
// Realtime bitta instansiyaga mo'ljallangan (config.ts, C3): bu yerdagi xaritalar faqat shu jarayonniki.

const PRESENCE_FRESH_MS = 60_000;
const RING_TIMEOUT_SEC = 30;
const REBIND_GRACE_MS = 15_000;
const STALE_BOUND_MS = 4_000;

interface SockEntry {
  socket: Socket;
  userId: string;
  companyId: string;
  role: string;
  visible: boolean;
  lastSeen: number;
  win: { start: number; count: number };
  badFrames: number;
  warmedAt: number;
}

const byUser = new Map<string, Map<string, SockEntry>>();
const calls = new Map<string, InAppCall>();
const byCorrelation = new Map<string, InAppCall>();
const starting = new Set<string>();

const isWebsocket = (s: Socket): boolean => (s.conn as any)?.transport?.name === 'websocket';
const WS_UPGRADE_WAIT_MS = 3_000;
const WARM_EVENT = 'aiv:warm';          // mijoz AI chatini ochganda — disclosure klipini isitish
const WARM_GAP_MS = 5 * 60_000;

/**
 * Polling → websocket yangilanishini qisqa kutadi (Render/Cloudflare ortida birinchi soniyalarda
 * transport hali polling bo'lishi mumkin — darhol 'unsupported_transport' qaytarmaymiz).
 */
function waitWebsocket(s: Socket, ms = WS_UPGRADE_WAIT_MS): Promise<boolean> {
  if (isWebsocket(s)) return Promise.resolve(true);
  const conn: any = s.conn;
  if (!conn || typeof conn.once !== 'function' || !s.connected) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      try { conn.off?.('upgrade', finish); } catch { /* */ }
      resolve(isWebsocket(s));
    };
    const t = setTimeout(finish, ms);
    t.unref?.();
    conn.once('upgrade', () => setImmediate(finish));
  });
}

function entryOf(socketId: string, userId: string): SockEntry | undefined {
  return byUser.get(userId)?.get(socketId);
}

function emitToSocket(userId: string, socketId: string, event: string, payload: unknown) {
  const e = entryOf(socketId, userId);
  if (e?.socket.connected) e.socket.emit(event, payload);
}

/** Engine.io yozish buferidagi baytlar (yuborilmagan) — chiqish navbati cap'i uchun. */
function socketBacklogBytes(s: Socket | null): number {
  const wb: any[] = (s?.conn as any)?.writeBuffer;
  if (!Array.isArray(wb) || !wb.length) return 0;
  let n = 0;
  for (const p of wb) {
    const d = p?.data;
    if (d && typeof d.length === 'number') n += d.length;
    else if (d && typeof d.byteLength === 'number') n += d.byteLength;
  }
  return n;
}

/** Bitta in-app qo'ng'iroq: VoiceTransport (menejer → mijoz) va socket bog'lanishi. */
class InAppCall implements VoiceTransport {
  readonly kind = 'inapp' as const;
  handle: VoiceSessionHandle | null = null;
  sessionId = '';
  correlationId = '';
  bound: Socket | null = null;
  readonly ringing = new Set<string>();
  readonly lost = new Set<string>();
  accepted: boolean;
  ended = false;
  lastInAt = 0;
  /** aiv:ready birinchi marta yuborilganda (haqiqatan ulangan qo'ng'iroq) — soatlik hisobga yoziladi. */
  onReady: (() => void) | null = null;
  private seq = 0;
  private graceTimer: NodeJS.Timeout | null = null;

  constructor(readonly userId: string, readonly companyId: string, readonly purpose: Purpose, readonly userInitiated: boolean) {
    this.accepted = userInitiated;
  }

  register(h: VoiceSessionHandle) {
    this.handle = h;
    this.sessionId = h.sessionId;
    this.correlationId = h.correlationId;
    calls.set(this.sessionId, this);
    byCorrelation.set(this.correlationId, this);
  }

  bind(s: Socket) {
    this.bound = s;
    this.lastInAt = Date.now();
    this.cancelGrace();
    if (this.sessionId) AiCallSession.updateOne({ _id: this.sessionId, isActive: true }, { $set: { socketId: s.id } }).catch(() => undefined);
  }

  // ── VoiceTransport ──
  sendAudio(pcm24k: Buffer): void {
    const s = this.bound;
    if (this.ended || !s?.connected || !this.correlationId || !pcm24k?.length) return;
    const pcm = pcm24k.length % 2 ? pcm24k.subarray(0, pcm24k.length - 1) : pcm24k;
    s.emit(S.audio, encodeAudioFrame(this.correlationId, this.seq, pcm));
    this.seq = (this.seq + 1) >>> 0;
  }

  /** Server navbatini menejer tozalaydi; mijoz o'z buferini aiv:interrupted bilan tozalaydi. */
  flushAudio(): void { /* no-op */ }

  sendEvent(event: string, payload: unknown): void {
    if (event === S.ready && this.onReady) { const f = this.onReady; this.onReady = null; try { f(); } catch { /* */ } }
    const s = this.bound;
    if (!this.ended && s?.connected) s.emit(event, payload);
  }

  backlogBytes(): number { return socketBacklogBytes(this.bound); }

  close(reason: AivEndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.cancelGrace();
    const payload = { sessionId: this.sessionId, reason };
    const sent = new Set<string>();
    if (this.bound?.connected) { this.bound.emit(S.end, payload); sent.add(this.bound.id); }
    for (const sid of this.ringing) if (!sent.has(sid) && !this.lost.has(sid)) emitToSocket(this.userId, sid, S.end, payload);
    if (calls.get(this.sessionId) === this) calls.delete(this.sessionId);
    if (byCorrelation.get(this.correlationId) === this) byCorrelation.delete(this.correlationId);
  }

  // ── Uzilish ──
  startGrace() {
    if (this.graceTimer || this.ended) return;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.ended || this.bound?.connected) return;
      void this.handle?.end(this.accepted ? 'error' : 'hangup');
    }, REBIND_GRACE_MS);
    this.graceTimer.unref?.();
  }

  cancelGrace() {
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
  }
}

function ackFn(ack: unknown): (r: unknown) => void {
  return typeof ack === 'function' ? (r) => { try { (ack as (x: unknown) => void)(r); } catch { /* */ } } : () => undefined;
}

const fail = (code: AivErrorCode, message?: string) => ({ ok: false as const, code, ...(message ? { message } : {}) });

function failCode(reason: Extract<StartVoiceSessionResult, { ok: false }>['reason']): AivErrorCode {
  return reason;   // menejer sabablari AivErrorCode'ning qism-to'plami
}

/** Sessiya so'rovidagi sessionId'ga mos (shu foydalanuvchiniki) qo'ng'iroq. */
function callFor(userId: string, sessionId: unknown): InAppCall | undefined {
  if (typeof sessionId !== 'string' || !isObjectIdString(sessionId)) return undefined;
  const c = calls.get(sessionId);
  return c && c.userId === userId && !c.ended ? c : undefined;
}

function boundCall(socketId: string): InAppCall | undefined {
  for (const c of calls.values()) if (!c.ended && c.bound?.id === socketId) return c;
  return undefined;
}

// ───────────── Ro'yxatga olish ─────────────
export function registerAiVoiceSocket(socket: Socket): void {
  if (!aiConfig.enabled) return;
  const userId = String(socket.data?.userId || '');
  const companyId = socket.data?.companyId ? String(socket.data.companyId) : '';
  if (!userId) return;
  const entry: SockEntry = {
    socket, userId, companyId, role: String(socket.data?.role || ''), visible: false, lastSeen: 0,
    win: { start: 0, count: 0 }, badFrames: 0, warmedAt: 0,
  };
  let m = byUser.get(userId);
  if (!m) { m = new Map(); byUser.set(userId, m); }
  m.set(socket.id, entry);

  socket.on(C.presence, (req: unknown) => {
    entry.visible = !!(req as any)?.visible;
    entry.lastSeen = Date.now();
  });

  socket.on(C.start, async (req: unknown, ack: unknown) => {
    const reply = ackFn(ack);
    try { reply(await handleStart(entry, req)); } catch (e) {
      console.error('[aiVoice] aiv:start xatosi:', (e as Error).message);
      reply(fail('error'));
    }
  });

  socket.on(C.accept, async (req: unknown, ack: unknown) => {
    const reply = ackFn(ack);
    try {
      // Avval transport (kutish), keyin accept — accept'ning o'zi sinxron (atomik) qoladi
      if (!(await waitWebsocket(socket))) return reply(fail('unsupported_transport'));
      reply(handleAccept(entry, req));
    } catch (e) {
      console.error('[aiVoice] aiv:accept xatosi:', (e as Error).message);
      reply(fail('error'));
    }
  });

  socket.on(WARM_EVENT, () => {
    const now = Date.now();
    if (!entry.companyId || now - entry.warmedAt < WARM_GAP_MS) return;
    entry.warmedAt = now;
    void getVoiceSessionManager().prewarm?.(entry.companyId, entry.userId);
  });

  socket.on(C.decline, (req: unknown, ack: unknown) => {
    const reply = ackFn(ack);
    const call = callFor(userId, (req as any)?.sessionId);
    if (!call) return reply(fail('not_found'));
    const reason = (req as any)?.reason;
    if (call.accepted) {
      // Ulangan qo'ng'iroqni faqat bog'langan socket rad eta oladi (= tugatish)
      if (call.bound?.id === socket.id) void call.handle?.end('hangup');
      return reply({ ok: true });
    }
    if (reason === 'unsupported') {
      // Bu qurilma qo'llamaydi (mikrofon yo'q) — boshqa tab qabul qilishi mumkin
      call.ringing.delete(socket.id);
      call.lost.add(socket.id);
      if (![...call.ringing].some((sid) => entryOf(sid, userId)?.socket.connected)) void call.handle?.end('unsupported_transport');
      return reply({ ok: true });
    }
    void call.handle?.end(reason === 'busy' ? 'busy' : 'declined');
    reply({ ok: true });
  });

  socket.on(C.hangup, (req: unknown, ack: unknown) => {
    const reply = ackFn(ack);
    const call = callFor(userId, (req as any)?.sessionId) || boundCall(socket.id);
    if (!call) return reply(fail('not_found'));
    if (!call.accepted) void call.handle?.end('declined');
    else if (call.bound?.id === socket.id || !call.bound?.connected) void call.handle?.end('hangup');
    else return reply(fail('answered_elsewhere'));
    reply({ ok: true });
  });

  socket.on(C.ptt, (req: unknown) => {
    const call = boundCall(socket.id);
    if (!call?.handle) return;
    call.lastInAt = Date.now();
    if ((req as any)?.on) call.handle.activityStart(); else call.handle.activityEnd();
  });

  socket.on(C.audio, (data: unknown) => onAudio(entry, data));

  socket.on(C.confirmAction, async (req: unknown, ack: unknown) => {
    const reply = ackFn(ack);
    try { reply(await handleConfirm(entry, req)); } catch (e) {
      console.error('[aiVoice] aiv:confirm-action xatosi:', (e as Error).message);
      reply(fail('error'));
    }
  });

  socket.on('disconnect', () => {
    const mm = byUser.get(userId);
    mm?.delete(socket.id);
    if (mm && !mm.size) byUser.delete(userId);
    for (const c of calls.values()) {
      if (c.userId !== userId || c.ended) continue;
      if (c.bound?.id === socket.id) c.startGrace();
      else if (!c.accepted) c.ringing.delete(socket.id);
    }
  });
}

// ───────────── Hodisa ishlovchilari ─────────────
async function handleStart(e: SockEntry, req: unknown): Promise<AivSessionAck> {
  const r = req as any;
  if (!r || r.purpose !== 'assistant') return fail('bad_request');
  if (!(await waitWebsocket(e.socket))) return fail('unsupported_transport');
  if (!e.companyId || !isObjectIdString(e.userId)) return fail('denied');
  if (starting.has(e.userId)) return fail('busy');
  starting.add(e.userId);
  try {
    const settings = await getSettings(e.companyId);
    // Ishchi rollar smenadan tashqarida AI'ga qo'ng'iroq qila olmaydi (design §7, workGate bilan bir xil)
    if (WORKER_ROLES.includes(e.role) && !settings.tools.allowOffShiftAssistant && !(await isOnShift(e.userId))) return fail('off_shift');
    const lang: AiLang = await resolveVoiceLang(e.companyId, e.userId, settings);
    // Owner 2026-10-17: rahbarlarga limit yo'q; ishchilarga qisqa tanaffus. Faqat HAQIQATAN ulangan
    // qo'ng'iroqlar sanaladi (answeredAt) — ulanmay qolgan urinishlar limitni yemaydi.
    const lim = await checkUserCallLimit({ companyId: e.companyId, employeeId: e.userId, role: e.role, settings });
    if (!lim.ok) return fail('limit', callLimitMessage(lang, lim));

    const call = new InAppCall(e.userId, e.companyId, 'assistant', true);
    call.bound = e.socket;
    call.lastInAt = Date.now();
    const res = await getVoiceSessionManager().start({
      companyId: e.companyId, employeeId: e.userId, purpose: 'assistant', channel: 'inapp_call', lang, ptt: !!r.ptt,
      transport: call, socketId: e.socket.id, userInitiated: true, ringTimeoutSec: RING_TIMEOUT_SEC,
    });
    if (!res.ok) return fail(failCode(res.reason));
    const h = res.handle;
    call.register(h);
    if (call.ended) return fail('error');
    if (!e.socket.connected) { void h.end('hangup'); return fail('error'); }
    // Ack'dan keyin ulanamiz: mijoz avval sessionId/correlationId'ni oladi, keyin aiv:ready
    setImmediate(() => { void h.connected().catch((err) => console.error('[aiVoice] connected xatosi:', (err as Error).message)); });
    return { ok: true, sessionId: h.sessionId, correlationId: h.correlationId };
  } finally {
    starting.delete(e.userId);
  }
}

function handleAccept(e: SockEntry, req: unknown): AivSessionAck {
  if (!isWebsocket(e.socket)) return fail('unsupported_transport');
  const call = callFor(e.userId, (req as any)?.sessionId);
  if (!call || !call.handle) return fail('not_found');
  const ok: AivSessionAck = { ok: true, sessionId: call.sessionId, correlationId: call.correlationId };
  if (!call.accepted) {
    // Atomik: tekshirish va belgilash bitta sinxron qadamda — ikkinchi tab 'answered_elsewhere' oladi
    call.accepted = true;
    call.bind(e.socket);
    for (const sid of call.ringing) {
      if (sid === e.socket.id) continue;
      call.lost.add(sid);
      emitToSocket(call.userId, sid, S.end, { sessionId: call.sessionId, reason: 'answered_elsewhere' });
    }
    const h = call.handle;
    setImmediate(() => { void h.connected().catch((err) => console.error('[aiVoice] connected xatosi:', (err as Error).message)); });
    return ok;
  }
  if (call.bound?.id === e.socket.id) return ok;                 // takroriy — idempotent
  if (call.lost.has(e.socket.id)) return fail('answered_elsewhere');
  // Qayta ulanish (yangi socket id): eski socket uzilgan yoki jim bo'lsa — qayta bog'lanadi
  const old = call.bound;
  if (!old || !old.connected || Date.now() - call.lastInAt > STALE_BOUND_MS) {
    if (old?.connected && old.id !== e.socket.id) old.emit(S.end, { sessionId: call.sessionId, reason: 'answered_elsewhere' });
    if (old) call.lost.add(old.id);
    call.bind(e.socket);
    return ok;
  }
  return fail('answered_elsewhere');
}

function onAudio(e: SockEntry, data: unknown) {
  const now = Date.now();
  if (now - e.win.start >= 1000) { e.win.start = now; e.win.count = 0; }
  if (++e.win.count > AUDIO_FRAMES_PER_SEC_MAX) { e.badFrames++; return; }
  if (!isWebsocket(e.socket)) { e.badFrames++; return; }
  let buf: Uint8Array | null = null;
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) buf = data;
  else if (data instanceof ArrayBuffer) buf = new Uint8Array(data);
  if (!buf || buf.length > AUDIO_FRAME_MAX_BYTES) { e.badFrames++; return; }
  const f = decodeAudioFrame(buf);
  if (!f) { e.badFrames++; return; }
  const call = byCorrelation.get(f.correlationId);
  // Faqat shu sessiyaga bog'langan socket'dan (A10) — boshqa tab/foydalanuvchi audio qo'sha olmaydi
  if (!call || call.ended || call.userId !== e.userId || call.bound?.id !== e.socket.id) { e.badFrames++; return; }
  call.lastInAt = now;
  call.handle?.pushAudio(Buffer.from(f.pcm));
}

async function handleConfirm(e: SockEntry, req: unknown): Promise<AivConfirmActionAck> {
  const r = req as any;
  if (!r || typeof r.pendingActionId !== 'string' || !isObjectIdString(r.pendingActionId) || typeof r.accept !== 'boolean') return fail('bad_request');
  const call = boundCall(e.socket.id);
  if (call?.handle) return call.handle.confirmAction(r.pendingActionId, r.accept);
  // Qo'ng'iroq tugagan bo'lsa ham karta hali amalda bo'lishi mumkin — executor atomik tasdiqlaydi (B3)
  if (!e.companyId) return fail('denied');
  const settings = await getSettings(e.companyId);
  const lang = await resolveVoiceLang(e.companyId, e.userId, settings);
  const out = await confirmPendingAction({ pendingActionId: r.pendingActionId, actorUserId: e.userId, companyId: e.companyId, channel: 'inapp_call', accept: r.accept, lang });
  if (out.result.status === 'error' && !out.auditId) return fail('not_found', out.result.message);
  return { ok: true, status: out.result.status, message: out.result.message };
}

// ───────────── Kanal (inAppCallChannel) uchun API ─────────────
/** Foydalanuvchining shu instansiyada socket'i bormi. */
export function userHasSocketHere(userId: string, companyId?: string): boolean {
  const m = byUser.get(String(userId));
  if (!m) return false;
  for (const e of m.values()) if (e.socket.connected && (!companyId || e.companyId === companyId)) return true;
  return false;
}

/** A11: kamida bitta socket ko'rinadigan va oxirgi presence < 60 s. */
export function hasFreshPresence(userId: string, companyId?: string, now = Date.now()): boolean {
  const m = byUser.get(String(userId));
  if (!m) return false;
  for (const e of m.values()) {
    if (!e.socket.connected || (companyId && e.companyId !== companyId)) continue;
    if (e.visible && now - e.lastSeen < PRESENCE_FRESH_MS) return true;
  }
  return false;
}

export interface RingUserOpts {
  companyId: string;
  employeeId: string;
  purpose: Purpose;
  lang: AiLang;
  attemptKey?: string;
  confirmationId?: string;
  attemptNo?: number;
  jobId?: string;
  ringTimeoutSec?: number;
  maxDurationSec?: number;
  requestText?: string;
}

/**
 * AI → foydalanuvchi qo'ng'irog'i: sessiya ochiladi (provayder ringing paytida oldindan ulanadi) va
 * foydalanuvchining shu instansiyadagi barcha socket'lariga aiv:incoming. Natija keyinroq
 * finishSession → onSessionsEnded orqali (answered/no_answer/declined) keladi.
 */
export async function ringUser(o: RingUserOpts): Promise<StartVoiceSessionResult> {
  // Socket bo'lmasa sessiya umuman ochilmaydi (keyingi kanalga — ikki marta natija bo'lmasin)
  if (!userHasSocketHere(o.employeeId, o.companyId)) return { ok: false, reason: 'error' };
  const call = new InAppCall(o.employeeId, o.companyId, o.purpose, false);
  const ringSec = Math.max(5, Math.min(60, Math.round(o.ringTimeoutSec ?? RING_TIMEOUT_SEC)));
  const res = await getVoiceSessionManager().start({
    companyId: o.companyId, employeeId: o.employeeId, purpose: o.purpose, channel: 'inapp_call', lang: o.lang, ptt: false,
    transport: call, attemptKey: o.attemptKey, confirmationId: o.confirmationId, attemptNo: o.attemptNo, jobId: o.jobId,
    ringTimeoutSec: ringSec, maxDurationSec: o.maxDurationSec, requestText: o.requestText, userInitiated: false,
  });
  if (!res.ok) return res;
  call.register(res.handle);
  if (call.ended) return { ok: false, reason: 'error' };
  const st = await getCompanyAiState(o.companyId).catch(() => null);
  const incoming: AivIncoming = {
    sessionId: call.sessionId, correlationId: call.correlationId, purpose: o.purpose,
    expiresAt: new Date(Date.now() + ringSec * 1000).toISOString(),
    ...(st?.name ? { companyName: sanitizeForPrompt(st.name, 60) } : {}),
  };
  const m = byUser.get(o.employeeId);
  for (const e of m?.values() || []) {
    if (!e.socket.connected || e.companyId !== o.companyId) continue;
    call.ringing.add(e.socket.id);
    e.socket.emit(S.incoming, incoming);
  }
  if (!call.ringing.size) { await res.handle.end('error'); return { ok: false, reason: 'error' }; }
  return res;
}

/** SIGTERM drain: shu instansiyadagi jonli in-app sessiyalarni 'interrupted' qilib yopadi (bootstrap chaqiradi). */
export async function shutdownAiVoiceSockets(_reason: 'shutdown'): Promise<void> {
  const list = [...calls.values()].filter((c) => !c.ended && c.handle);
  await Promise.all(list.map((c) => c.handle!.end('shutdown').catch(() => undefined)));
}

/** Faqat testlar uchun. */
export function __resetInAppSocketsForTests(): void {
  byUser.clear(); calls.clear(); byCorrelation.clear(); starting.clear();
}
