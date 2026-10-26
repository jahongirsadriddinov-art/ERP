import { Router } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import ObjectModel from '../models/Object';
import User from '../models/User';
import Transaction from '../models/Transaction';
import Material from '../models/Material';
import Attendance from '../models/Attendance';
import AuditLog from '../models/AuditLog';
import CompanyBackup from '../models/CompanyBackup';
import Company from '../models/Company';
import { getTenant } from '../middleware/tenantContext';
import { requireFeature } from '../middleware/requireFeature';
import { logAudit } from '../services/audit';
import { CompanySnapshot, takeSnapshot, restoreSnapshot, RESET_SCOPES, SNAPSHOT_MODELS } from '../services/companySnapshot';
import { checkRate } from '../utils/rateLimit';
import DailyReport from '../models/DailyReport';
import WorkLog from '../models/WorkLog';
import EquipmentLog from '../models/EquipmentLog';
import Subscription from '../models/Subscription';
import { backupBeforeRiskyOp } from '../services/offsiteBackup';

const router = Router();

// ── Firma eksporti (yuklab olinadigan fayl) ─────────────────────────────────────────────────────────
// Firmaning BARCHA biznes ma'lumotlari (xodimlar, obyektlar, tranzaksiyalar, materiallar, davomat, chat,
// jihozlar, xavfsizlik, hujjatlar, ish haqi, rasm/videolar, e-imzo, e'lonlar, kunlik hisobotlar, ishbay,
// jihoz jurnali, obuna) + firma kartochkasi + oxirgi 5000 audit yozuvi. Maxfiy maydonlar (parol/PIN xeshlari,
// tasdiqlash kodlari) HECH QACHON chiqmaydi. Ixtiyoriy parol bilan — AES-256-GCM (PBKDF2-SHA256) shifrlanadi.
const EXPORT_MODELS: Record<string, mongoose.Model<any>> = {
  ...SNAPSHOT_MODELS,
  dailyReports: DailyReport, worklogs: WorkLog, equipmentLogs: EquipmentLog, subscriptions: Subscription,
};
const LEGACY_IMPORT_KEYS = new Set(['users', 'objects', 'transactions', 'materials', 'attendance', 'auditLogs']);
// Obuna (subscriptions) importga KIRMAYDI — to'lov holatini fayl orqali o'zgartirib bo'lmasin
const EXTRA_IMPORT_MODELS: Record<string, mongoose.Model<any>> = Object.fromEntries(
  Object.entries(EXPORT_MODELS).filter(([k]) => !LEGACY_IMPORT_KEYS.has(k) && k !== 'subscriptions'));
const USER_SECRET_FIELDS = '-passwordHash -telegramVerificationCode -telegramVerificationCodeExpires -telegramVerificationAttempts -pinSalt -pinHash -pinResetCodeHash -twoFactorCodeHash';

async function exportActor(): Promise<{ actor: any; cid: string } | { error: string; status: number }> {
  const tenant = getTenant();
  if (!tenant?.userId) return { status: 401, error: 'Autentifikatsiya talab etiladi' };
  const actor: any = await User.findById(tenant.userId).lean().catch(() => null);
  // Owner 2026-10-26: butun firma ma'lumoti (ish haqi, moliya) — faqat firma egasi yoki direktor yuklab oladi
  if (!actor || !(actor.isOwner || actor.role === 'direktor')) return { status: 403, error: "Faqat firma egasi yoki direktor yuklab olishi mumkin" };
  const cid = String(actor.companyId || tenant.companyId || '');
  if (!cid) return { status: 400, error: 'Kompaniya topilmadi' };
  return { actor, cid };
}

export async function buildCompanyExport(cid: string, actor: any) {
  const filter = { companyId: cid };
  const data: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const [k, M] of Object.entries(EXPORT_MODELS)) {
    data[k] = k === 'users' ? await User.find(filter).select(USER_SECRET_FIELDS).lean() : await M.find(filter).lean();
    counts[k] = data[k].length;
  }
  data.auditLogs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
  counts.auditLogs = data.auditLogs.length;
  const company = await Company.findById(cid).lean().catch(() => null);
  return {
    format: 'qurilish-erp-company-backup', version: 2,
    exportedAt: new Date().toISOString(),
    exportedBy: { id: actor._id, name: `${actor.firstName || ''} ${actor.lastName || ''}`.trim(), role: actor.role },
    companyId: cid, companyName: (company as any)?.name,
    company,
    counts,
    data,
  };
}

/** Parol bilan shifrlash — brauzer WebCrypto bilan ham ochiladi (PBKDF2-SHA256 + AES-256-GCM, ct = shifr||tag). */
export function encryptExport(json: string, password: string) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const iterations = 310_000;
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(json, 'utf8'), c.final(), c.getAuthTag()]);
  return { format: 'qurilish-erp-encrypted-backup', v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: salt.toString('base64') }, cipher: 'AES-256-GCM', iv: iv.toString('base64'), ct: ct.toString('base64') };
}
export function decryptExport(wrapper: any, password: string): string {
  const key = crypto.pbkdf2Sync(password, Buffer.from(wrapper.kdf.salt, 'base64'), Number(wrapper.kdf.iterations), 32, 'sha256');
  const all = Buffer.from(wrapper.ct, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(wrapper.iv, 'base64'));
  d.setAuthTag(all.subarray(all.length - 16));
  return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString('utf8');
}

const sendExport = async (req: any, res: any, password?: string) => {
  const a = await exportActor();
  if ('error' in a) return res.status(a.status).json({ error: a.error });
  if (!checkRate(`export:${a.cid}`, 20, 3600_000).allowed) return res.status(429).json({ error: "Juda ko'p yuklab olish — birozdan keyin" });
  const backup = await buildCompanyExport(a.cid, a.actor);
  const day = new Date().toISOString().split('T')[0];
  await logAudit({ userId: String(a.actor._id), userName: backup.exportedBy.name, userRole: a.actor.role, action: 'create', entity: 'backup', entityId: a.cid,
    description: `Firma zaxirasi yuklab olindi${password ? ' (parol bilan shifrlangan)' : ''}`, companyId: a.cid, req });
  if (password) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="qurilish-erp-backup-${day}.qerp.json"`);
    return res.json(encryptExport(JSON.stringify(backup), password));
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="qurilish-erp-backup-${day}.json"`);
  res.json(backup);
};

// GET /api/admin/backup — firmaning to'liq eksporti (JSON, shifrlanmagan)
router.get('/backup', requireFeature('backup'), async (req, res) => {
  try { await sendExport(req, res); } catch (err) { console.error('Backup error:', err); res.status(500).json({ error: 'Server xatoligi' }); }
});
// POST /api/admin/backup/export { password? } — parol berilsa fayl shifrlanadi (kamida 8 belgi)
router.post('/backup/export', requireFeature('backup'), async (req, res) => {
  const pw = typeof req.body?.password === 'string' ? req.body.password : '';
  if (pw && pw.length < 8) return res.status(400).json({ error: "Parol kamida 8 belgidan iborat bo'lsin" });
  try { await sendExport(req, res, pw || undefined); } catch (err) { console.error('Backup export error:', err); res.status(500).json({ error: 'Server xatoligi' }); }
});

// POST /api/admin/backup/import — avval FAQAT o'chirilgan firmani tiklash
// mumkin edi (routes/companies.ts, companyId hali BAZADA MAVJUD bo'lmasa
// ishlaydi) — TIRIK, hozir ishlab turgan firmaga backup faylni QAYTA
// yuklash (masalan xato o'chirilgan/buzilgan ma'lumotni oldingi holatga
// qaytarish uchun) imkoni umuman yo'q edi. Bu — YUQORIDAGI GET /backup
// eksport qilgan AYNAN o'sha JSON'ni qabul qiladi.
//
// XAVFSIZLIK/MA'LUMOT BUTUNLIGI — QASDDAN QAT'IY: (1) faqat direktor/
// o'rinbosar, (2) backup ICHIDAGI companyId JORIY firma bilan ANIQ mos
// kelishi shart (boshqa firma backup'ini "aralashtirib" yuklab bo'lmaydi),
// (3) `confirm: true` ANIQ yuborilishi shart (tasodifiy chaqiruvdan
// himoya), (4) wipe qilishdan OLDIN joriy holat CompanyBackup'ga saqlanadi
// — agar import xato bo'lib chiqsa, buni ham (qo'lda, dasturchi orqali)
// tiklash imkoni qoladi. DIQQAT: bu backup olingan paytdan KEYINGI barcha
// o'zgarishlarni (yangi xodim, yangi tranzaksiya va h.k.) YO'QOTADI — bu
// "orqaga qaytarish" (rollback) tabiati, xato emas.
router.post('/backup/import', requireFeature('backup'), async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const actor = await User.findById(tenant.userId).lean().catch(() => null);
    // XAVFSIZLIK (audit 2026-10-19): butun firmani almashtiradi — faqat firma egasi yoki direktor
    if (!actor || !((actor as any).isOwner || actor.role === 'direktor')) {
      return res.status(403).json({ error: "Faqat firma egasi yoki direktor tiklashi mumkin" });
    }
    const cid = actor.companyId || tenant.companyId;
    if (!cid) return res.status(400).json({ error: 'Kompaniya topilmadi' });

    let body: any = req.body || {};
    // Parol bilan shifrlangan eksport (POST /backup/export { password }) — server ochadi
    if (body.encrypted && typeof body.encrypted === 'object') {
      if (body.encrypted.format !== 'qurilish-erp-encrypted-backup' || typeof body.password !== 'string' || !body.password) {
        return res.status(400).json({ error: 'Shifrlangan fayl uchun parol kiriting' });
      }
      if (!checkRate(`import-pw:${cid}`, 10, 3600_000).allowed) return res.status(429).json({ error: "Juda ko'p urinish — 1 soatdan keyin" });
      try { body = { ...JSON.parse(decryptExport(body.encrypted, body.password)), confirm: body.confirm }; }
      catch { return res.status(400).json({ error: "Parol noto'g'ri yoki fayl buzilgan" }); }
    }
    const { companyId: backupCompanyId, data, confirm } = body;
    if (!confirm) return res.status(400).json({ error: "Tasdiqlash talab etiladi (confirm: true)" });
    if (!data || typeof data !== 'object') return res.status(400).json({ error: "Backup fayli noto'g'ri formatda" });
    if (String(backupCompanyId) !== String(cid)) {
      return res.status(400).json({ error: "Bu backup fayli boshqa firmaga tegishli — faqat o'z firmangiz zaxirasini tiklashingiz mumkin" });
    }

    // XAVFSIZLIK (audit 2026-10-19): fayl ichidagi yozuvlarga ISHONILMAYDI — har biri majburan SHU firmaga
    // muhrlanadi; foydalanuvchi roli faqat firma rollaridan (dasturchi/super-admin yaratib bo'lmaydi);
    // boshqa firmaga tegishli _id/telefon/Telegram bog'lanishi bilan to'qnashuv — o'tkazib yuboriladi.
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 50_000) : []);
    const stamp = (docs: any[]) => docs.map((d) => {
      const { __v: _v, ...rest } = d;
      for (const k of Object.keys(rest)) if (k.startsWith('$')) delete (rest as any)[k];
      return { ...rest, companyId: cid };
    });
    const COMPANY_ROLES = ['direktor', 'orinbosar', 'prorab', 'brigadir', 'ishchi'];
    const foreignUsers = new Set<string>();
    const rawUsers = arr(data.users);
    const ids = rawUsers.map((u: any) => String(u?._id || '')).filter(Boolean);
    const phones = rawUsers.map((u: any) => String(u?.phone || '')).filter(Boolean);
    const others: any[] = await User.find({ companyId: { $ne: cid }, $or: [{ _id: { $in: ids.filter((x) => /^[a-f0-9]{24}$/i.test(x)) } }, { phone: { $in: phones } }] })
      .select('_id phone').lean().catch(() => []);
    for (const o of others) { foreignUsers.add(String(o._id)); foreignUsers.add(String(o.phone)); }
    // XAVFSIZLIK (audit 2026-10-22): firma egasi(lari) importda TEGILMAYDI — o'chirilmaydi va fayldagi
    // nusxasi bilan almashtirilmaydi; fayldan hech kim isOwner olmaydi. Avval egasi bo'lmagan direktor
    // soxta fayl bilan egani o'chirib/telefonini o'z raqamiga almashtirib (keyin OTP bilan kirib) yoki
    // o'zini ega qilib firmani egallab olishi mumkin edi.
    const owners: any[] = await User.find({ companyId: cid, isOwner: true }).select('_id phone').lean();
    for (const o of owners) { foreignUsers.add(String(o._id)); foreignUsers.add(String(o.phone)); }
    const users = stamp(rawUsers)
      .filter((u: any) => COMPANY_ROLES.includes(String(u.role)) && !foreignUsers.has(String(u._id)) && !foreignUsers.has(String(u.phone)))
      .map((u: any) => { const { isDeveloper: _d, isOwner: _o, ...rest } = u; return rest; });
    const objects = stamp(arr(data.objects));
    const transactions = stamp(arr(data.transactions));
    const materials = stamp(arr(data.materials));
    const attendance = stamp(arr(data.attendance));
    const auditLogs = stamp(arr(data.auditLogs));

    // ── Wipe'dan OLDIN joriy holatni saqlab qo'yamiz (qo'lda tiklash imkoni uchun) ──
    const filter = { companyId: cid };
    const [curUsers, curObjects, curTransactions, curMaterials, curAttendance] = await Promise.all([
      User.find(filter).lean(), ObjectModel.find(filter).lean(), Transaction.find(filter).lean(),
      Material.find(filter).lean(), Attendance.find(filter).lean(),
    ]);
    const company = await Company.findById(cid).select('name').lean();
    const safetyBackup = await CompanyBackup.create({
      companyId: cid,
      companyName: company?.name || cid,
      reason: 'pre_import_restore',
      deletedBy: { userId: tenant.userId, name: `${actor.firstName} ${actor.lastName || ''}`.trim(), role: actor.role },
      snapshot: { company: null, users: curUsers, objects: curObjects, materials: curMaterials, transactions: curTransactions, messages: [], groups: [], subscriptions: [], attendance: curAttendance },
    });

    const insertSafe = async (Model: any, docs: any[]) => {
      if (!docs?.length) return 0;
      try { const r = await Model.insertMany(docs, { ordered: false }); return r.length; }
      catch (e: any) { return e?.insertedDocs?.length ?? 0; }
    };

    // Qo'shimcha: firma ichidagi to'liq nusxa + tashqi (off-site) arxiv — import kutilmagan natija bersa ham qaytarish mumkin
    const by = { userId: String(tenant.userId), name: `${actor.firstName} ${actor.lastName || ''}`.trim(), role: actor.role };
    await takeSnapshot(cid, 'pre_restore', by, 'Fayldan importdan oldin').catch(() => undefined);
    await backupBeforeRiskyOp(cid, 'pre_import', by);

    await Promise.all([
      User.deleteMany({ ...filter, isOwner: { $ne: true } }), ObjectModel.deleteMany(filter),
      Transaction.deleteMany(filter), Material.deleteMany(filter), Attendance.deleteMany(filter),
    ]);
    const [uCount, oCount, tCount, mCount, aCount, alCount] = await Promise.all([
      insertSafe(User, users), insertSafe(ObjectModel, objects), insertSafe(Transaction, transactions),
      insertSafe(Material, materials), insertSafe(Attendance, attendance), insertSafe(AuditLog, auditLogs),
    ]);

    // Yangi (v2) eksportdagi qo'shimcha bo'limlar — faqat faylda BOR bo'lsa almashtiriladi (eski fayllar ularga tegmaydi)
    const extra: Record<string, number> = {};
    for (const [k, M] of Object.entries(EXTRA_IMPORT_MODELS)) {
      if (!Array.isArray(data[k])) continue;
      const docs = stamp(arr(data[k]));
      await M.deleteMany(filter);
      extra[k] = await insertSafe(M, docs);
    }

    await logAudit({
      userId: tenant.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
      action: 'update', entity: 'company', entityId: cid,
      description: `Firma ma'lumotlari backup'dan tiklandi (${uCount} user, ${oCount} obyekt, ${tCount} tranzaksiya, ${mCount} material). Import oldidan holat: CompanyBackup#${safetyBackup._id}`,
      companyId: cid, req,
    });

    res.json({ ok: true, safetyBackupId: String(safetyBackup._id), restored: { users: uCount, objects: oCount, transactions: tCount, materials: mCount, attendance: aCount, auditLogs: alCount, ...extra } });
  } catch (err) {
    console.error('Backup import error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// ── Shaxsiy nusxalar ro'yxati va "Xavfli zona" (faqat direktor / o'rinbosar) ─────────────────────────────
async function bossActor(): Promise<{ actor: any; cid: string; by: any } | null> {
  const t = getTenant();
  if (!t?.userId) return null;
  const actor: any = await User.findById(t.userId).lean().catch(() => null);
  if (!actor || !(actor.isOwner || ['direktor', 'orinbosar'].includes(actor.role))) return null;
  const cid = String(actor.companyId || t.companyId || '');
  if (!cid) return null;
  return { actor, cid, by: { userId: String(actor._id), name: `${actor.firstName} ${actor.lastName || ''}`.trim(), role: actor.role } };
}
const REASON_UZ: Record<string, string> = { auto_daily: 'Avtomatik (kunlik)', manual: "Qo'lda olingan", pre_reset: "Tozalashdan oldin", pre_restore: 'Tiklashdan oldin', pre_delete: "O'chirishdan oldin" };

// GET /api/admin/snapshots — barcha nusxalar, eng yangisi tepada
router.get('/snapshots', async (_req, res) => {
  const b = await bossActor(); if (!b) return res.status(403).json({ error: "Faqat direktor yoki o'rinbosar" });
  const list: any[] = await CompanySnapshot.find({ companyId: b.cid }).sort({ createdAt: -1 }).limit(200).select('-data').lean();
  res.json(list.map(s => ({ id: s._id, reason: s.reason, reasonLabel: REASON_UZ[s.reason] || s.reason, note: s.note, by: s.by?.name, counts: s.counts, sizeBytes: s.sizeBytes, createdAt: s.createdAt })));
});
// POST /api/admin/snapshots — hozir nusxa olish
router.post('/snapshots', async (req, res) => {
  const b = await bossActor(); if (!b) return res.status(403).json({ error: "Faqat direktor yoki o'rinbosar" });
  if (!checkRate(`snap:${b.cid}`, 10, 3600_000).allowed) return res.status(429).json({ error: "Juda ko'p nusxa — birozdan keyin" });
  const s = await takeSnapshot(b.cid, 'manual', b.by, typeof req.body?.note === 'string' ? req.body.note.slice(0, 120) : undefined);
  res.status(201).json({ id: s._id, createdAt: s.createdAt, counts: s.counts });
});
// POST /api/admin/snapshots/:id/restore — bir bosishda tiklash (oldin joriy holat ham saqlanadi)
router.post('/snapshots/:id/restore', async (req, res) => {
  const b = await bossActor(); if (!b) return res.status(403).json({ error: "Faqat direktor yoki o'rinbosar" });
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Tasdiqlash kerak' });
  try {
    if (!(await CompanySnapshot.exists({ _id: String(req.params.id), companyId: b.cid }).catch(() => null))) return res.status(404).json({ error: 'Nusxa topilmadi' });
    await backupBeforeRiskyOp(b.cid, 'pre_snapshot_restore', b.by);
    const r = await restoreSnapshot(String(req.params.id), b.cid, b.by, b.by.userId);
    await logAudit({ userId: b.by.userId, userName: b.by.name, userRole: b.by.role, action: 'update', entity: 'company', entityId: b.cid,
      description: `Ma'lumotlar nusxadan tiklandi (#${req.params.id}). Tiklashdan oldingi holat: #${r.safetyId}`, companyId: b.cid, req });
    res.json({ ok: true, ...r });
  } catch (e: any) {
    if (e?.message === 'NOT_FOUND') return res.status(404).json({ error: 'Nusxa topilmadi' });
    console.error('[snapshot restore]', e); res.status(500).json({ error: 'Server xatoligi' });
  }
});
// GET /api/admin/reset-scopes — tozalash bo'limlari
router.get('/reset-scopes', (_req, res) => res.json(Object.entries(RESET_SCOPES).map(([key, v]) => ({ key, label: v.label }))));
// ── "Xavfli zona" — IKKI BOSQICHLI tozalash (owner 2026-10-26: "ma'lumot yo'qolmasin") ──────────────────
// 1) POST /reset/prepare { scopes } → nima o'chishini sanab ko'rsatadi va 10 daqiqalik bir martalik token beradi
//    (token kamida RESET_COOLDOWN_MS o'tgach ishlaydi — "tasodifan ikki marta bosish" bilan o'chib ketmaydi);
// 2) POST /reset { scopes, confirmText (firma nomi), token } → firma ichidagi nusxa + tashqi (off-site) arxiv olinadi,
//    keyin o'chiriladi, firma egasi/rahbarlariga Telegram'da xabar boradi.
// Butun firmani tozalash ("all") — faqat egasi yoki direktor; firma bo'yicha soatiga ko'pi bilan 3 marta.
const resetCooldownMs = () => { const v = Number(process.env.RESET_COOLDOWN_MS); return Number.isFinite(v) && v >= 0 ? v : 3000; };
const resetTokens = new Map<string, { cid: string; userId: string; keys: string[]; notBefore: number; exp: number }>();
const resetKeys = (scopes: any): string[] => scopes === 'all' ? Object.keys(RESET_SCOPES).sort() : (Array.isArray(scopes) ? [...new Set<string>(scopes.filter((k: any) => typeof k === 'string' && RESET_SCOPES[k]))].sort() : []);
const isWipeAll = (keys: string[]) => keys.length === Object.keys(RESET_SCOPES).length;

router.post('/reset/prepare', async (req, res) => {
  const b = await bossActor(); if (!b) return res.status(403).json({ error: "Faqat direktor yoki o'rinbosar" });
  const keys = resetKeys(req.body?.scopes);
  if (!keys.length) return res.status(400).json({ error: "Hech bo'lim tanlanmagan" });
  if (isWipeAll(keys) && !(b.actor.isOwner || b.actor.role === 'direktor')) return res.status(403).json({ error: "Butun firmani tozalash — faqat firma egasi yoki direktor" });
  if (!checkRate(`reset-prep:${b.cid}`, 10, 3600_000).allowed) return res.status(429).json({ error: "Juda ko'p urinish — birozdan keyin" });
  const counts: Record<string, number> = {};
  for (const k of keys) counts[k] = await RESET_SCOPES[k].count(b.cid, [b.by.userId]).catch(() => 0);
  const now = Date.now();
  for (const [t, v] of resetTokens) if (v.exp < now) resetTokens.delete(t);
  const token = crypto.randomBytes(16).toString('hex');
  resetTokens.set(token, { cid: b.cid, userId: b.by.userId, keys, notBefore: now + resetCooldownMs(), exp: now + 10 * 60_000 });
  res.json({ token, keys, counts, total: Object.values(counts).reduce((a, x) => a + x, 0), waitMs: resetCooldownMs(), expiresAt: new Date(now + 10 * 60_000) });
});

router.post('/reset', async (req, res) => {
  const b = await bossActor(); if (!b) return res.status(403).json({ error: "Faqat direktor yoki o'rinbosar" });
  const { scopes, confirmText, token } = req.body || {};
  const keys = resetKeys(scopes);
  if (!keys.length) return res.status(400).json({ error: "Hech bo'lim tanlanmagan" });
  const tk = typeof token === 'string' ? resetTokens.get(token) : undefined;
  if (!tk || tk.cid !== b.cid || tk.userId !== b.by.userId || tk.exp < Date.now() || tk.keys.join(',') !== keys.join(',')) {
    return res.status(400).json({ error: "Avval tasdiqlash bosqichidan o'ting (token yo'q yoki muddati tugagan)" });
  }
  if (Date.now() < tk.notBefore) return res.status(425).json({ error: 'Bir necha soniya kuting va qayta tasdiqlang' });
  const company: any = await Company.findById(b.cid).select('name').lean();
  if (!company || String(confirmText || '').trim().toLowerCase() !== String(company.name).trim().toLowerCase()) {
    return res.status(400).json({ error: "Tasdiqlash uchun firma nomini aynan yozing" });
  }
  const rl = checkRate(`reset:${b.cid}`, 3, 3600_000);
  if (!rl.allowed) return res.status(429).json({ error: `Tozalash soatiga 3 martadan ko'p emas — ${Math.ceil(rl.retryAfterSec / 60)} daqiqadan keyin` });
  resetTokens.delete(token);
  const snap = await takeSnapshot(b.cid, 'pre_reset', b.by, `Tozalash: ${keys.map(k => RESET_SCOPES[k].label).join(', ')}`);
  const offsiteRunId = await backupBeforeRiskyOp(b.cid, 'pre_reset', b.by);
  const deleted: Record<string, number> = {};
  for (const k of keys) deleted[k] = await RESET_SCOPES[k].run(b.cid, [b.by.userId]);
  const total = Object.values(deleted).reduce((a, x) => a + x, 0);
  await logAudit({ userId: b.by.userId, userName: b.by.name, userRole: b.by.role, action: 'delete', entity: 'company', entityId: b.cid,
    description: `Xavfli zona: tozalandi — ${keys.map(k => RESET_SCOPES[k].label).join(', ')} (${total} yozuv). Oldingi holat nusxasi: #${snap._id}${offsiteRunId ? `, tashqi arxiv: run#${offsiteRunId}` : ''}`, companyId: b.cid, req });
  // Firma rahbarlari darhol bilsin (begona/xato tozalash bo'lsa — nusxadan qaytaradi)
  void import('../services/bot').then((m) => m.notifyAdmins(`⚠️ "Xavfli zona": ${b.by.name} firma ma'lumotlarini tozaladi — ${keys.map(k => RESET_SCOPES[k].label).join(', ')} (${total} yozuv).\nOldingi holat nusxasi saqlandi: Profil → Zaxira nusxalar bo'limidan qaytarish mumkin.`, undefined, b.cid)).catch(() => undefined);
  res.json({ ok: true, deleted, snapshotId: String(snap._id), offsiteRunId });
});

export default router;
