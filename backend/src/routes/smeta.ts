// ─── Smeta parse endpoint (deterministik, AI'siz) ────────────────────────────
import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import { parseSmeta } from '../smeta';

const router = Router();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/smeta/parse — multipart (maydon: "smeta") → ParseResult JSON
router.post('/parse', upload.single('smeta'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Fayl yuklanmadi (maydon: smeta)' });

  const ext = (file.originalname || '').split('.').pop()?.toLowerCase();
  if (ext !== 'pdf' && file.mimetype !== 'application/pdf') {
    fs.unlink(file.path, () => {});
    return res.status(400).json({ error: 'Faqat PDF qo\'llab-quvvatlanadi (deterministik parser)' });
  }

  try {
    const buf = fs.readFileSync(file.path);
    const result = await parseSmeta(buf, file.originalname || 'smeta.pdf');
    // ok:false bo'lsa ham natijани qaytaramiz — foydalanuvchi xatolarni ko'rsin.
    // ERP bazasiga yozishni frontend validation.ok bo'yicha hal qiladi.
    return res.json(result);
  } catch (err) {
    console.error('[smeta] parse xatosi:', err);
    return res.status(500).json({ error: 'Parse xatosi: ' + (err as Error).message });
  } finally {
    fs.unlink(file.path, () => {}); // vaqtinchalik faylni tozalash
  }
});

export default router;
