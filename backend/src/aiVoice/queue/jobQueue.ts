import AiJob, { type IAiJob } from '../../models/AiJob';
import { INSTANCE_ID, LIMITS } from '../config';
import { captureError } from '../../services/errorTracker';

// Mongo'dagi ish navbati (design D8 + review C1/C3/C5):
//  • claim — atomik findOneAndUpdate (status queued→leased, leaseOwner, leaseUntil, attempts+1);
//    ikki instansiya bir ishni hech qachon birga olmaydi;
//  • requires:'worker' ishlarni faqat worker socket'i SHU instansiyada ulangan bo'lsa oladi;
//  • sweeper — muddati o'tgan lease'lar qayta navbatga yoki attempts ≥ maxAttempts bo'lsa 'dead';
//  • backoff — min(base·2^(n−1), cap) ± jitter;
//  • HAR yakuniy holatda (done/failed/dead/cancelled) expiresAt — dedupeKey abadiy band qolmaydi;
//  • drain — SIGTERM'da yangi ish olinmaydi, ishlayotganlar kutiladi, ulgurmaganlar qaytariladi.
// Ishlar qo'ng'iroq davomida lease USHLAMAYDI (C1) — qadamlar voqealar bilan zanjirlanadi.

export type AiJobLean = Pick<IAiJob, 'type' | 'companyId' | 'employeeId' | 'refId' | 'payload' | 'runAt' | 'priority' | 'status'
  | 'attempts' | 'maxAttempts' | 'leaseOwner' | 'leaseUntil' | 'dedupeKey' | 'correlationId' | 'requires'> & { _id: any };

export interface JobHandlerCtx {
  job: AiJobLean;
  queue: JobQueue;
  /** Lease'ni uzaytiradi; false — lease yo'qotilgan (ishni to'xtatish kerak). */
  heartbeat(): Promise<boolean>;
  signal: AbortSignal;
}
export type JobHandler = (ctx: JobHandlerCtx) => Promise<void>;

/** Qayta urinib bo'lmaydigan xato — ish darhol 'failed'. */
export class NonRetryableJobError extends Error {
  constructor(message: string) { super(message); this.name = 'NonRetryableJobError'; }
}

export interface JobTypeOpts {
  concurrency?: number;
  leaseMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  /**
   * 'done' ish qancha saqlanadi (dedupeKey shu muddat band). Davriy ishlar (minutlik tick'lar) uchun
   * qisqa qiling — aks holda 7 kunda o'n minglab hujjat yig'iladi. Davr uzunligidan katta bo'lishi shart.
   */
  doneTtlMs?: number;
}

export interface EnqueueInput {
  type: string;
  companyId?: string;
  employeeId?: string;
  refId?: string;
  payload?: unknown;
  runAt?: Date;
  priority?: number;
  dedupeKey?: string;
  maxAttempts?: number;
  correlationId?: string;
  requires?: 'worker';
}

export interface JobQueueOpts {
  instanceId?: string;
  /** Shu instansiyada Telegram worker socket'i ulanganmi (requires:'worker' filtri). */
  hasWorker?: () => boolean;
  pollMs?: number;
  /** Testlar uchun soxta soat. */
  now?: () => Date;
  log?: (msg: string) => void;
}

interface Registered { handler: JobHandler; opts: Required<JobTypeOpts> }
interface Recurring { type: string; everyMs: number; input?: Omit<EnqueueInput, 'type' | 'dedupeKey' | 'runAt'>; lastBucket?: number }

export function backoffMs(attempts: number, baseMs: number, capMs: number, rnd: () => number = Math.random): number {
  const exp = Math.min(capMs, baseMs * Math.pow(2, Math.max(0, attempts - 1)));
  return Math.round(exp * (0.8 + 0.4 * rnd()));
}

export class JobQueue {
  readonly instanceId: string;
  private readonly hasWorker: () => boolean;
  private readonly pollMs: number;
  private readonly nowFn: () => Date;
  private readonly log: (msg: string) => void;
  private readonly types = new Map<string, Registered>();
  private readonly recurring: Recurring[] = [];
  private readonly running = new Map<string, { type: string; promise: Promise<void>; abort: AbortController }>();
  private readonly runningByType = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = true;
  private draining = false;
  private lastSweepAt = 0;

  constructor(opts: JobQueueOpts = {}) {
    this.instanceId = opts.instanceId || INSTANCE_ID;
    this.hasWorker = opts.hasWorker || (() => false);
    this.pollMs = opts.pollMs ?? LIMITS.jobPollMs;
    this.nowFn = opts.now || (() => new Date());
    this.log = opts.log || ((m) => console.log(`[aiVoice/queue] ${m}`));
  }

  now(): Date { return this.nowFn(); }

  register(type: string, handler: JobHandler, opts: JobTypeOpts = {}): void {
    if (this.types.has(type)) throw new Error(`[aiVoice/queue] tur takrorlangan: ${type}`);
    this.types.set(type, {
      handler,
      opts: {
        concurrency: Math.max(1, opts.concurrency ?? 2),
        leaseMs: opts.leaseMs ?? LIMITS.jobLeaseMs,
        maxAttempts: Math.max(1, opts.maxAttempts ?? 5),
        backoffBaseMs: opts.backoffBaseMs ?? LIMITS.jobBackoffBaseMs,
        backoffCapMs: opts.backoffCapMs ?? LIMITS.jobBackoffCapMs,
        doneTtlMs: Math.max(60_000, opts.doneTtlMs ?? LIMITS.jobDoneTtlMs),
      },
    });
  }

  registeredTypes(): string[] { return [...this.types.keys()]; }

  /** Davriy ish: har tick'da `${type}:<davr>` dedupeKey bilan qo'shiladi — instansiyalar soniga qaramay bir marta. */
  scheduleRecurring(type: string, everyMs: number, input?: Recurring['input']): void {
    this.recurring.push({ type, everyMs: Math.max(1000, everyMs), input });
  }

  /** Ish qo'shish. dedupeKey band bo'lsa — mavjud ish qaytariladi (duplicate:true). */
  async enqueue(input: EnqueueInput): Promise<{ id: string; duplicate: boolean }> {
    const reg = this.types.get(input.type);
    const doc = {
      type: input.type,
      companyId: input.companyId,
      employeeId: input.employeeId,
      refId: input.refId,
      payload: input.payload,
      runAt: input.runAt || this.now(),
      priority: input.priority ?? 0,
      status: 'queued' as const,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? reg?.opts.maxAttempts ?? 5,
      dedupeKey: input.dedupeKey,
      correlationId: input.correlationId,
      requires: input.requires,
    };
    try {
      const created = await AiJob.create(doc);
      return { id: String(created._id), duplicate: false };
    } catch (e: any) {
      if (e?.code === 11000 && input.dedupeKey) {
        const ex: any = await AiJob.findOne({ dedupeKey: input.dedupeKey }).select('_id').lean();
        if (ex) return { id: String(ex._id), duplicate: true };
        // Poyga: mavjud ish shu orada TTL bilan o'chdi — bir marta qayta
        const created = await AiJob.create(doc);
        return { id: String(created._id), duplicate: false };
      }
      throw e;
    }
  }

  /** Navbatdagi (hali olinmagan) ishlarni bekor qiladi. */
  async cancel(filter: { type?: string; refId?: string; companyId?: string; dedupeKey?: string }): Promise<number> {
    const now = this.now();
    const f: Record<string, unknown> = { status: 'queued' };
    for (const [k, v] of Object.entries(filter)) if (v !== undefined) f[k] = v;
    const r = await AiJob.updateMany(f, { $set: { status: 'cancelled', finishedAt: now, expiresAt: new Date(now.getTime() + LIMITS.jobDoneTtlMs) } });
    return r.modifiedCount;
  }

  private typesWithCapacity(): string[] {
    const out: string[] = [];
    for (const [type, reg] of this.types) {
      if ((this.runningByType.get(type) || 0) < reg.opts.concurrency) out.push(type);
    }
    return out;
  }

  /** Bitta ishni atomik ravishda oladi (yoki null). */
  async claim(): Promise<AiJobLean | null> {
    if (this.draining) return null;
    const types = this.typesWithCapacity();
    if (!types.length) return null;
    const now = this.now();
    const filter: Record<string, unknown> = { status: 'queued', runAt: { $lte: now }, type: { $in: types } };
    if (!this.hasWorker()) filter.requires = { $ne: 'worker' };
    const job: any = await AiJob.findOneAndUpdate(
      filter,
      { $set: { status: 'leased', leaseOwner: this.instanceId, leaseUntil: new Date(now.getTime() + LIMITS.jobLeaseMs), startedAt: now }, $inc: { attempts: 1 } },
      { sort: { priority: -1, runAt: 1 }, returnDocument: 'after' },
    ).lean();
    if (!job) return null;
    if (this.draining) {
      // Drain claim davomida boshlandi — ishni darhol qaytaramiz (urinish hisobga olinmaydi)
      await AiJob.updateOne({ _id: job._id, leaseOwner: this.instanceId, status: 'leased' } as Record<string, unknown>,
        { $set: { status: 'queued', leaseOwner: null, leaseUntil: null }, $inc: { attempts: -1 } });
      return null;
    }
    const leaseMs = this.types.get(job.type)?.opts.leaseMs ?? LIMITS.jobLeaseMs;
    if (leaseMs !== LIMITS.jobLeaseMs) {
      const leaseUntil = new Date(now.getTime() + leaseMs);
      await AiJob.updateOne({ _id: job._id, leaseOwner: this.instanceId, status: 'leased' }, { $set: { leaseUntil } });
      job.leaseUntil = leaseUntil;
    }
    return job as AiJobLean;
  }

  async heartbeat(job: AiJobLean): Promise<boolean> {
    const leaseMs = this.types.get(job.type)?.opts.leaseMs ?? LIMITS.jobLeaseMs;
    const r = await AiJob.updateOne(
      { _id: job._id, leaseOwner: this.instanceId, status: 'leased' },
      { $set: { leaseUntil: new Date(this.now().getTime() + leaseMs) } },
    );
    return r.matchedCount === 1;
  }

  private async complete(job: AiJobLean): Promise<void> {
    const now = this.now();
    const ttl = this.types.get(job.type)?.opts.doneTtlMs ?? LIMITS.jobDoneTtlMs;
    await AiJob.updateOne(
      { _id: job._id, leaseOwner: this.instanceId, status: 'leased' },
      { $set: { status: 'done', finishedAt: now, leaseOwner: null, leaseUntil: null, expiresAt: new Date(now.getTime() + ttl) } },
    );
  }

  private async fail(job: AiJobLean, err: unknown): Promise<void> {
    const now = this.now();
    const reg = this.types.get(job.type);
    const msg = String((err as Error)?.message || err).slice(0, 1000);
    const own: Record<string, unknown> = { _id: job._id, leaseOwner: this.instanceId, status: 'leased' };
    const terminal = (status: 'failed' | 'dead') => AiJob.updateOne(own, {
      $set: { status, lastError: msg, finishedAt: now, leaseOwner: null, leaseUntil: null, expiresAt: new Date(now.getTime() + LIMITS.jobFailedTtlMs) },
    });
    // Yakuniy muvaffaqiyatsizlik — markaziy xato jurnaliga (dasturchi panelida "Xatolar", yangi tur bo'lsa Telegram)
    const report = (status: string) => void captureError({ source: 'worker', kind: `${job.type}:${status}`, message: msg, stack: (err as Error)?.stack });
    if (err instanceof NonRetryableJobError) { await terminal('failed'); report('failed'); return; }
    if (job.attempts >= job.maxAttempts) { await terminal('dead'); report('dead'); this.log(`ish 'dead': ${job.type} ${job._id} — ${msg}`); return; }
    const delay = backoffMs(job.attempts, reg?.opts.backoffBaseMs ?? LIMITS.jobBackoffBaseMs, reg?.opts.backoffCapMs ?? LIMITS.jobBackoffCapMs);
    await AiJob.updateOne(own, { $set: { status: 'queued', lastError: msg, runAt: new Date(now.getTime() + delay), leaseOwner: null, leaseUntil: null } });
  }

  /** Olingan ishni bajaradi (natija/xatoni yozadi). */
  async execute(job: AiJobLean): Promise<void> {
    const reg = this.types.get(job.type);
    if (!reg) { await this.fail(job, new NonRetryableJobError(`handler yo'q: ${job.type}`)); return; }
    const id = String(job._id);
    const abort = new AbortController();
    this.runningByType.set(job.type, (this.runningByType.get(job.type) || 0) + 1);
    const promise = (async () => {
      try {
        await reg.handler({ job, queue: this, heartbeat: () => this.heartbeat(job), signal: abort.signal });
        if (!abort.signal.aborted) await this.complete(job);
      } catch (e) {
        if (!abort.signal.aborted) await this.fail(job, e).catch((err) => this.log(`fail yozilmadi: ${(err as Error).message}`));
      } finally {
        this.runningByType.set(job.type, Math.max(0, (this.runningByType.get(job.type) || 1) - 1));
        this.running.delete(id);
      }
    })();
    this.running.set(id, { type: job.type, promise, abort });
    await promise;
  }

  /** Bitta ishni olib bajaradi; ish bo'lmasa false. */
  async runOnce(): Promise<boolean> {
    const job = await this.claim();
    if (!job) return false;
    await this.execute(job);
    return true;
  }

  /** Muddati o'tgan lease'lar: attempts tugagan — 'dead', qolgani — 'queued'. */
  async sweepExpired(): Promise<{ requeued: number; dead: number }> {
    const now = this.now();
    const base: Record<string, unknown> = { status: 'leased', leaseUntil: { $lt: now } };
    const dead = await AiJob.updateMany(
      { ...base, $expr: { $gte: ['$attempts', '$maxAttempts'] } },
      { $set: { status: 'dead', lastError: 'lease_expired', finishedAt: now, leaseOwner: null, leaseUntil: null, expiresAt: new Date(now.getTime() + LIMITS.jobFailedTtlMs) } },
    );
    const requeued = await AiJob.updateMany(base, { $set: { status: 'queued', lastError: 'lease_expired', leaseOwner: null, leaseUntil: null } });
    return { requeued: requeued.modifiedCount, dead: dead.modifiedCount };
  }

  private async enqueueRecurring(): Promise<void> {
    const now = this.now().getTime();
    for (const r of this.recurring) {
      const bucket = Math.floor(now / r.everyMs) * r.everyMs;
      if (r.lastBucket === bucket) continue;          // shu davr allaqachon qo'shilgan — har tick'da DB'ga urilmaymiz
      await this.enqueue({ ...(r.input || {}), type: r.type, runAt: new Date(bucket), dedupeKey: `${r.type}:${new Date(bucket).toISOString()}` })
        .then(() => { r.lastBucket = bucket; })
        .catch((e) => this.log(`davriy ish qo'shilmadi (${r.type}): ${(e as Error).message}`));
    }
  }

  /** Bitta sikl: sweep (15 s'da bir), davriy ishlar, bo'sh sig'imgacha claim (fon rejimida bajariladi). */
  async tick(): Promise<void> {
    if (this.ticking || this.draining) return;
    this.ticking = true;
    try {
      if (Date.now() - this.lastSweepAt > 15_000) { this.lastSweepAt = Date.now(); await this.sweepExpired(); }
      await this.enqueueRecurring();
      for (let i = 0; i < 50 && !this.draining; i++) {
        const job = await this.claim();
        if (!job) break;
        void this.execute(job);
      }
    } catch (e) {
      this.log(`tick xatosi: ${(e as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.draining = false;
    const loop = async () => {
      if (this.stopped) return;
      await this.tick();
      if (!this.stopped) this.timer = setTimeout(loop, this.pollMs);
    };
    this.timer = setTimeout(loop, 0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  isRunning(id?: string): boolean { return id ? this.running.has(id) : this.running.size > 0; }

  /**
   * SIGTERM: yangi ish olinmaydi, ishlayotganlar timeoutMs gacha kutiladi; ulgurmaganlari
   * bekor qilinadi (signal) va lease'i qaytariladi (attempt hisobga olinmaydi).
   */
  async drain(timeoutMs: number): Promise<{ finished: number; released: number }> {
    this.draining = true;
    this.stop();
    const entries = [...this.running.entries()];
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(entries.map(([, r]) => r.promise)),
      new Promise<void>((res) => { timer = setTimeout(res, Math.max(0, timeoutMs)); }),
    ]);
    if (timer) clearTimeout(timer);
    let released = 0;
    for (const [id, r] of this.running) {
      r.abort.abort();
      const res = await AiJob.updateOne(
        { _id: id, leaseOwner: this.instanceId, status: 'leased' },
        { $set: { status: 'queued', leaseOwner: null, leaseUntil: null, lastError: 'drained' }, $inc: { attempts: -1 } },
      );
      released += res.modifiedCount;
    }
    return { finished: entries.length - released, released };
  }
}

// Jarayon bo'yicha yagona navbat (bootstrap o'rnatadi) — scheduler/routes ish qo'shishi uchun.
let shared: JobQueue | null = null;
export function setSharedQueue(q: JobQueue | null): void { shared = q; }
export function getSharedQueue(): JobQueue | null { return shared; }
