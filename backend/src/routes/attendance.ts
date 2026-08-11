import { Router } from 'express';
import Attendance from '../models/Attendance';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';

const router = Router();

// GET /api/attendance — o'z yoki kompaniya yozuvlari
router.get('/', async (req, res) => {
  try {
    const { userId, from, to, date } = req.query as Record<string, string>;
    const filter: any = scoped();
    if (userId) filter.userId = userId;
    if (date) { filter.date = date; }
    else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }
    const records = await Attendance.find(filter).sort({ date: -1 });
    res.json(records.map(r => ({ ...r.toObject(), id: r._id })));
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// POST /api/attendance/checkin — kirish qayd etish
router.post('/checkin', async (req, res) => {
  try {
    const tenant = getTenant();
    const { lat, lng, note } = req.body;
    const userId = tenant?.userId;
    if (!userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const hour = now.getHours();
    const status = hour >= 9 ? 'late' : 'present'; // 9:00 dan keyin kech keldi

    let record = await Attendance.findOne({ userId, date: today });
    if (record?.checkIn) return res.status(400).json({ error: 'Bugun allaqachon kirishni qayd etgansiz' });

    if (!record) {
      record = new Attendance(stamped({ userId, date: today }));
    }
    record.checkIn = now.toISOString();
    record.status = status;
    if (lat != null) record.lat = lat;
    if (lng != null) record.lng = lng;
    if (note) record.note = note;
    await record.save();

    res.json({ ...record.toObject(), id: record._id });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// POST /api/attendance/checkout — chiqishni qayd etish
router.post('/checkout', async (req, res) => {
  try {
    const tenant = getTenant();
    const { lat, lng, note } = req.body;
    const userId = tenant?.userId;
    if (!userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const today = new Date().toISOString().split('T')[0];
    const record = await Attendance.findOne({ userId, date: today });
    if (!record) return res.status(400).json({ error: 'Avval kirish qayd etilmagan' });
    if (record.checkOut) return res.status(400).json({ error: 'Chiqish allaqachon qayd etilgan' });

    const now = new Date();
    record.checkOut = now.toISOString();
    if (lat != null) record.checkOutLat = lat;
    if (lng != null) record.checkOutLng = lng;
    if (note) record.note = (record.note ? record.note + ' | ' : '') + note;

    // Ishlangan soatlar hisoblash
    if (record.checkIn) {
      const ms = now.getTime() - new Date(record.checkIn).getTime();
      record.workHours = Math.round((ms / 3600000) * 10) / 10;
    }
    await record.save();
    res.json({ ...record.toObject(), id: record._id });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// GET /api/attendance/today — bugungi holat
router.get('/today', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const today = new Date().toISOString().split('T')[0];
    const record = await Attendance.findOne({ userId: tenant.userId, date: today });
    res.json(record ? { ...record.toObject(), id: record._id } : null);
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// GET /api/attendance/stats — oylik statistika
router.get('/stats', async (req, res) => {
  try {
    const { userId, month } = req.query as Record<string, string>;
    const tenant = getTenant();
    const targetUserId = userId || tenant?.userId;
    if (!targetUserId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });

    const yearMonth = month || new Date().toISOString().slice(0, 7);
    const from = `${yearMonth}-01`;
    const toDate = new Date(yearMonth + '-01');
    toDate.setMonth(toDate.getMonth() + 1);
    const to = toDate.toISOString().split('T')[0];

    const records = await Attendance.find({ userId: targetUserId, date: { $gte: from, $lt: to } }).sort({ date: 1 });
    const present = records.filter(r => r.status === 'present').length;
    const late = records.filter(r => r.status === 'late').length;
    const absent = records.filter(r => r.status === 'absent').length;
    const totalHours = records.reduce((s, r) => s + (r.workHours || 0), 0);

    res.json({ records: records.map(r => ({ ...r.toObject(), id: r._id })), stats: { present, late, absent, totalHours: Math.round(totalHours * 10) / 10, days: records.length } });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

export default router;
