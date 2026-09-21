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

export default router;
