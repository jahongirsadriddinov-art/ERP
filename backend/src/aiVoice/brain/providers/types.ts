import type { TextProviderName, ToolDeclaration, ToolResult } from '../../contracts';

// Matn provayderlari uchun umumiy (provayderdan mustaqil) interfeys. Har bir provayder o'z xabar
// formatini (Gemini contents / OpenAI messages / Claude messages) SESSIYA ichida saqlaydi; agent
// faqat navbat (turn) va tool natijalari bilan ishlaydi. Tool'larni provayder EMAS — agent
// tools/executor.ts orqali bajaradi (RBAC, tasdiq, audit).

export interface ProviderCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Argumentlar JSON sifatida o'qilmadi — tool BAJARILMAYDI, xato natija qaytariladi. */
  argsError?: string;
}

export interface ProviderUsage { tokensIn: number; tokensOut: number; cacheReadTokens?: number; costUsd?: number }

export interface ProviderTurn {
  text: string;
  calls: ProviderCall[];
  model: string;
  usage: ProviderUsage;
  /** Model xavfsizlik sababli rad etdi (Claude stop_reason 'refusal'). */
  refusal?: boolean;
  /** Javob max_tokens'da kesildi — chala tool chaqiruvi bajarilmaydi. */
  truncated?: boolean;
}

export interface ProviderToolResult { id: string; name: string; result: ToolResult }

export interface ProviderSession {
  next(signal: AbortSignal): Promise<ProviderTurn>;
  addToolResults(results: ProviderToolResult[]): void;
}

export interface ProviderStartOpts {
  system: string;
  history: { role: 'user' | 'assistant'; text: string }[];
  userText: string;
  tools: ToolDeclaration[];
  effort: 'low' | 'medium' | 'high';
  /** Gemini uchun sozlamadagi textModel (bo'lmasa env/standart). */
  model?: string;
}

export interface TextProvider {
  readonly name: TextProviderName;
  /** Bitta HTTP so'rov uchun vaqt chegarasi (ms). */
  readonly requestTimeoutMs: number;
  start(opts: ProviderStartOpts): ProviderSession;
}

/** Provayder xatosi — kodi log uchun (kalit/so'rov tanasi hech qachon kirmaydi). */
export class ProviderError extends Error {
  constructor(public provider: TextProviderName, public code: string, public status?: number) {
    super(`${provider}:${code}`);
    this.name = 'ProviderError';
  }
}

/** Xato qisqa kodi (log uchun, maxfiy ma'lumotsiz). */
export function errorCode(e: unknown): string {
  if (e instanceof ProviderError) return e.code;
  const any = e as any;
  if (any?.name === 'AbortError' || any?.name === 'TimeoutError') return 'TIMEOUT';
  if (typeof any?.status === 'number') return `HTTP_${any.status}`;
  const m = /\b(4\d\d|5\d\d)\b/.exec(String(any?.message || ''));
  return m ? `HTTP_${m[1]}` : String(any?.code || any?.name || 'ERROR').slice(0, 40);
}

/** Tarix: oxirgi N navbat, har biri cheklangan uzunlikda. */
export function trimHistory(h: ProviderStartOpts['history'], maxTurns = 12, maxChars = 2000): ProviderStartOpts['history'] {
  return (Array.isArray(h) ? h : [])
    .filter((x) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.text === 'string' && x.text.trim())
    .slice(-maxTurns)
    .map((x) => ({ role: x.role, text: x.text.slice(0, maxChars) }));
}
