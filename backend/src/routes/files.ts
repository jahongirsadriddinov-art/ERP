import { Router } from 'express';

const router = Router();

// GET /api/files/proxy?url=<cloudinary URL> — Cloudinary'ga (yoki istalgan
// tashqi CDN'ga) TO'G'RIDAN-TO'G'RI ulanish ba'zi tarmoqlar/provayderlar
// tomonidan bloklangan/beqaror bo'lishi mumkin (O'zbekistonda xabar
// qilingan aniq muammo). Foydalanuvchi/ilova ALLAQACHON bizning
// backend domenimizga (qurilisherp-backend.onrender.com) ishonch bilan
// ulanadi — shu sabab fayl baytlarini backend O'ZI (server-server, hech
// qanday bloklashga uchramaydi) yuklab, mijozga O'ZIDAN uzatadi. Mijoz
// hech qachon Cloudinary'ga to'g'ridan-to'g'ri so'rov yubormaydi.
//
// XAVFSIZLIK: `url` faqat Cloudinary domenlariga tegishli bo'lishi SHART
// (SSRF oldini olish — aks holda bu backend orqali ichki tarmoq/boshqa
// xizmatlarga so'rov yuborish "proksi" sifatida suiiste'mol qilinishi
// mumkin edi).
const ALLOWED_HOSTS = /(^|\.)res\.cloudinary\.com$/i;

router.get('/proxy', async (req, res) => {
  const raw = req.query.url;
  if (typeof raw !== 'string' || !raw) return res.status(400).json({ error: 'url talab etiladi' });

  let parsed: URL;
  try { parsed = new URL(raw); } catch { return res.status(400).json({ error: "Noto'g'ri URL" }); }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.test(parsed.hostname)) {
    return res.status(400).json({ error: 'Faqat Cloudinary manzillari proksi qilinadi' });
  }

  try {
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).json({ error: 'Manba fayl olinmadi' });
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    const cd = upstream.headers.get('content-disposition');
    if (cd) res.setHeader('Content-Disposition', cd);
    // Fayl kontenti hech qachon o'zgarmaydi (Cloudinary public_id'lari
    // barqaror/overwrite bo'lgan holatlarda ham brauzer keshi 1 kunlik
    // "yangi tekshirish" bilan yetarli — uzoqroq immutable qilinmaydi,
    // chunki "QurilishERP-latest.apk" kabi ATAYLAB QAYTA YOZILADIGAN
    // manzillar bor, ular uchun immutable NOTO'G'RI bo'lardi.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    console.error('[files/proxy]', err);
    res.status(502).json({ error: 'Manba fayl olib bo\'lmadi' });
  }
});

export default router;
