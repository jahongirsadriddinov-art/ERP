import { Router } from 'express';
import ObjectModel from '../models/Object';
import ProjectMedia from '../models/ProjectMedia';
import Material from '../models/Material';
import { checkRate } from '../utils/rateLimit';

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
    const progressPercent = totalNeeded > 0 ? Math.min(100, Math.round((totalSent / totalNeeded) * 100)) : 0;

    res.json({
      name: obj.name,
      location: obj.location,
      status: obj.status,
      progressPercent,
      media: media.map(m => ({ type: m.type, url: m.url, caption: m.caption, createdAt: m.createdAt })),
    });
  } catch (err) {
    console.error('[publicClient]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
