import { Router } from 'express';
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
import { CompanySnapshot, takeSnapshot, restoreSnapshot, RESET_SCOPES } from '../services/companySnapshot';
import { checkRate } from '../utils/rateLimit';

const router = Router();

// GET /api/admin/backup — export all company data as JSON (director/orinbosar only)
router.get('/backup', requireFeature('backup'), async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const actor = await User.findById(tenant.userId).lean().catch(() => null);
    if (!actor || !['direktor', 'orinbosar'].includes(actor.role)) {
      return res.status(403).json({ error: 'Faqat direktor yoki o\'rinbosar yuklab olishi mumkin' });
    }

    const cid = actor.companyId || tenant.companyId;
    if (!cid) return res.status(400).json({ error: 'Kompaniya topilmadi' });

    const filter = { companyId: cid };

    // XAVFSIZLIK — TOPILMA (audit): bu yerda .select() yo'q edi — export
    // qilingan JSON'da HAR BIR xodimning parol xesh'i (passwordHash) va
    // Telegram tasdiqlash kodi ham chiqib ketardi. Backup fayli o'zi
    // to'g'ri (faqat direktor/orinbosar, faqat o'z firmasi) cheklangan
    // bo'lsa ham, keyin ulashilsa/yo'qolsa/hisob buzilsa — bu maxfiy
    // maydonlar butun jamoa uchun parol-buzish (crackable hash) manbaiga
    // aylanardi. Endi users.ts'dagi bir xil chiqarib tashlash ro'yxati.
    const [users, objects, transactions, materials, attendance, auditLogs] = await Promise.all([
      User.find(filter).select('-passwordHash -telegramVerificationCode -telegramVerificationCodeExpires').lean(),
      ObjectModel.find(filter).lean(),
      Transaction.find(filter).lean(),
      Material.find(filter).lean(),
      Attendance.find(filter).lean(),
      AuditLog.find(filter).sort({ createdAt: -1 }).limit(5000).lean(),
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      exportedBy: { id: actor._id, name: (actor as any).name, role: actor.role },
      companyId: cid,
      counts: {
        users: users.length,
        objects: objects.length,
        transactions: transactions.length,
        materials: materials.length,
        attendance: attendance.length,
        auditLogs: auditLogs.length,
      },
      data: { users, objects, transactions, materials, attendance, auditLogs },
    };

    const filename = `qurilish-erp-backup-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(backup);
  } catch (err) {
    console.error('Backup error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
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
    if (!actor || !['direktor', 'orinbosar'].includes(actor.role)) {
      return res.status(403).json({ error: "Faqat direktor yoki o'rinbosar tiklashi mumkin" });
    }
    const cid = actor.companyId || tenant.companyId;
    if (!cid) return res.status(400).json({ error: 'Kompaniya topilmadi' });

    const { companyId: backupCompanyId, data, confirm } = req.body || {};
    if (!confirm) return res.status(400).json({ error: "Tasdiqlash talab etiladi (confirm: true)" });
    if (!data || typeof data !== 'object') return res.status(400).json({ error: "Backup fayli noto'g'ri formatda" });
    if (String(backupCompanyId) !== String(cid)) {
      return res.status(400).json({ error: "Bu backup fayli boshqa firmaga tegishli — faqat o'z firmangiz zaxirasini tiklashingiz mumkin" });
    }

    const { users = [], objects = [], transactions = [], materials = [], attendance = [], auditLogs = [] } = data;

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

    await Promise.all([
      User.deleteMany(filter), ObjectModel.deleteMany(filter),
      Transaction.deleteMany(filter), Material.deleteMany(filter), Attendance.deleteMany(filter),
    ]);
    const [uCount, oCount, tCount, mCount, aCount, alCount] = await Promise.all([
      insertSafe(User, users), insertSafe(ObjectModel, objects), insertSafe(Transaction, transactions),
      insertSafe(Material, materials), insertSafe(Attendance, attendance), insertSafe(AuditLog, auditLogs),
    ]);

    await logAudit({
      userId: tenant.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
      action: 'update', entity: 'company', entityId: cid,
      description: `Firma ma'lumotlari backup'dan tiklandi (${uCount} user, ${oCount} obyekt, ${tCount} tranzaksiya, ${mCount} material). Import oldidan holat: CompanyBackup#${safetyBackup._id}`,
      companyId: cid, req,
    });

    res.json({ ok: true, safetyBackupId: String(safetyBackup._id), restored: { users: uCount, objects: oCount, transactions: tCount, materials: mCount, attendance: aCount, auditLogs: alCount } });
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
// POST /api/admin/reset — "Xavfli zona": tanlangan bo'limlarni (yoki hammasini) butunlay o'chirish.
// Har doim OLDIN avtomatik nusxa olinadi. Tasdiq uchun firma nomini aynan yozish shart.
router.post('/reset', async (req, res) => {
  const b = await bossActor(); if (!b) return res.status(403).json({ error: "Faqat direktor yoki o'rinbosar" });
  const { scopes, confirmText } = req.body || {};
  const company: any = await Company.findById(b.cid).select('name').lean();
  if (!company || String(confirmText || '').trim().toLowerCase() !== String(company.name).trim().toLowerCase()) {
    return res.status(400).json({ error: "Tasdiqlash uchun firma nomini aynan yozing" });
  }
  const keys: string[] = scopes === 'all' ? Object.keys(RESET_SCOPES) : (Array.isArray(scopes) ? scopes.filter((k: any) => typeof k === 'string' && RESET_SCOPES[k]) : []);
  if (!keys.length) return res.status(400).json({ error: "Hech bo'lim tanlanmagan" });
  const snap = await takeSnapshot(b.cid, 'pre_reset', b.by, `Tozalash: ${keys.map(k => RESET_SCOPES[k].label).join(', ')}`);
  const deleted: Record<string, number> = {};
  for (const k of keys) deleted[k] = await RESET_SCOPES[k].run(b.cid, [b.by.userId]);
  await logAudit({ userId: b.by.userId, userName: b.by.name, userRole: b.by.role, action: 'delete', entity: 'company', entityId: b.cid,
    description: `Xavfli zona: tozalandi — ${keys.map(k => RESET_SCOPES[k].label).join(', ')}. Oldingi holat nusxasi: #${snap._id}`, companyId: b.cid, req });
  res.json({ ok: true, deleted, snapshotId: String(snap._id) });
});

export default router;
