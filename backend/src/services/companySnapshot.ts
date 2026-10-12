// Firma ma'lumotlarining to'liq nusxasi (snapshot) — avtomatik kunlik, qo'lda, har qanday tozalash (reset)
// OLDIDAN va tiklash oldidan olinadi. Nusxa gzip bilan siqilib bazada saqlanadi (katta bo'lsa bo'laklarga
// bo'linadi), direktor/o'rinbosar ro'yxatdan vaqt bo'yicha tanlab bir bosishda tiklaydi — fayl tanlash yo'q.
import zlib from 'zlib';
import mongoose, { Schema } from 'mongoose';
import User from '../models/User';
import ObjectModel from '../models/Object';
import Transaction from '../models/Transaction';
import Material from '../models/Material';
import Attendance from '../models/Attendance';
import Message from '../models/Message';
import Group from '../models/Group';
import Equipment from '../models/Equipment';
import SafetyIncident from '../models/SafetyIncident';
import CompanyDocument from '../models/CompanyDocument';
import PayrollRecord from '../models/PayrollRecord';
import ProjectMedia from '../models/ProjectMedia';
import SignedDoc from '../models/SignedDoc';
import Announcement from '../models/Announcement';
import Company from '../models/Company';

// Har bir bo'lim: nomi → model. GPS izlari (juda ko'p yozuv) nusxaga kirmaydi.
export const SNAPSHOT_MODELS: Record<string, mongoose.Model<any>> = {
  users: User, objects: ObjectModel, transactions: Transaction, materials: Material, attendance: Attendance,
  messages: Message, groups: Group, equipment: Equipment, safety: SafetyIncident, documents: CompanyDocument,
  payroll: PayrollRecord, media: ProjectMedia, signedDocs: SignedDoc, announcements: Announcement,
};

export type SnapshotReason = 'auto_daily' | 'manual' | 'pre_reset' | 'pre_restore' | 'pre_delete';

export interface ISnapshot extends mongoose.Document {
  companyId: string;
  reason: SnapshotReason;
  note?: string;
  by?: { userId: string; name: string; role: string };
  counts: Record<string, number>;
  sizeBytes: number;
  chunks: number;
  data?: Buffer; // chunks === 1 bo'lsa shu yerda
  createdAt: Date;
}
const SnapshotSchema = new Schema<ISnapshot>({
  companyId: { type: String, required: true, index: true },
  reason: { type: String, required: true },
  note: String,
  by: Schema.Types.Mixed,
  counts: { type: Schema.Types.Mixed, default: {} },
  sizeBytes: Number,
  chunks: { type: Number, default: 1 },
  data: Buffer,
}, { timestamps: { createdAt: true, updatedAt: false } });
SnapshotSchema.index({ companyId: 1, createdAt: -1 });
// 120 kundan eski nusxalar avtomatik o'chadi
SnapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 24 * 3600 });
export const CompanySnapshot = mongoose.models.CompanySnapshot as mongoose.Model<ISnapshot> || mongoose.model<ISnapshot>('CompanySnapshot', SnapshotSchema);

const ChunkSchema = new Schema({ snapshotId: { type: String, index: true }, i: Number, data: Buffer }, { timestamps: { createdAt: true, updatedAt: false } });
ChunkSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 24 * 3600 });
const SnapshotChunk = mongoose.models.SnapshotChunk || mongoose.model('SnapshotChunk', ChunkSchema);
const CHUNK = 12 * 1024 * 1024;

export async function takeSnapshot(companyId: string, reason: SnapshotReason, by?: ISnapshot['by'], note?: string) {
  const data: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const [k, M] of Object.entries(SNAPSHOT_MODELS)) {
    data[k] = await M.find({ companyId }).lean();
    counts[k] = data[k].length;
  }
  const company = await Company.findById(companyId).lean().catch(() => null);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, companyId, company, data })));
  const snap = await CompanySnapshot.create({ companyId, reason, by, note, counts, sizeBytes: gz.length, chunks: Math.max(1, Math.ceil(gz.length / CHUNK)), data: gz.length <= CHUNK ? gz : undefined });
  if (gz.length > CHUNK) {
    for (let i = 0; i * CHUNK < gz.length; i++) await SnapshotChunk.create({ snapshotId: String(snap._id), i, data: gz.subarray(i * CHUNK, (i + 1) * CHUNK) });
  }
  return snap;
}

async function readSnapshot(snap: ISnapshot): Promise<{ data: Record<string, any[]> }> {
  // Mongoose Buffer — Node Buffer (uning .buffer'i butun xotira hovuzi, ishlatib bo'lmaydi); lean() — BSON Binary
  const toBuf = (x: any): Buffer => Buffer.isBuffer(x) ? x : x?.buffer ? Buffer.from(x.buffer) : Buffer.from(x);
  let gz: Buffer;
  if (snap.chunks > 1 || !snap.data) {
    const parts: any[] = await SnapshotChunk.find({ snapshotId: String(snap._id) }).sort({ i: 1 }).lean();
    gz = Buffer.concat(parts.map(p => toBuf(p.data)));
  } else gz = toBuf(snap.data);
  return JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
}

/** Nusxadan tiklash: avval joriy holat nusxasi olinadi, keyin tanlangan bo'limlar nusxadagi holatga qaytariladi.
 *  Tiklayotgan rahbarning o'z hisobi hech qachon o'chirilmaydi (nusxada bo'lmasa ham saqlanadi). */
export async function restoreSnapshot(snapshotId: string, companyId: string, by: ISnapshot['by'], actorUserId: string) {
  const snap = await CompanySnapshot.findOne({ _id: snapshotId, companyId });
  if (!snap) throw new Error('NOT_FOUND');
  const { data } = await readSnapshot(snap);
  const safety = await takeSnapshot(companyId, 'pre_restore', by, `Tiklashdan oldin (${new Date(snap.createdAt).toISOString()} nusxasi)`);
  const restored: Record<string, number> = {};
  for (const [k, M] of Object.entries(SNAPSHOT_MODELS)) {
    const docs: any[] = (data[k] || []).filter((d: any) => String(d.companyId) === String(companyId));
    if (k === 'users') {
      await M.deleteMany({ companyId, _id: { $ne: actorUserId } });
      const rest = docs.filter(d => String(d._id) !== String(actorUserId));
      if (rest.length) { try { await M.insertMany(rest, { ordered: false }); } catch { /* takrorlar o'tkaziladi */ } }
      restored[k] = rest.length;
      continue;
    }
    await M.deleteMany({ companyId });
    if (docs.length) { try { await M.insertMany(docs, { ordered: false }); } catch { /* */ } }
    restored[k] = docs.length;
  }
  return { restored, safetyId: String(safety._id) };
}

// ── Tozalash (reset) bo'limlari — har biri qaysi ma'lumotni o'chiradi ─────────
export const RESET_SCOPES: Record<string, { label: string; run: (cid: string, keepUserIds: string[]) => Promise<number> }> = {
  expenses: { label: "Chiqimlar, o'tkazmalar va hisobotlar", run: async cid => (await Transaction.deleteMany({ companyId: cid })).deletedCount || 0 },
  objects: { label: "Obyektlar (materiallar, rasm/videolar bilan)", run: async cid => {
    const r = await Promise.all([ObjectModel.deleteMany({ companyId: cid }), Material.deleteMany({ companyId: cid }), ProjectMedia.deleteMany({ companyId: cid })]);
    return r.reduce((a, x) => a + (x.deletedCount || 0), 0);
  } },
  staff: { label: "Xodimlar (rahbarlardan tashqari)", run: async (cid, keep) => (await User.deleteMany({ companyId: cid, role: { $in: ['prorab', 'brigadir', 'ishchi'] }, _id: { $nin: keep }, isOwner: { $ne: true } })).deletedCount || 0 },
  attendance: { label: "Davomat va GPS izlari", run: async cid => {
    const GpsLocation = mongoose.model('GpsLocation');
    const r = await Promise.all([Attendance.deleteMany({ companyId: cid }), GpsLocation.deleteMany({ companyId: cid })]);
    return r.reduce((a, x: any) => a + (x.deletedCount || 0), 0);
  } },
  chat: { label: "Xabarlar va guruhlar", run: async cid => {
    const r = await Promise.all([Message.deleteMany({ companyId: cid }), Group.deleteMany({ companyId: cid })]);
    return r.reduce((a, x) => a + (x.deletedCount || 0), 0);
  } },
  documents: { label: "Hujjatlar va e-imzolar", run: async cid => {
    const r = await Promise.all([CompanyDocument.deleteMany({ companyId: cid }), SignedDoc.deleteMany({ companyId: cid })]);
    return r.reduce((a, x) => a + (x.deletedCount || 0), 0);
  } },
  other: { label: "Jihozlar, xavfsizlik, ish haqi, e'lonlar", run: async cid => {
    const r = await Promise.all([Equipment.deleteMany({ companyId: cid }), SafetyIncident.deleteMany({ companyId: cid }), PayrollRecord.deleteMany({ companyId: cid }), Announcement.deleteMany({ companyId: cid })]);
    return r.reduce((a, x) => a + (x.deletedCount || 0), 0);
  } },
};

// ── Kunlik avtomatik nusxa — har 6 soatda tekshiriladi, firma uchun oxirgi 22 soatda nusxa bo'lmasa olinadi.
// Avtomatik nusxalardan oxirgi 14 tasi saqlanadi (qo'lda va tozalashdan oldingi nusxalar 120 kun turadi).
export function startAutoSnapshots() {
  const run = async () => {
    try {
      const companies: any[] = await Company.find({}).select('_id').lean();
      for (const c of companies) {
        const cid = String(c._id);
        const last = await CompanySnapshot.findOne({ companyId: cid, reason: 'auto_daily' }).sort({ createdAt: -1 }).select('createdAt').lean();
        if (last && Date.now() - new Date(last.createdAt).getTime() < 22 * 3600 * 1000) continue;
        await takeSnapshot(cid, 'auto_daily').catch(e => console.error('[auto snapshot]', cid, e?.message));
        const old = await CompanySnapshot.find({ companyId: cid, reason: 'auto_daily' }).sort({ createdAt: -1 }).skip(14).select('_id chunks').lean();
        for (const o of old) { await SnapshotChunk.deleteMany({ snapshotId: String(o._id) }); await CompanySnapshot.deleteOne({ _id: o._id }); }
      }
    } catch (e: any) { console.error('[auto snapshot] run', e?.message); }
  };
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, 6 * 3600 * 1000);
}
