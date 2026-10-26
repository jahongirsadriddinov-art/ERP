// Zaxira arxivi: MongoDB'ning (butun baza yoki bitta firma) to'liq nusxasi.
//   satrlar (NDJSON, EJSON canonical — ObjectId/Date/Long/Binary turlari aynan saqlanadi)
//   → gzip → AES-256-GCM shifrlash (BACKUP_ENCRYPTION_KEY, yo'q bo'lsa AI_SECRETS_KEY, oxirgi chora JWT_SECRET).
// Tashqariga (S3/R2, Telegram) HECH QACHON shifrlanmagan ma'lumot chiqmaydi.
//
// Fayl tuzilishi (.qbk):  "QERPBAK1"(8) | keyId(8, ascii hex) | iv(12) | shifrlangan gzip | GCM tag(16)
// Sarlavha (magic+keyId+iv) AAD sifatida imzoga kiradi — almashtirib bo'lmaydi.
// Satrlar: {"t":"h",...} sarlavha · {"t":"c","c":nom,"idx":[...]} kolleksiya · {"c":nom,"d":hujjat} · {"t":"f",manifest} yakun
import crypto from 'crypto';
import zlib from 'zlib';
import readline from 'readline';
import { Readable } from 'stream';
import { once } from 'events';
import mongoose from 'mongoose';

const { EJSON, ObjectId } = mongoose.mongo.BSON;
type Db = mongoose.mongo.Db;

export const ARCHIVE_MAGIC = Buffer.from('QERPBAK1', 'ascii');
export const ARCHIVE_SCHEMA_VERSION = 1;
const HEADER_LEN = 8 + 8 + 12;
const TAG_LEN = 16;

/** Arxivga KIRMAYDIGAN kolleksiyalar: vaqtinchalik (sessiya, OTP, nonce), takroriy (ichki nusxalar) va zaxira tizimining o'zi. */
export const EXCLUDED_COLLECTIONS = new Set([
  'companysnapshots', 'snapshotchunks', // firma ichidagi nusxalar — asl ma'lumot arxivda bor
  'sessions', 'otps', 'ainonces', 'airatecounters', 'idempotencyrecords', 'qrloginsessions',
  'offsitebackupruns', 'offsitebackuplocks',
]);
/** Kolleksiya ichida qo'shimcha filtr: ilova o'rnatuvchilari (APK/EXE) — qayta yig'iladi, katta. */
const COLLECTION_FILTER: Record<string, Record<string, unknown>> = {
  storedfiles: { name: { $not: /\.(apk|aab|exe|msi|dmg)$/i } },
};

// ── Kalitlar ──────────────────────────────────────────────────────────────────
export interface BackupKey { id: string; key: Buffer; source: string }

function deriveKey(raw: string): Buffer {
  const s = raw.trim();
  let ikm: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(s)) ikm = Buffer.from(s, 'hex');
  else ikm = Buffer.from(s, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.from('qurilish-erp-backup'), Buffer.from('archive-v1'), 32));
}
const keyIdOf = (k: Buffer) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 8);

const KEY_SOURCES = ['BACKUP_ENCRYPTION_KEY', 'AI_SECRETS_KEY', 'JWT_SECRET'] as const;
const KEY_SOURCES_PREV = ['BACKUP_ENCRYPTION_KEY_PREV', 'AI_SECRETS_KEY_PREV'] as const;

function usable(name: string, v: string | undefined): v is string {
  if (!v || !v.trim()) return false;
  if (name === 'JWT_SECRET' && (v === 'secret' || v.trim().length < 16)) return false;
  return true;
}

/** Yangi arxivlar shu kalit bilan shifrlanadi (null — hech qaysi kalit sozlanmagan). */
export function primaryKey(env: NodeJS.ProcessEnv = process.env): BackupKey | null {
  for (const name of KEY_SOURCES) {
    const v = env[name];
    if (usable(name, v)) { const key = deriveKey(v); return { id: keyIdOf(key), key, source: name }; }
  }
  return null;
}

/** O'qish uchun barcha mumkin kalitlar (rotatsiya/joy almashtirilgan bo'lsa ham eski arxivlar ochiladi). */
export function allKeys(env: NodeJS.ProcessEnv = process.env): BackupKey[] {
  const out: BackupKey[] = [];
  for (const name of [...KEY_SOURCES, ...KEY_SOURCES_PREV]) {
    const v = env[name];
    if (!usable(name, v)) continue;
    const key = deriveKey(v);
    const id = keyIdOf(key);
    if (!out.some((k) => k.id === id)) out.push({ id, key, source: name });
  }
  return out;
}

// ── Shifrlash konteyneri ───────────────────────────────────────────────────────
export class ArchiveEncryptor {
  readonly header: Buffer;
  private cipher: crypto.CipherGCM;
  private parts: Buffer[] = [];
  private hash = crypto.createHash('sha256');
  size = 0;
  constructor(key: BackupKey) {
    const iv = crypto.randomBytes(12);
    this.header = Buffer.concat([ARCHIVE_MAGIC, Buffer.from(key.id, 'ascii'), iv]);
    this.cipher = crypto.createCipheriv('aes-256-gcm', key.key, iv);
    this.cipher.setAAD(this.header);
    this.push(this.header);
  }
  private push(b: Buffer) { if (b.length) { this.parts.push(b); this.hash.update(b); this.size += b.length; } }
  update(chunk: Buffer) { this.push(this.cipher.update(chunk)); }
  final(): { file: Buffer; sha256: string } {
    this.push(this.cipher.final());
    this.push(this.cipher.getAuthTag());
    return { file: Buffer.concat(this.parts), sha256: this.hash.digest('hex') };
  }
}

export function encryptBuffer(plain: Buffer, key: BackupKey): Buffer {
  const e = new ArchiveEncryptor(key);
  e.update(plain);
  return e.final().file;
}

export function isArchive(buf: Buffer): boolean {
  return buf.length >= HEADER_LEN + TAG_LEN && buf.subarray(0, 8).equals(ARCHIVE_MAGIC);
}
export function archiveKeyId(buf: Buffer): string | null {
  return isArchive(buf) ? buf.subarray(8, 16).toString('ascii') : null;
}

export class ArchiveKeyError extends Error {}

/** Shifrni ochadi va GCM imzosini tekshiradi (buzilgan/boshqa kalit — xato). */
export function decryptBuffer(file: Buffer, keys: BackupKey[] = allKeys()): Buffer {
  if (!isArchive(file)) throw new ArchiveKeyError("Fayl zaxira arxivi emas (QERPBAK1 sarlavhasi yo'q)");
  const header = file.subarray(0, HEADER_LEN);
  const keyId = header.subarray(8, 16).toString('ascii');
  const k = keys.find((x) => x.id === keyId);
  if (!k) throw new ArchiveKeyError(`Arxiv boshqa kalit bilan shifrlangan (kalit ID: ${keyId}). BACKUP_ENCRYPTION_KEY (yoki *_PREV) ni o'sha paytdagi qiymatga qo'ying.`);
  const iv = header.subarray(16, 28);
  const tag = file.subarray(file.length - TAG_LEN);
  const d = crypto.createDecipheriv('aes-256-gcm', k.key, iv);
  d.setAAD(header);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(file.subarray(HEADER_LEN, file.length - TAG_LEN)), d.final()]);
  } catch {
    throw new ArchiveKeyError("Arxiv buzilgan yoki o'zgartirilgan (shifr imzosi mos kelmadi)");
  }
}

// ── Manifest ──────────────────────────────────────────────────────────────────
export type ArchiveScope = 'full' | 'company';

export interface ArchiveManifest {
  format: 'qurilish-erp-backup';
  schemaVersion: number;
  appVersion: string | null;
  commit: string | null;
  createdAt: string;
  scope: ArchiveScope;
  companyId?: string;
  companyName?: string;
  reason: string;
  collections: Record<string, number>;
  totalDocs: number;
  companies?: { id: string; name: string; docs: number }[];
  contentSha256: string;
  gzipBytes: number;
  keyId: string;
  // Fayl darajasi (shifrlangandan keyin ma'lum bo'ladi — arxiv ichidagi yakun satrida yo'q)
  sizeBytes?: number;
  sha256?: string;
  fileName?: string;
}

let appVersionCache: string | null | undefined;
function appVersion(): string | null {
  if (appVersionCache !== undefined) return appVersionCache;
  try { appVersionCache = String(require('../../../package.json').version || '') || null; } catch { appVersionCache = null; }
  return appVersionCache;
}

const cidVariants = (cid: string): unknown[] => (ObjectId.isValid(cid) && /^[a-f0-9]{24}$/i.test(cid) ? [cid, new ObjectId(cid)] : [cid]);

/** Bitta firma doirasida kolleksiya filtri (companies — o'z _id'si, qolganlari companyId). */
export function companyFilter(collection: string, cid: string): Record<string, unknown> {
  if (collection === 'companies') return { _id: { $in: cidVariants(cid) } };
  return { companyId: { $in: cidVariants(cid) } };
}

export async function listBackupCollections(db: Db): Promise<string[]> {
  const cols = await db.listCollections({ type: 'collection' }, { nameOnly: true }).toArray();
  return cols.map((c: any) => String(c.name)).filter((n) => !n.startsWith('system.') && !EXCLUDED_COLLECTIONS.has(n)).sort();
}

// ── Arxiv yaratish (oqim bilan: xotirada faqat siqilgan+shifrlangan natija turadi) ──
export interface BuildOptions { scope: ArchiveScope; companyId?: string; reason: string; key: BackupKey; now?: Date }

export async function buildArchive(db: Db, opts: BuildOptions): Promise<{ file: Buffer; manifest: ArchiveManifest }> {
  if (opts.scope === 'company' && !opts.companyId) throw new Error('companyId kerak');
  const createdAt = (opts.now || new Date()).toISOString();
  const enc = new ArchiveEncryptor(opts.key);
  const gzip = zlib.createGzip({ level: 6 });
  const contentHash = crypto.createHash('sha256');
  let gzipBytes = 0;
  gzip.on('data', (c: Buffer) => { gzipBytes += c.length; enc.update(c); });
  const ended = once(gzip, 'end');
  const write = async (s: string) => {
    const b = Buffer.from(s + '\n', 'utf8');
    contentHash.update(b);
    if (!gzip.write(b)) await once(gzip, 'drain');
  };

  const collections: Record<string, number> = {};
  const perCompany = new Map<string, number>();
  const companyNames = new Map<string, string>();
  let totalDocs = 0;
  await write(JSON.stringify({ t: 'h', format: 'qurilish-erp-backup', schemaVersion: ARCHIVE_SCHEMA_VERSION, createdAt, scope: opts.scope, companyId: opts.companyId, reason: opts.reason }));

  for (const name of await listBackupCollections(db)) {
    const coll = db.collection(name);
    const idx = await coll.indexes().catch(() => []);
    await write(EJSON.stringify({ t: 'c', c: name, idx }, { relaxed: false }));
    const filter = { ...(COLLECTION_FILTER[name] || {}), ...(opts.scope === 'company' ? companyFilter(name, opts.companyId!) : {}) };
    let n = 0;
    const cursor = coll.find(filter, { batchSize: 500 });
    for await (const doc of cursor) {
      await write(`{"c":${JSON.stringify(name)},"d":${EJSON.stringify(doc, { relaxed: false })}}`);
      n++;
      if (name === 'companies') companyNames.set(String(doc._id), String((doc as any).name || ''));
      const cid = name === 'companies' ? String(doc._id) : (doc as any).companyId != null ? String((doc as any).companyId) : '';
      if (cid) perCompany.set(cid, (perCompany.get(cid) || 0) + 1);
    }
    collections[name] = n;
    totalDocs += n;
  }

  const companies = [...companyNames.entries()].map(([id, name]) => ({ id, name, docs: perCompany.get(id) || 0 })).sort((a, b) => b.docs - a.docs);
  const footer: Omit<ArchiveManifest, 'contentSha256' | 'gzipBytes'> = {
    format: 'qurilish-erp-backup', schemaVersion: ARCHIVE_SCHEMA_VERSION, appVersion: appVersion(),
    commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 12) || null, createdAt, scope: opts.scope,
    ...(opts.companyId ? { companyId: opts.companyId, companyName: companyNames.get(opts.companyId) || undefined } : {}),
    reason: opts.reason, collections, totalDocs, ...(opts.scope === 'full' ? { companies } : {}), keyId: opts.key.id,
  };
  // contentSha256 — yakun satrigacha bo'lgan barcha satrlar xeshi (yakun satri o'zi xeshga kirmaydi)
  const contentSha256 = contentHash.copy().digest('hex');
  await write(JSON.stringify({ t: 'f', ...footer, contentSha256 }));
  gzip.end();
  await ended;
  const { file, sha256 } = enc.final();
  const manifest: ArchiveManifest = { ...footer, contentSha256, gzipBytes, sizeBytes: file.length, sha256 };
  return { file, manifest };
}

// ── Arxivni o'qish ──────────────────────────────────────────────────────────────
export type ArchiveRecord =
  | { t: 'h'; header: any }
  | { t: 'c'; name: string; indexes: any[] }
  | { t: 'd'; name: string; doc: any }
  | { t: 'f'; manifest: ArchiveManifest; contentOk: boolean };

/** Shifrdan ochilgan (gzip) arxivni satrma-satr o'qiydi. */
export async function* readArchive(gz: Buffer): AsyncGenerator<ArchiveRecord> {
  const gunzip = zlib.createGunzip();
  const src = Readable.from([gz]).pipe(gunzip);
  const rl = readline.createInterface({ input: src, crlfDelay: Infinity });
  const hash = crypto.createHash('sha256');
  for await (const line of rl) {
    if (!line) continue;
    if (line.startsWith('{"c":')) {
      hash.update(line + '\n', 'utf8');
      const rec = EJSON.parse(line, { relaxed: false }) as any;
      yield { t: 'd', name: rec.c, doc: rec.d };
      continue;
    }
    const head = JSON.parse(line);
    if (head.t === 'f') {
      const { t: _t, ...manifest } = head;
      yield { t: 'f', manifest, contentOk: hash.digest('hex') === manifest.contentSha256 };
      continue;
    }
    hash.update(line + '\n', 'utf8');
    if (head.t === 'h') yield { t: 'h', header: head };
    else if (head.t === 'c') {
      const parsed = EJSON.parse(line, { relaxed: false }) as any;
      yield { t: 'c', name: parsed.c, indexes: Array.isArray(parsed.idx) ? parsed.idx : [] };
    }
  }
}

/** Faqat yakun satridagi manifest (yuklangan fayllar uchun — tashqi manifest bo'lmasa). */
export async function readManifest(gz: Buffer): Promise<ArchiveManifest | null> {
  let m: ArchiveManifest | null = null;
  for await (const r of readArchive(gz)) if (r.t === 'f') m = r.manifest;
  return m;
}
