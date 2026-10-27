// ─── Smeta parse endpoint (deterministik, AI'siz) ────────────────────────────
import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { parseSmeta } from '../smeta';
import ObjectModel from '../models/Object';
import { aiSmetaFallback } from '../smeta/aiFallback';
import { scoped } from '../middleware/scope';
import { captureError } from '../services/errorTracker';
import { takeSmetaDiag } from '../smeta/excelTable';
import { getTenant } from '../middleware/tenantContext';

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
    let result = await parseSmeta(buf, file.originalname || 'smeta.pdf');
    // Deterministik yo'l hech narsa topmadi (skanerlangan PDF, notanish jadval) — AI zaxirasi (Gemini) bilan urinamiz
    if (!result.resources?.length && ['.pdf', '.docx', '.xlsx', '.xls'].includes(ext)) {
      const ai = await aiSmetaFallback(file.path, file.mimetype, ext, file.originalname || 'smeta').catch(() => null);
      if (ai) result = ai;
    }

    // XAVFSIZLIK (audit 2026-10-19): obyekt smetasi/byudjetini faqat rahbar yoki o'sha obyekt prorabi yangilaydi;
    // objectId — faqat ObjectId satri (multipart tanasi global $-tozalagichdan o'tmaydi)
    const rawObj = req.body?.objectId;
    const objectId = typeof rawObj === 'string' && /^[a-f0-9]{24}$/i.test(rawObj) ? rawObj : undefined;
    const t = getTenant();
    const boss = !!t?.isDeveloper || ['direktor', 'orinbosar'].includes(String(t?.role));
    const canWrite = !!objectId && (boss || !!(await ObjectModel.exists(scoped({ _id: objectId, foremanId: String(t?.userId || '') })).catch(() => null)));
    if (objectId && !canWrite) return res.status(403).json({ error: "Bu obyekt smetasini o'zgartirishga ruxsat yo'q" });
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
    // Owner 2026-10-27: "smeta o'qiyotganda xatolik bo'lsa yoki nimadir o'qilmay qolsa — dasturchiga
    // xabar borsin: qayerda, nima xatolik". Faqat haqiqiy muammo bo'lsa yuboriladi.
    try {
      const diag = takeSmetaDiag();
      const rows = result.resources?.length || 0;
      const noPrice = (result.resources || []).filter((r: any) => r.price === null).length;
      const emptySheets = diag.filter((d) => !d.parsed).map((d) => d.sheet);
      const priceShare = rows ? noPrice / rows : 0;
      if (!rows || emptySheets.length || priceShare > 0.5) {
        const lines = diag.map((d) =>
          `${d.sheet}: ${d.parsed}/${d.rows} qator, sarlavha ${d.header ?? '—'}, ustunlar ${JSON.stringify(d.cols)}, narxsiz ${d.noPrice}, summasiz ${d.noTotal} (${d.note})`);
        await captureError({
          source: 'server',
          kind: 'smeta-parse',
          message: !rows
            ? `Smeta o'qilmadi: "${file.originalname}" — birorta qator chiqmadi`
            : `Smeta to'liq o'qilmadi: "${file.originalname}" — ${rows} qator, ${noPrice} tasida narx yo'q${emptySheets.length ? `, o'qilmagan varaqlar: ${emptySheets.join(', ')}` : ''}`,
          stack: lines.join('\n'),
          route: '/api/smeta/parse',
          method: 'POST',
          action: `fayl ${(file.size / 1024).toFixed(0)} KB, ${ext}`,
          companyId: String(t?.companyId || ''),
          userId: String(t?.userId || ''),
          role: String(t?.role || ''),
        });
      }
    } catch { /* tashxis xabari yuborilmasa ham, javob beriladi */ }
    return res.json(result);
  } catch (err) {
    console.error('[smeta] parse xatosi:', err);
    void captureError({
      source: 'server', kind: 'smeta-parse',
      message: `Smeta o'qishda xato: "${file.originalname}" — ${(err as Error)?.message || err}`,
      stack: (err as Error)?.stack, route: '/api/smeta/parse', method: 'POST', status: 500,
      action: `fayl ${(file.size / 1024).toFixed(0)} KB, ${ext}`,
    }).catch(() => {});
    return res.status(500).json({ error: "Faylni tahlil qilishda xatolik yuz berdi. Fayl formatini tekshirib qayta urining." });
  } finally {
    fs.unlink(file.path, () => {});
  }
});

export default router;
