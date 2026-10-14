import { registerHandlers as registerSchedulerHandlers } from '../scheduler';
import { registerHandlers as registerHealthHandlers } from '../telegram/health';
import type { JobQueue } from './jobQueue';
import { SESSION_SWEEP_JOB, sweepStaleSessions } from './sessionSweep';

// Barcha ish turlarini ro'yxatga olish. P1 faqat umumiy ishlarni (session.sweep) o'zi qo'shadi;
// scheduler (P3) va Telegram health (P6) o'z fayllaridagi registerHandlers(q) orqali qo'shiladi.

export function registerAllHandlers(q: JobQueue): void {
  q.register(SESSION_SWEEP_JOB, async () => { await sweepStaleSessions(q.now()); }, { concurrency: 1, maxAttempts: 2, doneTtlMs: 3600_000 });
  q.scheduleRecurring(SESSION_SWEEP_JOB, 60_000);
  registerSchedulerHandlers(q);
  registerHealthHandlers(q);
}
