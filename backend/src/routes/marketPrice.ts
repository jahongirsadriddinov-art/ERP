import { Router } from 'express';
import { currentCompanyId } from '../middleware/tenantContext';
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
//
// TOPILMASA (owner 2026-10-29: "AI hohlagan narsani hohlagan vaqtda qidirsin"): javob
// darhol "topilmadi" deb qaytadi, lekin FONDA shu so'z bo'yicha OLX'dan izlash
// boshlanadi. Shunda ikkinchi marta qidirilganda ma'lumot bo'ladi. Foydalanuvchi
// kutib turmaydi — javob tezligi o'zgarmaydi.
const router = Router();

/** Bir so'z bo'yicha fonda izlash shu muddatda bir martadan ko'p boshlanmaydi. */
const LOOKUP_COOLDOWN_MS = 6 * 3600_000;
const lookedUp = new Map<string, number>();

function startBackgroundLookup(q: string): boolean {
  const key = q.toLowerCase();
  const last = lookedUp.get(key) || 0;
  if (Date.now() - last < LOOKUP_COOLDOWN_MS) return false;
  lookedUp.set(key, Date.now());
  // Xotira cheklanadi — eng eski yozuvlar tashlab ketiladi
  if (lookedUp.size > 500) for (const k of [...lookedUp.keys()].slice(0, 200)) lookedUp.delete(k);
  void import('../services/priceOlx')
    .then((m) => m.collectOlxQuery(q))
    .then((n) => { if (n) console.log(`[narx/olx] "${q}" bo'yicha ${n} ta narx qo'shildi`); })
    .catch(() => undefined);
  return true;
}

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=120');
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.status(400).json({ error: 'Qidiruv so\'zi kaltaroq' });
    const unit = typeof req.query.unit === 'string' ? req.query.unit : undefined;
    const region = typeof req.query.region === 'string' ? req.query.region.slice(0, 60) : undefined;
    const companyId = String(currentCompanyId() || '');
    const stats = await lookupPrice(q, unit, { ...(region ? { region } : {}), ...(companyId ? { companyId } : {}) });
    if (!stats) return res.json({ found: false, query: q, searching: startBackgroundLookup(q) });

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
      ownOnly: !!stats.ownOnly,
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

/**
 * Indeks holati (dasturchi) — "nega qidiruvda hech nima chiqmayapti?" degan
 * savolga ANIQ javob: indeksda nechta narx bor, qaysi manbadan, oxirgisi
 * qachon kelgan, nechta kanal ulangan. Taxmin qilish shart emas.
 */
router.get('/status', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  res.set('Cache-Control', 'no-store');
  try {
    const MarketPrice = (await import('../models/MarketPrice')).default;
    const [total, bySource, newest, channels] = await Promise.all([
      MarketPrice.estimatedDocumentCount(),
      MarketPrice.aggregate([{ $group: { _id: '$source', n: { $sum: 1 } } }]).catch(() => []),
      MarketPrice.findOne().sort({ at: -1 }).select('at name').lean().catch(() => null),
      getChannels(),
    ]) as any[];
    const fresh = await MarketPrice.countDocuments({ at: { $gte: new Date(Date.now() - 7 * 86400_000) } }).catch(() => 0);
    res.json({
      total,
      last7days: fresh,
      bySource: Object.fromEntries((bySource || []).map((r: any) => [String(r._id || 'nomalum'), r.n])),
      newestAt: newest?.at || null,
      channels,
      sites: await (await import('../services/priceSites')).getSites().catch(() => []),
      // Qidiruv xulosa berishi uchun kerak bo'lgan eng kam shart — panelda ko'rsatiladi
      needs: { minPoints: 4, minCompanies: 2, windowDays: 45 },
    });
  } catch (err) {
    console.error('[marketPrice] holat xatosi:', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

/**
 * Kanal nomzodlarini topish: AI Google orqali qidiradi, keyin HAR BIRI shu
 * yerda sinab ko'riladi (sahifasi o'qiladi, narx chiqadimi sanaladi).
 * Ro'yxatga qo'shish — alohida qadam (PUT /channels), ya'ni qaror adminniki.
 */
router.post('/channels/suggest', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  try {
    const { suggestChannels, workingOnes } = await import('../services/priceSourceFinder');
    const r = await suggestChannels({ query: typeof req.body?.query === 'string' ? req.body.query : undefined });
    res.json({ ...r, working: workingOnes(r) });
  } catch (err) {
    console.error('[marketPrice] nomzod qidirish xatosi:', err);
    res.status(500).json({ error: "Qidirib bo'lmadi" });
  }
});

/** Bitta kanalni qo'lda sinab ko'rish — qo'shishdan oldin "ishlaydimi?" degan savolga javob. */
router.post('/channels/probe', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  try {
    const { probeChannel } = await import('../services/priceSourceFinder');
    res.json(await probeChannel(String(req.body?.channel || '')));
  } catch (err) {
    res.status(500).json({ error: "Sinab bo'lmadi" });
  }
});

// ── Narx manbalari: SAYTLAR (owner 2026-10-30: "faqat tg kanal emas, saytlar ham") ──

router.get('/sites', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  res.set('Cache-Control', 'no-store');
  const { getSites } = await import('../services/priceSites');
  res.json({ sites: await getSites() });
});

router.put('/sites', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  if (!Array.isArray(req.body?.sites)) return res.status(400).json({ error: "sites ro'yxati kerak" });
  const { setSites } = await import('../services/priceSites');
  res.json({ ok: true, sites: await setSites(req.body.sites) });
});

/** Saytni qo'shishdan OLDIN sinab ko'rish: ochiladimi va nechta narx chiqadi. */
router.post('/sites/probe', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  const { probeSite } = await import('../services/priceSites');
  res.json(await probeSite(String(req.body?.url || '')));
});

/** Hoziroq yig'ish (odatda o'zi 6 soatda bir ishlaydi) — kanallar va OLX. */
router.post('/collect', async (req, res) => {
  if (!req.user?.isDeveloper) return res.status(403).json({ error: "Ruxsat yo'q" });
  try {
    const { collectFromOlx } = await import('../services/priceOlx');
    const { collectFromSites } = await import('../services/priceSites');
    const [tg, olx, sites] = await Promise.all([collectFromChannels(), collectFromOlx(), collectFromSites()]);
    res.json({ ...tg, olx, sites });
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
