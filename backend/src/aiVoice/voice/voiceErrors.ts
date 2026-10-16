import type { AiLang } from '../contracts';
import { isAuthError, isQuotaError, isTransientError } from '../lib/geminiKeys';

// Ovozli qo'ng'iroq xatolari: tasnif (kvota / model yo'q / kalit / taymaut / tarmoq), mijozga
// tushunarli kod (aiv:error) va Live modellari uchun "o'chirgich" (circuit breaker) — bir marta
// ishlamagan model har qo'ng'iroqda 1–4 s yo'qotmasin. Model zanjirlari: env/sozlama birinchi,
// keyin tasdiqlangan zaxiralar (2026-10-16 ListModels: gemini-3.8-live, gemini-3.1-flash-live-preview,
// gemini-2.5-flash-native-audio-latest — hammasi bidiGenerateContent; setupComplete + audio sinaldi).
// Bepul tarifda kvota MODEL bo'yicha — boshqa modelga o'tish limitni amalda kengaytiradi.

export type VoiceErrorKind = 'quota' | 'model' | 'auth' | 'timeout' | 'network' | 'not_configured' | 'other';

const MODEL_RE = /\bNOT_FOUND\b|\b404\b|is not found|not supported for bidiGenerateContent|not supported for generateContent|unknown model|model .*not (?:found|available)|\b1008\b/i;

export function classifyVoiceError(e: unknown): VoiceErrorKind {
  const msg = String((e as any)?.message ?? e ?? '');
  if (/GEMINI_NOT_CONFIGURED|NO_PROVIDER|no_provider/.test(msg)) return 'not_configured';
  if (isQuotaError(e)) return 'quota';
  if (isAuthError(e)) return 'auth';
  if (MODEL_RE.test(msg)) return 'model';
  if (/SETUP_TIMEOUT/.test(msg)) return 'timeout';
  if (isTransientError(e) || /ENOTFOUND|EAI_AGAIN|socket hang up|WebSocket/i.test(msg)) return 'network';
  return 'other';
}

/** Mijozga yuboriladigan sabab kodi (frontend shu bo'yicha o'zbekcha matn ko'rsatadi). */
export type VoiceFailCode = 'ai_quota' | 'ai_not_configured' | 'ai_unavailable';

export function failCodeFor(kind: VoiceErrorKind): VoiceFailCode {
  if (kind === 'quota') return 'ai_quota';
  if (kind === 'not_configured' || kind === 'auth') return 'ai_not_configured';
  return 'ai_unavailable';
}

export const FAIL_TEXT: Record<VoiceFailCode, Record<AiLang, string>> = {
  ai_quota: {
    uz: "Ovozli limit tugadi — matn bilan davom etamiz.",
    ru: 'Голосовой лимит исчерпан — продолжим текстом.',
  },
  ai_not_configured: {
    uz: "AI ovozli xizmati sozlanmagan (API kalit) — matn bilan davom etamiz. Administratorga ayting.",
    ru: 'Голосовой AI не настроен (API-ключ) — продолжим текстом. Сообщите администратору.',
  },
  ai_unavailable: {
    uz: "AI ovozli xizmatiga ulanib bo'lmadi — matn bilan davom etamiz.",
    ru: 'Не удалось подключиться к голосовому AI — продолжим текстом.',
  },
};

/** Kaskad navbati yiqilganda foydalanuvchiga aytiladigan qisqa jumla (sukut o'rniga). */
export function turnFailText(kind: VoiceErrorKind, lang: AiLang): string {
  if (kind === 'quota') return lang === 'ru' ? 'Извините, лимит AI сейчас исчерпан. Попробуйте чуть позже.' : "Kechirasiz, AI limiti hozircha tugadi. Birozdan so'ng qayta so'rang.";
  return lang === 'ru' ? 'Извините, не расслышал. Повторите, пожалуйста.' : "Kechirasiz, tushunolmadim. Iltimos, qaytaring.";
}

// ───────────── Model zanjirlari ─────────────
export const LIVE_FALLBACK_MODELS = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest'];
export const TRANSCRIBE_FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
export const TTS_FALLBACK_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts'];

/** "a, b" + zaxiralar → takrorsiz ro'yxat (≤ max). Vergul bilan bir nechta model berish mumkin (AI_LIVE_MODEL). */
export function modelChain(primary: string | undefined, fallbacks: string[], max = 3): string[] {
  const out: string[] = [];
  for (const m of [...String(primary || '').split(','), ...fallbacks]) {
    const v = m.trim();
    if (v && /^[a-zA-Z0-9._\-/:]{1,100}$/.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** Shu xato boshqa model bilan qayta urinishga arziydimi (kvota/model yo'q — ha; tarmoq/taymaut — yo'q). */
export const worthNextModel = (e: unknown): boolean => {
  const k = classifyVoiceError(e);
  return k === 'quota' || k === 'model' || k === 'other';
};

// ───────────── Live o'chirgichi (jarayon xotirasida) ─────────────
const COOLDOWN_MS: Partial<Record<VoiceErrorKind, number>> = { quota: 60_000, model: 30 * 60_000, auth: 10 * 60_000, timeout: 20_000 };
const liveDownUntil = new Map<string, number>();

export function noteLiveFailure(model: string, e: unknown, now = Date.now()): VoiceErrorKind {
  const kind = classifyVoiceError(e);
  const ms = COOLDOWN_MS[kind];
  if (ms) liveDownUntil.set(model, now + ms);
  return kind;
}

export function noteLiveOk(model: string): void { liveDownUntil.delete(model); }

export function liveModelDown(model: string, now = Date.now()): boolean {
  const until = liveDownUntil.get(model);
  if (!until) return false;
  if (until <= now) { liveDownUntil.delete(model); return false; }
  return true;
}

/** Faqat testlar uchun. */
export function __resetVoiceHealth(): void { liveDownUntil.clear(); }
