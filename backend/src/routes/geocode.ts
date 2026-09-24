import { Router } from 'express';
import { checkRate } from '../utils/rateLimit';

const router = Router();

// Manzil qidiruvi/aniqlash — OpenStreetMap Nominatim (bepul, API kalit
// SHART EMAS) orqali. Frontend'dan TO'G'RIDAN-TO'G'RI chaqirilmaydi —
// bu yerda proksi qilinishining sabablari: (1) Nominatim'ning foydalanish
// qoidasi HAQIQIY User-Agent talab qiladi (brauzerdan yuborilgan so'rov
// buni kafolatlay olmaydi), (2) so'rovlar chastotasini (1/soniya)
// serverimiz tomonidan cheklashimiz osonroq, (3) kalitsiz tashqi xizmatga
// to'g'ridan-to'g'ri chaqiruvni ochiq qoldirish o'rniga bitta joyda
// nazorat qilinadi.
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'QurilishERP/1.0 (https://qurilisherp.uz)';

// GET /api/geocode/search?q=... — yozayotganda manzil takliflari.
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.json([]);
    const rl = checkRate('geocode:search', 1, 1100); // Nominatim qoidasi: max 1/s
    if (!rl.allowed) return res.json([]);

    const url = `${NOMINATIM_BASE}/search?format=json&addressdetails=0&limit=5&accept-language=uz,ru&countrycodes=uz&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!r.ok) return res.json([]);
    const data = await r.json() as Array<{ display_name: string; lat: string; lon: string }>;
    res.json(data.map(d => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) })));
  } catch (err) {
    console.error('[geocode/search]', err);
    res.json([]);
  }
});

// GET /api/geocode/reverse?lat=..&lng=.. — "joriy joylashuvni aniqlash"
// tugmasi uchun — koordinatani o'qiladigan manzilga aylantiradi.
router.get('/reverse', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "Noto'g'ri koordinata" });
    const rl = checkRate('geocode:reverse', 1, 1100);
    if (!rl.allowed) return res.status(429).json({ error: "Juda ko'p so'rov, biroz kuting" });

    const url = `${NOMINATIM_BASE}/reverse?format=json&accept-language=uz,ru&lat=${lat}&lon=${lng}`;
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!r.ok) return res.status(502).json({ error: 'Manzilni aniqlab bo\'lmadi' });
    const data = await r.json() as { display_name?: string };
    if (!data.display_name) return res.status(404).json({ error: 'Manzil topilmadi' });
    res.json({ label: data.display_name, lat, lng });
  } catch (err) {
    console.error('[geocode/reverse]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export default router;
