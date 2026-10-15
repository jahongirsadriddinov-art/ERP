import { NonRetryableJobError, type JobQueue } from '../queue/jobQueue';
import type { ManagerReason } from './attendanceFlow';
import {
  handleCallOutcome, handleCallTimeout, installSessionListener, notifyManagerOnce, runStep, sendAfterCallButtons, type StepPayload,
} from './attendanceRunner';
import { finalizeShift, sendManagerSummary } from './finalize';
import { plannerTick, planShift } from './planner';
import { reconcileCheckIns } from './reconciler';
import { fireReminder, reminderTick } from './reminders';
import { retentionSweep } from './retention';
import { runTranscriptArchive } from '../archive/transcriptArchive';
import { enqueueJob, JOBS, keys } from './jobTypes';

// Scheduler ishlarini ro'yxatga olish (queue/handlers.ts chaqiradi; AI o'chiq bo'lsa navbat yo'q —
// bu funksiya umuman chaqirilmaydi). Davriy tick'lar qisqa doneTtl bilan (hujjatlar yig'ilmasin).

const MIN = 60_000;

export function registerHandlers(q: JobQueue): void {
  const need = (v: unknown, what: string): string => {
    if (typeof v !== 'string' || !v) throw new NonRetryableJobError(`${what} yo'q`);
    return v;
  };

  // ── Davriy ──
  q.register(JOBS.tick, async ({ queue }) => { await plannerTick(queue, queue.now()); }, { concurrency: 1, maxAttempts: 2, doneTtlMs: 2 * 3600_000 });
  q.scheduleRecurring(JOBS.tick, MIN);
  q.register(JOBS.reconcile, async ({ queue }) => { await reconcileCheckIns(queue.now(), {}, queue); }, { concurrency: 1, maxAttempts: 2, doneTtlMs: 2 * 3600_000 });
  q.scheduleRecurring(JOBS.reconcile, 2 * MIN);
  q.register(JOBS.reminderTick, async ({ queue }) => { await reminderTick(queue, queue.now()); }, { concurrency: 1, maxAttempts: 2, doneTtlMs: 2 * 3600_000 });
  q.scheduleRecurring(JOBS.reminderTick, 30_000);
  q.register(JOBS.retention, async ({ queue }) => { await retentionSweep(queue.now()); }, { concurrency: 1, maxAttempts: 3, doneTtlMs: 3 * 86_400_000 });
  q.scheduleRecurring(JOBS.retention, 24 * 3600_000);
  // Transkript arxivi (#3): kuniga bir marta; vaqt tugasa — davom ettiruvchi ish (dedupe arch:<kun>:more:<n>)
  q.register(JOBS.archive, async ({ job, queue }) => {
    const r = await runTranscriptArchive(queue.now());
    if (r.more) {
      const n = Math.min(1000, (Number((job.payload as any)?.n) || 0) + 1);
      await enqueueJob(queue, {
        type: JOBS.archive, runAt: new Date(queue.now().getTime() + MIN), payload: { n },
        dedupeKey: keys.archive(queue.now().toISOString().slice(0, 10), n),
      });
    }
  }, { concurrency: 1, maxAttempts: 3, doneTtlMs: 3 * 86_400_000 });
  q.scheduleRecurring(JOBS.archive, 24 * 3600_000);

  // ── Attendance ──
  q.register(JOBS.plan, async ({ job, queue }) => {
    const p = (job.payload || {}) as { shiftId?: string; manual?: boolean };
    await planShift(queue, { companyId: need(job.companyId, 'companyId'), shiftId: need(p.shiftId, 'shiftId'), manual: !!p.manual }, queue.now());
  }, { concurrency: 1, maxAttempts: 5 });
  q.register(JOBS.step, async ({ job, queue }) => {
    await runStep(queue, need(job.refId, 'refId'), (job.payload || { stepIndex: 0 }) as StepPayload, queue.now());
  }, { concurrency: 4, maxAttempts: 4 });
  q.register(JOBS.outcome, async ({ job, queue }) => {
    await handleCallOutcome(queue, need((job.payload as any)?.sessionId, 'sessionId'), queue.now());
  }, { concurrency: 2, maxAttempts: 5 });
  q.register(JOBS.callTimeout, async ({ job, queue }) => {
    await handleCallTimeout(queue, need(job.refId, 'refId'), Number((job.payload as any)?.stepIndex) || 0, queue.now());
  }, { concurrency: 2, maxAttempts: 5 });
  q.register(JOBS.buttons, async ({ job, queue }) => {
    await sendAfterCallButtons(need(job.refId, 'refId'), queue.now());
  }, { concurrency: 2, maxAttempts: 3 });
  q.register(JOBS.manager, async ({ job, queue }) => {
    await notifyManagerOnce(need(job.refId, 'refId'), ((job.payload as any)?.reason || 'no_answer') as ManagerReason, queue.now());
  }, { concurrency: 2, maxAttempts: 3 });
  q.register(JOBS.finalize, async ({ job, queue }) => {
    const p = (job.payload || {}) as { shiftId?: string; date?: string; cutoff?: string };
    await finalizeShift(queue, {
      companyId: need(job.companyId, 'companyId'), shiftId: need(p.shiftId, 'shiftId'), date: need(p.date, 'date'),
      ...(typeof p.cutoff === 'string' ? { cutoff: p.cutoff } : {}),
    }, queue.now());
  }, { concurrency: 1, maxAttempts: 5 });
  q.register(JOBS.summary, async ({ job, queue }) => {
    const p = (job.payload || {}) as { managerId?: string; date?: string; absent?: string[]; declined?: string[] };
    await sendManagerSummary({
      companyId: need(job.companyId, 'companyId'), managerId: need(p.managerId, 'managerId'), date: need(p.date, 'date'),
      absent: p.absent || [], declined: p.declined || [],
    }, queue.now());
  }, { concurrency: 1, maxAttempts: 3 });

  // ── Eslatmalar ──
  q.register(JOBS.reminderFire, async ({ job, queue }) => {
    await fireReminder(need(job.refId, 'refId'), queue.now());
  }, { concurrency: 2, maxAttempts: 3 });

  // Qo'ng'iroq yakunlari (P5/P6 finishSession, sweep) → attendance.outcome
  installSessionListener(q);
}
