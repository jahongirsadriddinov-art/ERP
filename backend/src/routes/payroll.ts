import { Router } from 'express';
import PayrollRecord from '../models/PayrollRecord';
import Attendance from '../models/Attendance';
import User from '../models/User';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { requireOwnerOrAdmin } from '../middleware/auth';
import { logAudit } from '../services/audit';

const router = Router();

// Ish haqi hisob-kitobi — avval umuman yo'q edi. Attendance yozuvlaridan
// (kelgan kunlar/soatlar) va User.baseSalary'dan (admin profil orqali
// belgilaydi) hisoblanadi. Kunlik stavka = oylik stavka / shu oydagi ish
// kunlari soni (dam olish — yakshanba — hisobga olinmaydi, O'zbekistonda
// odatiy amaliyot).
export function workingDaysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(y, m - 1, d).getDay() !== 0) count++; // 0 = yakshanba
  }
  return count;
}

router.post('/calculate', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { period } = req.body || {};
    if (!/^\d{4}-\d{2}$/.test(period || '')) return res.status(400).json({ error: "period 'YYYY-MM' formatida bo'lishi kerak" });
    const t = getTenant();

    const users = await User.find(scoped({ role: { $ne: 'dasturchi' } }) as any).lean();
    const workDays = workingDaysInMonth(period);
    const results = [];

    for (const u of users) {
      const attendance = await Attendance.find({ userId: String(u._id), date: { $regex: `^${period}` } }).lean();
      const presentDays = attendance.filter(a => ['present', 'late', 'half'].includes(a.status)).length;
      const totalWorkHours = attendance.reduce((s, a) => s + (a.workHours || 0), 0);
      const baseSalary = u.baseSalary || 0;
      const dailyRate = workDays > 0 ? baseSalary / workDays : 0;
      const netPay = Math.round(dailyRate * presentDays);

      const rec = await PayrollRecord.findOneAndUpdate(
        { companyId: t?.companyId, userId: String(u._id), period },
        {
          $set: {
            companyId: t?.companyId, userId: String(u._id), userName: `${u.firstName} ${u.lastName || ''}`.trim(),
            period, baseSalary, presentDays, totalWorkHours,
            netPay, status: 'draft',
          },
          $setOnInsert: { bonuses: 0, deductions: 0 },
        },
        { upsert: true, new: true }
      );
      results.push({ ...rec!.toObject(), id: rec!._id });
    }

    res.json({ ok: true, period, count: results.length, records: results });
  } catch (err) {
    console.error('[payroll/calculate]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.get('/', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { period } = req.query as Record<string, string>;
    const filter: any = scoped();
    if (period) filter.period = period;
    const list = await PayrollRecord.find(filter).sort({ userName: 1 }).lean();
    res.json(list.map(r => ({ ...r, id: r._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// Xodimning o'zi — faqat o'z tarixini ko'radi.
router.get('/mine', async (req, res) => {
  try {
    const t = getTenant();
    if (!t?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const list = await PayrollRecord.find(scoped({ userId: t.userId })).sort({ period: -1 }).lean();
    res.json(list.map(r => ({ ...r, id: r._id })));
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

router.patch('/:id', requireOwnerOrAdmin, async (req, res) => {
  try {
    const { bonuses, deductions, status } = req.body || {};
    const rec = await PayrollRecord.findOne(scoped({ _id: req.params.id }));
    if (!rec) return res.status(404).json({ error: 'Topilmadi' });
    if (rec.status === 'paid') return res.status(409).json({ error: "To'langan yozuvni o'zgartirib bo'lmaydi" });

    if (bonuses !== undefined) rec.bonuses = Math.max(0, Number(bonuses) || 0);
    if (deductions !== undefined) rec.deductions = Math.max(0, Number(deductions) || 0);
    // Asosiy summani HAR DOIM qayta hisoblaymiz (saqlangan netPay'dan EMAS) —
    // aks holda PATCH bir necha marta chaqirilsa, bonus/ushlab qolish har
    // safar oldingi (allaqachon qo'shilgan) netPay ustiga qayta qo'shilib,
        // noto'g'ri (o'sib ketuvchi) natija berardi.
    const workDays = workingDaysInMonth(rec.period);
    const dailyRate = workDays > 0 ? rec.baseSalary / workDays : 0;
    const basePay = Math.round(dailyRate * rec.presentDays);
    rec.netPay = Math.max(0, basePay + (rec.bonuses || 0) - (rec.deductions || 0));
    if (status !== undefined && ['draft', 'finalized', 'paid'].includes(status)) rec.status = status;
    await rec.save();

    const t = getTenant();
    if (t?.userId) {
      const actor = await User.findById(t.userId).lean().catch(() => null);
      if (actor) {
        logAudit({
          userId: t.userId, userName: `${actor.firstName} ${actor.lastName || ''}`.trim(), userRole: actor.role,
          action: 'update', entity: 'payroll', entityId: String(rec._id),
          description: `Ish haqi yozuvi yangilandi: ${rec.userName} (${rec.period}) — ${rec.netPay.toLocaleString()} so'm`,
          companyId: t.companyId, req,
        }).catch(() => {});
      }
    }

    res.json({ ...rec.toObject(), id: rec._id });
  } catch (err) {
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
