import { Router } from 'express';

const router = Router();

// GET /api/avatars/dicebear/:seed.svg — "Avataaars" (DiceBear, MIT litsenziya,
// Apple Memoji'ga eng yaqin bepul uslub) avatarini SEED'dan deterministik
// generatsiya qilib qaytaradi. Tashqi to'lov/API kalit kerak emas — SVG shu
// yerning o'zida (serverda) chiziladi. Natija FAQAT seed'ga bog'liq (bir xil
// seed — doim bir xil rasm), shuning uchun uzoq keshlanadi.
//
// Nega bizning BACKEND domenimizdan: profil avatar URL'i users.ts'dagi
// isAllowedAvatarUrl() orqali faqat Cloudinary yoki shu backend hostiga
// ruxsat beradi — boshqa (masalan api.dicebear.com) domendan to'g'ridan-to'g'ri
// link saqlab bo'lmaydi.
const SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;

// @dicebear/core va @dicebear/collection faqat ESM (type: module) qilib
// chiqarilgan — bu backend esa CommonJS, shuning uchun statik import emas,
// dinamik import() orqali (bir marta) yuklab, keyingi so'rovlar uchun
// keshlab qo'yiladi.
let dicebearPromise: Promise<{ createAvatar: any; avataaars: any }> | null = null;
function loadDicebear() {
  if (!dicebearPromise) {
    dicebearPromise = Promise.all([
      import('@dicebear/core'),
      import('@dicebear/collection'),
    ]).then(([core, collection]) => ({ createAvatar: core.createAvatar, avataaars: collection.avataaars }));
  }
  return dicebearPromise;
}

router.get('/dicebear/:seed.svg', async (req, res) => {
  const seed = req.params.seed;
  if (!SEED_RE.test(seed)) return res.status(400).json({ error: "Noto'g'ri seed" });
  try {
    const { createAvatar, avataaars } = await loadDicebear();
    const avatar = createAvatar(avataaars, { seed });
    const svg = avatar.toString();
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    // Deterministik (seed -> bir xil rasm) — uzoq va "immutable" kesh xavfsiz.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(svg);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Avatar generatsiya qilib bo\'lmadi' });
  }
});

export default router;
