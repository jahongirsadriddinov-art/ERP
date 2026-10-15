import { getSharedQueue, type EnqueueInput, type JobQueue } from '../queue/jobQueue';

// Scheduler ish turlari va dedupe kalitlari (design §5 + review C1/C5/C9) — bitta joyda.
export const JOBS = {
  tick: 'attendance.tick',               // daqiqalik, level-triggered: bugun reja kerakmi
  plan: 'attendance.plan',               // att:plan:<company>:<date>:<shift>[:manual:<minute>]
  step: 'attendance.step',               // att:step:<conf>:<stepIndex>
  outcome: 'attendance.outcome',         // att:out:<sessionId> — qo'ng'iroq yakuni (onSessionsEnded)
  callTimeout: 'attendance.call_timeout',// att:ct:<conf>:<stepIndex> — ring+maxDuration+30 s
  buttons: 'attendance.buttons',         // att:btn:<conf>:<stepIndex> — javob berilgan qo'ng'iroqdan keyin tugmalar
  manager: 'attendance.manager',         // att:mgr:<conf> — rad etish / javobsizlik
  reconcile: 'attendance.reconcile',     // har 2 daqiqada
  finalize: 'attendance.finalize',       // att:fin:<company>:<date>:<shift> — absentCutoff'da
  summary: 'attendance.summary',         // att:sum:<company>:<date>:<shift>:<manager>
  reminderTick: 'reminder.tick',
  reminderFire: 'reminder.fire',         // rem:<id>:<nextFireAt ISO>
  retention: 'retention.sweep',
  archive: 'transcripts.archive',        // arch:<YYYY-MM-DD>[:more:<n>] — 7 kundan eski suhbatlar → gzip JSONL fayl
} as const;

export const keys = {
  plan: (c: string, d: string, s: string) => `att:plan:${c}:${d}:${s}`,
  /** Shaxsiy jadvalli xodimlar boshqa vaqtda boshlasa — o'sha so'rov vaqti uchun alohida kalit (#5). */
  planAt: (c: string, d: string, s: string, callTime: string) => `att:plan:${c}:${d}:${s}@${callTime}`,
  planManual: (c: string, d: string, s: string, minute: string) => `att:plan:${c}:${d}:${s}:manual:${minute}`,
  step: (conf: string, i: number) => `att:step:${conf}:${i}`,
  outcome: (sessionId: string) => `att:out:${sessionId}`,
  callTimeout: (conf: string, i: number) => `att:ct:${conf}:${i}`,
  buttons: (conf: string, i: number) => `att:btn:${conf}:${i}`,
  manager: (conf: string) => `att:mgr:${conf}`,
  finalize: (c: string, d: string, s: string) => `att:fin:${c}:${d}:${s}`,
  finalizeAt: (c: string, d: string, s: string, cutoff: string) => `att:fin:${c}:${d}:${s}@${cutoff}`,
  summary: (c: string, d: string, s: string, m: string) => `att:sum:${c}:${d}:${s}:${m}`,
  reminderFire: (id: string, at: Date) => `rem:${id}:${at.toISOString()}`,
  archive: (day: string, n = 0) => (n ? `arch:${day}:more:${n}` : `arch:${day}`),
};

/** Navbat: aniq berilgan yoki jarayonning umumiy navbati (AI o'chiq bo'lsa — null). */
export function queueOf(q?: JobQueue | null): JobQueue | null {
  return q || getSharedQueue();
}

/** Ish qo'shadi; navbat bo'lmasa (AI o'chiq) — null, xato tashlamaydi. */
export async function enqueueJob(q: JobQueue | null | undefined, input: EnqueueInput): Promise<{ id: string; duplicate: boolean } | null> {
  const queue = queueOf(q);
  if (!queue) return null;
  return queue.enqueue(input);
}

/** Navbatdagi (olinmagan) qadamlarni bekor qilish — holat yakunlanganda shovqinni kamaytiradi. */
export async function cancelSteps(q: JobQueue | null | undefined, confId: string): Promise<void> {
  const queue = queueOf(q);
  if (!queue) return;
  await queue.cancel({ type: JOBS.step, refId: confId }).catch(() => 0);
  await queue.cancel({ type: JOBS.callTimeout, refId: confId }).catch(() => 0);
}
