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

// Qidiruv natijalari xotirada 10 daqiqa saqlanadi — bir xil so'z qayta so'ralsa tashqi
// xizmatga bormasdan darhol qaytadi (tezlik + Nominatim/Photon'ni ortiqcha yuklamaslik).
const searchCache = new Map<string, { at: number; data: SearchHit[] }>();
const CACHE_TTL = 10 * 60 * 1000;
type SearchHit = { label: string; lat: number; lng: number };

// Photon (komoot, OpenStreetMap ma'lumoti) — yozayotganda taklif berishga mo'ljallangan, Nominatim'dan
// ancha tez. Toshkent markaziga yaqin natijalar ustuvor; faqat O'zbekiston natijalari qoldiriladi.
async function photonSearch(q: string): Promise<SearchHit[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=15&lat=41.3&lon=69.24&lang=en`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctl.signal });
    if (!r.ok) return [];
    const data = await r.json() as { features?: Array<{ geometry: { coordinates: [number, number] }; properties: any }> };
    const out: SearchHit[] = [];
    const seen = new Set<string>();
    for (const f of data.features || []) {
      const p = f.properties || {};
      if (p.countrycode && String(p.countrycode).toUpperCase() !== 'UZ') continue;
      const street = [p.street, p.housenumber].filter(Boolean).join(' ');
      const parts = [p.name, street && street !== p.name ? street : '', p.district, p.city || p.town || p.village || p.county, p.state]
        .filter((x: any) => typeof x === 'string' && x.trim());
      const label = Array.from(new Set(parts)).join(', ');
      const [lng, lat] = f.geometry.coordinates;
      if (!label || !Number.isFinite(lat) || !Number.isFinite(lng) || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, lat, lng });
      if (out.length >= 8) break;
    }
    return out;
  } catch { return []; }
  finally { clearTimeout(timer); }
}

async function nominatimSearch(q: string): Promise<SearchHit[]> {
  const url = `${NOMINATIM_BASE}/search?format=json&addressdetails=0&limit=8&accept-language=uz,ru&countrycodes=uz&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) return [];
  const data = await r.json() as Array<{ display_name: string; lat: string; lon: string }>;
  return data.map(d => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }));
}

// GET /api/geocode/search?q=... — yozayotganda manzil takliflari.
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (q.length < 2) return res.json([]);
    const key = q.toLowerCase();
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return res.json(hit.data);

    // Har foydalanuvchi (IP) uchun alohida chegara — avval BITTA umumiy chegara edi va bir necha
    // odam bir vaqtda yozsa natijalar bo'sh qolardi.
    const rl = checkRate(`geocode:search:${req.ip}`, 6, 1000);
    if (!rl.allowed) return res.json([]);

    let data = await photonSearch(q);
    if (data.length === 0) {
      const nrl = checkRate('geocode:nominatim', 1, 1100); // Nominatim qoidasi: max 1/s
      if (nrl.allowed) data = await nominatimSearch(q).catch(() => []);
    }
    if (data.length) {
      if (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value as string);
      searchCache.set(key, { at: Date.now(), data });
    }
    res.json(data);
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
