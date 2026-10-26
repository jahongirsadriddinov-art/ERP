// Tashqi (off-site) zaxira tizimi — server/baza butunlay yo'qolsa ham firma ma'lumotlari saqlanib qolishi uchun.
//  • Har kuni (Toshkent 03:00, BACKUP_HOUR_TASHKENT) va xavfli amallardan oldin BUTUN bazaning shifrlangan arxivi
//    olinadi va Render/Mongo'dan TASHQARIGA yuboriladi:
//      1) S3-mos xotira (Cloudflare R2 / Backblaze B2 / AWS S3) — BACKUP_S3_* env'lar bilan;
//      2) dasturchining Telegram'i (hujjat) — hech qanday sozlashsiz ishlaydi.
//  • Saqlash: 14 kunlik + 8 haftalik + 12 oylik (S3'da eskilari o'chiriladi).
//  • Faqat bitta instansiya ishga tushiradi (Mongo qulf hujjati).
//  • Muvaffaqiyatsizlik yoki 26 soat davomida muvaffaqiyatli zaxira bo'lmasa — dasturchiga bot orqali xabar.
//  • Tiklash (faqat dasturchi): butun baza yoki bitta firma, avval sinov (dry-run), majburiy oldindan nusxa,
//    yozib tasdiqlash, audit jurnali.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose, { Schema } from 'mongoose';
import { S3Client, s3ConfigFromEnv, S3Config } from './sigv4';
import { buildArchive, primaryKey, allKeys, decryptBuffer, encryptBuffer, ArchiveManifest, ArchiveScope, readManifest, isArchive } from './archive';
import { restoreFromArchive, RestoreMode, RestoreResult } from './restore';
import { selectRetention, DEFAULT_RETENTION } from './retention';
import { sendArchiveToTelegram, downloadTelegramParts, TgPart } from './telegram';

export type TargetName = 's3' | 'telegram';
export interface Actor { userId: string; name: string; role: string }

// ── Bog'liqliklar (testlarda almashtiriladi) ─────────────────────────────────────
type Deps = { fetch: typeof fetch; now: () => Date; notify: (text: string) => Promise<void> };
const defaultNotify = async (text: string) => {
  try { const { notifyDeveloper } = await import('../bot'); await notifyDeveloper(text, { plain: true }); }
  catch (e: any) { console.error('[offsite backup] notify', e?.message); }
};
const deps: Deps = { fetch: (...a) => fetch(...a), now: () => new Date(), notify: defaultNotify };
export function __setBackupDeps(p: Partial<Deps>) { Object.assign(deps, p); }
export function __resetBackupDeps() { deps.fetch = (...a) => fetch(...a); deps.now = () => new Date(); deps.notify = defaultNotify; }

// ── Modellar ──────────────────────────────────────────────────────────────────
const TargetResultSchema = new Schema({
  target: String, ok: Boolean, error: String, at: Date, ms: Number,
  key: String,            // S3 obyekt kaliti
  parts: Schema.Types.Mixed, // Telegram: [{index,total,fileId,messageId,size,fileName}]
  chatId: String,
}, { _id: false });

export interface IBackupRun extends mongoose.Document {
  kind: 'backup' | 'restore';
  scope: ArchiveScope; companyId?: string; companyName?: string;
  reason: string; scheduled: boolean;
  status: 'running' | 'ok' | 'partial' | 'failed';
  startedAt: Date; finishedAt?: Date;
  fileName?: string; key?: string; sizeBytes?: number; sha256?: string; totalDocs?: number;
  collections?: Record<string, number>; companies?: { id: string; name: string; docs: number }[];
  manifest?: ArchiveManifest;
  targets: { target: TargetName; ok: boolean; error?: string; at: Date; ms?: number; key?: string; parts?: TgPart[]; chatId?: string }[];
  error?: string; by?: Actor;
  restore?: any;
  createdAt: Date;
}
const BackupRunSchema = new Schema<IBackupRun>({
  kind: { type: String, default: 'backup' },
  scope: { type: String, default: 'full' }, companyId: String, companyName: String,
  reason: String, scheduled: { type: Boolean, default: false },
  status: { type: String, default: 'running' },
  startedAt: Date, finishedAt: Date,
  fileName: String, key: String, sizeBytes: Number, sha256: String, totalDocs: Number,
  collections: Schema.Types.Mixed, companies: Schema.Types.Mixed, manifest: Schema.Types.Mixed,
  targets: [TargetResultSchema],
  error: String, by: Schema.Types.Mixed, restore: Schema.Types.Mixed,
}, { timestamps: true, collection: 'offsitebackupruns' });
BackupRunSchema.index({ kind: 1, createdAt: -1 });
BackupRunSchema.index({ key: 1 });
BackupRunSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 3600 });
export const BackupRun = (mongoose.models.OffsiteBackupRun as mongoose.Model<IBackupRun>) || mongoose.model<IBackupRun>('OffsiteBackupRun', BackupRunSchema);

const locks = () => mongoose.connection.db!.collection<{ _id: string; owner?: string; expiresAt?: Date; at?: Date }>('offsitebackuplocks');

// ── Qulf (faqat bitta instansiya) ───────────────────────────────────────────────
const INSTANCE = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
export async function acquireLock(name: string, ttlMs: number): Promise<{ release: () => Promise<void> } | null> {
  const now = deps.now();
  const owner = `${INSTANCE}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    await locks().findOneAndUpdate(
      { _id: name, $or: [{ expiresAt: { $lt: now } }, { expiresAt: { $exists: false } }] },
      { $set: { owner, expiresAt: new Date(now.getTime() + ttlMs), at: now } },
      { upsert: true },
    );
  } catch (e: any) {
    if (e?.code === 11000) return null;
    throw e;
  }
  const hb = setInterval(() => {
    void locks().updateOne({ _id: name, owner }, { $set: { expiresAt: new Date(Date.now() + ttlMs) } }).catch(() => undefined);
  }, Math.max(5_000, Math.floor(ttlMs / 3)));
  hb.unref?.();
  return { release: async () => { clearInterval(hb); await locks().deleteOne({ _id: name, owner }).catch(() => undefined); } };
}

// ── Sozlamalar ─────────────────────────────────────────────────────────────────
export const BACKUP_HOUR_TASHKENT = () => {
  const h = Number(process.env.BACKUP_HOUR_TASHKENT);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 3;
};
const prefix = () => (process.env.BACKUP_S3_PREFIX || 'qurilish-erp-backups').replace(/^\/+|\/+$/g, '');
export const s3Config = (): S3Config | null => s3ConfigFromEnv(process.env);
const s3Client = (cfg = s3Config()) => (cfg ? new S3Client(cfg, deps.fetch, deps.now) : null);
const telegramDisabled = () => /^(0|off|false|no)$/i.test(String(process.env.BACKUP_TELEGRAM || '').trim());

export async function telegramTarget(): Promise<{ token: string; chatId: string; chatSource: string } | null> {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || telegramDisabled()) return null;
  const explicit = (process.env.BACKUP_TELEGRAM_CHAT_ID || '').trim();
  if (explicit) return { token, chatId: explicit, chatSource: 'BACKUP_TELEGRAM_CHAT_ID' };
  const dev = (process.env.DEVELOPER_CHAT_ID || '').trim();
  if (dev) return { token, chatId: dev, chatSource: 'DEVELOPER_CHAT_ID' };
  try {
    const u: any = await mongoose.connection.db!.collection('users').findOne(
      { role: 'dasturchi', telegramChatId: { $exists: true, $nin: ['', null] } }, { projection: { telegramChatId: 1 }, sort: { createdAt: 1 } });
    if (u?.telegramChatId) return { token, chatId: String(u.telegramChatId), chatSource: "dasturchi hisobi (Telegram'ga ulangan)" };
  } catch { /* */ }
  return null;
}

// ── Arxiv nomi ──────────────────────────────────────────────────────────────────
const stampOf = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
export function archiveKeyFor(scope: ArchiveScope, companyId: string | undefined, reason: string, at: Date): { key: string; fileName: string } {
  const safeReason = reason.replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'manual';
  const fileName = `${scope === 'full' ? 'full' : `company-${companyId}`}_${stampOf(at)}_${safeReason}_${crypto.randomBytes(2).toString('hex')}.qbk`;
  const dir = scope === 'full' ? 'full' : `company/${companyId}`;
  return { key: `${prefix()}/${dir}/${at.toISOString().slice(0, 4)}/${at.toISOString().slice(5, 7)}/${fileName}`, fileName };
}
const manifestKeyOf = (key: string) => key.replace(/\.qbk$/, '.manifest');
/** Kalit nomidan: sana, sabab, doira (manifest o'qimasdan ro'yxat uchun). */
export function parseArchiveKey(key: string): { createdAt: Date | null; reason: string; scope: ArchiveScope; companyId?: string } {
  const base = key.split('/').pop() || key;
  const m = /^(full|company-([a-f0-9]{24}|[^_]+))_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)_([A-Za-z0-9_-]+?)_[a-f0-9]{4}\.qbk$/.exec(base);
  if (!m) return { createdAt: null, reason: 'unknown', scope: 'full' };
  const iso = m[3].replace(/T(\d{2})-(\d{2})-(\d{2})Z/, 'T$1:$2:$3Z');
  return { createdAt: new Date(iso), reason: m[4], scope: m[1] === 'full' ? 'full' : 'company', companyId: m[2] };
}

// ── Zaxira olish ────────────────────────────────────────────────────────────────
const REASON_UZ: Record<string, string> = {
  daily: 'kunlik (rejali)', manual: "qo'lda", pre_restore: 'tiklashdan oldin', pre_delete_company: "firma o'chirilishidan oldin",
  pre_reset: 'tozalashdan oldin', pre_import: 'importdan oldin', pre_snapshot_restore: 'nusxadan tiklashdan oldin',
};
export const reasonLabel = (r: string) => REASON_UZ[r] || r;
const fmtSize = (n = 0) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const errMsg = (e: any) => String(e?.message || e || 'xato').replace(/bot\d{6,12}:[A-Za-z0-9_-]{30,}/g, 'bot[token]').slice(0, 300);

export interface BackupRequest { scope: ArchiveScope; companyId?: string; reason: string; scheduled?: boolean; by?: Actor; targets?: TargetName[] }
export interface StagedBackup { run: IBackupRun | null; skipped?: string; done: Promise<IBackupRun | null> }

const ALERT_FAIL_EVERY_MS = 3 * 3600_000;
const ALERT_STALE_EVERY_MS = 12 * 3600_000;
const STALE_AFTER_MS = 26 * 3600_000;

async function alertOnce(id: string, everyMs: number, text: string) {
  const now = deps.now();
  try {
    const r = await locks().findOneAndUpdate(
      { _id: `alert:${id}`, $or: [{ at: { $lt: new Date(now.getTime() - everyMs) } }, { at: { $exists: false } }] },
      { $set: { at: now } }, { upsert: true });
    void r;
  } catch (e: any) { if (e?.code === 11000) return; }
  await deps.notify(text);
}

/**
 * Arxiv yaratiladi (await — shu payt ma'lumot o'qiladi), yuborish esa `done` va'dasida davom etadi.
 * Xavfli amaldan oldin: `await stageBackup(...)` — keyin amal bajariladi, yuborish fonda tugaydi.
 */
export async function stageBackup(req: BackupRequest): Promise<StagedBackup> {
  const key = primaryKey();
  const s3 = s3Config();
  const tg = await telegramTarget();
  const wanted = (req.targets || ['s3', 'telegram']).filter((t) => (t === 's3' ? !!s3 : !!tg));
  const db = mongoose.connection.db;
  if (!db) return { run: null, skipped: "Bazaga ulanish yo'q", done: Promise.resolve(null) };
  if (!key || !wanted.length) {
    const why = !key ? "Shifrlash kaliti yo'q (BACKUP_ENCRYPTION_KEY)" : 'Hech qanday tashqi manzil sozlanmagan (S3 yoki Telegram)';
    if (req.scheduled) {
      const run = await BackupRun.create({ kind: 'backup', scope: req.scope, companyId: req.companyId, reason: req.reason, scheduled: true, status: 'failed', startedAt: deps.now(), finishedAt: deps.now(), error: why, targets: [], by: req.by });
      await alertOnce('fail', ALERT_FAIL_EVERY_MS, `⚠️ Zaxira olinmadi: ${why}. Dasturchi paneli → Zaxira bo'limida sozlash yo'riqnomasi bor.`);
      return { run, skipped: why, done: Promise.resolve(run) };
    }
    return { run: null, skipped: why, done: Promise.resolve(null) };
  }
  const startedAt = deps.now();
  const { key: s3Key, fileName } = archiveKeyFor(req.scope, req.companyId, req.reason, startedAt);
  const run = await BackupRun.create({ kind: 'backup', scope: req.scope, companyId: req.companyId, reason: req.reason, scheduled: !!req.scheduled, status: 'running', startedAt, fileName, by: req.by, targets: [] });
  let built: { file: Buffer; manifest: ArchiveManifest };
  try {
    built = await buildArchive(db, { scope: req.scope, companyId: req.companyId, reason: req.reason, key, now: startedAt });
  } catch (e) {
    run.status = 'failed'; run.error = `Arxiv yaratilmadi: ${errMsg(e)}`; run.finishedAt = deps.now();
    await run.save();
    await alertOnce('fail', req.scheduled ? ALERT_FAIL_EVERY_MS : 0, `🔴 Zaxira arxivi yaratilmadi (${reasonLabel(req.reason)}): ${errMsg(e)}`);
    return { run, done: Promise.resolve(run) };
  }
  const manifest = { ...built.manifest, fileName };
  run.sizeBytes = built.file.length; run.sha256 = built.manifest.sha256; run.totalDocs = manifest.totalDocs;
  run.collections = manifest.collections; run.companies = manifest.companies; run.companyName = manifest.companyName;
  run.manifest = manifest;
  await run.save();

  const done = (async () => {
    for (const t of wanted) {
      const t0 = Date.now();
      try {
        if (t === 's3') {
          const c = s3Client(s3)!;
          await c.put(s3Key, built.file);
          await c.put(manifestKeyOf(s3Key), encryptBuffer(Buffer.from(JSON.stringify(manifest)), key), 'application/octet-stream');
          run.key = s3Key;
          run.targets.push({ target: 's3', ok: true, at: deps.now(), ms: Date.now() - t0, key: s3Key });
        } else {
          const scopeTxt = req.scope === 'full' ? "butun baza" : `firma: ${manifest.companyName || req.companyId}`;
          const caption = `🗄 QurilishERP zaxira — ${scopeTxt}\n${startedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC · ${reasonLabel(req.reason)}\n${manifest.totalDocs} yozuv · ${fmtSize(built.file.length)} · AES-256 shifrlangan\nsha256: ${String(manifest.sha256).slice(0, 16)}…\nTiklash: Dasturchi paneli → Zaxira → "Fayldan tiklash"`;
          const parts = await sendArchiveToTelegram({ token: tg!.token, chatId: tg!.chatId, fileName, file: built.file, caption, fetchImpl: deps.fetch });
          run.targets.push({ target: 'telegram', ok: true, at: deps.now(), ms: Date.now() - t0, parts, chatId: tg!.chatId });
        }
      } catch (e) {
        run.targets.push({ target: t, ok: false, error: errMsg(e), at: deps.now(), ms: Date.now() - t0 });
      }
    }
    const okN = run.targets.filter((x) => x.ok).length;
    run.status = okN === run.targets.length ? 'ok' : okN ? 'partial' : 'failed';
    if (!okN) run.error = run.targets.map((x) => `${x.target}: ${x.error}`).join('; ');
    run.finishedAt = deps.now();
    await run.save();
    if (run.status !== 'ok') {
      const lines = run.targets.filter((x) => !x.ok).map((x) => `• ${x.target === 's3' ? 'S3/R2' : 'Telegram'}: ${x.error}`).join('\n');
      await alertOnce(`fail`, req.scheduled ? ALERT_FAIL_EVERY_MS : 0, `${run.status === 'failed' ? '🔴 Zaxira YUBORILMADI' : '🟠 Zaxira qisman yuborildi'} (${reasonLabel(req.reason)}, ${fmtSize(run.sizeBytes)}):\n${lines}`);
    }
    if (req.scheduled && run.targets.some((x) => x.target === 's3' && x.ok)) await pruneS3().catch((e) => console.error('[offsite backup] prune', errMsg(e)));
    return run;
  })().catch((e) => { console.error('[offsite backup] upload', errMsg(e)); return run; });
  return { run, done };
}

/** Zaxira olib, yuborish tugashini ham kutadi. Butun baza uchun — qulf bilan (bir vaqtda bitta). */
export async function runBackup(req: BackupRequest): Promise<{ run: IBackupRun | null; skipped?: string }> {
  let lock: Awaited<ReturnType<typeof acquireLock>> = null;
  if (req.scope === 'full') {
    lock = await acquireLock('full-backup', 30 * 60_000);
    if (!lock) return { run: null, skipped: 'Boshqa zaxira jarayoni ketyapti — birozdan keyin' };
  }
  try {
    if (req.scheduled && !(await isDailyDue())) return { run: null, skipped: 'Bugungi zaxira allaqachon olingan' };
    const st = await stageBackup(req);
    const run = await st.done;
    return { run: run ?? st.run, skipped: st.skipped };
  } finally {
    await lock?.release();
  }
}

/** Xavfli amaldan oldin firma nusxasi — arxiv yaratilishini kutadi (ma'lumot o'qiladi), yuborish fonda. Hech qachon xato tashlamaydi. */
export async function backupBeforeRiskyOp(companyId: string, reason: string, by?: Actor): Promise<string | null> {
  try {
    const st = await Promise.race([
      stageBackup({ scope: 'company', companyId, reason, by }),
      new Promise<null>((r) => setTimeout(() => r(null), 60_000)),
    ]);
    if (!st) return null;
    void st.done.catch(() => undefined);
    return st.run ? String(st.run._id) : null;
  } catch (e) {
    console.error('[offsite backup] pre-op', errMsg(e));
    return null;
  }
}

// ── Saqlash muddati (S3) ────────────────────────────────────────────────────────
export async function pruneS3(): Promise<{ pruned: string[] }> {
  const c = s3Client();
  if (!c) return { pruned: [] };
  const objs = await c.list(prefix() + '/');
  const archives = objs.filter((o) => o.key.endsWith('.qbk')).map((o) => {
    const p = parseArchiveKey(o.key);
    return { key: o.key, createdAt: p.createdAt || new Date(o.lastModified || 0), scheduled: p.scope === 'full' && p.reason === 'daily' };
  });
  const { prune } = selectRetention(archives, deps.now(), DEFAULT_RETENTION);
  for (const k of prune) {
    await c.delete(k);
    await c.delete(manifestKeyOf(k)).catch(() => undefined);
  }
  return { pruned: prune };
}

// ── Jadval ─────────────────────────────────────────────────────────────────────
const TZ_OFFSET_MS = 5 * 3600_000; // Toshkent UTC+5, yozgi vaqt yo'q
/** Hozirgacha bo'lgan oxirgi rejali vaqt (bugun yoki kecha soat BACKUP_HOUR'da). */
export function lastSlot(now: Date, hour = BACKUP_HOUR_TASHKENT()): Date {
  const t = new Date(now.getTime() + TZ_OFFSET_MS);
  let slot = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), hour) - TZ_OFFSET_MS;
  if (slot > now.getTime()) slot -= 24 * 3600_000;
  return new Date(slot);
}

async function lastScheduledSuccess(): Promise<Date | null> {
  const r = await BackupRun.findOne({ kind: 'backup', scheduled: true, status: { $in: ['ok', 'partial'] } }).sort({ createdAt: -1 }).select('startedAt').lean();
  return r ? new Date(r.startedAt) : null;
}

export async function isDailyDue(now = deps.now()): Promise<boolean> {
  const last = await lastScheduledSuccess();
  if (last && last.getTime() >= lastSlot(now).getTime()) return false;
  // Muvaffaqiyatsiz urinishdan keyin soatiga ko'pi bilan bir marta qayta uriniladi
  const lastTry = await BackupRun.findOne({ kind: 'backup', scheduled: true }).sort({ createdAt: -1 }).select('startedAt status').lean();
  if (lastTry && lastTry.status !== 'ok' && lastTry.status !== 'partial' && now.getTime() - new Date(lastTry.startedAt).getTime() < 3600_000) return false;
  return true;
}

export async function nextRunAt(now = deps.now()): Promise<Date> {
  const last = await lastScheduledSuccess();
  const slot = lastSlot(now);
  if (!last || last.getTime() < slot.getTime()) return now; // muddati o'tgan — keyingi tekshiruvda
  return new Date(slot.getTime() + 24 * 3600_000);
}

export async function checkStale(now = deps.now()): Promise<boolean> {
  const lastOk = await BackupRun.findOne({ kind: 'backup', status: { $in: ['ok', 'partial'] } }).sort({ createdAt: -1 }).select('startedAt').lean();
  const ref = lastOk ? new Date(lastOk.startedAt) : (await BackupRun.findOne({ kind: 'backup' }).sort({ createdAt: 1 }).select('startedAt').lean())?.startedAt;
  if (!ref) return false;
  const age = now.getTime() - new Date(ref).getTime();
  if (age <= STALE_AFTER_MS) return false;
  const hours = Math.round(age / 3600_000);
  await alertOnce('stale', ALERT_STALE_EVERY_MS, lastOk
    ? `⚠️ Oxirgi muvaffaqiyatli tashqi zaxira ${hours} soat oldin olingan (26 soatdan ko'p). Dasturchi paneli → Zaxira bo'limini tekshiring.`
    : `⚠️ Tashqi zaxira hali BIRORTA ham muvaffaqiyatli olinmagan (${hours} soatdan beri). Dasturchi paneli → Zaxira bo'limini tekshiring.`);
  return true;
}

export async function schedulerTick(): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 1) return;
    if (await isDailyDue()) await runBackup({ scope: 'full', reason: 'daily', scheduled: true });
    await checkStale();
  } catch (e) {
    console.error('[offsite backup] tick', errMsg(e));
  }
}

let started = false;
export function startOffsiteBackupScheduler() {
  if (started || /^(0|off|false|no)$/i.test(String(process.env.BACKUP_SCHEDULE || '').trim())) return;
  started = true;
  setTimeout(() => void schedulerTick(), 3 * 60_000).unref?.();
  setInterval(() => void schedulerTick(), 10 * 60_000).unref?.();
}

// ── Holat (dasturchi paneli) ─────────────────────────────────────────────────────
export async function backupStatus() {
  const s3 = s3Config();
  const tg = await telegramTarget();
  const key = primaryKey();
  const lastFor = async (target: TargetName) => {
    const ok: any = await BackupRun.findOne({ kind: 'backup', targets: { $elemMatch: { target, ok: true } } }).sort({ createdAt: -1 }).lean();
    const fail: any = await BackupRun.findOne({ kind: 'backup', targets: { $elemMatch: { target, ok: false } } }).sort({ createdAt: -1 }).lean();
    const okT = ok?.targets?.find((x: any) => x.target === target && x.ok);
    const failT = fail?.targets?.find((x: any) => x.target === target && !x.ok);
    return {
      lastSuccessAt: okT?.at || null, lastSuccessSize: ok?.sizeBytes || null, lastSuccessReason: ok?.reason || null,
      lastFailureAt: failT?.at || null, lastError: failT && (!okT || new Date(failT.at) >= new Date(okT.at)) ? failT.error : null,
    };
  };
  const [s3Last, tgLast, recent, failures, lastOk] = await Promise.all([
    lastFor('s3'), lastFor('telegram'),
    BackupRun.find({}).sort({ createdAt: -1 }).limit(15).select('-manifest -companies -collections').lean(),
    BackupRun.find({ status: { $in: ['failed', 'partial'] } }).sort({ createdAt: -1 }).limit(10).select('kind reason status error targets.target targets.ok targets.error startedAt').lean(),
    BackupRun.findOne({ kind: 'backup', status: { $in: ['ok', 'partial'] } }).sort({ createdAt: -1 }).select('startedAt sizeBytes').lean(),
  ]);
  const now = deps.now();
  const lastOkAt = lastOk ? new Date(lastOk.startedAt) : null;
  return {
    now,
    encryption: { configured: !!key, source: key?.source || null, keyId: key?.id || null, weak: key?.source === 'JWT_SECRET' },
    targets: {
      s3: { configured: !!s3, endpoint: s3 ? new URL(s3.endpoint).host : null, bucket: s3?.bucket || null, prefix: prefix(), ...s3Last },
      telegram: { configured: !!tg, chatSource: tg?.chatSource || null, disabled: telegramDisabled(), ...tgLast },
    },
    schedule: { hourTashkent: BACKUP_HOUR_TASHKENT(), nextRunAt: await nextRunAt(now), retention: DEFAULT_RETENTION },
    lastSuccessAt: lastOkAt, stale: !lastOkAt || now.getTime() - lastOkAt.getTime() > STALE_AFTER_MS,
    recent: recent.map(runView), failures: failures.map(runView),
    checklist: [
      { key: 'BACKUP_ENCRYPTION_KEY', ok: key?.source === 'BACKUP_ENCRYPTION_KEY', required: false, note: key ? `Hozir: ${key.source}` : "Hech qanday kalit yo'q — zaxira olinmaydi" },
      { key: 'TELEGRAM_BOT_TOKEN', ok: !!process.env.TELEGRAM_BOT_TOKEN, required: false, note: tg ? `Chat: ${tg.chatSource}` : "Dasturchi hisobini Telegram'ga ulang yoki DEVELOPER_CHAT_ID qo'ying" },
      { key: 'BACKUP_S3_ENDPOINT', ok: !!process.env.BACKUP_S3_ENDPOINT, required: true },
      { key: 'BACKUP_S3_BUCKET', ok: !!process.env.BACKUP_S3_BUCKET, required: true },
      { key: 'BACKUP_S3_ACCESS_KEY_ID', ok: !!process.env.BACKUP_S3_ACCESS_KEY_ID, required: true },
      { key: 'BACKUP_S3_SECRET_ACCESS_KEY', ok: !!process.env.BACKUP_S3_SECRET_ACCESS_KEY, required: true },
      { key: 'BACKUP_S3_REGION', ok: !!process.env.BACKUP_S3_REGION, required: false, note: "R2 uchun: auto" },
    ],
  };
}

export function runView(r: any) {
  return {
    id: String(r._id), kind: r.kind, scope: r.scope, companyId: r.companyId, companyName: r.companyName, reason: r.reason, reasonLabel: reasonLabel(r.reason),
    scheduled: !!r.scheduled, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, sizeBytes: r.sizeBytes, totalDocs: r.totalDocs,
    error: r.error, by: r.by?.name, key: r.key,
    targets: (r.targets || []).map((t: any) => ({ target: t.target, ok: t.ok, error: t.error, at: t.at, parts: Array.isArray(t.parts) ? t.parts.length : undefined })),
    restore: r.restore ? { mode: r.restore.mode, totals: r.restore.totals, preRunId: r.restore.preRunId, source: r.restore.source } : undefined,
  };
}

// ── Arxivlar ro'yxati va manbalar ──────────────────────────────────────────────
export type ArchiveSource = { type: 's3'; key: string } | { type: 'telegram'; runId: string } | { type: 'upload'; token: string };

export interface ArchiveItem { id: string; source: ArchiveSource; createdAt: string | null; sizeBytes: number; scope: ArchiveScope; companyId?: string; companyName?: string; reason: string; reasonLabel: string; totalDocs?: number; collections?: Record<string, number>; companies?: { id: string; name: string; docs: number }[]; runId?: string }

export async function listArchives(): Promise<{ items: ArchiveItem[]; s3Error?: string }> {
  const items: ArchiveItem[] = [];
  let s3Error: string | undefined;
  const c = s3Client();
  if (c) {
    try {
      const objs = (await c.list(prefix() + '/')).filter((o) => o.key.endsWith('.qbk'));
      const runs: any[] = await BackupRun.find({ key: { $in: objs.map((o) => o.key) } }).select('key totalDocs collections companies companyName').lean();
      const byKey = new Map(runs.map((r) => [r.key, r]));
      for (const o of objs) {
        const p = parseArchiveKey(o.key);
        const r = byKey.get(o.key);
        items.push({ id: `s3:${o.key}`, source: { type: 's3', key: o.key }, createdAt: (p.createdAt || (o.lastModified ? new Date(o.lastModified) : null))?.toISOString() || null, sizeBytes: o.size, scope: p.scope, companyId: p.companyId, companyName: r?.companyName, reason: p.reason, reasonLabel: reasonLabel(p.reason), totalDocs: r?.totalDocs, collections: r?.collections, companies: r?.companies, runId: r ? String(r._id) : undefined });
      }
    } catch (e) { s3Error = errMsg(e); }
  }
  const tgRuns: any[] = await BackupRun.find({ kind: 'backup', targets: { $elemMatch: { target: 'telegram', ok: true } } }).sort({ createdAt: -1 }).limit(120).select('-manifest').lean();
  for (const r of tgRuns) {
    items.push({ id: `telegram:${r._id}`, source: { type: 'telegram', runId: String(r._id) }, createdAt: new Date(r.startedAt).toISOString(), sizeBytes: r.sizeBytes || 0, scope: r.scope, companyId: r.companyId, companyName: r.companyName, reason: r.reason, reasonLabel: reasonLabel(r.reason), totalDocs: r.totalDocs, collections: r.collections, companies: r.companies, runId: String(r._id) });
  }
  items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { items, s3Error };
}

// Qo'lda yuklangan arxivlar (Telegram'dan yuklab olingan .qbk fayllar) — vaqtinchalik diskda, 2 soat
const uploads = new Map<string, { file: string; expires: number; name: string; size: number }>();
function sweepUploads() {
  const now = Date.now();
  for (const [k, v] of uploads) if (v.expires < now) { fs.promises.unlink(v.file).catch(() => undefined); uploads.delete(k); }
}
export async function registerUpload(buf: Buffer, name: string): Promise<{ token: string; manifest: ArchiveManifest | null; sizeBytes: number }> {
  sweepUploads();
  if (!isArchive(buf)) throw new Error("Bu fayl QurilishERP zaxira arxivi emas (.qbk)");
  const gz = decryptBuffer(buf); // kalit/buzilganlik shu yerda tekshiriladi
  const manifest = await readManifest(gz);
  const token = crypto.randomBytes(12).toString('hex');
  const file = path.join(os.tmpdir(), `qerp-restore-${token}.qbk`);
  await fs.promises.writeFile(file, buf);
  uploads.set(token, { file, expires: Date.now() + 2 * 3600_000, name, size: buf.length });
  return { token, manifest, sizeBytes: buf.length };
}

export async function loadArchiveFile(src: ArchiveSource): Promise<Buffer> {
  if (src.type === 's3') {
    const c = s3Client();
    if (!c) throw new Error('S3 sozlanmagan');
    if (!String(src.key).startsWith(prefix() + '/') || !src.key.endsWith('.qbk')) throw new Error("Noto'g'ri arxiv kaliti");
    return c.get(src.key);
  }
  if (src.type === 'telegram') {
    const run: any = await BackupRun.findById(src.runId).lean().catch(() => null);
    const t = run?.targets?.find((x: any) => x.target === 'telegram' && x.ok && Array.isArray(x.parts));
    if (!t) throw new Error('Telegram nusxasi topilmadi');
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN yo\'q');
    const buf = await downloadTelegramParts(token, t.parts, deps.fetch);
    if (run.sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== run.sha256) throw new Error("Telegram'dan olingan fayl xeshi mos emas");
    return buf;
  }
  sweepUploads();
  const u = uploads.get(String(src.token));
  if (!u) throw new Error('Yuklangan fayl muddati tugagan — qaytadan yuklang');
  return fs.promises.readFile(u.file);
}

export async function inspectArchive(src: ArchiveSource): Promise<ArchiveManifest | null> {
  if (src.type === 's3') {
    const run: any = await BackupRun.findOne({ key: src.key }).select('manifest').lean();
    if (run?.manifest) return run.manifest;
    const c = s3Client();
    if (!c) throw new Error('S3 sozlanmagan');
    try { return JSON.parse(decryptBuffer(await c.get(manifestKeyOf(src.key))).toString('utf8')); } catch { /* manifest yo'q — arxivning o'zidan */ }
  }
  if (src.type === 'telegram') {
    const run: any = await BackupRun.findById(src.runId).select('manifest').lean().catch(() => null);
    if (run?.manifest) return run.manifest;
  }
  return readManifest(decryptBuffer(await loadArchiveFile(src)));
}

// ── Tiklash ────────────────────────────────────────────────────────────────────
const sourceId = (s: ArchiveSource) => (s.type === 's3' ? `s3:${s.key}` : s.type === 'telegram' ? `telegram:${s.runId}` : `upload:${s.token}`);
export function confirmCodeFor(src: ArchiveSource, scope: ArchiveScope, companyId: string | undefined, mode: RestoreMode): string {
  const secret = primaryKey()?.key || Buffer.from(process.env.JWT_SECRET || 'qerp');
  const h = crypto.createHmac('sha256', secret).update(`${sourceId(src)}|${scope}|${companyId || ''}|${mode}`).digest('hex');
  return `TIKLASH-${h.slice(0, 6).toUpperCase()}`;
}

export interface RestoreRequest { source: ArchiveSource; scope: ArchiveScope; companyId?: string; mode: RestoreMode }

export async function previewRestore(r: RestoreRequest): Promise<RestoreResult & { confirmCode: string }> {
  const db = mongoose.connection.db!;
  const gz = decryptBuffer(await loadArchiveFile(r.source));
  const res = await restoreFromArchive(db, gz, { scope: r.scope, companyId: r.companyId, mode: r.mode, dryRun: true });
  if (res.manifest && res.manifest.scope === 'company' && r.scope === 'full') throw new Error("Bu arxiv bitta firmaniki — faqat \"bitta firma\" tiklash mumkin");
  if (res.manifest?.scope === 'company' && r.companyId && res.manifest.companyId !== r.companyId) throw new Error('Arxiv boshqa firmaga tegishli');
  return { ...res, confirmCode: confirmCodeFor(r.source, r.scope, r.companyId, r.mode) };
}

export class RestoreError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function executeRestore(r: RestoreRequest & { confirmText: string; by: Actor }): Promise<{ result: RestoreResult; preRunId: string; restoreRunId: string }> {
  if (String(r.confirmText || '').trim().toUpperCase() !== confirmCodeFor(r.source, r.scope, r.companyId, r.mode)) {
    throw new RestoreError(400, "Tasdiqlash kodi noto'g'ri — avval sinov (dry-run) qiling va ko'rsatilgan kodni aynan yozing");
  }
  const lock = await acquireLock('restore', 60 * 60_000);
  if (!lock) throw new RestoreError(409, 'Boshqa tiklash jarayoni ketyapti');
  try {
    const db = mongoose.connection.db!;
    const file = await loadArchiveFile(r.source);
    const gz = decryptBuffer(file);
    const m = await readManifest(gz);
    if (m?.scope === 'company' && (r.scope === 'full' || (r.companyId && m.companyId !== r.companyId))) throw new RestoreError(400, 'Arxiv doirasi tanlangan tiklashga mos emas');

    // 1) MAJBURIY: tiklashdan oldingi holat tashqi nusxasi (kamida bitta manzilga yetib borishi shart)
    const pre = await runBackup({ scope: r.scope, companyId: r.companyId, reason: 'pre_restore', by: r.by });
    if (!pre.run || !pre.run.targets.some((t) => t.ok)) {
      throw new RestoreError(503, `Tiklashdan oldingi nusxa olinmadi — tiklash to'xtatildi (${pre.skipped || pre.run?.error || 'manzil yo\'q'})`);
    }
    if (r.scope === 'company' && r.companyId) {
      try {
        const exists = await db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId(r.companyId) as any }, { projection: { _id: 1 } });
        if (exists) { const { takeSnapshot } = await import('../companySnapshot'); await takeSnapshot(r.companyId, 'pre_restore', r.by, 'Dasturchi tashqi arxivdan tiklashidan oldin'); }
      } catch { /* firma ichidagi nusxa — qo'shimcha, majburiy emas */ }
    }

    // 2) Tiklash
    const t0 = deps.now();
    const result = await restoreFromArchive(db, gz, { scope: r.scope, companyId: r.companyId, mode: r.mode, dryRun: false });
    const restoreRun = await BackupRun.create({
      kind: 'restore', scope: r.scope, companyId: r.companyId, companyName: m?.companyName || m?.companies?.find((c) => c.id === r.companyId)?.name,
      reason: 'restore', status: result.totals.errors ? 'partial' : 'ok', startedAt: t0, finishedAt: deps.now(), by: r.by, targets: [],
      restore: { source: sourceId(r.source), mode: r.mode, totals: result.totals, preRunId: String(pre.run._id), archiveCreatedAt: m?.createdAt },
    });
    if (r.scope === 'full') {
      try { const { reloadPlanCache } = await import('../../config/plans'); await reloadPlanCache(); } catch { /* */ }
    }
    try {
      const { logAudit } = await import('../audit');
      await logAudit({
        userId: r.by.userId, userName: r.by.name, userRole: r.by.role, action: 'update', entity: 'backup', entityId: String(restoreRun._id),
        description: `Tashqi arxivdan tiklandi (${r.scope === 'full' ? 'BUTUN BAZA' : `firma ${r.companyId}`}, ${r.mode}): ${result.totals.written} yozildi, ${result.totals.deleted} o'chirildi, ${result.totals.errors} xato. Arxiv: ${sourceId(r.source)}. Oldingi holat: run#${pre.run._id}`,
        companyId: r.scope === 'company' ? r.companyId : undefined,
      });
    } catch { /* */ }
    await deps.notify(`♻️ Tiklash bajarildi: ${r.scope === 'full' ? 'butun baza' : `firma ${restoreRun.companyName || r.companyId}`} (${r.by.name}).\nYozildi: ${result.totals.written}, o'chirildi: ${result.totals.deleted}, xato: ${result.totals.errors}.\nOldingi holat nusxasi saqlandi.`);
    return { result, preRunId: String(pre.run._id), restoreRunId: String(restoreRun._id) };
  } finally {
    await lock.release();
  }
}

export { allKeys };
