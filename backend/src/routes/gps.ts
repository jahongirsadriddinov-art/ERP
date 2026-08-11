import { Router } from 'express';
import GpsLocation from '../models/GpsLocation';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { emitToUser } from '../services/socket';

const router = Router();

// POST /api/gps — GPS koordinata saqlash
router.post('/', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { lat, lng, accuracy, projectId } = req.body;
    if (lat == null || lng == null) return res.status(400).json({ error: 'lat va lng talab etiladi' });

    const loc = new GpsLocation(stamped({ userId: tenant.userId, lat, lng, accuracy, projectId }));
    await loc.save();

    // Adminlarga real-time emit
    const payload = { userId: tenant.userId, lat, lng, accuracy, timestamp: loc.timestamp, projectId };
    emitToUser(tenant.userId, 'gps:update', payload);

    res.json({ ok: true, id: loc._id });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// GET /api/gps/latest — kompaniya xodimlarining so'nggi joylashuvi
router.get('/latest', async (req, res) => {
  try {
    const filter = scoped();
    // Har bir foydalanuvchi uchun oxirgi yozuv (aggregate)
    const latest = await GpsLocation.aggregate([
      { $match: filter },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$userId', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
    ]);
    res.json(latest);
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// GET /api/gps/user/:id — ma'lum foydalanuvchi tarixi
router.get('/user/:id', async (req, res) => {
  try {
    const { limit = '20' } = req.query as Record<string, string>;
    const locations = await GpsLocation.find({ userId: req.params.id, ...scoped() })
      .sort({ timestamp: -1 }).limit(parseInt(limit));
    res.json(locations);
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

export default router;
