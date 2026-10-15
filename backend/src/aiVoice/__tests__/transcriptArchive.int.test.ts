// Transkript arxivi (owner 2026-10-15, #3): 7 kundan eski AiConversation + AiCallEvent → firma × kun gzip JSONL
// (StoredFile, ommaviy /uploads'dan berilmaydi) → AiTranscriptArchive → FAQAT keyin qatorlar o'chiriladi.
// Saqlash xatosida hech narsa o'chmaydi; qayta ishga tushish idempotent; yarim qolgan o'chirish davom ettiriladi;
// yuklab olish: direktor — faqat o'z firmasi, dasturchi — hammasi.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import zlib from 'zlib';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import AiCallEvent from '../../models/AiCallEvent';
import AiConversation from '../../models/AiConversation';
import AiTranscriptArchive from '../../models/AiTranscriptArchive';
import User from '../../models/User';
import { JWT_SECRET } from '../../middleware/auth';
import { serveDurableUpload } from '../../services/durableFiles';
import { mountAiVoiceRoutes } from '../bootstrap';
import { runTranscriptArchive } from '../archive/transcriptArchive';
import { __setArchiveStorageForTests, mongoArchiveStorage } from '../archive/storage';
import { invalidateSettings } from '../settings';
import { seedCompany, startMongo, stopMongo, type SeedCompany } from './helpers';

let mongo: MongoMemoryServer;
let A: SeedCompany, B: SeedCompany;
let devId = '';
const app = express();
app.use(express.json());
mountAiVoiceRoutes(app);
app.get('/uploads/:name', serveDurableUpload);

const tok = (id: string) => `Bearer ${jwt.sign({ userId: id }, JWT_SECRET)}`;
const get = (path: string, id: string) => request(app).get(`/api/ai-voice${path}`).set('Authorization', tok(id))
  .buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
const json = (r: request.Response) => JSON.parse(Buffer.from(r.body).toString('utf8'));

const NOW = new Date('2026-10-15T07:00:00Z');               // Toshkent 12:00, 15-oktabr
const daysAgo = (n: number, h = 6) => new Date(NOW.getTime() - n * 86_400_000 - h * 3600_000);
const OLD_DAY = '2026-10-05';                                 // daysAgo(10) → 2026-10-05 (Toshkent)

async function conv(companyId: string | undefined, updatedAt: Date, extra: Record<string, unknown> = {}) {
  const c = await AiConversation.create({ userId: 'u1', ...(companyId ? { companyId } : {}), title: 't', messages: [{ role: 'user', content: 'salom' }, { role: 'assistant', content: 'va alaykum' }], ...extra });
  await AiConversation.collection.updateOne({ _id: c._id }, { $set: { updatedAt, createdAt: updatedAt } });
  return String(c._id);
}
async function ev(companyId: string, at: Date, seq: number) {
  const e = await AiCallEvent.create({ companyId, sessionId: 's-' + companyId.slice(-4), correlationId: 'c', seq, type: 'transcript_in', at, data: { text: `matn ${seq}` }, expiresAt: new Date(NOW.getTime() + 30 * 86_400_000) });
  return String(e._id);
}
const gunzipLines = (buf: Buffer) => zlib.gunzipSync(buf).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));

beforeAll(async () => {
  mongo = await startMongo();
  await AiTranscriptArchive.init();
  A = await seedCompany('AaArx');
  B = await seedCompany('BbArx');
  devId = String((await User.create({ firstName: 'Dev', phone: '+998900008199', role: 'dasturchi' } as any))._id);
}, 120_000);
afterAll(async () => { __setArchiveStorageForTests(null); await stopMongo(mongo); });
beforeEach(async () => {
  __setArchiveStorageForTests(null);
  await Promise.all([AiConversation.deleteMany({}), AiCallEvent.deleteMany({}), AiTranscriptArchive.deleteMany({}), mongoose.model('StoredFile').deleteMany({})]);
  invalidateSettings();
});

describe('runTranscriptArchive', () => {
  it("7 kundan eskilar firma × kun bo'yicha arxivlanadi va o'chiriladi; yangilari qoladi; qayta ishga tushish — hech narsa", async () => {
    const aOld = await conv(A.companyId, daysAgo(10), { source: 'voice_inapp', sessionId: 'x' });
    const aChat = await conv(A.companyId, daysAgo(10, 7));
    const aNew = await conv(A.companyId, daysAgo(2));
    const aEdge = await conv(A.companyId, daysAgo(6, 0));    // 7 kundan yosh — qoladi
    const bOld = await conv(B.companyId, daysAgo(10));
    const pOld = await conv(undefined, daysAgo(10));          // firmasiz (dasturchi)
    const e1 = await ev(A.companyId, daysAgo(10), 1);
    const e2 = await ev(A.companyId, daysAgo(10), 2);
    const eNew = await ev(A.companyId, daysAgo(1), 3);

    const st = await runTranscriptArchive(NOW);
    expect(st).toMatchObject({ units: 3, parts: 3, conversations: 4, events: 2, errors: 0, more: false });
    const arch: any[] = await AiTranscriptArchive.find({}).sort({ companyId: 1 }).lean();
    expect(arch.map((a) => [a.companyId, a.period, a.part, a.status]).sort()).toEqual([
      [A.companyId, OLD_DAY, 1, 'done'], [B.companyId, OLD_DAY, 1, 'done'], [null, OLD_DAY, 1, 'done'],
    ].sort());
    expect(arch.every((a) => a.convIds === undefined && a.eventIds === undefined)).toBe(true);
    expect(await AiConversation.countDocuments({ _id: { $in: [aOld, aChat, bOld, pOld] } })).toBe(0);
    expect(await AiConversation.countDocuments({ _id: { $in: [aNew, aEdge] } })).toBe(2);
    expect(await AiCallEvent.countDocuments({ _id: { $in: [e1, e2] } })).toBe(0);
    expect(await AiCallEvent.exists({ _id: eNew })).toBeTruthy();

    // Fayl mazmuni: header + suhbatlar + qo'ng'iroq voqealari; boshqa firma ma'lumoti yo'q
    const a = arch.find((x) => x.companyId === A.companyId);
    expect(a.counts).toEqual({ conversations: 2, events: 2 });
    const lines = gunzipLines((await mongoArchiveStorage.get(a.storageRef))!);
    expect(lines[0]).toMatchObject({ type: 'header', companyId: A.companyId, period: OLD_DAY, part: 1 });
    expect(lines.filter((l) => l.type === 'conversation').map((l) => l.id).sort()).toEqual([aOld, aChat].sort());
    expect(lines.find((l) => l.id === aOld)).toMatchObject({ source: 'voice_inapp', messages: [{ role: 'user', content: 'salom' }, { role: 'assistant', content: 'va alaykum' }] });
    expect(lines.filter((l) => l.type === 'call_event').map((l) => l.seq)).toEqual([1, 2]);
    expect(JSON.stringify(lines)).not.toContain(bOld);
    expect(a.size).toBeGreaterThan(0);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);

    // Ommaviy /uploads/:name orqali arxiv HECH QACHON berilmaydi
    const name = a.storageRef.slice('mongo:'.length);
    expect((await request(app).get(`/uploads/${encodeURIComponent(name)}`)).status).toBe(404);

    const again = await runTranscriptArchive(NOW);
    expect(again).toMatchObject({ units: 0, parts: 0, conversations: 0, events: 0 });
    expect(await AiTranscriptArchive.countDocuments({})).toBe(3);
  });

  it("saqlash muvaffaqiyatsiz — qatorlar O'CHIRILMAYDI va arxiv yozuvi yo'q; keyingi muvaffaqiyatli ishda arxivlanadi", async () => {
    const id = await conv(A.companyId, daysAgo(9));
    const e = await ev(A.companyId, daysAgo(9), 1);
    __setArchiveStorageForTests({ ...mongoArchiveStorage, put: async () => { throw new Error('disk to\'la'); } });
    const st = await runTranscriptArchive(NOW);
    expect(st.errors).toBe(1);
    expect(st.parts).toBe(0);
    expect(await AiConversation.exists({ _id: id })).toBeTruthy();
    expect(await AiCallEvent.exists({ _id: e })).toBeTruthy();
    expect(await AiTranscriptArchive.countDocuments({})).toBe(0);

    __setArchiveStorageForTests(null);
    expect((await runTranscriptArchive(NOW)).parts).toBe(1);
    expect(await AiConversation.exists({ _id: id })).toBeNull();
  });

  it("o'chirish o'rtasida qulash — keyingi ishga tushishda 'stored' yozuv bo'yicha yakunlanadi (takroriy qism yo'q)", async () => {
    const id = await conv(A.companyId, daysAgo(9));
    const e = await ev(A.companyId, daysAgo(9), 1);
    const spy = vi.spyOn(AiCallEvent, 'deleteMany').mockRejectedValueOnce(new Error('ulanish uzildi'));
    const st = await runTranscriptArchive(NOW);
    spy.mockRestore();
    expect(st.errors).toBe(1);
    const stored: any = await AiTranscriptArchive.findOne({}).select('+convIds +eventIds').lean();
    expect(stored).toMatchObject({ status: 'stored', part: 1 });
    expect(stored.eventIds).toEqual([e]);
    expect(await AiCallEvent.exists({ _id: e })).toBeTruthy();

    const again = await runTranscriptArchive(NOW);
    expect(again.resumed).toBeGreaterThanOrEqual(1);
    expect(again.parts).toBe(0);
    expect(await AiTranscriptArchive.countDocuments({})).toBe(1);
    expect((await AiTranscriptArchive.findOne({}).lean() as any).status).toBe('done');
    expect(await AiCallEvent.exists({ _id: e })).toBeNull();
    expect(await AiConversation.exists({ _id: id })).toBeNull();
    // Fayl ikkalasini ham saqlagan
    const lines = gunzipLines((await mongoArchiveStorage.get(stored.storageRef))!);
    expect(lines.map((l) => l.id).filter(Boolean).sort()).toEqual([id, e].sort());
  });

  it("muddati o'tgan arxiv fayllari (auditRetentionDays) o'chiriladi", async () => {
    await conv(A.companyId, daysAgo(9));
    await runTranscriptArchive(NOW);
    const a: any = await AiTranscriptArchive.findOne({}).lean();
    const later = new Date(NOW.getTime() + 400 * 86_400_000);
    const st = await runTranscriptArchive(later);
    expect(st.purged).toBe(1);
    expect(await AiTranscriptArchive.countDocuments({})).toBe(0);
    expect(await mongoArchiveStorage.get(a.storageRef)).toBeNull();
  });
});

describe('arxiv yo\'llari: firma izolyatsiyasi', () => {
  it("direktor faqat o'z firmasini ko'radi/yuklaydi; boshqa firma — 404; o'rinbosar 403; dasturchi — hammasi", async () => {
    await conv(A.companyId, daysAgo(10));
    await conv(B.companyId, daysAgo(10));
    await runTranscriptArchive(NOW);
    const aArch: any = await AiTranscriptArchive.findOne({ companyId: A.companyId }).lean();
    const bArch: any = await AiTranscriptArchive.findOne({ companyId: B.companyId }).lean();

    const list = json(await get('/admin/archives', A.ownerId));
    expect(list.items.map((i: any) => i.id)).toEqual([String(aArch._id)]);
    expect(JSON.stringify(list)).not.toMatch(/storageRef|convIds|eventIds/);
    const dl = await get(`/admin/archives/${aArch._id}/download`, A.ownerId);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toMatch(/gzip/);
    expect(dl.headers['content-disposition']).toMatch(/attachment; filename="ai-transcripts-/);
    expect(gunzipLines(Buffer.from(dl.body))[0]).toMatchObject({ type: 'header', companyId: A.companyId });
    expect((await get(`/admin/archives/${bArch._id}/download`, A.ownerId)).status).toBe(404);
    expect((await get('/admin/archives', A.orinbosarId)).status).toBe(403);
    expect((await get(`/admin/archives/${aArch._id}/download`, A.orinbosarId)).status).toBe(403);
    expect((await get('/admin/archives', devId)).status).toBe(403);           // dasturchi firma yo'llariga kira olmaydi

    const all = json(await get('/platform/archives', devId));
    expect(all.items.map((i: any) => i.companyId).sort()).toEqual([A.companyId, B.companyId].sort());
    expect(all.items.find((i: any) => i.companyId === B.companyId).companyName).toBe('BbArx');
    const onlyB = json(await get(`/platform/archives?companyId=${B.companyId}`, devId));
    expect(onlyB.items.map((i: any) => i.id)).toEqual([String(bArch._id)]);
    expect((await get(`/platform/archives/${bArch._id}/download`, devId)).status).toBe(200);
    expect((await get('/platform/archives', A.ownerId)).status).toBe(403);
    expect((await get(`/platform/archives/${aArch._id}/download`, A.ownerId)).status).toBe(403);
  });
});
