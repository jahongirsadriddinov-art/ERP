import { Router } from 'express';
import Transaction from '../models/Transaction';
import { lookupPrice, compare, recordPoint } from '../services/marketPrice';

// Narx razvedkasi (owner 2026-10-29: "hohlagan narsasini yozadi, uni global O'zbekiston
// bo'yicha qidiradi va o'rtacha narxini ko'rsatadi").
//
//  GET  /api/market-price?q=sement&unit=qop[&price=61000]
//       → o'rtacha (mediana) narx, odatdagi oraliq, nechta kuzatuvdan.
//         price berilsa — qimmat/arzonligi ham hisoblanadi.
//  POST /api/market-price/backfill   (dasturchi) — eski xaridlardan indeksni to'ldirish.
//
// Javob DOIM indeksdan keladi — so'rov paytida hech qayerga chiqilmaydi, shuning uchun tez.
const router = Router();

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=120');
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.status(400).json({ error: 'Qidiruv so\'zi kaltaroq' });
    const unit = typeof req.query.unit === 'string' ? req.query.unit : undefined;
    const region = typeof req.query.region === 'string' ? req.query.region.slice(0, 60) : undefined;
    const stats = await lookupPrice(q, unit, region ? { region } : {});
    if (!stats) return res.json({ found: false, query: q });

    const price = Number(req.query.price);
    const cmp = Number.isFinite(price) && price > 0 ? compare(price, stats) : null;
    res.json({
      found: true,
      query: q,
      name: stats.name,
      unit: stats.unit,
      median: stats.median,
      low: stats.low,
      high: stats.high,
      points: stats.points,
      companies: stats.companies,
      updatedAt: stats.updatedAt,
      ...(cmp ? { yourPrice: Math.round(price), diffPct: cmp.pct, expensive: cmp.expensive } : {}),
    });
  } catch (err) {
    console.error('[marketPrice] qidiruv xatosi:', err);
    res.status(500).json({ error: 'Narxni olib bo\'lmadi' });
  }
});

/** Eski xaridlardan indeksni to'ldirish — bir marta yetadi (takrorlar o'zi tashlab ketiladi). */
router.post('/backfill', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: 'Ruxsat yo\'q' });
  try {
    const since = new Date(Date.now() - 180 * 24 * 3600_000);
    const rows: any[] = await Transaction.find({
      materialName: { $nin: [null, ''] }, unit: { $nin: [null, ''] }, price: { $gt: 0 },
      createdAt: { $gte: since },
    }).select('materialName unit price companyId createdAt').limit(20_000).lean();

    // Takrorni tekshirish SHART EMAS: recordPoint refId bo'yicha upsert qiladi va
    // (source, refId) ustida unique indeks bor — qayta ishga tushirish xavfsiz.
    let added = 0;
    for (const t of rows) {
      await recordPoint({
        name: String(t.materialName), unit: String(t.unit), price: Number(t.price),
        at: t.createdAt ? new Date(t.createdAt) : new Date(),
        source: 'receipt', companyId: String(t.companyId || ''), refId: String(t._id),
      });
      added++;
    }
    res.json({ ok: true, scanned: rows.length, added });
  } catch (err) {
    console.error('[marketPrice] backfill xatosi:', err);
    res.status(500).json({ error: 'Bajarib bo\'lmadi' });
  }
});

export default router;
