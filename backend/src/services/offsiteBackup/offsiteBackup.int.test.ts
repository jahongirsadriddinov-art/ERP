// Integratsion sinov (haqiqiy MongoDB xotirada, S3 va Telegram — soxta fetch):
// butun baza zaxirasi → baza o'chiriladi → tiklash: hamma hujjat AYNAN qaytadi (ObjectId/Date/Long/Binary turlari bilan);
// bitta firma tiklash faqat o'sha firmaga tegadi; dry-run hech narsa yozmaydi; tasdiqlash kodi majburiy; saqlash siyosati.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  runBackup, stageBackup, previewRestore, executeRestore, listArchives, backupStatus, registerUpload, loadArchiveFile,
  __setBackupDeps, __resetBackupDeps, BackupRun, schedulerTick, checkStale, pruneS3, acquireLock, backupBeforeRiskyOp,
} from './index';

const { EJSON, ObjectId, Long, Binary } = mongoose.mongo.BSON;

let mongo: MongoMemoryServer;
const A = new ObjectId();
const B = new ObjectId();
const bucket = new Map<string, Buffer>();
const tgFiles = new Map<string, Buffer>();
const notes: string[] = [];
let tgFail = false;
let clock = new Date('2026-10-26T23:00:00Z');

async function fakeFetch(input: any, init: any = {}): Promise<Response> {
  const url = new URL(String(input));
  if (url.host === 'api.telegram.org') {
    if (url.pathname.endsWith('/sendDocument')) {
      if (tgFail) return new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked' }), { status: 403 });
      const form = init.body as FormData;
      const doc = form.get('document') as Blob;
      const id = `f${tgFiles.size + 1}`;
      tgFiles.set(id, Buffer.from(await doc.arrayBuffer()));
      return new Response(JSON.stringify({ ok: true, result: { message_id: tgFiles.size, document: { file_id: id } } }));
    }
    if (url.pathname.endsWith('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: `docs/${url.searchParams.get('file_id')}` } }));
    if (url.pathname.startsWith('/file/')) return new Response(new Uint8Array(tgFiles.get(url.pathname.split('/').pop()!)!));
    return new Response(JSON.stringify({ ok: true }));
  }
  // S3 (path-style): /bucket/key
  expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  const key = decodeURIComponent(url.pathname.replace(/^\/erp-zaxira\/?/, ''));
  if (init.method === 'PUT') { bucket.set(key, Buffer.from(init.body)); return new Response('', { status: 200 }); }
  if (init.method === 'DELETE') { bucket.delete(key); return new Response(null, { status: 204 }); }
  if (url.searchParams.get('list-type') === '2') {
    const prefix = url.searchParams.get('prefix') || '';
    const items = [...bucket.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-10-26T00:00:00Z</LastModified></Contents>`).join('');
    return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${items}</ListBucketResult>`);
  }
  const v = bucket.get(key);
  return v ? new Response(new Uint8Array(v)) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
}

const ENV = {
  BACKUP_ENCRYPTION_KEY: 'test-backup-kalit-0123456789abcdef', TELEGRAM_BOT_TOKEN: '123456:TEST', DEVELOPER_CHAT_ID: '777',
  BACKUP_S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', BACKUP_S3_BUCKET: 'erp-zaxira', BACKUP_S3_ACCESS_KEY_ID: 'AK', BACKUP_S3_SECRET_ACCESS_KEY: 'SK', BACKUP_S3_REGION: 'auto',
};
const by = { userId: 'dev1', name: 'Dasturchi', role: 'dasturchi' };
const db = () => mongoose.connection.db!;

async function seed() {
  await db().collection('companies').insertMany([{ _id: A, name: 'Alfa Qurilish', createdAt: new Date('2026-01-01') }, { _id: B, name: 'Beta Stroy' }]);
  await db().collection('users').insertMany([
    { _id: new ObjectId(), firstName: 'Ali', phone: '+998901', role: 'direktor', companyId: String(A), passwordHash: 'h1', isOwner: true },
    { _id: new ObjectId(), firstName: 'Vali', phone: '+998902', role: 'ishchi', companyId: String(A) },
    { _id: new ObjectId(), firstName: 'Bek', phone: '+998903', role: 'direktor', companyId: String(B) },
    { _id: new ObjectId(), firstName: 'Dev', phone: '+998909', role: 'dasturchi' },
  ]);
  await db().collection('transactions').insertMany([
    { companyId: String(A), amount: Long.fromString('9007199254740993'), date: new Date('2026-10-01T05:00:00Z'), note: 'Sement', tags: ['a', 'b'], nested: { x: 1.5, y: null } },
    { companyId: String(A), amount: 150000, date: new Date('2026-10-02') },
    { companyId: String(B), amount: 70000, date: new Date('2026-10-03') },
  ]);
  await db().collection('storedfiles').insertMany([
    { name: 'photo.jpg', data: new Binary(Buffer.from([1, 2, 3, 250])) },
    { name: 'app-latest.apk', data: new Binary(Buffer.alloc(10)) }, // o'rnatuvchi — arxivga kirmaydi
  ]);
  await db().collection('sessions').insertOne({ userId: 'x', jti: 'y' }); // vaqtinchalik — arxivga kirmaydi
  await db().collection('transactions').createIndex({ companyId: 1, date: -1 }, { name: 'cid_date' });
}

const SKIP = new Set(['offsitebackupruns', 'offsitebackuplocks', 'sessions', 'storedfiles', 'companysnapshots', 'snapshotchunks', 'auditlogs']);
async function dump(filter?: (name: string, d: any) => boolean): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const c of await db().listCollections().toArray()) {
    if (SKIP.has(c.name)) continue;
    const docs = await db().collection(c.name).find({}).sort({ _id: 1 }).toArray();
    const list = docs.filter((d) => !filter || filter(c.name, d)).map((d) => EJSON.stringify(d, { relaxed: false }));
    if (list.length) out[c.name] = list;
  }
  return out;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  Object.assign(process.env, ENV);
  __setBackupDeps({ fetch: fakeFetch as any, now: () => clock, notify: async (t) => { notes.push(t); } });
  await seed();
}, 120_000);

afterAll(async () => {
  __resetBackupDeps();
  for (const k of Object.keys(ENV)) delete (process.env as any)[k];
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(() => { tgFail = false; });

describe('butun baza: zaxira → o\'chirish → tiklash', () => {
  it('ikkala manzilga shifrlangan arxiv ketadi, baza butunlay tiklanadi (turlar bilan)', async () => {
    const before = await dump();
    const { run } = await runBackup({ scope: 'full', reason: 'manual', by });
    expect(run?.status).toBe('ok');
    expect(run!.targets.map((t) => t.target).sort()).toEqual(['s3', 'telegram']);
    expect(run!.collections!.transactions).toBe(3);
    expect(run!.collections!.storedfiles).toBe(1);   // APK chiqarib tashlangan
    expect(run!.collections!.sessions).toBeUndefined();
    expect(run!.companies!.map((c) => c.name).sort()).toEqual(['Alfa Qurilish', 'Beta Stroy']);
    // tashqarida ochiq matn yo'q
    const archive = [...bucket.entries()].find(([k]) => k.endsWith('.qbk'))!;
    expect(archive[1].includes(Buffer.from('Sement'))).toBe(false);
    expect(bucket.has(archive[0].replace(/\.qbk$/, '.manifest'))).toBe(true);
    expect([...tgFiles.values()][0].equals(archive[1])).toBe(true);

    // OFAT: hamma narsa o'chdi
    for (const c of await db().listCollections().toArray()) if (!c.name.startsWith('offsitebackup')) await db().collection(c.name).drop();
    expect(await db().collection('transactions').countDocuments()).toBe(0);

    const src = { type: 's3' as const, key: archive[0] };
    const prev = await previewRestore({ source: src, scope: 'full', mode: 'upsert' });
    expect(prev.dryRun).toBe(true);
    expect(prev.totals.add).toBe(prev.totals.archive);
    expect(prev.contentOk).toBe(true);
    expect(await db().collection('users').countDocuments()).toBe(0); // dry-run hech narsa yozmadi

    await expect(executeRestore({ source: src, scope: 'full', mode: 'upsert', confirmText: 'TIKLASH-000000', by })).rejects.toThrow(/kodi noto'g'ri/);
    const r = await executeRestore({ source: src, scope: 'full', mode: 'upsert', confirmText: prev.confirmCode, by });
    expect(r.result.totals.errors).toBe(0);
    expect(await BackupRun.findById(r.preRunId).lean()).toMatchObject({ reason: 'pre_restore', status: 'ok' });
    expect(await dump()).toEqual(before);
    const idx = await db().collection('transactions').indexes();
    expect(idx.some((i) => i.name === 'cid_date')).toBe(true);
    expect(notes.some((n) => n.includes('Tiklash bajarildi'))).toBe(true);

    // idempotent: yana bir marta — natija o'zgarmaydi
    const again = await executeRestore({ source: src, scope: 'full', mode: 'upsert', confirmText: prev.confirmCode, by });
    expect(again.result.totals.add).toBe(0);
    expect(await dump()).toEqual(before);
  }, 60_000);
});

describe('bitta firma tiklash', () => {
  it("faqat o'sha firma hujjatlariga tegadi, id'lar o'zgarmaydi; exact rejim keyin qo'shilganini o'chiradi", async () => {
    const isA = (n: string, d: any) => (n === 'companies' ? String(d._id) === String(A) : d.companyId === String(A));
    const beforeA = await dump(isA);
    const { run } = await runBackup({ scope: 'full', reason: 'manual', by });
    const tgSrc = { type: 'telegram' as const, runId: String(run!._id) };

    // A firmada "falokat": tranzaksiyalar o'chirildi, xodim o'zgartirildi, yangi yozuv qo'shildi; B ham o'zgaradi
    await db().collection('transactions').deleteMany({ companyId: String(A) });
    await db().collection('users').updateOne({ firstName: 'Vali' }, { $set: { role: 'prorab' } });
    await db().collection('transactions').insertOne({ companyId: String(A), amount: 1, note: 'keyin qo\'shilgan' });
    await db().collection('transactions').insertOne({ companyId: String(B), amount: 2, note: 'B yangi' });
    const beforeB = await dump((n, d) => !isA(n, d));

    const prev = await previewRestore({ source: tgSrc, scope: 'company', companyId: String(A), mode: 'exact' });
    expect(prev.collections.transactions).toMatchObject({ archive: 2, current: 1, add: 2, remove: 1 });
    expect(prev.collections.users).toMatchObject({ archive: 2, update: 2 });
    const r = await executeRestore({ source: tgSrc, scope: 'company', companyId: String(A), mode: 'exact', confirmText: prev.confirmCode, by });
    expect(r.result.totals.deleted).toBe(1);
    expect(await dump(isA)).toEqual(beforeA);
    expect(await dump((n, d) => !isA(n, d))).toEqual(beforeB); // B firma va dasturchi tegilmagan
    const pre: any = await BackupRun.findById(r.preRunId).lean();
    expect(pre).toMatchObject({ scope: 'company', companyId: String(A), reason: 'pre_restore' });
  }, 60_000);

  it("boshqa firmaga tegishli _id ustidan yozilmaydi (xato sifatida o'tkaziladi)", async () => {
    const { run } = await runBackup({ scope: 'company', companyId: String(A), reason: 'manual', by });
    const tx: any = await db().collection('transactions').findOne({ companyId: String(A) });
    // hujjat "B firmaga ko'chgan" holat — A tiklanishi uni A'ga qaytarib olmasligi kerak
    await db().collection('transactions').updateOne({ _id: tx._id }, { $set: { companyId: String(B) } });
    const src = { type: 's3' as const, key: run!.key! };
    const prev = await previewRestore({ source: src, scope: 'company', companyId: String(A), mode: 'upsert' });
    const r = await executeRestore({ source: src, scope: 'company', companyId: String(A), mode: 'upsert', confirmText: prev.confirmCode, by });
    expect(r.result.totals.errors).toBe(1);
    expect((await db().collection('transactions').findOne({ _id: tx._id }))!.companyId).toBe(String(B));
    await db().collection('transactions').updateOne({ _id: tx._id }, { $set: { companyId: String(A) } });
    await expect(previewRestore({ source: src, scope: 'full', mode: 'upsert' })).rejects.toThrow(/bitta firmaniki/);
  }, 60_000);

  it('qo\'lda yuklangan fayl (Telegram bo\'laklari) orqali', async () => {
    const { run } = await runBackup({ scope: 'full', reason: 'manual', by });
    const file = await loadArchiveFile({ type: 'telegram', runId: String(run!._id) });
    const up = await registerUpload(file, 'x.qbk');
    expect(up.manifest?.totalDocs).toBe(run!.totalDocs);
    const prev = await previewRestore({ source: { type: 'upload', token: up.token }, scope: 'full', mode: 'upsert' });
    expect(prev.totals.add).toBe(0);
    await expect(registerUpload(Buffer.from('hello world, not an archive at all'), 'y')).rejects.toThrow(/arxivi emas/);
  }, 60_000);
});

describe('jadval, qulf, ogohlantirish, saqlash', () => {
  it('kunlik: bir kunda bir marta; ikkinchi instansiya qulfni ololmaydi', async () => {
    clock = new Date('2026-10-27T23:00:00Z');
    await schedulerTick();
    expect(await BackupRun.countDocuments({ scheduled: true, status: 'ok' })).toBe(1);
    await schedulerTick();
    expect(await BackupRun.countDocuments({ scheduled: true })).toBe(1);
    const l1 = await acquireLock('full-backup', 60_000);
    expect(l1).not.toBeNull();
    expect(await acquireLock('full-backup', 60_000)).toBeNull();
    const busy = await runBackup({ scope: 'full', reason: 'manual', by });
    expect(busy.skipped).toMatch(/Boshqa zaxira/);
    await l1!.release();
  }, 60_000);

  it("Telegram ishlamasa — qisman, dasturchiga xabar; 26 soatdan keyin 'eskirgan' ogohlantirish", async () => {
    tgFail = true;
    notes.length = 0;
    const { run } = await runBackup({ scope: 'full', reason: 'manual', by });
    expect(run?.status).toBe('partial');
    expect(notes.some((n) => n.includes('qisman') && n.includes('blocked'))).toBe(true);
    const st = await backupStatus();
    expect(st.targets.telegram.lastError).toMatch(/blocked/);
    expect(st.targets.s3.lastSuccessAt).toBeTruthy();
    clock = new Date(clock.getTime() + 30 * 3600_000);
    notes.length = 0;
    expect(await checkStale()).toBe(true);
    expect(notes.some((n) => n.includes('26 soatdan'))).toBe(true);
    notes.length = 0;
    await checkStale(); // 12 soat ichida qayta xabar yo'q
    expect(notes.length).toBe(0);
  }, 60_000);

  it("saqlash: eski kunlik arxivlar S3'dan o'chiriladi, ro'yxatda ikkala manba ko'rinadi", async () => {
    // 20 kunlik soxta "kunlik" arxivlar (ism bo'yicha sanasi)
    for (let i = 1; i <= 20; i++) {
      const d = new Date(clock.getTime() - i * 86400000);
      const stamp = d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
      bucket.set(`qurilish-erp-backups/full/2026/10/full_${stamp}_daily_abcd.qbk`, Buffer.from('x'));
    }
    const { pruned } = await pruneS3();
    expect(pruned.length).toBeGreaterThan(0);
    expect(pruned.every((k) => k.includes('_daily_'))).toBe(true);
    const list = await listArchives();
    expect(list.items.some((i) => i.source.type === 's3')).toBe(true);
    expect(list.items.some((i) => i.source.type === 'telegram')).toBe(true);
  }, 60_000);

  it("xavfli amaldan oldin firma arxivi (hech qachon xato tashlamaydi)", async () => {
    const id = await backupBeforeRiskyOp(String(A), 'pre_reset', by);
    expect(id).toBeTruthy();
    const st = await stageBackup({ scope: 'company', companyId: String(A), reason: 'pre_reset' });
    const run = await st.done;
    expect(run?.scope).toBe('company');
    expect(run?.collections?.transactions).toBe(2);
    expect(run?.collections?.users).toBe(2);
  }, 60_000);
});
