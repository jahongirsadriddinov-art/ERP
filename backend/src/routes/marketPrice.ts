import { Router } from 'express';
import Transaction from '../models/Transaction';
import AppSettings from '../models/AppSettings';
import { lookupPrice, compare, recordPoint } from '../services/marketPrice';
import { collectFromChannels, getChannels } from '../services/priceChannels';

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

// ── Narx manbalari: Telegram ochiq kanallari (BETA, faqat dasturchi) ──
// Hech qanday Telegram akkaunti ishlatilmaydi — t.me/s/<kanal> ochiq sahifasi
// o'qiladi, shuning uchun AI akkauntlariga mutlaqo xavf yo'q.

router.get('/channels', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  res.set('Cache-Control', 'no-store');
  res.json({ channels: await getChannels() });
});

router.put('/channels', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  const list = Array.isArray(req.body?.channels) ? req.body.channels : null;
  if (!list) return res.status(400).json({ error: "channels ro'yxati kerak" });
  const clean = [...new Set(list
    .map((c: unknown) => String(c).replace(/^@/, '').trim())
    .filter((c: string) => /^[A-Za-z0-9_]{4,32}$/.test(c)))].slice(0, 30);
  await AppSettings.updateOne({ key: 'global' }, { $set: { priceChannels: clean } }, { upsert: true });
  res.json({ ok: true, channels: clean });
});

/** Hoziroq yig'ish (odatda o'zi 6 soatda bir ishlaydi). */
router.post('/collect', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  try {
    res.json(await collectFromChannels());
  } catch (err) {
    console.error("[marketPrice] yig'ish xatosi:", err);
    res.status(500).json({ error: "Yig'ib bo'lmadi" });
  }
});

/** Ob-havo ogohlantirishini HOZIR sinab ko'rish (odatda har kuni 18:00 da). Faqat dasturchi. */
router.post('/weather-test', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  try {
    const { runWeatherAlerts } = await import('../aiVoice/scheduler/weatherJob');
    res.json(await runWeatherAlerts(new Date(), { force: true }));
  } catch (err) {
    console.error('[ob-havo] sinov xatosi:', err);
    res.status(500).json({ error: "Sinab bo'lmadi" });
  }
});

export default router;
