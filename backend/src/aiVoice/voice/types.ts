import type { AiLang, AivEndReason, CallChannel, Purpose } from '../contracts';

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
}

export type StartVoiceSessionResult =
  | { ok: true; handle: VoiceSessionHandle }
  | { ok: false; reason: 'busy' | 'platform_cap' | 'company_cap' | 'disabled' | 'limit' | 'budget' | 'denied' | 'error' };

export interface VoiceSessionHandle {
  readonly sessionId: string;
  readonly correlationId: string;
  /** 16 kHz PCM16LE (kadr sarlavhasiz). */
  pushAudio(pcm16k: Buffer): void;
  activityStart(): void;
  activityEnd(): void;
  /** Mijoz ulandi (in-app accept / Telegram connected) — disclosure ijro etiladi. */
  connected(): Promise<void>;
  confirmAction(pendingActionId: string, accept: boolean): Promise<void>;
  end(reason: AivEndReason): Promise<void>;
}

export interface VoiceSessionManagerApi {
  start(opts: StartVoiceSessionOpts): Promise<StartVoiceSessionResult>;
  get(sessionIdOrCorrelationId: string): VoiceSessionHandle | undefined;
  endAllForUser(userId: string, reason: AivEndReason): Promise<number>;
  /** SIGTERM: barcha sessiyalar 'interrupted'. */
  drain(timeoutMs: number): Promise<void>;
}
