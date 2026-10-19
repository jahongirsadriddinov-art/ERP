import type { AiLang, AivConfirmActionAck, AivEndReason, CallChannel, Purpose } from '../contracts';

// Ovoz dvigateli turlari (P5 amalga oshiradi, P6 Telegram ko'prigi shu orqali ulanadi).
export type {
  VoiceProvider, VoiceSession, VoiceOpenOpts, VoiceSessionEvents, VoiceUsage, ToolDeclaration,
} from '../contracts';

/** Audio va voqealarni mijozga yetkazuvchi transport (in-app socket yoki Telegram worker). */
export interface VoiceTransport {
  kind: 'inapp' | 'telegram';
  /** 24 kHz PCM16LE. */
  sendAudio(pcm24k: Buffer): void;
  /** Ovozni darhol to'xtatish (barge-in). */
  flushAudio(): void;
  sendEvent(event: string, payload: unknown): void;
  close(reason: AivEndReason): void;
  /** AI tool ishlatyapti (video avatar uchun; ixtiyoriy). */
  activity?(a: { tool: string; phase: 'start' | 'end'; status?: string }): void;
  /** P5 qo'shimchasi (ixtiyoriy): transportda hali yuborilmagan baytlar — chiqish navbati cap'i (A10) uchun. */
  backlogBytes?(): number;
}

export interface StartVoiceSessionOpts {
  companyId: string;
  employeeId: string;
  purpose: Purpose;
  channel: CallChannel;
  lang: AiLang;
  ptt: boolean;
  transport: VoiceTransport;
  /** Bo'lmasa yangi UUID yaratiladi. */
  correlationId?: string;
  /** `${confirmationId}:${stepIndex}:${attemptNo}` — attendance qadamlari uchun (C1). */
  attemptKey?: string;
  confirmationId?: string;
  jobId?: string;
  attemptNo?: number;
  /** In-app: audio faqat shu socket'dan qabul qilinadi (A10). */
  socketId?: string;
  workerInstanceId?: string;
  /** P5 qo'shimchasi (ixtiyoriy): shu vaqtda ulanmasa — 'timeout' (no_answer). In-app: 30 s. */
  ringTimeoutSec?: number;
  /** P5 qo'shimchasi (ixtiyoriy): suhbat chegarasi; berilmasa — sozlamadan (assistant/boshqa). */
  maxDurationSec?: number;
  /** P5 qo'shimchasi (ixtiyoriy): eslatma matni va h.k. — promptga untrusted sifatida. */
  requestText?: string;
  /** P5 qo'shimchasi (ixtiyoriy): foydalanuvchi o'zi qo'ng'iroq qildi (chat AI kontakti / aiv:start). */
  userInitiated?: boolean;
  /**
   * Mehmon sinov qo'ng'irog'i (owner 2026-10-19): dasturchi panelidan ERP'ga aloqasi yo'q odamga oddiy AI suhbati.
   * companyId = PLATFORM_SCOPE, employeeId = qo'ng'iroqni boshlagan dasturchi; firma/ERP tool'lari va ma'lumoti yo'q.
   */
  guest?: { name?: string };
  /** AI Telegram akkaunti ismi (owner 2026-10-19) — AI shu qo'ng'iroqda o'zini shu ism bilan tanishtiradi. */
  aiName?: string;
}

export type StartVoiceSessionResult =
  | { ok: true; handle: VoiceSessionHandle }
  | { ok: false; reason: 'busy' | 'platform_cap' | 'company_cap' | 'disabled' | 'limit' | 'budget' | 'denied' | 'error' };

export interface VoiceSessionHandle {
  readonly sessionId: string;
  readonly correlationId: string;
  /** P5 qo'shimchalari (ixtiyoriy — mavjud soxta handle'lar buzilmasin). */
  readonly employeeId?: string;
  readonly companyId?: string;
  readonly purpose?: Purpose;
  /** 'ringing' | 'connecting' | 'connected' | 'ending' | 'ended'. */
  readonly state?: string;
  /** 16 kHz PCM16LE (kadr sarlavhasiz). */
  pushAudio(pcm16k: Buffer): void;
  /** Suhbatdosh kamerasi (JPEG) — Telegram video qo'ng'iroq (owner 2026-10-18). */
  pushVideo?(jpeg: Buffer): void;
  activityStart(): void;
  activityEnd(): void;
  /** Mijoz ulandi (in-app accept / Telegram connected) — disclosure ijro etiladi. */
  connected(): Promise<void>;
  /** Haqiqiy natija qaytadi (P5: void → ack; void kutgan chaqiruvchilar uchun mos). */
  confirmAction(pendingActionId: string, accept: boolean): Promise<AivConfirmActionAck>;
  end(reason: AivEndReason): Promise<void>;
}

export interface VoiceSessionManagerApi {
  start(opts: StartVoiceSessionOpts): Promise<StartVoiceSessionResult>;
  get(sessionIdOrCorrelationId: string): VoiceSessionHandle | undefined;
  endAllForUser(userId: string, reason: AivEndReason): Promise<number>;
  /** SIGTERM: barcha sessiyalar 'interrupted'. */
  drain(timeoutMs: number): Promise<void>;
  /** Ixtiyoriy: qo'ng'iroqdan OLDIN isitish (disclosure klipi) — foydalanuvchi AI chatini ochganda. */
  prewarm?(companyId: string, userId: string): Promise<void>;
}
