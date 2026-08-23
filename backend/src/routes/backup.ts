import { Router } from 'express';
import ObjectModel from '../models/Object';
import User from '../models/User';
import Transaction from '../models/Transaction';
import Material from '../models/Material';
import Attendance from '../models/Attendance';
import AuditLog from '../models/AuditLog';
import { getTenant } from '../middleware/tenantContext';

const router = Router();

// GET /api/admin/backup — export all company data as JSON (director/orinbosar only)
router.get('/backup', async (req, res) => {
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

export default router;
