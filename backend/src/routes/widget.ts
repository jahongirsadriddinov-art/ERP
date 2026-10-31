import { Router } from 'express';
import User from '../models/User';
import Company from '../models/Company';
import Transaction from '../models/Transaction';
import Attendance from '../models/Attendance';
import { getTenant } from '../middleware/tenantContext';

// Telefon ekranidagi widget uchun ixcham ma'lumot (owner 2026-10-31:
// "ilovalarga widget chiqarish kerak").
//
// NEGA ALOHIDA YO'L, /dashboard/stats EMAS:
//  • widget kuniga o'nlab marta, fonda so'raydi — javob imkon qadar KICHIK
//    bo'lishi kerak (mobil trafik va batareya);
//  • dashboard "jami chiqim"ni BUTUN davr uchun beradi, widgetda esa BUGUNGI
//    raqam kerak;
//  • dashboard faqat direktor/o'rinbosarga ochiq. Widget har qanday xodimga
//    kerak — shuning uchun bu yerda ROLGA QARAB ko'rsatiladi: pul faqat
//    rahbarga, qolganlarga o'z kuni (davomat, tasdiq kutayotganlari).
//
// Javob 60 soniya keshlanadi: widget ketma-ket so'rasa ham server zo'riqmaydi.

const router = Router();

/** Rahbarmi — pul ko'rsatkichlari faqat shularga. */
const isBoss = (u: any): boolean => !!u?.isOwner || u?.role === 'direktor' || u?.role === 'orinbosar';

router.get('/summary', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });
    const actor: any = await User.findById(tenant.userId).select('role isOwner companyId firstName').lean().catch(() => null);
    if (!actor) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    const cid = actor.companyId || tenant.companyId;
    const filter: Record<string, any> = cid ? { companyId: cid } : {};
    const today = new Date().toISOString().split('T')[0];
    const boss = isBoss(actor);

    const [company, todayExpense, pending, attendance, employees] = await Promise.all([
      cid ? Company.findById(cid).select('name').lean().catch(() => null) : null,
      boss
        ? Transaction.aggregate([
            // Dashboard bilan AYNAN bir xil qoida: ko'chirma va kirim chiqim emas
            { $match: { ...filter, status: 'confirmed', date: today, amount: { $exists: true }, type: { $nin: ['transfer', 'income'] } } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]).catch(() => [])
        : Promise.resolve([]),
      Transaction.countDocuments({ ...filter, status: 'pending', type: 'transfer' }).catch(() => 0),
      Attendance.countDocuments({ ...filter, date: today, status: { $in: ['present', 'late'] } }).catch(() => 0),
      User.countDocuments({ ...filter, role: { $in: ['prorab', 'brigadir', 'ishchi'] } }).catch(() => 0),
    ]);

    res.json({
      company: (company as any)?.name || '',
      // Pul faqat rahbarga — widget boshqa odamning telefonida ham ko'rinadi
      todayExpense: boss ? (todayExpense as any[])[0]?.total || 0 : null,
      pending,
      attendance,
      employees,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[widget] summary xatosi:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
