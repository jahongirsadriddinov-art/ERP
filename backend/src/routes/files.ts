import { Router } from 'express';
import { Readable } from 'stream';

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
    // MUHIM: video/ovoz elementlari (<video>/<audio>) brauzerda ISHLASHI
    // uchun HTTP Range so'rovlari (qisman yuklab olish, "206 Partial
    // Content") qo'llab-quvvatlanishi SHART — aks holda ko'pchilik
    // brauzer/WebView "oldindan ko'rish" yoki hatto ijro etishning O'ZINI
    // butunlay rad etadi (jimgina, xatosiz — aynan shu "ovozli xabar
    // umuman eshitilmaydi, video ochilmaydi" muammosiga sabab bo'lgan).
    // Kiruvchi so'rovdagi Range sarlavhasini ANIQ Cloudinary'ga uzatamiz
    // va uning javobini (status + sarlavhalar) o'zgarishsiz qaytaramiz.
    const upstreamHeaders: Record<string, string> = {};
    const range = req.headers.range;
    if (range) upstreamHeaders['Range'] = range;

    const upstream = await fetch(parsed.toString(), { headers: upstreamHeaders });
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).json({ error: 'Manba fayl olinmadi' });
    }

    res.status(upstream.status); // 200 yoki 206 (Range so'ralgan bo'lsa)

    // filename/type — APK/EXE kabi Cloudinary rad etadigan kengaytmali
    // fayllar U YERDA ZARARSIZ ".bin" nomi bilan saqlanadi (cloudinary.ts,
    // RISKY_EXTS), shu sabab bu yerda ANIQ berilgan bo'lsa, HAQIQIY
    // nom/turi bilan almashtiramiz — foydalanuvchi/Android/Windows uchun
    // fayl to'g'ri tanilishi uchun.
    const overrideFilename = typeof req.query.filename === 'string' ? req.query.filename : null;
    const overrideType = typeof req.query.type === 'string' ? req.query.type : null;

    res.setHeader('Content-Type', overrideType || upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (overrideFilename) {
      res.setHeader('Content-Disposition', `attachment; filename="${overrideFilename.replace(/["\r\n]/g, '_')}"`);
    } else {
      const cd = upstream.headers.get('content-disposition');
      if (cd) res.setHeader('Content-Disposition', cd);
    }
    // Fayl kontenti hech qachon o'zgarmaydi (Cloudinary public_id'lari
    // barqaror/overwrite bo'lgan holatlarda ham brauzer keshi 1 kunlik
    // "yangi tekshirish" bilan yetarli — uzoqroq immutable qilinmaydi,
    // chunki "QurilishERP-latest.apk" kabi ATAYLAB QAYTA YOZILADIGAN
    // manzillar bor, ular uchun immutable NOTO'G'RI bo'lardi.
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // Butun faylni xotiraga bufferlash o'rniga OQIM (stream) sifatida
    // uzatamiz — katta video fayllarda ancha tezroq va xotira tejamli.
    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (err) {
    console.error('[files/proxy]', err);
    if (!res.headersSent) res.status(502).json({ error: 'Manba fayl olib bo\'lmadi' });
  }
});

export default router;
