import type { Router } from 'express';
import { requireAuth, blockDeveloper, requireDeveloper } from '../middleware/auth';
import { aiConfig, INSTANCE_ID, LIMITS } from './config';
import { JobQueue, setSharedQueue } from './queue/jobQueue';
import { registerAllHandlers } from './queue/handlers';
import { beatInstance, removeInstance } from './instances';
import { ensurePlatformConnection } from './lib/workerLease';
import { registerChannel } from './channels/registry';
import { botChannel } from './channels/botChannel';
import { pushChannel } from './channels/pushChannel';
import { managerChannel } from './channels/managerChannel';
import { inAppCallChannel } from './channels/inAppCallChannel';
import { telegramCallChannel } from './channels/telegramCallChannel';
import { backfillTgLinks } from './telegram/tgLink';
import { workerConnectedHere, closeWorkerNamespace } from './telegram/workerNamespace';
import { shutdownAiVoiceSockets } from './socket/inAppSocket';
import { getVoiceSessionManager } from './voice/sessionManager';
import { registerErpTools } from './tools/erp';
import adminRoutes from './routes/adminRoutes';
import meRoutes from './routes/meRoutes';
import platformRoutes from './routes/platformRoutes';
import platformAdminRoutes from './routes/platformAdminRoutes';
import chatRoutes from './routes/chatRoutes';
import { agentCallbackRoutes, agentRoutes } from './routes/agentRoutes';
import { officeMediaRoutes } from './officeMedia/routes';
import { smmRoutes } from './smm/routes';
import { serveTempMedia } from './smm/tempMedia';

// AI ovozli yordamchini ishga tushirish (index.ts: startAutoSnapshots()'dan keyin startAiVoice()).
// AI_VOICE_ENABLED o'chiq bo'lsa HECH NARSA qilmaydi: navbat, heartbeat, SIGTERM tinglovchisi yo'q —
// serverning mavjud xatti-harakati o'zgarmaydi.

// ───────────── Yo'llar ─────────────
/**
 * Alohida prefikslar (review F): requireAuth har so'rovda bir marta ishlaydi va /me hech qachon
 * admin guard'iga tushmaydi. Platforma — faqat dasturchi; admin va me — dasturchiga yopiq.
 */
export function mountAiVoiceRoutes(app: Pick<Router, 'use'>): void {
  // platformAdminRoutes (firmalar, miya/limitlar, sarf, audit, arxivlar) — mos kelmasa P6 platformRoutes'ga o'tadi
  app.use('/api/ai-voice/platform', requireAuth, requireDeveloper, platformAdminRoutes, platformRoutes, agentRoutes, smmRoutes, officeMediaRoutes);
  // SMM: e'lon uchun VAQTINCHALIK fayllar (Instagram oladi) — auth yo'q, faqat taxmin qilib bo'lmaydigan token, 1 soat TTL
  app.use('/api/smm-media/:file', serveTempMedia as any);
  // AI ofis: GitHub Actions qayta qo'ng'irog'i — auth yo'q, faqat X-Agent-Secret (agentRoutes.ts)
  app.use('/api/ai-voice/agent-callback', agentCallbackRoutes);
  // Chatdagi AI kontakti (P7) — /me'dan OLDIN (aniqroq prefiks), workGate ALLOW ostida
  app.use('/api/ai-voice/me/chat', requireAuth, blockDeveloper, chatRoutes);
  app.use('/api/ai-voice/me', requireAuth, blockDeveloper, meRoutes);
  app.use('/api/ai-voice/admin', requireAuth, blockDeveloper, adminRoutes);
}

// ───────────── Kanallar ─────────────
/** 5 ta kanal adapterini registry'ga qo'yadi (DI — registry.ts adapterlarni import qilmaydi). */
export function registerDefaultChannels(): void {
  for (const a of [botChannel, pushChannel, managerChannel, inAppCallChannel, telegramCallChannel]) registerChannel(a);
}

// ───────────── To'xtatish ilgaklari ─────────────
type ShutdownHook = { name: string; fn: () => Promise<void> | void };
const shutdownHooks: ShutdownHook[] = [];
/** Keyingi paketlar (P3/P5/P6) SIGTERM drain'ga qo'shimcha qadam qo'shishi uchun. */
export function onAiShutdown(name: string, fn: ShutdownHook['fn']): void { shutdownHooks.push({ name, fn }); }

const withTimeout = async (p: Promise<unknown> | unknown, ms: number, label: string): Promise<void> => {
  let t: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve(p),
      new Promise<void>((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), Math.max(0, ms)); }),
    ]);
  } catch (e) {
    console.warn(`[aiVoice] to'xtatish qadami (${label}) xatosi:`, (e as Error).message);
  } finally {
    if (t) clearTimeout(t);
  }
};

// ───────────── Ishga tushirish ─────────────
export interface AiVoiceRuntime {
  queue: JobQueue;
  /** Drain: yangi ish olinmaydi, jonli sessiyalar 'interrupted', worker namespace yopiladi, ishlar kutiladi. */
  stop(timeoutMs?: number): Promise<void>;
}

let runtime: AiVoiceRuntime | null = null;

export function getAiVoiceRuntime(): AiVoiceRuntime | null { return runtime; }

export function startAiVoice(opts: { installSignalHandlers?: boolean } = {}): AiVoiceRuntime | null {
  if (runtime) return runtime;
  if (!aiConfig.enabled) {
    console.log("[aiVoice] o'chiq (AI_VOICE_ENABLED) — ishga tushirilmadi");
    return null;
  }

  registerDefaultChannels();
  registerErpTools();                                // P2 tool'lari (idempotent)
  const queue = new JobQueue({ hasWorker: workerConnectedHere });
  registerAllHandlers(queue);
  setSharedQueue(queue);
  ensurePlatformConnection().catch((e) => console.error('[aiVoice] platforma ulanish yozuvi xatosi:', (e as Error).message));
  queue.start();
  // Owner 2026-10-16: ERP botga bog'langan xodimlarning Telegram id'si AI kontaktlariga (kod shart emas)
  const backfillTimer = setTimeout(() => {
    backfillTgLinks().then((n) => { if (n) console.log(`[aiVoice] Telegram bog'lanishi: ${n} ta kontakt yangilandi`); })
      .catch((e) => console.error('[aiVoice] Telegram backfill xatosi:', (e as Error)?.name || 'Error'));
  }, 5_000);
  backfillTimer.unref?.();

  // Instansiya heartbeat — ikki instansiya bir vaqtda bo'lsa instances.ts ogohlantiradi (C3).
  const version = (process.env.RENDER_GIT_COMMIT || '').slice(0, 12) || undefined;
  const beat = () => beatInstance({ hasWorker: workerConnectedHere(), version })
    .catch((e) => console.error('[aiVoice] heartbeat xatosi:', (e as Error).message));
  void beat();
  const beatTimer = setInterval(beat, LIMITS.instanceBeatMs);
  beatTimer.unref?.();

  let stopping: Promise<void> | null = null;
  const stop = (timeoutMs = aiConfig.shutdownDrainMs): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      const deadline = Date.now() + timeoutMs;
      const left = () => Math.max(0, deadline - Date.now());
      clearInterval(beatTimer);
      queue.stop();                                    // yangi ish olinmaydi
      await withTimeout(shutdownAiVoiceSockets('shutdown'), Math.min(5_000, left()), 'in-app sessiyalar');
      await withTimeout(getVoiceSessionManager().drain(Math.min(5_000, left())), Math.min(6_000, left()), 'ovozli sessiyalar');
      await withTimeout(closeWorkerNamespace(), Math.min(3_000, left()), 'worker namespace');
      for (const h of shutdownHooks) await withTimeout(h.fn(), Math.min(5_000, left()), h.name);
      await withTimeout(queue.drain(Math.max(0, left() - 1_000)), left(), 'navbat drain');
      await withTimeout(removeInstance(), 1_000, 'instansiya');
      setSharedQueue(null);
      runtime = null;
    })();
    return stopping;
  };

  runtime = { queue, stop };

  // Render SIGTERM'dan keyin ~30 s beradi (maxShutdownDelaySeconds). Tinglovchi qo'shilgach Node o'zi
  // chiqmaydi — drain'dan keyin (yoki qattiq taymerda) process.exit.
  if (opts.installSignalHandlers !== false) {
    process.once('SIGTERM', () => {
      console.log(`[aiVoice] SIGTERM — drain (≤${aiConfig.shutdownDrainMs} ms)…`);
      const hard = setTimeout(() => process.exit(0), aiConfig.shutdownDrainMs + 2_000);
      hard.unref?.();
      stop().finally(() => process.exit(0));
    });
  }

  console.log(`[aiVoice] ishga tushdi (instansiya ${INSTANCE_ID})`);
  return runtime;
}
