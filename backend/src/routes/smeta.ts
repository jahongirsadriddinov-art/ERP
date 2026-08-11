// ─── Smeta parse endpoint (deterministik, AI'siz) ────────────────────────────
import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { parseSmeta } from '../smeta';
import ObjectModel from '../models/Object';
import { scoped } from '../middleware/scope';

const router = Router();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

// Qo'llab-quvvatlanadigan kengaytmalar
const ALLOWED_EXTS = new Set(['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.csv', '.txt']);

function extOf(name: string): string {
  return path.extname(name || '').toLowerCase();
}

// POST /api/smeta/parse — multipart (maydon: "smeta") → ParseResult JSON
router.post('/parse', upload.single('smeta'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Fayl yuklanmadi (maydon: smeta)' });

  const ext = extOf(file.originalname);
  if (!ALLOWED_EXTS.has(ext)) {
    fs.unlink(file.path, () => {});
    return res.status(400).json({
      error: `Fayl formati qo'llab-quvvatlanmaydi: ${ext || '(kengaytma yo\'q)'}. Ruxsat etilganlar: PDF, Excel (.xlsx/.xls), Word (.docx/.doc), CSV, TXT`,
    });
  }

  try {
    const buf = fs.readFileSync(file.path);
    const result = await parseSmeta(buf, file.originalname || 'smeta.pdf');

    const objectId = req.body.objectId as string | undefined;
    if (objectId && result.resources?.length) {
      await ObjectModel.findOneAndUpdate(
        scoped({ _id: objectId }),
        {
          smeta: result,
          smetaFileUrl: file.originalname,
          ...(result.meta?.totalWithoutVat ? { budget: result.meta.totalWithoutVat } : {}),
        }
      );
    }
    return res.json(result);
  } catch (err) {
    console.error('[smeta] parse xatosi:', err);
    return res.status(500).json({ error: 'Parse xatosi: ' + (err as Error).message });
  } finally {
    fs.unlink(file.path, () => {});
  }
});

export default router;
