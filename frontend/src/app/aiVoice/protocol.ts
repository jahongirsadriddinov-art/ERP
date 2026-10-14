// AI ovozli yordamchi — frontend protokoli. backend/src/aiVoice/contracts.ts'ning (MUZLATILGAN, P1)
// mijozga tegishli qismining aynan nusxasi: socket hodisa nomlari, DTO'lar va binary audio kadr.
// O'zgarish faqat ikkala faylda birga (P1 follow-up) — protocol.test.ts mosligini tekshiradi.

// ───────────── Umumiy turlar ─────────────
export type AiRole = 'direktor' | 'orinbosar' | 'prorab' | 'brigadir' | 'ishchi';
export type AiLang = 'uz' | 'ru';
export type Purpose = 'assistant' | 'attendance' | 'reminder' | 'test';
export type ToolStatus = 'ok' | 'denied' | 'not_found' | 'error' | 'needs_confirmation';
export type ChannelName = 'telegram_call' | 'bot_message' | 'inapp_call' | 'push' | 'notify_manager';
export const CHANNEL_NAMES: ChannelName[] = ['telegram_call', 'bot_message', 'inapp_call', 'push', 'notify_manager'];

// ───────────── Socket (asosiy "/" namespace) ─────────────
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

export interface AivIncoming { sessionId: string; purpose: Purpose; expiresAt: string; companyName?: string }
export interface AivReady { sessionId: string; inputSampleRate: 16000; outputSampleRate: 24000; frameMs: 40; ptt: boolean }
export interface AivTranscript { sessionId: string; role: 'user' | 'assistant'; text: string; final: boolean }
export interface AivToolEvent { sessionId: string; name: string; status: ToolStatus; message: string }
export interface AivConfirm { sessionId: string; pendingActionId: string; summary: string; expiresAt: string }
export type AivEndReason =
  | 'hangup' | 'completed' | 'timeout' | 'max_duration' | 'declined' | 'busy' | 'answered_elsewhere'
  | 'error' | 'shutdown' | 'revoked' | 'off_shift' | 'limit' | 'unsupported_transport';
export interface AivEnd { sessionId: string; reason: AivEndReason }
export interface AivError { code: string; message: string }

// ───────────── REST DTO'lar (P3/P6/P8 to'ldiradi) ─────────────
export interface AiMePrefsDto {
  languageOverride?: AiLang;
  channelOrder?: ChannelName[];
  disabledChannels: ChannelName[];
  callConsent: 'none' | 'requested' | 'granted' | 'revoked';
  optOut: { calls: boolean; reminders: boolean; all: boolean };
}
export interface AiTelegramAccountDto {
  status: string; username?: string; displayName?: string; phoneMasked?: string;
  workerConnected: boolean; workerVersion?: string; lastHealthAt?: string; udpOk?: boolean;
  floodWaitUntil?: string; dailyCallCount: number; dailyCap: number;
}

// ───────────── Binary audio kadr ─────────────
// [16 bayt UUID (correlationId)][u32 LE seq][PCM16LE …]
export const AUDIO_FRAME_HEADER_BYTES = 20;
export const AUDIO_FRAME_MAX_BYTES = 8 * 1024;          // butun kadr (sarlavha bilan)
export const AUDIO_FRAMES_PER_SEC_MAX = 60;
export const AUDIO_IN_SAMPLE_RATE = 16000;
export const AUDIO_OUT_SAMPLE_RATE = 24000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_RE.test(uuid)) throw new Error('BAD_UUID');
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToUuid(b: Uint8Array): string {
  if (b.length !== 16) throw new Error('BAD_UUID_BYTES');
  let h = '';
  for (let i = 0; i < 16; i++) h += b[i].toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** PCM16LE baytlari (Int16Array ham bo'ladi — platformalar little-endian). */
export function encodeAudioFrame(correlationId: string, seq: number, pcm: Uint8Array | Int16Array): Uint8Array {
  const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  if (bytes.length % 2 !== 0) throw new Error('ODD_PCM_LENGTH');
  const out = new Uint8Array(AUDIO_FRAME_HEADER_BYTES + bytes.length);
  out.set(uuidToBytes(correlationId), 0);
  new DataView(out.buffer).setUint32(16, seq >>> 0, true);
  out.set(bytes, AUDIO_FRAME_HEADER_BYTES);
  return out;
}

export type DecodedAudioFrame = { correlationId: string; seq: number; pcm: Uint8Array };

/** Noto'g'ri kadr uchun null (o'lcham, juft uzunlik, sarlavha). socket.io ArrayBuffer ham berishi mumkin. */
export function decodeAudioFrame(input: ArrayBuffer | Uint8Array, maxBytes = AUDIO_FRAME_MAX_BYTES): DecodedAudioFrame | null {
  if (!input) return null;
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < AUDIO_FRAME_HEADER_BYTES + 2 || b.length > maxBytes) return null;
  if ((b.length - AUDIO_FRAME_HEADER_BYTES) % 2 !== 0) return null;
  const seq = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(16, true);
  return { correlationId: bytesToUuid(b.subarray(0, 16)), seq, pcm: b.subarray(AUDIO_FRAME_HEADER_BYTES) };
}
