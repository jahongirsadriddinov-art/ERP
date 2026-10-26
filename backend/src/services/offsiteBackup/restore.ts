// Arxivdan tiklash dvigateli. Idempotent: har hujjat _id bo'yicha replaceOne+upsert (bir necha marta
// ishlatilsa ham natija bir xil, id'lar o'zgarmaydi). Bitta firma tiklanganda FAQAT o'sha firmaning
// hujjatlariga tegiladi: filtrda companyId ham bor — boshqa firmaga tegishli bir xil _id'li hujjat hech
// qachon ustidan yozilmaydi (upsert insert'ga aylanib, dublikat xato bilan o'tkazib yuboriladi).
import mongoose from 'mongoose';
import { readArchive, companyFilter, ArchiveManifest, EXCLUDED_COLLECTIONS } from './archive';

const { EJSON } = mongoose.mongo.BSON;
type Db = mongoose.mongo.Db;

export type RestoreMode = 'upsert' | 'exact';
export interface RestoreOptions { scope: 'full' | 'company'; companyId?: string; mode: RestoreMode; dryRun: boolean; batchSize?: number }

export interface CollectionDiff {
  archive: number;     // arxivdagi hujjatlar (doiraga mos)
  current: number;     // hozir bazadagi (doiraga mos)
  add: number;         // arxivda bor, bazada yo'q — qo'shiladi
  update: number;      // ikkalasida bor — arxivdagi holatga qaytariladi
  remove: number;      // bazada bor, arxivda yo'q — faqat "exact" rejimda o'chiriladi
  written?: number;
  deleted?: number;
  errors?: number;
  errorSamples?: string[];
}
export interface RestoreResult { dryRun: boolean; scope: string; companyId?: string; mode: RestoreMode; collections: Record<string, CollectionDiff>; totals: { archive: number; current: number; add: number; update: number; remove: number; written: number; deleted: number; errors: number }; manifest: ArchiveManifest | null; contentOk: boolean | null; indexesCreated: number }

const idKey = (id: unknown) => EJSON.stringify({ i: id as any }, { relaxed: false });

function belongs(name: string, doc: any, cid: string): boolean {
  if (name === 'companies') return String(doc?._id) === cid;
  return doc?.companyId != null && String(doc.companyId) === cid;
}

async function currentIds(db: Db, name: string, filter: Record<string, unknown>): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  for await (const d of db.collection(name).find(filter, { projection: { _id: 1 }, batchSize: 5000 })) out.set(idKey(d._id), d._id);
  return out;
}

export async function restoreFromArchive(db: Db, gz: Buffer, opts: RestoreOptions): Promise<RestoreResult> {
  if (opts.scope === 'company' && !opts.companyId) throw new Error('companyId kerak');
  const cid = opts.companyId ? String(opts.companyId) : '';
  const batchSize = opts.batchSize ?? 500;
  const scopeFilter = (name: string) => (opts.scope === 'company' ? companyFilter(name, cid) : {});

  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c: any) => String(c.name)));
  const cols: Record<string, CollectionDiff> = {};
  const indexSpecs: Record<string, any[]> = {};
  const dbIds: Record<string, Map<string, unknown>> = {};
  const seen: Record<string, Set<string>> = {};
  let manifest: ArchiveManifest | null = null;
  let contentOk: boolean | null = null;
  let pending: { name: string; ops: any[] } | null = null;

  const flush = async () => {
    if (!pending || !pending.ops.length) { pending = null; return; }
    const { name, ops } = pending;
    pending = null;
    const c = cols[name];
    try {
      const r = await db.collection(name).bulkWrite(ops, { ordered: false });
      c.written = (c.written || 0) + (r.upsertedCount || 0) + (r.modifiedCount || 0) + ((r.matchedCount || 0) - (r.modifiedCount || 0));
    } catch (e: any) {
      const writeErrors: any[] = e?.writeErrors ? (Array.isArray(e.writeErrors) ? e.writeErrors : [e.writeErrors]) : [];
      const failed = writeErrors.length || ops.length;
      const res = e?.result;
      const ok = res ? (res.upsertedCount || 0) + (res.matchedCount || 0) : Math.max(0, ops.length - failed);
      c.written = (c.written || 0) + ok;
      c.errors = (c.errors || 0) + failed;
      c.errorSamples = c.errorSamples || [];
      for (const w of writeErrors.slice(0, 3 - c.errorSamples.length)) c.errorSamples.push(String(w?.errmsg || w?.err?.errmsg || w?.message || 'xato').slice(0, 200));
      if (!writeErrors.length && c.errorSamples.length < 3) c.errorSamples.push(String(e?.message || e).slice(0, 200));
    }
  };

  for await (const rec of readArchive(gz)) {
    if (rec.t === 'c') {
      if (EXCLUDED_COLLECTIONS.has(rec.name) || rec.name.startsWith('system.')) continue;
      cols[rec.name] = { archive: 0, current: 0, add: 0, update: 0, remove: 0 };
      indexSpecs[rec.name] = rec.indexes;
      dbIds[rec.name] = existing.has(rec.name) ? await currentIds(db, rec.name, scopeFilter(rec.name)) : new Map();
      seen[rec.name] = new Set();
      cols[rec.name].current = dbIds[rec.name].size;
      continue;
    }
    if (rec.t === 'f') { manifest = rec.manifest; contentOk = rec.contentOk; continue; }
    if (rec.t !== 'd') continue;
    const c = cols[rec.name];
    if (!c) continue;
    const doc = rec.doc;
    if (doc?._id === undefined) continue;
    if (opts.scope === 'company' && !belongs(rec.name, doc, cid)) continue;
    const k = idKey(doc._id);
    if (seen[rec.name].has(k)) continue;
    seen[rec.name].add(k);
    c.archive++;
    if (dbIds[rec.name].has(k)) c.update++; else c.add++;
    if (opts.dryRun) continue;
    // Firma doirasi: filtrda companyId ham bor — boshqa firmaning hujjati ustidan yozilmaydi
    const filter = opts.scope === 'company' && rec.name !== 'companies' ? { _id: doc._id, companyId: doc.companyId } : { _id: doc._id };
    if (pending && pending.name !== rec.name) await flush();
    if (!pending) pending = { name: rec.name, ops: [] };
    pending.ops.push({ replaceOne: { filter, replacement: doc, upsert: true } });
    if (pending.ops.length >= batchSize) await flush();
  }
  await flush();

  // Arxivda yo'q (keyin qo'shilgan) hujjatlar — hisoblanadi; "exact" rejimda o'chiriladi
  for (const [name, c] of Object.entries(cols)) {
    const extra = [...dbIds[name].entries()].filter(([k]) => !seen[name].has(k)).map(([, id]) => id);
    c.remove = extra.length;
    if (!opts.dryRun && opts.mode === 'exact' && extra.length) {
      let deleted = 0;
      for (let i = 0; i < extra.length; i += 1000) {
        const r = await db.collection(name).deleteMany({ ...scopeFilter(name), _id: { $in: extra.slice(i, i + 1000) as any[] } } as any);
        deleted += r.deletedCount || 0;
      }
      c.deleted = deleted;
    }
  }

  // Indekslar: faqat yo'q bo'lganlari yaratiladi (mavjudlariga tegilmaydi, xato — o'tkazib yuboriladi)
  let indexesCreated = 0;
  if (!opts.dryRun) {
    for (const [name, specs] of Object.entries(indexSpecs)) {
      if (!specs?.length) continue;
      const have = new Set((await db.collection(name).indexes().catch(() => [])).map((i: any) => i.name));
      for (const s of specs) {
        if (!s?.key || !s.name || s.name === '_id_' || have.has(s.name)) continue;
        const { v: _v, ns: _ns, key, ...rest } = s;
        try { await db.collection(name).createIndex(key, rest); indexesCreated++; } catch { /* mos kelmaydigan indeks — o'tkazib yuboriladi */ }
      }
    }
  }

  const totals = { archive: 0, current: 0, add: 0, update: 0, remove: 0, written: 0, deleted: 0, errors: 0 };
  for (const c of Object.values(cols)) {
    totals.archive += c.archive; totals.current += c.current; totals.add += c.add; totals.update += c.update; totals.remove += c.remove;
    totals.written += c.written || 0; totals.deleted += c.deleted || 0; totals.errors += c.errors || 0;
  }
  // Firma doirasida bo'sh kolleksiyalarni javobdan chiqaramiz (ro'yxat qisqa bo'lsin)
  if (opts.scope === 'company') for (const [n, c] of Object.entries(cols)) if (!c.archive && !c.current) delete cols[n];
  return { dryRun: opts.dryRun, scope: opts.scope, companyId: cid || undefined, mode: opts.mode, collections: cols, totals, manifest, contentOk, indexesCreated };
}
