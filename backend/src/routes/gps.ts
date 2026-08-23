import { Router } from 'express';
import GpsLocation from '../models/GpsLocation';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { emitToCompany } from '../services/socket';

const router = Router();

// GET /api/gps/config — frontend'ning GPS interval'ini serverdan boshqarish
// imkonini beradi (GPS_INTERVAL_MS env orqali) — kod o'zgartirmasdan, deploy
// qilmasdan sozlash mumkin bo'lsin uchun. /api/push/vapidPublicKey bilan bir
// xil "kichik ochiq konfiguratsiya" pattern'i.
router.get('/config', (_req, res) => {
  res.json({ intervalMs: Number(process.env.GPS_INTERVAL_MS) || 60_000 });
});

// POST /api/gps — GPS koordinata saqlash
router.post('/', async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const { lat, lng, accuracy, projectId } = req.body;
    if (lat == null || lng == null) return res.status(400).json({ error: 'lat va lng talab etiladi' });

    const loc = new GpsLocation(stamped({ userId: tenant.userId, lat, lng, accuracy, projectId, source: 'site' }));
    await loc.save();

    // MUHIM: avval BARCHA ulangan foydalanuvchilarga (boshqa firmalarga ham)
    // global broadcast qilinardi — endi faqat SHU firma xonasiga.
    const payload = { userId: tenant.userId, companyId: tenant.companyId, lat, lng, accuracy, timestamp: loc.timestamp, projectId, source: 'site' as const };
    emitToCompany(tenant.companyId, 'gps:update', payload);

    res.json({ ok: true, id: loc._id });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// GET /api/gps/latest — kompaniya xodimlarining so'nggi joylashuvi
// XAVFSIZLIK — QATTIQLASHTIRISH (audit): faqat rahbariyat (direktor/
// orinbosar/dasturchi) ko'rishi kerak degan aniq talab — scoped() firma
// chegarasini to'g'ri saqlaydi, lekin rol tekshiruvi yo'q edi, ya'ni oddiy
// ishchi ham to'g'ridan-to'g'ri so'rov bilan BARCHA hamkasblarining
// joriy joylashuvini ko'rishi mumkin edi.
router.get('/latest', async (req, res) => {
  try {
    const tenant = getTenant();
    const isBoss = tenant?.isDeveloper || tenant?.role === 'direktor' || tenant?.role === 'orinbosar';
    if (!isBoss) return res.status(403).json({ error: 'Ruxsat yo\'q' });
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
// XAVFSIZLIK — QATTIQLASHTIRISH (audit): scoped() firmalararo sizishning
// oldini olardi, lekin firma ICHIDA istalgan oddiy xodim boshqa bir
// xodimning to'liq joylashuv TARIXINI so'rashi mumkin edi — shaxsiy
// joylashuv ma'lumoti, faqat rahbariyat (yoki o'zi) ko'rishi kerak.
router.get('/user/:id', async (req, res) => {
  try {
    const tenant = getTenant();
    const isSelf = String(req.params.id) === String(tenant?.userId);
    const isBoss = tenant?.isDeveloper || tenant?.role === 'direktor' || tenant?.role === 'orinbosar';
    if (!isSelf && !isBoss) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    const { limit = '20' } = req.query as Record<string, string>;
    const locations = await GpsLocation.find({ userId: req.params.id, ...scoped() })
      .sort({ timestamp: -1 }).limit(parseInt(limit));
    res.json(locations);
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

export default router;
