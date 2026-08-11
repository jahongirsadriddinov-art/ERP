import { Router } from 'express';
import ObjectModel from '../models/Object';
import User from '../models/User';
import Transaction from '../models/Transaction';
import Attendance from '../models/Attendance';
import { getTenant } from '../middleware/tenantContext';

const router = Router();

// GET /api/dashboard/stats — real aggregated stats for admin dashboard
router.get('/stats', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const actor = await User.findById(tenant.userId).lean().catch(() => null);
    if (!actor || !['direktor', 'orinbosar', 'dasturchi'].includes(actor.role)) {
      return res.status(403).json({ error: 'Faqat admin ko\'rishi mumkin' });
    }

    const cid = actor.companyId || tenant.companyId;
    const filter: Record<string, any> = cid ? { companyId: cid } : {};

    const today = new Date().toISOString().split('T')[0];

    const [
      activeProjects,
      totalProjects,
      totalEmployees,
      confirmedExpenses,
      pendingTransfers,
      todayAttendance,
    ] = await Promise.all([
      ObjectModel.countDocuments({ ...filter, status: 'active' }),
      ObjectModel.countDocuments(filter),
      User.countDocuments({ ...filter, role: { $in: ['prorab', 'brigadir', 'ishchi'] } }),
      Transaction.aggregate([
        { $match: { ...filter, status: 'confirmed', amount: { $exists: true } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Transaction.countDocuments({ ...filter, status: 'pending', type: 'transfer' }),
      Attendance.countDocuments({ ...filter, date: today, status: { $in: ['present', 'late'] } }),
    ]);

    res.json({
      activeProjects,
      totalProjects,
      totalEmployees,
      totalExpenses: confirmedExpenses[0]?.total || 0,
      pendingTransfers,
      todayAttendance,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
