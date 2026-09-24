import { Router } from 'express';
import GpsLocation from '../models/GpsLocation';
import { scoped, stamped } from '../middleware/scope';
import { getTenant } from '../middleware/tenantContext';
import { emitToCompany } from '../services/socket';
import { requireFeature } from '../middleware/requireFeature';

const router = Router();

// Har bir GPS nuqta alohida hujjat sifatida saqlanadi (kuniga ~1440 gacha
// har bir faol xodim uchun) — cheklovsiz saqlansa baza jadal o'sib,
// so'rovlar sekinlashib boradi. Aniq talab: "gps saqlagan malumotlar
// faqat 1 oyga saqlaydi, qolgan narsalar turadi" — FAQAT GpsLocation
// tozalanadi (Attendance/Transaction kabi boshqa modellar butunlay
// tegilmaydi, ular abadiy saqlanadi). transactions.ts'dagi idempotency
// tozalash bilan bir xil oddiy setInterval pattern'i (alohida cron
// kutubxonasi ataylab qo'shilmagan).
const GPS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 kun
async function cleanupOldGps() {
  try {
    const cutoff = new Date(Date.now() - GPS_RETENTION_MS);
    const r = await GpsLocation.deleteMany({ timestamp: { $lt: cutoff } });
    if (r.deletedCount) console.log(`[gps cleanup] ${r.deletedCount} ta 30 kundan eski GPS yozuvi o'chirildi`);
  } catch (err) {
    console.error('[gps cleanup]', err);
  }
}
setInterval(() => cleanupOldGps(), 24 * 60 * 60 * 1000); // har kuni bir marta
cleanupOldGps().catch(() => {}); // server ishga tushganda ham darhol (avvalgi to'xtash davridagilarni ham tozalash uchun)

// GET /api/gps/config — frontend'ning GPS sozlamalarini serverdan boshqarish
// (env orqali) — kod o'zgartirmasdan, deploy qilmasdan sozlash uchun.
// Klient (useGeoTracker) shu asosiy intervalni batareya/harakatga qarab
// MOSLASHTIRADI (harakatda tezroq, turganda/batareya kam bo'lsa sekinroq).
router.get('/config', (_req, res) => {
  res.json({
    intervalMs: Number(process.env.GPS_INTERVAL_MS) || 60_000,
    minIntervalMs: 20_000,
    maxIntervalMs: 10 * 60_000,
    lowBatteryPercent: 20,
    criticalBatteryPercent: 10,
    goodAccuracyM: 30,
  });
});

const num = (v: any, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

// Klient yuborgan nuqtani tekshirib, saqlashga tayyor obyekt qaytaradi.
// Klient vaqti (offline navbatdan keyin yuborilgan eski nuqtalar uchun)
// faqat oxirgi 24 soat ichida va kelajakda emas bo'lsa qabul qilinadi.
function sanitizePoint(b: any): any | null {
  const lat = num(b?.lat, -90, 90), lng = num(b?.lng, -180, 180);
  if (lat === undefined || lng === undefined) return null;
  let timestamp = new Date();
  if (b?.timestamp) {
    const t = new Date(b.timestamp).getTime();
    if (Number.isFinite(t) && t <= Date.now() + 2 * 60_000 && t >= Date.now() - 24 * 60 * 60_000) timestamp = new Date(t);
  }
  const network = typeof b?.network === 'string' ? b.network.slice(0, 16) : undefined;
  return {
    lat, lng, timestamp, network,
    accuracy: num(b?.accuracy, 0, 100_000),
    speed: num(b?.speed, 0, 200),
    heading: num(b?.heading, 0, 360),
    altitude: num(b?.altitude, -1000, 20_000),
    battery: num(b?.battery, 0, 100),
    charging: typeof b?.charging === 'boolean' ? b.charging : undefined,
    projectId: typeof b?.projectId === 'string' ? b.projectId : undefined,
  };
}

// POST /api/gps — GPS koordinata saqlash
router.post('/', requireFeature('gps_tracking'), async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const pt = sanitizePoint(req.body);
    if (!pt) return res.status(400).json({ error: "lat va lng (to'g'ri qiymatda) talab etiladi" });

    const loc = new GpsLocation(stamped({ userId: tenant.userId, ...pt, source: 'site' }));
    await loc.save();

    // MUHIM: avval BARCHA ulangan foydalanuvchilarga (boshqa firmalarga ham)
    // global broadcast qilinardi — endi faqat SHU firma xonasiga.
    const payload = {
      userId: tenant.userId, companyId: tenant.companyId, lat: pt.lat, lng: pt.lng, accuracy: pt.accuracy,
      speed: pt.speed, heading: pt.heading, battery: pt.battery, charging: pt.charging, network: pt.network,
      timestamp: loc.timestamp, projectId: pt.projectId, source: 'site' as const,
    };
    emitToCompany(tenant.companyId, 'gps:update', payload);

    res.json({ ok: true, id: loc._id });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// POST /api/gps/batch — offline (internet yo'q) paytda yig'ilgan nuqtalarni
// bir yo'la yuborish. Faqat eng oxirgisi jonli (socket) yangilanish beradi.
router.post('/batch', requireFeature('gps_tracking'), async (req, res) => {
  try {
    const tenant = getTenant();
    if (!tenant?.userId) return res.status(401).json({ error: 'Autentifikatsiya talab etiladi' });
    const raw: any[] = Array.isArray(req.body?.points) ? req.body.points.slice(0, 200) : [];
    const pts = raw.map(sanitizePoint).filter(Boolean).sort((a, b) => +a.timestamp - +b.timestamp);
    if (!pts.length) return res.status(400).json({ error: "Nuqtalar yo'q" });
    const docs = await GpsLocation.insertMany(pts.map(pt => stamped({ userId: tenant.userId, ...pt, source: 'site' as const })));
    const last: any = docs[docs.length - 1];
    emitToCompany(tenant.companyId, 'gps:update', {
      userId: tenant.userId, companyId: tenant.companyId, lat: last.lat, lng: last.lng, accuracy: last.accuracy,
      speed: last.speed, heading: last.heading, battery: last.battery, charging: last.charging, network: last.network,
      timestamp: last.timestamp, source: 'site' as const,
    });
    res.json({ ok: true, saved: docs.length });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// GET /api/gps/latest — kompaniya xodimlarining so'nggi joylashuvi
// XAVFSIZLIK — QATTIQLASHTIRISH (audit): faqat rahbariyat (direktor/
// orinbosar/dasturchi) ko'rishi kerak degan aniq talab — scoped() firma
// chegarasini to'g'ri saqlaydi, lekin rol tekshiruvi yo'q edi, ya'ni oddiy
// ishchi ham to'g'ridan-to'g'ri so'rov bilan BARCHA hamkasblarining
// joriy joylashuvini ko'rishi mumkin edi.
router.get('/latest', requireFeature('gps_tracking'), async (req, res) => {
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
// `from`/`to` (ISO sana-vaqt) — "Kuzatuv" sahifasidagi xodim profilida
// tanlangan KUN uchun to'liq GPS izini (trail) olish uchun qo'shildi.
// Berilmasa — eski xatti-harakat (oxirgi N nuqta) saqlanadi.
router.get('/user/:id', requireFeature('gps_tracking'), async (req, res) => {
  try {
    const tenant = getTenant();
    const isSelf = String(req.params.id) === String(tenant?.userId);
    const isBoss = tenant?.isDeveloper || tenant?.role === 'direktor' || tenant?.role === 'orinbosar';
    if (!isSelf && !isBoss) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    const { limit = '20', from, to } = req.query as Record<string, string>;
    const filter: any = { userId: req.params.id, ...scoped() };
    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to) filter.timestamp.$lte = new Date(to);
    }
    // Sana oralig'i so'ralganda — butun kunni ko'rish uchun standart 20
    // yetarli emas (60s intervalda kuniga ~1440 nuqtagacha bo'lishi mumkin),
    // shu sabab shunday holatda balandroq shift (2000) qo'llaniladi.
    const effectiveLimit = from || to ? Math.min(parseInt(limit) || 2000, 2000) : parseInt(limit) || 20;
    const locations = await GpsLocation.find(filter)
      .sort({ timestamp: (from || to) ? 1 : -1 }).limit(effectiveLimit);
    res.json(locations);
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

// GET /api/gps/user/:id/summary?from&to — tanlangan davr uchun xulosa: nuqtalar
// soni, bosib o'tilgan masofa, o'rtacha/eng yaxshi aniqlik, batareya, tezlik.
// (faqat rahbariyat yoki o'zi). Masofa hisobida aniqligi yomon (>200m) nuqtalar
// va fizik jihatdan mumkin bo'lmagan sakrashlar (>150 km/soat) o'tkazib yuboriladi.
const haversineM = (a: any, b: any) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
router.get('/user/:id/summary', requireFeature('gps_tracking'), async (req, res) => {
  try {
    const tenant = getTenant();
    const isSelf = String(req.params.id) === String(tenant?.userId);
    const isBoss = tenant?.isDeveloper || tenant?.role === 'direktor' || tenant?.role === 'orinbosar';
    if (!isSelf && !isBoss) return res.status(403).json({ error: "Ruxsat yo'q" });
    const { from, to } = req.query as Record<string, string>;
    const filter: any = { userId: req.params.id, ...scoped() };
    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to) filter.timestamp.$lte = new Date(to);
    }
    const pts: any[] = await GpsLocation.find(filter).sort({ timestamp: 1 }).limit(5000).lean();
    let distanceM = 0, prev: any = null, maxSpeed = 0, accSum = 0, accN = 0, bestAcc: number | undefined;
    let minBattery: number | undefined, lastBattery: number | undefined, lastCharging: boolean | undefined;
    for (const p of pts) {
      if (p.accuracy != null) { accSum += p.accuracy; accN++; bestAcc = bestAcc == null ? p.accuracy : Math.min(bestAcc, p.accuracy); }
      if (p.battery != null) { minBattery = minBattery == null ? p.battery : Math.min(minBattery, p.battery); lastBattery = p.battery; lastCharging = p.charging; }
      if (p.speed != null) maxSpeed = Math.max(maxSpeed, p.speed);
      if ((p.accuracy ?? 0) > 200) continue;
      if (prev) {
        const d = haversineM(prev, p);
        const dt = (+new Date(p.timestamp) - +new Date(prev.timestamp)) / 1000;
        const jitter = Math.max(15, ((prev.accuracy ?? 0) + (p.accuracy ?? 0)) / 2);
        if (d > jitter && dt > 0 && d / dt < 42) distanceM += d; // 42 m/s = ~150 km/soat
      }
      prev = p;
    }
    res.json({
      points: pts.length, distanceM: Math.round(distanceM),
      avgAccuracy: accN ? Math.round(accSum / accN) : null, bestAccuracy: bestAcc != null ? Math.round(bestAcc) : null,
      maxSpeedKmh: maxSpeed ? Math.round(maxSpeed * 3.6) : null,
      minBattery: minBattery != null ? Math.round(minBattery) : null,
      lastBattery: lastBattery != null ? Math.round(lastBattery) : null, lastCharging,
      firstAt: pts[0]?.timestamp || null, lastAt: pts[pts.length - 1]?.timestamp || null,
    });
  } catch { res.status(500).json({ error: 'Server xatoligi' }); }
});

export default router;
