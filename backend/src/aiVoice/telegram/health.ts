import type { JobQueue } from '../queue/jobQueue';
import { initAccountService, recordHealth, runMaintenance } from './accountService';
import { initCallBridge } from './callBridge';
import { initIncomingCalls } from './incomingCalls';
import { callWorker } from './workerRpc';
import { workerConnectedHere } from './workerNamespace';

// 'connection.health' davriy ishi (har daqiqa). requires:'worker' ISHLATILMAYDI — worker hech qayerda
// ulanmagan bo'lsa (PC o'chiq) har daqiqalik ishlar navbatda yig'ilib qolardi. O'rniga ish faqat
// worker shu instansiyada bo'lsa haqiqiy ish qiladi: status RPC → AiChannelConnection, bog'lash
// kodlarini sinxronlash, kontaktlarni aniqlash. Worker'ning o'zi ham har 30 s 'health' voqeasini yuboradi.

export const CONNECTION_HEALTH_JOB = 'connection.health';

export async function runHealthCheck(now: Date = new Date()): Promise<void> {
  if (!workerConnectedHere()) return;
  try {
    const st = await callWorker('status', {});
    await recordHealth(st, now);
  } catch { /* worker javob bermadi — keyingi safar */ }
  await runMaintenance(now);
}

export function registerHandlers(q: JobQueue): void {
  initAccountService();
  initCallBridge();
  initIncomingCalls();
  q.register(CONNECTION_HEALTH_JOB, async () => { await runHealthCheck(q.now()); }, { concurrency: 1, maxAttempts: 1, doneTtlMs: 3600_000 });
  q.scheduleRecurring(CONNECTION_HEALTH_JOB, 60_000);
}
