import { Router } from 'express';
import ObjectModel from '../models/Object';
import ProjectMedia from '../models/ProjectMedia';
import Material from '../models/Material';
import { checkRate } from '../utils/rateLimit';
import Equipment from '../models/Equipment';
import EquipmentLog from '../models/EquipmentLog';
import { todayInTashkent } from '../utils/tz';
import { computePlanFact } from '../services/planFact';

const router = Router();

// GET /api/public/client-view/:token — mijoz portali. ATAYLAB auth talab
// qilmaydi (mijoz tizim foydalanuvchisi emas) — himoya token'ning o'zi
// (32 bayt tasodifiy, taxmin qilib bo'lmaydigan) orqali ta'minlanadi.
// FAQAT xavfsiz/umumiy ma'lumot qaytariladi — moliyaviy tafsilot
// (byudjet, xarajatlar, xodimlar ro'yxati) UMUMAN yo'q.
router.get('/client-view/:token', async (req, res) => {
  try {
    const ip = (req.ip || '').trim();
    const rl = checkRate(`clientview:${ip}`, 60, 10 * 60 * 1000);
    if (!rl.allowed) return res.status(429).json({ error: "Juda ko'p urinish" });

    const token = req.params.token;
    if (!/^[0-9a-f]{48}$/.test(token)) return res.status(404).json({ error: 'Topilmadi' });

    const obj = await ObjectModel.findOne({ clientShareToken: token }).lean();
    if (!obj) return res.status(404).json({ error: 'Havola yaroqsiz yoki bekor qilingan' });

    const [media, materials] = await Promise.all([
      ProjectMedia.find({ objectId: String(obj._id) }).sort({ createdAt: -1 }).limit(100).select('type url caption createdAt').lean(),
      Material.find({ objectId: obj._id }).select('name unit needed sent').lean(),
    ]);

    // Progress — moliyaviy emas, faqat FIZIK (yetkazilgan/kerakli material
    // nisbati) ko'rsatkich, mijoz uchun tushunarli va xavfsiz.
    const totalNeeded = materials.reduce((s, m) => s + (m.needed || 0), 0);
    const totalSent = materials.reduce((s, m) => s + (m.sent || 0), 0);
    // Plan-fakt bahosi (qo'lda foiz > AI foto-baho > material nisbati) — pulsiz; mijoz uchun tushunarli
    const pf = computePlanFact(obj, materials, { confirmed: 0, pending: 0 });
    const progressPercent = pf.progressSource === 'none'
      ? (totalNeeded > 0 ? Math.min(100, Math.round((totalSent / totalNeeded) * 100)) : 0)
      : Math.round(pf.progressPct);

    res.json({
      name: obj.name,
      location: obj.location,
      status: obj.status,
      progressPercent,
      progressSource: pf.progressSource,
      startDate: pf.startDate,
      endDate: pf.endDate,
      aiNote: (obj as any).progressAi?.note ? String((obj as any).progressAi.note).slice(0, 300) : undefined,
      media: media.map(m => ({ type: m.type, url: m.url, caption: m.caption, createdAt: m.createdAt })),
    });
  } catch (err) {
    console.error('[publicClient]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

// POST|GET /api/public/telemetry/:token — GPS-treker (owner 2026-10-19: "texnika telemetriyasi"). Token — har
// texnikaga alohida, taxmin qilib bo'lmaydigan; faqat joylashuv/motor-soat/yoqilg'i yoziladi, boshqa hech narsa.
const telemetry = async (req: any, res: any) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[0-9a-f]{36}$/.test(token)) return res.status(404).json({ error: 'Topilmadi' });
    const rl = checkRate(`telemetry:${token}`, 120, 60 * 60 * 1000);
    if (!rl.allowed) return res.status(429).json({ error: "Juda ko'p" });
    const eq: any = await Equipment.findOne({ trackerToken: token });
    if (!eq) return res.status(404).json({ error: 'Topilmadi' });
    const src = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    const f = (k: string[]) => { for (const x of k) { const v = Number(src[x]); if (Number.isFinite(v)) return v; } return undefined; };
    const lat = f(['lat', 'latitude']), lng = f(['lon', 'lng', 'longitude']);
    const okCoord = lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const engineHours = f(['engineHours', 'hours_total', 'motohours']);
    const fuel = f(['fuel', 'fuel_used']);
    await EquipmentLog.create({
      companyId: eq.companyId, equipmentId: String(eq._id), objectId: eq.objectId, date: todayInTashkent(),
      ...(okCoord ? { lat, lng } : {}), speed: f(['speed']), engineHours: engineHours !== undefined && engineHours >= 0 ? engineHours : undefined,
      fuel: fuel !== undefined && fuel >= 0 && fuel <= 5000 ? fuel : undefined, source: 'tracker',
    });
    eq.lastSeenAt = new Date();
    if (okCoord) { eq.lastLat = lat; eq.lastLng = lng; }
    if (engineHours !== undefined && engineHours > (eq.engineHours || 0)) eq.engineHours = engineHours;
    await eq.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('[telemetry]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
};
router.post('/telemetry/:token', telemetry);
router.get('/telemetry/:token', telemetry);

export default router;
