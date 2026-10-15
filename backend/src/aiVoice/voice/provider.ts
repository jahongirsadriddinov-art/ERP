import type { VoiceOpenOpts, VoiceProvider, VoiceSession, VoiceSessionEvents } from './types';

// Provayderlar uchun umumiy asos: tiplangan hodisa emitteri, "setup" taymauti va zaxira tartibi
// (Gemini Live → kaskad). VoiceProvider.open() sessiya TAYYOR bo'lganda (setupComplete) resolve bo'ladi.

export type ProviderKind = 'gemini_live' | 'gemini_cascade';

type Handler = (...args: any[]) => void;

/** VoiceSession hodisalari uchun kichik emitter (tinglovchi xatosi boshqalarini to'xtatmaydi). */
export class VoiceEmitter {
  private handlers = new Map<string, Set<Handler>>();

  on<E extends keyof VoiceSessionEvents>(event: E, cb: VoiceSessionEvents[E]): void {
    let set = this.handlers.get(event as string);
    if (!set) { set = new Set(); this.handlers.set(event as string, set); }
    set.add(cb as Handler);
  }

  protected emit<E extends keyof VoiceSessionEvents>(event: E, ...args: Parameters<VoiceSessionEvents[E]>): void {
    const set = this.handlers.get(event as string);
    if (!set) return;
    for (const h of [...set]) {
      try { h(...args); } catch (e) { console.error(`[aiVoice] voice hodisa (${String(event)}) tinglovchisi xatosi:`, (e as Error).message); }
    }
  }

  protected removeAllListeners(): void { this.handlers.clear(); }
}

/** "12.5s" / "3s" / 1500 → ms (Gemini Duration JSON formati). */
export function parseDurationMs(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v !== 'string') return fallback;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)?\s*$/i.exec(v);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Math.round((m[2] || 's').toLowerCase() === 'ms' ? n : n * 1000);
}

/**
 * open() ni taymaut bilan chaqiradi. Taymautdan keyin kech kelgan sessiya darhol yopiladi
 * (aks holda Gemini ulanishi "osilib" pul sarflaydi).
 */
export async function openWithTimeout(provider: VoiceProvider, opts: VoiceOpenOpts, ms: number): Promise<VoiceSession> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const p = provider.open(opts);
  try {
    return await Promise.race([
      p,
      new Promise<VoiceSession>((_, rej) => { timer = setTimeout(() => { timedOut = true; rej(new Error('SETUP_TIMEOUT')); }, ms); }),
    ]);
  } catch (e) {
    if (timedOut) p.then((s) => s.close('setup_timeout')).catch(() => undefined);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ProviderCandidate {
  kind: ProviderKind;
  model: string;
  provider: VoiceProvider;
}

export interface OpenedProvider { session: VoiceSession; kind: ProviderKind; model: string; provider: VoiceProvider }

/** Nomzodlarni tartib bilan sinaydi; birinchi muvaffaqiyatlisi qaytadi. Hammasi yiqilsa — oxirgi xato. */
export async function openFirstAvailable(
  candidates: ProviderCandidate[],
  base: Omit<VoiceOpenOpts, 'model'>,
  timeoutMs: number,
  onFail?: (kind: ProviderKind, err: Error) => void,
): Promise<OpenedProvider> {
  let last: Error = new Error('NO_PROVIDER');
  for (const c of candidates) {
    try {
      const session = await openWithTimeout(c.provider, { ...base, model: c.model }, timeoutMs);
      return { session, kind: c.kind, model: c.model, provider: c.provider };
    } catch (e) {
      last = e as Error;
      onFail?.(c.kind, last);
    }
  }
  throw last;
}
