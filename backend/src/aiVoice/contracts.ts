// AI ovozli yordamchi — MUZLATILGAN shartnomalar (P1). Keyingi paketlar (P2–P8) faqat shularga
// tayanadi; bu yerdagi har qanday o'zgarish alohida P1 follow-up PR orqali bo'ladi.
// Ichida: umumiy turlar, REST DTO'lari, socket (asosiy namespace) va worker protokoli,
// binary audio kadr formati, lease xabarlari, TextAgent va VoiceProvider interfeyslari.

// ───────────────────────────── Umumiy turlar ─────────────────────────────
export type AiRole = 'direktor' | 'orinbosar' | 'prorab' | 'brigadir' | 'ishchi';
export const AI_ROLES: AiRole[] = ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'];
export type AiLang = 'uz' | 'ru';
export type Purpose = 'assistant' | 'attendance' | 'reminder' | 'test';
/** Tool qaysi kanal orqali chaqirilmoqda (executor allow-list'i shunga qaraydi). */
export type ToolChannel = 'inapp_call' | 'telegram_call' | 'bot' | 'web';
export const TOOL_CHANNELS: ToolChannel[] = ['inapp_call', 'telegram_call', 'bot', 'web'];
/** Xodimga yetkazish kanallari (attendance/reminder zanjiri). */
export type ChannelName = 'telegram_call' | 'bot_message' | 'inapp_call' | 'push' | 'notify_manager';
export const CHANNEL_NAMES: ChannelName[] = ['telegram_call', 'bot_message', 'inapp_call', 'push', 'notify_manager'];
export type CallChannel = 'telegram_call' | 'inapp_call';
export type HHmm = string;          // "08:00"
export type IsoDate = string;       // "2026-10-13"
/** ISO hafta kuni: 1 = Dushanba … 7 = Yakshanba (C7). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ───────────────────────────── Sozlamalar DTO ─────────────────────────────
/**
 * Ish jadvali (egasi qo'lda belgilaydi — bot, ilova, sayt; owner decision 2026-10-13).
 * Kun ish kunimi: skipDates → yo'q; extraWorkDates → ha; aks holda workdays (ISO) — lib/zonedTime.resolveWorkday.
 */
export interface AiShift {
  id: string;
  name: string;
  objectIds: string[];             // bo'sh = barcha obyektlar
  roles: AiRole[];
  workStart: HHmm;                 // ish boshlanish vaqti
  callLeadMin: number;             // AI so'rovi workStart'dan necha daqiqa oldin (0 = aynan workStart'da)
  /** HOSILA: workStart − callLeadMin. Server hisoblaydi (mergeDefaults), to'g'ridan-to'g'ri tahrirlanmaydi. */
  callTime: HHmm;
  workdays: IsoWeekday[];
  lateAfterMin: number;            // workStart'dan necha daqiqa keyin "kechikdi"
  absentCutoff: HHmm;
  buttonWaitMin: number;
  maxLateMin: number;              // callTime + maxLateMin'dan keyin faqat bot xabari (C2)
  skipDates: IsoDate[];            // ishlanmaydigan sanalar (bayramlar)
  extraWorkDates: IsoDate[];       // odatda dam olish kuni bo'lsa ham ishlanadigan sanalar
}

export interface AiSettingsData {
  companyId: string;
  enabled: boolean;
  language: 'uz' | 'ru' | 'auto';
  voiceName: string;
  timezone: 'Asia/Tashkent';
  disclosureText?: string;
  /** AI xarakteri (owner 2026-10-18): uslub, ism, qo'shimcha ko'rsatma. */
  persona?: { style: 'friendly' | 'formal' | 'cheerful' | 'calm' | 'strict'; name?: string; custom?: string };
  /** Telegram video qo'ng'iroqdagi avatar: 'auto' — ovoz jinsiga qarab. */
  avatar?: { look: 'auto' | 'female' | 'male' | 'orb' };
  attendance: {
    enabled: boolean;
    suppressLegacyMorningReminder: boolean;
    /** Jadvalni o'rinbosar ham tahrirlay oladimi (egasi/direktor doim; bu bayroqni faqat ular o'zgartiradi). */
    orinbosarCanEditSchedule: boolean;
    shifts: AiShift[];
  };
  calls: {
    maxAttemptsPerChannel: number; backoffMin: number[]; ringTimeoutSec: number; maxDurationSec: number;
    assistantMaxDurationSec: number; companyConcurrency: number; minGapSec: number;
    quietHours: { from: HHmm; to: HHmm };
    /** Owner 2026-10-16: firma (egasi/direktor/o'rinbosar) barcha xodimlar nomidan qo'ng'iroqqa rozi. Standart true. */
    companyConsent: boolean;
  };
  fallbackOrder: ChannelName[];
  reminders: { defaultLeadMin: number; defaultChannels: ChannelName[]; maxActivePerUser: number };
  /** byRole[role] berilmasa — registry'dagi defaultRoles ishlatiladi. Har doim kod chegarasi (maxRoles) bilan kesishtiriladi. */
  tools: { byRole: Partial<Record<AiRole, string[]>>; allowOffShiftAssistant: boolean };
  /** Realtime OVOZ provayderi (Gemini Live; zaxira — Gemini kaskad). */
  provider: {
    primary: 'gemini_live' | 'gemini_cascade'; fallback: 'gemini_cascade' | 'none';
    liveModel?: string; textModel?: string; ttsModel?: string; transcribeModel?: string;
  };
  /** MATN "miyasi" (TextAgent, llm-provider.md): Gemini asosiy → OpenRouter zaxira; Claude ixtiyoriy. */
  brain: AiBrainSettings;
  limits: {
    userSessionsPerHour: number; companyMinutesPerDay: number; monthlyBudgetUsd: number; hardStop: boolean;
    botMsgsPer10Min: number; toolCallsPerSession: number;
    /** Ishchi rollar: ulangan qo'ng'iroqdan keyingi tanaffus (s, 0..600; standart 90). Rahbarlarga limit yo'q. */
    workerCallCooldownSec?: number;
  };
  privacy: { recordAudio: false; transcriptRetentionDays: number; auditRetentionDays: number };
  version: number;
  updatedBy?: string;
}

export type TextProviderName = 'gemini' | 'groq' | 'openrouter' | 'claude';
export interface AiBrainSettings {
  /** 'claude' faqat ANTHROPIC_API_KEY sozlangan bo'lsa ishlaydi, aks holda Gemini (xatosiz). */
  provider: 'gemini' | 'claude';
  /** Asosiy provayder xato bersa (429/5xx/timeout/sozlanmagan) — OpenRouter (OPENROUTER_API_KEY bo'lsa). */
  fallback: 'openrouter' | 'none';
  /** Claude output_config.effort (bot/ovoz uchun 'low'). */
  effort: 'low' | 'medium' | 'high';
}

// ───────────────────────────── Tool kontrakti ─────────────────────────────
export interface ToolCtx {
  companyId: string;
  userId: string;
  role: AiRole;
  isOwner: boolean;
  lang: AiLang;
  tz: 'Asia/Tashkent';
  channel: ToolChannel;
  purpose: Purpose;
  sessionId?: string;
  correlationId: string;
}

export type ToolStatus = 'ok' | 'denied' | 'not_found' | 'error' | 'needs_confirmation';
/** Modelga qaytadigan natija. data HECH QACHON {} emas (Live API talabi) — bo'sh bo'lsa berilmaydi. */
export interface ToolResult {
  status: ToolStatus;
  message: string;
  data?: unknown;
  retryable: boolean;
  pendingActionId?: string;
}

/** Tasdiq kutayotgan amal (UI kartasi yoki bot ai:x tugmasi uchun) — modelga ko'rsatilmaydi. */
export interface PendingActionInfo {
  pendingActionId: string;
  /** Faqat bot tugmasi uchun (ai:x:<token>); UI/socket yo'lida bo'sh. Xeshi saqlanadi, o'zi emas. */
  token?: string;
  summary: string;
  expiresAt: string;
  confirmVia: 'ui' | 'bot';
  tool: string;
}

/** Gemini funksiya e'loni — har bir tool BLOCKING (A7). */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: JsonSchema;
  behavior: 'BLOCKING';
}

export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: (string | number)[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
  pattern?: string;
  format?: 'date' | 'time' | 'date-time' | 'objectId';
}

// ───────────────────────────── Kanal adapterlari ─────────────────────────────
export type ChannelOutcome =
  | 'answered' | 'delivered' | 'no_answer' | 'busy' | 'declined' | 'failed' | 'unavailable' | 'skipped';

export interface ChannelCtx {
  companyId: string;
  employeeId: string;
  correlationId: string;
  purpose: Purpose;
  lang: AiLang;
  now: Date;
  confirmationId?: string;
  reminderId?: string;
  stepIndex?: number;
  attemptNo: number;
  /** `${confirmationId}:${stepIndex}:${attemptNo}` — qo'ng'iroq kanallari AiCallSession.attemptKey sifatida yozadi. */
  attemptKey?: string;
}

export interface ChannelButton { text: string; data: string }   // data ≤ 64 bayt (Telegram)

export interface ChannelRequest {
  kind: 'attendance' | 'reminder' | 'manager_alert' | 'consent' | 'pending_action' | 'test';
  title?: string;
  text?: string;
  buttons?: ChannelButton[][];
  buttonToken?: string;
  ringTimeoutSec?: number;
  maxDurationSec?: number;
  urgency?: 'normal' | 'high';
}

export interface ChannelAttemptResult {
  outcome: ChannelOutcome;
  retryable: boolean;
  sessionId?: string;
  messageId?: string;
  errorCode?: string;
  /** Qo'ng'iroq yuborildi, natija keyin call.state / call.timeout orqali keladi (C1). */
  awaitResponseUntil?: Date;
  /** 429 retry_after / boshqa instansiya — shu vaqtdan keyin qayta urinish. */
  retryAt?: Date;
}

export interface ChannelAdapter {
  name: ChannelName;
  isAvailable(c: ChannelCtx): Promise<{ ok: boolean; reason?: string }>;
  attempt(c: ChannelCtx, r: ChannelRequest): Promise<ChannelAttemptResult>;
}

// ───────────────────────────── Socket (asosiy "/" namespace) ─────────────────────────────
export const AIV_CLIENT_EVENTS = {
  start: 'aiv:start',
  accept: 'aiv:accept',
  decline: 'aiv:decline',
  audio: 'aiv:audio',
  ptt: 'aiv:ptt',
  confirmAction: 'aiv:confirm-action',
  hangup: 'aiv:hangup',
  presence: 'aiv:presence',
} as const;

export const AIV_SERVER_EVENTS = {
  incoming: 'aiv:incoming',
  ready: 'aiv:ready',
  audio: 'aiv:audio',
  transcript: 'aiv:transcript',
  tool: 'aiv:tool',
  confirm: 'aiv:confirm',
  interrupted: 'aiv:interrupted',
  end: 'aiv:end',
  error: 'aiv:error',
} as const;

export interface AivStartReq { purpose: 'assistant'; ptt?: boolean }
export interface AivAcceptReq { sessionId: string }
export interface AivDeclineReq { sessionId: string; reason: 'declined' | 'busy' | 'unsupported' }
export interface AivPttReq { on: boolean }
export interface AivConfirmActionReq { pendingActionId: string; accept: boolean }
export interface AivPresenceReq { visible: boolean }
/** aiv:hangup — sessionId ixtiyoriy (bo'lmasa shu socket'ning faol sessiyasi). */
export interface AivHangupReq { sessionId?: string }

/** Socket ack xato kodlari (aiv:start / accept / confirm-action). */
export type AivErrorCode =
  | 'disabled' | 'busy' | 'platform_cap' | 'company_cap' | 'limit' | 'budget' | 'off_shift' | 'denied'
  | 'unsupported_transport' | 'not_found' | 'answered_elsewhere' | 'bad_request' | 'error';
export type AivAck = { ok: true } | { ok: false; code: AivErrorCode; message?: string };
/** aiv:start va aiv:accept ack'i: correlationId — audio kadr sarlavhasidagi 16 bayt (A10). */
export type AivSessionAck =
  | { ok: true; sessionId: string; correlationId: string }
  | { ok: false; code: AivErrorCode; message?: string };
/** aiv:confirm-action ack'i — amalning HAQIQIY natijasi (modelning so'zi emas). */
export type AivConfirmActionAck =
  | { ok: true; status: ToolStatus; message: string }
  | { ok: false; code: AivErrorCode; message?: string };

/** correlationId — mijoz yuboradigan audio kadrlar sarlavhasiga yoziladi. */
export interface AivIncoming { sessionId: string; correlationId: string; purpose: Purpose; expiresAt: string; companyName?: string }
export interface AivReady { sessionId: string; correlationId: string; inputSampleRate: 16000; outputSampleRate: 24000; frameMs: 40; ptt: boolean }
export interface AivTranscript { sessionId: string; role: 'user' | 'assistant'; text: string; final: boolean }
export interface AivToolEvent { sessionId: string; name: string; status: ToolStatus; message: string }
export interface AivConfirm { sessionId: string; pendingActionId: string; summary: string; expiresAt: string }
export type AivEndReason =
  | 'hangup' | 'completed' | 'timeout' | 'max_duration' | 'declined' | 'busy' | 'answered_elsewhere'
  | 'error' | 'shutdown' | 'revoked' | 'off_shift' | 'limit' | 'unsupported_transport';
export interface AivEnd { sessionId: string; reason: AivEndReason }
export interface AivError { code: AivErrorCode | string; message: string }

// ───────────────────────────── Binary audio kadr ─────────────────────────────
// [16 bayt UUID (correlationId)][u32 LE seq][PCM16LE …]   (A10 — ObjectId EMAS, 12 bayt bo'lardi)
export const AUDIO_FRAME_HEADER_BYTES = 20;
export const AUDIO_FRAME_MAX_BYTES = 8 * 1024;          // butun kadr (sarlavha bilan)
export const AUDIO_FRAMES_PER_SEC_MAX = 60;
export const AUDIO_IN_SAMPLE_RATE = 16000;
export const AUDIO_OUT_SAMPLE_RATE = 24000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidToBytes(uuid: string): Buffer {
  if (!UUID_RE.test(uuid)) throw new Error('BAD_UUID');
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

export function bytesToUuid(b: Uint8Array): string {
  if (b.length !== 16) throw new Error('BAD_UUID_BYTES');
  const h = Buffer.from(b).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function encodeAudioFrame(correlationId: string, seq: number, pcm: Uint8Array): Buffer {
  if (pcm.length % 2 !== 0) throw new Error('ODD_PCM_LENGTH');
  const out = Buffer.allocUnsafe(AUDIO_FRAME_HEADER_BYTES + pcm.length);
  uuidToBytes(correlationId).copy(out, 0);
  out.writeUInt32LE(seq >>> 0, 16);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(out, AUDIO_FRAME_HEADER_BYTES);
  return out;
}

export type DecodedAudioFrame = { correlationId: string; seq: number; pcm: Buffer };
/** Noto'g'ri kadr uchun null (o'lcham, juft uzunlik, sarlavha). */
export function decodeAudioFrame(buf: Uint8Array, maxBytes = AUDIO_FRAME_MAX_BYTES): DecodedAudioFrame | null {
  if (!buf || buf.length < AUDIO_FRAME_HEADER_BYTES + 2 || buf.length > maxBytes) return null;
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const pcmLen = b.length - AUDIO_FRAME_HEADER_BYTES;
  if (pcmLen % 2 !== 0) return null;
  return { correlationId: bytesToUuid(b.subarray(0, 16)), seq: b.readUInt32LE(16), pcm: b.subarray(AUDIO_FRAME_HEADER_BYTES) };
}

// ───────────────────────────── Worker protokoli ("/aiv-worker") ─────────────────────────────
// Faqat websocket transporti. Autentifikatsiya: Ed25519 challenge-response (A5) — backend
// faqat AIV_WORKER_PUBKEY'ni biladi. Telegram sessiyasi backendga HECH QACHON yuborilmaydi.
export const AIV_WORKER_NAMESPACE = '/aiv-worker';

export const WORKER_EVENTS = {
  challenge: 'worker:challenge',        // s → w   WorkerChallenge
  auth: 'worker:auth',                  // w → s   WorkerAuthRequest  (ack: WorkerAuthAck)
  leaseAcquire: 'worker:lease.acquire', // w → s   {}                  (ack: LeaseAck)
  leaseRenew: 'worker:lease.renew',     // w → s   LeaseRenewRequest   (ack: LeaseAck)
  leaseRelease: 'worker:lease.release', // w → s   LeaseRenewRequest   (ack: {ok})
  leaseRevoked: 'worker:lease.revoked', // s → w   {leaseId}  — worker darhol Telethon'ni uzadi
  rpc: 'worker:rpc',                    // s → w   WorkerRpcRequest    (ack: WorkerRpcResponse)
  event: 'worker:event',                // w → s   WorkerEvent
  audio: 'worker:audio',                // ikki tomonga, binary kadr
  incomingCall: 'worker:incoming.call', // w → s   IncomingCallRequest (ack: IncomingCallAck) — "Ochiq muloqot"
  video: 'worker:video',                // w → s   binary: 16 bayt kadr UUID + 4 bayt (0) + JPEG — suhbatdosh kamerasi
} as const;

/** "Ochiq muloqot": AI akkauntiga kiruvchi shaxsiy qo'ng'iroq — qarorni backend beradi. */
export interface IncomingCallRequest { tgUserId: string; workerBusy?: boolean; at?: number; /** worker: faol qo'ng'iroqlar / kutilayotgan kiruvchilar soni (diagnostika) */ activeCount?: number; pending?: number }
export type IncomingCallAck =
  | { accept: true; sessionId: string; maxDurationSec: number; /** video avatar ko'rinishi */ avatar?: string }
  | { accept: false; reason: string };

export interface WorkerHandshakeAuth { workerId: string; version: string }
export interface WorkerChallenge { nonce: string; expiresAt: number; instanceId: string }
export interface WorkerAuthRequest { workerId: string; nonce: string; signature: string /* base64 */ }
export interface WorkerAuthAck { ok: boolean; error?: string; /** bad_signature'da: backenddagi ochiq kalit boshi (sir emas, diagnostika) */ keyHint?: string }
/** Imzolanadigan xabar (UTF-8). */
export function workerChallengeMessage(workerId: string, nonce: string): string {
  return `aiv-worker\n${workerId}\n${nonce}`;
}

export interface LeaseRenewRequest { leaseId: string }
export type LeaseAck =
  | { ok: true; leaseId: string; leaseUntil: number; renewEveryMs: number }
  | { ok: false; reason: 'held' | 'lost' | 'unauthenticated' | 'error'; retryAfterMs?: number };

export interface WorkerRpcMethods {
  'auth.start': { params: { loginAttemptId: string; phone: string }; result: { status: 'awaiting_code' | 'awaiting_password' | 'connected'; phoneMasked?: string } };
  'auth.code': { params: { loginAttemptId: string; code: string }; result: { status: 'awaiting_password' | 'connected'; tgUserId?: string; username?: string; displayName?: string } };
  'auth.password': { params: { loginAttemptId: string; password: string }; result: { status: 'connected'; tgUserId?: string; username?: string; displayName?: string } };
  'auth.logout': { params: Record<string, never>; result: { ok: true } };
  'status': { params: Record<string, never>; result: WorkerStatus };
  'contact.resolve': {
    params: { employeeId: string; expectedTgUserId: string; username?: string; phone?: string; allowImport: boolean };
    result: { status: 'resolved' | 'not_found' | 'privacy_restricted' | 'mismatch' | 'flood_wait'; tgUserId?: string; retryAfterSec?: number };
  };
  'binding.expect': { params: { employeeId: string; codeHash: string; expectedTgUserId: string; expiresAt: number }; result: { ok: true } };
  /** phone/username — faqat peer noma'lum bo'lsa, SHU qo'ng'iroq uchun (worker saqlamaydi, log qilmaydi). */
  'call.place': { params: { sessionId: string; tgUserId: string; timeoutSec: number; maxDurationSec: number; phone?: string; username?: string; avatar?: string; video?: boolean }; result: { accepted: boolean; reason?: string } };
  /** AI'ning joriy gapi — video avatar subtitri va kayfiyati (owner 2026-10-18). */
  'call.caption': { params: { sessionId: string; text: string; emotion?: string }; result: { ok: true } };
  /** Kamera kadrlari tezligi (videoga olishda vaqtincha ko'proq). */
  'call.video_rate': { params: { sessionId: string; fps: number; forSec: number }; result: { ok: true } };
  /** Video avatar subtitri (standart o'chiq; foydalanuvchi so'rasa yoqiladi). */
  'call.subtitles': { params: { sessionId: string; on: boolean }; result: { ok: true; on?: boolean } };
  /** AI hozir nima qilyapti (tool boshlandi/tugadi) — video avatar pozasi va belgisi. */
  'call.avatar': { params: { sessionId: string; tool: string; phase: 'start' | 'end'; status?: string }; result: { ok: true } };
  'call.hangup': { params: { sessionId: string; reason: string }; result: { ok: true } };
  'udp.probe': { params: Record<string, never>; result: { ok: boolean; details?: string } };
  /** "Ochiq muloqot" holati (standart o'chiq) — worker 'up' bo'lganda va o'zgarganda yuboriladi. */
  'incoming.config': { params: { open: boolean }; result: { ok: true; open?: boolean } };
}
export type WorkerRpcMethod = keyof WorkerRpcMethods;
export interface WorkerRpcRequest<M extends WorkerRpcMethod = WorkerRpcMethod> {
  requestId: string;                    // noyob (nonce emas — A5)
  method: M;
  params: WorkerRpcMethods[M]['params'];
  deadlineMs: number;
}
export interface WorkerRpcError { code: string; message: string; retryAfterSec?: number }
export type WorkerRpcResponse<M extends WorkerRpcMethod = WorkerRpcMethod> =
  | { requestId: string; ok: true; result: WorkerRpcMethods[M]['result'] }
  | { requestId: string; ok: false; error: WorkerRpcError };

export interface WorkerStatus {
  version: string;
  connected: boolean;                   // Telethon ulangan va avtorizatsiyadan o'tgan
  tgUserId?: string;
  username?: string;
  activeCalls: number;
  udpOk?: boolean;
  floodWaitUntil?: number;
  /** Worker'dagi "Ochiq muloqot" holati (backend bilan solishtirish uchun). */
  openConversation?: boolean;
}

export type WorkerCallState = 'dialing' | 'ringing' | 'connected' | 'ended';
export type WorkerCallEndReason =
  | 'completed' | 'busy' | 'declined' | 'timeout' | 'privacy' | 'blocked' | 'outdated' | 'flood_wait' | 'network' | 'hangup' | 'error';
export type WorkerEvent =
  | { type: 'call.state'; sessionId: string; state: WorkerCallState; reason?: WorkerCallEndReason; at: number; /** ulanmaslik bosqichi: accept | key_exchange | p2p_connect | connect_timeout | record */ stage?: string }
  | { type: 'health'; status: WorkerStatus; at: number }
  | { type: 'binding.matched'; employeeId: string; tgUserId: string; username?: string; at: number };

// ───────────────────────────── TextAgent (P2 amalga oshiradi) ─────────────────────────────
export interface TextAgentInput {
  ctx: ToolCtx;
  history: { role: 'user' | 'assistant'; text: string }[];
  userText: string;
  signal?: AbortSignal;
  maxToolRounds?: number;               // standart 5
}
export interface TextAgentOutput {
  text: string;
  toolCalls: { name: string; status: ToolStatus; message: string }[];
  pendingActions: PendingActionInfo[];
  usage: { model: string; tokensIn: number; tokensOut: number; provider?: TextProviderName | 'none'; costUsdMicros?: number };
}
export interface TextAgent {
  run(input: TextAgentInput): Promise<TextAgentOutput>;
}

// ───────────────────────────── VoiceProvider (P5 amalga oshiradi) ─────────────────────────────
export interface VoiceOpenOpts {
  model: string;
  systemInstruction: string;
  tools: ToolDeclaration[];
  lang: AiLang;
  voiceName: string;
  ptt: boolean;
  resumptionHandle?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

export interface VoiceUsage { tokensIn: number; tokensOut: number; audioInSec: number; audioOutSec: number }

export interface VoiceSessionEvents {
  setupComplete: () => void;
  audioOut: (pcm24k: Buffer) => void;
  transcript: (t: { role: 'user' | 'assistant'; text: string; final: boolean }) => void;
  toolCall: (c: { id: string; name: string; args: Record<string, unknown> }) => void;
  interrupted: () => void;
  goAway: (g: { timeLeftMs: number }) => void;
  resumption: (r: { handle: string }) => void;
  usage: (u: VoiceUsage) => void;
  closed: (c: { reason: string; error?: string }) => void;
}

export interface VoiceSession {
  on<E extends keyof VoiceSessionEvents>(event: E, cb: VoiceSessionEvents[E]): void;
  pushAudio(pcm16k: Buffer): void;
  activityStart(): void;
  activityEnd(): void;
  /** Matnli navbat (masalan oldindan ijro etilgan disclosure'dan keyingi "start"). silent — javob so'ramasdan kontekstga. */
  sendText(text: string, opts?: { silent?: boolean }): void;
  /** Suhbatdosh kamerasi kadri (JPEG) — faqat ko'ra oladigan provayderlar (Gemini Live). */
  sendVideo?(jpeg: Buffer): void;
  toolResponse(responses: { id: string; name: string; result: ToolResult }[]): void;
  close(reason: string): Promise<void>;
}

export interface VoiceProvider {
  readonly name: 'gemini_live' | 'gemini_cascade' | 'fake';
  open(opts: VoiceOpenOpts): Promise<VoiceSession>;
}

// ───────────────────────────── REST DTO'lar (P3/P4/P6/P8) ─────────────────────────────
/** Ish jadvalini tor yangilash (bot menyusi P4, sozlamalar UI P8) — settings.updateSchedule. */
export interface AiSchedulePatch {
  workStart?: HHmm;
  callLeadMin?: number;
  workdays?: IsoWeekday[];
  addSkipDates?: IsoDate[];
  removeSkipDates?: IsoDate[];
  addExtraWorkDates?: IsoDate[];
  removeExtraWorkDates?: IsoDate[];
}

export interface AiToolCatalogEntry {
  name: string; kind: 'read' | 'write'; description: { uz: string; ru: string };
  maxRoles: AiRole[]; defaultRoles: AiRole[]; channels: ToolChannel[]; purposes: Purpose[];
}
export interface AiMePrefsDto {
  languageOverride?: AiLang;
  channelOrder?: ChannelName[];
  disabledChannels: ChannelName[];
  callConsent: 'none' | 'requested' | 'granted' | 'revoked';
  optOut: { calls: boolean; reminders: boolean; all: boolean };
  /** Shaxsiy jim soatlar (P3 qo'shimchasi); null — o'rnatilmagan (faqat firma jim soatlari). */
  quietHours?: { from: HHmm; to: HHmm } | null;
}
export interface AiEmployeeRowDto {
  userId: string; name: string; role: string;
  telegramLinked: boolean; resolveStatus: string; callConsent: string;
  optOut: { calls: boolean; reminders: boolean; all: boolean };
  channelOrder?: ChannelName[]; disabledChannels: ChannelName[];
}
export interface AiTelegramAccountDto {
  status: string; username?: string; displayName?: string; phoneMasked?: string;
  workerConnected: boolean; workerVersion?: string; lastHealthAt?: string; udpOk?: boolean;
  floodWaitUntil?: string; dailyCallCount: number; dailyCap: number;
}

// ── /api/ai-voice/admin (P8 backend + P8 UI) ──
/** GET /admin/settings. providers — faqat "sozlanganmi" (kalit qiymatlari HECH QACHON qaytmaydi). */
export interface AiSettingsViewDto {
  settings: AiSettingsData;
  editor: { canEditSchedule: boolean; canEditBossRows: boolean };
  providers: { gemini: boolean; openrouter: boolean; claude: boolean };
  status: { aiVoiceEnabled: boolean; planHasFeature: boolean; companyActive: boolean };
}
/** PUT /admin/settings — qisman yangilash; version mos kelmasa 409 {current: AiSettingsViewDto}. */
export interface AiSettingsPutReq { version: number; patch: Record<string, unknown> }
/** PATCH /admin/schedule (va bot menyusi) — settings.updateSchedule'ga boradi. */
export interface AiScheduleUpdateReq { shiftId: string; patch: AiSchedulePatch }
/** PATCH /admin/employees/:userId — shaxsiy rozilik maydoni RAD etiladi; optOut — rahbar qo'yadi (owner 2026-10-16). */
export interface AiEmployeePatchReq {
  channelOrder?: ChannelName[] | null; disabledChannels?: ChannelName[];
  /** Owner 2026-10-16: rahbar xodim uchun opt-out qo'yadi (ConsentLog source:'admin'). */
  optOut?: Partial<{ calls: boolean; reminders: boolean; all: boolean }>;
}
export interface AiAttendanceRowDto {
  confirmationId: string; employeeId: string; name: string; shiftId: string; date: IsoDate;
  status: 'pending' | 'confirmed' | 'late' | 'declined' | 'no_answer' | 'call_failed' | 'checked_in' | 'absent';
  voiceAnswer: string; buttonAnswer: string; checkInAt?: string; lastChannel?: ChannelName; attempts: number;
}
export interface AiRunNowReq { shiftId: string }
export interface AiTestCallReq { userId: string; channel: ChannelName }

// ── /api/ai-voice/me (P3 backend; P8 MyAiPrefsPanel UI) ──
/** PATCH /me — faqat o'zi uchun (consent.ts orqali, ConsentLog source:'me'). */
export interface AiMePrefsPatchReq {
  languageOverride?: AiLang | null;
  channelOrder?: ChannelName[] | null;
  disabledChannels?: ChannelName[];
  callConsent?: 'granted' | 'revoked';
  optOut?: Partial<{ calls: boolean; reminders: boolean; all: boolean }>;
  /** null — shaxsiy jim soatlarni o'chirish (P3 qo'shimchasi). */
  quietHours?: { from: HHmm; to: HHmm } | null;
}
export interface AiReminderDto {
  id: string; text: string; targetUserId: string; ownerId: string; dueAt: string; nextFireAt?: string;
  recurrence: { freq: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'; interval: number; byWeekday: IsoWeekday[]; until?: string; count?: number };
  status: 'active' | 'done' | 'cancelled' | 'failed' | 'missed'; channels: ChannelName[];
}
export interface AiReminderCreateReq {
  text: string; dueAt: string; targetUserId?: string; channels?: ChannelName[];
  recurrence?: Partial<AiReminderDto['recurrence']>; idempotencyKey?: string;
}
/** POST /me/attendance/:id/respond — bot tugmalarining veb ekvivalenti. */
export interface AiAttendanceRespondReq { answer: 'confirm' | 'late' | 'decline' }
/** GET /me/pending-call — muddati o'tmagan AI qo'ng'irog'i (bildirishnomadan ochganlar uchun). */
export type AiPendingCallDto = { call: AivIncoming | null };
