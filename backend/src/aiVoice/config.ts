import { hostname } from 'os';
import { randomBytes } from 'crypto';

// AI ovozli yordamchi — umumiy konfiguratsiya (env NOMLARI shu yerda; qiymatlar hech qachon log qilinmaydi).
//
// MUHIM ARXITEKTURA FARAZI (review C3): realtime qism (Socket.IO, /aiv-worker namespace,
// in-app ovozli sessiyalar) BITTA instansiyada ishlaydi deb mo'ljallangan. Deploy overlap
// paytida ikki instansiya qisqa muddat birga ishlashi mumkin, shuning uchun:
//  • worker talab qiladigan ishlar (requires:'worker') faqat worker ulangan instansiyada olinadi;
//  • in-app qo'ng'iroq foydalanuvchi socket'i shu instansiyada bo'lmasa 'unavailable' (+15 s qayta);
//  • ikki instansiya bir vaqtda heartbeat qilsa ogohlantirish yoziladi (instances.ts).
// Parallellik hisoblagichlar bilan EMAS, faol AiCallSession'larni sanash orqali olinadi (B12).

const int = (name: string, def: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? def : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
};
const bool = (name: string, def = false): boolean => {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (!raw) return def;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

/** Shu jarayonning noyob identifikatori (lease egasi, heartbeat). */
export const INSTANCE_ID: string = (process.env.RENDER_INSTANCE_ID || process.env.INSTANCE_ID ||
  `${hostname()}:${process.pid}`) + ':' + randomBytes(3).toString('hex');

/** v1'da yagona vaqt zonasi (Attendance.date / utils/tz.ts bilan kelishuv, C7). */
export const AI_TIMEZONE = 'Asia/Tashkent' as const;

export const aiConfig = {
  /** Butun AI ovozli tizimning global kaliti (env AI_VOICE_ENABLED). */
  get enabled() { return bool('AI_VOICE_ENABLED', false); },
  /**
   * Platforma bo'yicha bir vaqtdagi Gemini Live sessiyalari chegarasi (A6). Standart 1 — owner qarori
   * (2026-10-14): pilot Render FREE (0.1 CPU) da, Starter+ ga o'tilganda env bilan oshiriladi.
   */
  get liveMaxConcurrent() { return int('AI_LIVE_MAX_CONCURRENT', 1, 1, 100); },
  /** Telegram akkaunti bo'yicha bir vaqtdagi qo'ng'iroqlar (A1: rasmiy mijozlarda 1 ta). */
  get tgMaxConcurrent() { return int('AI_TG_MAX_CONCURRENT', 1, 1, 2); },
  /** Telegram akkauntining platforma bo'yicha kunlik qo'ng'iroq chegarasi. */
  get tgDailyCap() { return int('AI_TG_DAILY_CAP', 150, 0, 1000); },
  /** SIGTERM'da drain uchun maksimal vaqt (render.yaml maxShutdownDelaySeconds bilan mos). */
  get shutdownDrainMs() { return int('AI_SHUTDOWN_DRAIN_MS', 25_000, 1_000, 300_000); },

  /** Matn miyasi (llm-provider.md). Kalit qiymatlari faqat env'da; bu yerda faqat "sozlanganmi". */
  brain: {
    /** Groq — tez, OpenAI-mos (GROQ_API_KEY; mavjud /api/ai chat ham ishlatadi). GROQ_MODEL vergul bilan ro'yxat. */
    get groqConfigured() { return !!(process.env.GROQ_API_KEY || '').trim(); },
    get groqModels(): string[] {
      const list = (process.env.GROQ_MODEL || '').split(',').map((m) => m.trim()).filter(Boolean);
      return list.length ? list : ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];
    },
    get openRouterConfigured() { return !!(process.env.OPENROUTER_API_KEY || '').trim(); },
    /** Vergul bilan ro'yxat bo'lishi mumkin (OpenRouter `models` zaxira massivi). */
    get openRouterModels(): string[] {
      return (process.env.OPENROUTER_MODEL || '').split(',').map((m) => m.trim()).filter(Boolean);
    },
    /** Claude ixtiyoriy: kalit bo'lmasa import/log xatosisiz o'chiq. */
    get claudeConfigured() { return !!(process.env.ANTHROPIC_API_KEY || '').trim(); },
    get claudeModel() { return process.env.AI_CLAUDE_MODEL || 'claude-opus-5-5'; },
  },

  models: {
    get live() { return process.env.AI_LIVE_MODEL || 'gemini-3.8-live'; },
    get text() { return process.env.AI_TEXT_MODEL || 'gemini-3.8-flash'; },
    get tts() { return process.env.AI_TTS_MODEL || 'gemini-3.8-flash-tts'; },
    get transcribe() { return process.env.AI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe-live'; },
  },
};

// ── Doimiy chegaralar (kodda; sozlamalar ularni oshira olmaydi) ──
export const LIMITS = {
  /** Sozlamalar va aktyor (user/company/feature) keshi — B2: ≤10 s. */
  settingsCacheMs: 10_000,
  actorCacheMs: 10_000,
  /** Tasdiq kutayotgan amal muddati. */
  pendingActionTtlMs: 5 * 60_000,
  /** Bir sessiyada boshqa foydalanuvchiga ta'sir qiluvchi yozuvlar soni (B4). */
  otherUserWritesPerSession: 5,
  /** Tool natijasidagi erkin matn maydoni (B4). */
  untrustedTextMax: 200,
  /** Audio kadr chegaralari (A10). */
  audioFrameMaxBytes: 8 * 1024,
  audioFramesPerSecMax: 60,
  /** In-app chiqish navbati ~500 ms (24 kHz PCM16 = 48000 B/s). */
  audioOutQueueMaxBytes: 24_000,
  /** Sessiya updatedAt'ni shuncha vaqtda yangilaydi; sweeper chegarasi undan katta. */
  sessionTouchMs: 15_000,
  sessionSweepGraceSec: 60,
  /** "Band" tufayli qayta navbatga qo'yish chegarasi (C4). */
  busyRequeueMax: 5,
  /** Worker fencing lease (A4). */
  workerLeaseTtlMs: 30_000,
  workerLeaseRenewMs: 10_000,
  workerLeaseGraceMs: 10_000,
  workerSocketDownFenceMs: 20_000,
  workerChallengeTtlMs: 60_000,
  /** Ish navbati. */
  jobLeaseMs: 60_000,
  jobPollMs: 2_000,
  jobBackoffBaseMs: 5_000,
  jobBackoffCapMs: 10 * 60_000,
  /** Yakuniy holatdagi ishlar saqlanish muddati (C5). */
  jobDoneTtlMs: 7 * 24 * 3600_000,
  jobFailedTtlMs: 14 * 24 * 3600_000,
  /** Instansiya heartbeat. */
  instanceBeatMs: 15_000,
  instanceStaleMs: 45_000,
};
