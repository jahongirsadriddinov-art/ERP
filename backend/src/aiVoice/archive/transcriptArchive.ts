import crypto from 'crypto';
import type { Response } from 'express';
import zlib from 'zlib';
import { promisify } from 'util';
import AiCallEvent from '../../models/AiCallEvent';
import AiConversation from '../../models/AiConversation';
import AiTranscriptArchive from '../../models/AiTranscriptArchive';
import { addDays, isIsoDate, localDate } from '../lib/zonedTime';
import { getSettings, TRANSCRIPT_DB_DAYS } from '../settings';
import { archiveStorage, ARCHIVE_PREFIX } from './storage';

// Transkript arxivi (owner 2026-10-15, #3). Har kuni (AiJob 'transcripts.archive'):
//  1) 7 kundan eski AiConversation (barcha manbalar: chat, ovoz, Telegram, bot) va AiCallEvent (qo'ng'iroq
//     transkriptlari/voqealari) firma × Toshkent kuni bo'yicha guruhlanadi;
//  2) har guruh gzip JSONL faylga yoziladi (mavjud doimiy ombor), fayl qaytadan o'qib tekshiriladi;
//  3) AiTranscriptArchive yozuvi ('stored', o'chiriladigan id'lar bilan) yaratiladi;
//  4) FAQAT shundan keyin bazadagi qatorlar o'chiriladi va yozuv 'done' bo'ladi.
// Idempotent va davom ettiriladigan: qulash 2-3 orasida bo'lsa — fayl keyingi safar ustidan yoziladi (hech narsa
// o'chirilmagan); 3-4 orasida bo'lsa — 'stored' yozuvdagi id'lar bo'yicha o'chirish yakunlanadi.
// Eski arxiv fayllari firma auditRetentionDays (firmasiz — 365 kun) o'tgach o'chiriladi.

const gzip = promisify(zlib.gzip);
/** Bir qismdagi JSONL hajmi (gzip'dan oldin) — StoredFile 15 MB chegarasidan ancha past. */
export const PART_RAW_MAX = 8 * 1024 * 1024;
const FORMAT = 'qurilish-erp.ai-transcripts';
const PLATFORM_KEY = 'platform';
const DEFAULT_ARCHIVE_KEEP_DAYS = 365;

/** Toshkent kunining boshlanishi (UTC+5, DST yo'q — C7). */
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:00`);
const companyKey = (c: string | null) => c || PLATFORM_KEY;
const companyFilter = (c: string | null) => (c ? { companyId: c } : { companyId: { $in: [null, ''] } });

export interface ArchiveRunStats {
  units: number; parts: number; conversations: number; events: number; resumed: number; purged: number; errors: number; more: boolean;
}

interface Unit { companyId: string | null; day: string }

/** Arxivlanadigan (firma, kun) juftliklari — eng eski kundan. */
async function findUnits(cutoff: Date, limit: number): Promise<Unit[]> {
  const group = (field: string) => [
    { $match: { [field]: { $lt: cutoff } } },
    { $group: { _id: { c: '$companyId', d: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: '+05:00' } } } } },
    { $sort: { '_id.d': 1 } },
    { $limit: limit },
  ];
  const [a, b]: any[][] = await Promise.all([
    AiConversation.aggregate(group('updatedAt') as any[]),
    AiCallEvent.aggregate(group('at') as any[]),
  ]);
  const map = new Map<string, Unit>();
  for (const r of [...a, ...b]) {
    const companyId = r._id.c ? String(r._id.c) : null;
    map.set(`${companyKey(companyId)}|${r._id.d}`, { companyId, day: r._id.d });
  }
  return [...map.values()].sort((x, y) => x.day.localeCompare(y.day)).slice(0, limit);
}

/** 'stored' (qatorlari hali o'chirilmagan) qismlarni yakunlaydi. */
async function finishStored(filter: Record<string, unknown>, cutoff: Date): Promise<number> {
  const rows: any[] = await AiTranscriptArchive.find({ ...filter, status: 'stored' }).select('+convIds +eventIds').lean();
  for (const r of rows) {
    // Arxivdan keyin yangilangan suhbat (updatedAt yangi) o'chirilmaydi — keyinroq yana arxivlanadi
    if (r.convIds?.length) await AiConversation.deleteMany({ _id: { $in: r.convIds }, updatedAt: { $lt: cutoff } });
    if (r.eventIds?.length) await AiCallEvent.deleteMany({ _id: { $in: r.eventIds } });
    await AiTranscriptArchive.updateOne({ _id: r._id, status: 'stored' }, { $set: { status: 'done', deletedAt: new Date() }, $unset: { convIds: 1, eventIds: 1 } });
  }
  return rows.length;
}

const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : undefined);

function conversationLine(c: any): string {
  return JSON.stringify({
    type: 'conversation', id: String(c._id), userId: c.userId, companyId: c.companyId || null, source: c.source || 'chat',
    title: c.title || '', sessionId: c.sessionId, correlationId: c.correlationId, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt),
    messages: (c.messages || []).map((m: any) => ({ role: m.role, content: m.content })),
  });
}

function eventLine(e: any): string {
  return JSON.stringify({
    type: 'call_event', id: String(e._id), sessionId: e.sessionId, correlationId: e.correlationId, seq: e.seq,
    event: e.type, at: iso(e.at), data: e.data,
  });
}

interface Chunk { lines: string[]; convIds: string[]; eventIds: string[]; bytes: number }

/** Bitta (firma, kun) guruhini arxivlaydi. */
async function archiveUnit(u: Unit, cutoff: Date, stats: ArchiveRunStats): Promise<void> {
  const base = { companyId: u.companyId, period: u.day };
  stats.resumed += await finishStored(base, cutoff);

  const from = dayStart(u.day);
  const to = new Date(Math.min(dayStart(addDays(u.day, 1)).getTime(), cutoff.getTime()));
  const convs: any[] = await AiConversation.find({ ...companyFilter(u.companyId), updatedAt: { $gte: from, $lt: to } })
    .sort({ updatedAt: 1, _id: 1 }).lean();
  const events: any[] = u.companyId
    ? await AiCallEvent.find({ companyId: u.companyId, at: { $gte: from, $lt: to } }).sort({ sessionId: 1, seq: 1 }).lean()
    : [];
  if (!convs.length && !events.length) return;

  const chunks: Chunk[] = [];
  let cur: Chunk = { lines: [], convIds: [], eventIds: [], bytes: 0 };
  const push = (line: string, kind: 'c' | 'e', id: string) => {
    const n = Buffer.byteLength(line) + 1;
    if (cur.lines.length && cur.bytes + n > PART_RAW_MAX) { chunks.push(cur); cur = { lines: [], convIds: [], eventIds: [], bytes: 0 }; }
    cur.lines.push(line); cur.bytes += n;
    (kind === 'c' ? cur.convIds : cur.eventIds).push(id);
  };
  for (const c of convs) push(conversationLine(c), 'c', String(c._id));
  for (const e of events) push(eventLine(e), 'e', String(e._id));
  if (cur.lines.length) chunks.push(cur);

  const last: any = await AiTranscriptArchive.findOne(base).sort({ part: -1 }).select('part').lean();
  let part = Number(last?.part || 0);
  const storage = archiveStorage();
  for (const ch of chunks) {
    part++;
    const header = JSON.stringify({ type: 'header', format: FORMAT, version: 1, companyId: u.companyId, period: u.day, part, createdAt: new Date().toISOString() });
    const raw = Buffer.from(`${header}\n${ch.lines.join('\n')}\n`, 'utf8');
    const gz = await gzip(raw);
    const name = `${ARCHIVE_PREFIX}${companyKey(u.companyId)}:${u.day}:${part}.jsonl.gz`;
    // Saqlash muvaffaqiyatsiz bo'lsa — xato yuqoriga chiqadi, qatorlar O'CHIRILMAYDI
    const put = await storage.put(name, gz);
    await AiTranscriptArchive.create({
      ...base, part, status: 'stored', storageRef: put.ref,
      fileName: `ai-transcripts-${companyKey(u.companyId)}-${u.day}-p${part}.jsonl.gz`,
      size: put.size, rawSize: raw.length, sha256: crypto.createHash('sha256').update(gz).digest('hex'),
      counts: { conversations: ch.convIds.length, events: ch.eventIds.length },
      convIds: ch.convIds, eventIds: ch.eventIds,
    });
    stats.parts++;
    stats.conversations += ch.convIds.length;
    stats.events += ch.eventIds.length;
  }
  await finishStored(base, cutoff);
}

/** Muddati o'tgan arxiv fayllarini o'chiradi (firma auditRetentionDays; firmasiz — 365 kun). */
async function purgeOld(now: Date, limit = 200): Promise<number> {
  const today = localDate(now);
  const oldest = addDays(today, -30);   // auditRetentionDays ≥ 30
  const rows: any[] = await AiTranscriptArchive.find({ status: 'done', period: { $lt: oldest } }).select('companyId period storageRef')
    .sort({ period: 1 }).limit(limit).lean();
  const keep = new Map<string, number>();
  let purged = 0;
  for (const r of rows) {
    const k = companyKey(r.companyId);
    if (!keep.has(k)) {
      keep.set(k, r.companyId ? (await getSettings(String(r.companyId)).catch(() => null))?.privacy.auditRetentionDays ?? DEFAULT_ARCHIVE_KEEP_DAYS : DEFAULT_ARCHIVE_KEEP_DAYS);
    }
    if (r.period >= addDays(today, -(keep.get(k) as number))) continue;
    await archiveStorage().remove(r.storageRef);
    await AiTranscriptArchive.deleteOne({ _id: r._id });
    purged++;
  }
  return purged;
}

/**
 * Arxiv ishi. timeBudgetMs tugasa — more:true (handler davom ettiruvchi ish qo'yadi).
 * Bitta guruhdagi xato boshqalarini to'xtatmaydi (keyingi ishga tushishda qayta uriniladi).
 */
export async function runTranscriptArchive(now: Date = new Date(), opts: { timeBudgetMs?: number; maxUnits?: number } = {}): Promise<ArchiveRunStats> {
  const stats: ArchiveRunStats = { units: 0, parts: 0, conversations: 0, events: 0, resumed: 0, purged: 0, errors: 0, more: false };
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 60_000;
  const maxUnits = opts.maxUnits ?? 500;
  // Kesish: 7 to'liq kundan eski (bugungi Toshkent kunidan 7 kun oldingi kun boshi)
  const cutoff = dayStart(addDays(localDate(now), -TRANSCRIPT_DB_DAYS));

  // Avval yarim qolgan ('stored') qismlar — boshqa kunlarnikini ham
  try { stats.resumed += await finishStored({}, cutoff); } catch (e) { stats.errors++; console.error('[aiVoice/archive] davom ettirish xatosi:', (e as Error).message); }

  const units = await findUnits(cutoff, maxUnits + 1);
  for (const u of units.slice(0, maxUnits)) {
    if (Date.now() - started > budget) { stats.more = true; break; }
    try {
      await archiveUnit(u, cutoff, stats);
      stats.units++;
    } catch (e) {
      stats.errors++;
      console.error(`[aiVoice/archive] ${companyKey(u.companyId)} ${u.day} xatosi:`, (e as Error).message);
    }
  }
  if (units.length > maxUnits) stats.more = true;
  try { stats.purged = await purgeOld(now); } catch (e) { console.error('[aiVoice/archive] tozalash xatosi:', (e as Error).message); }
  return stats;
}

// ───────────── Ro'yxat va yuklab olish (routes) ─────────────

export interface ArchiveListItem {
  id: string; companyId: string | null; period: string; part: number; status: 'stored' | 'done';
  fileName: string; size: number; rawSize: number; counts: { conversations: number; events: number }; createdAt?: string;
}

/** scope: firma id'si — faqat shu firma; 'all' — hammasi (dasturchi), ixtiyoriy companyId filtri bilan. */
export async function listArchives(
  scope: { companyId: string } | { all: true; companyId?: string | null },
  q: { page?: number; limit?: number; from?: string; to?: string } = {},
): Promise<{ page: number; limit: number; total: number; items: ArchiveListItem[] }> {
  const page = Math.max(1, Math.min(1000, Math.floor(q.page || 1)));
  const limit = Math.max(1, Math.min(100, Math.floor(q.limit || 30)));
  const filter: Record<string, any> = {};
  if ('all' in scope) {
    if (scope.companyId !== undefined) filter.companyId = scope.companyId;
  } else {
    filter.companyId = scope.companyId;
  }
  if (isIsoDate(q.from) || isIsoDate(q.to)) {
    filter.period = {};
    if (isIsoDate(q.from)) filter.period.$gte = q.from;
    if (isIsoDate(q.to)) filter.period.$lte = q.to;
  }
  const [total, rows] = await Promise.all([
    AiTranscriptArchive.countDocuments(filter),
    AiTranscriptArchive.find(filter).sort({ period: -1, part: 1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return {
    page, limit, total,
    items: rows.map((r: any) => ({
      id: String(r._id), companyId: r.companyId ?? null, period: r.period, part: r.part, status: r.status,
      fileName: r.fileName, size: r.size, rawSize: r.rawSize, counts: { conversations: r.counts?.conversations || 0, events: r.counts?.events || 0 },
      createdAt: iso(r.createdAt),
    })),
  };
}

/** Arxiv faylini o'qiydi. companyId berilsa — faqat shu firmaniki (boshqa firma → null, 404). */
export async function readArchiveFile(id: string, scope: { companyId: string } | { all: true }): Promise<{ fileName: string; data: Buffer; companyId: string | null; period: string } | null> {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return null;
  const filter: Record<string, unknown> = { _id: id };
  if (!('all' in scope)) filter.companyId = scope.companyId;
  const r: any = await AiTranscriptArchive.findOne(filter).lean();
  if (!r) return null;
  const data = await archiveStorage().get(r.storageRef);
  if (!data) return null;
  return { fileName: r.fileName, data, companyId: r.companyId ?? null, period: r.period };
}

/** gzip faylni biriktirma sifatida yuboradi (admin va platforma yo'llari). */
export function sendArchive(res: Response, fileName: string, data: Buffer): void {
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Content-Length', String(data.length));
  res.end(data);
}
