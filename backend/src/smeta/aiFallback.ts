// ─── AI zaxirasi (owner 2026-10-19: "smetani kuchaytir") ─────────────────────────────────────────────────────
// Deterministik parser hech narsa topmasa (skanerlangan PDF, notanish jadval shakli) — mavjud Gemini o'quvchisi
// (services/smetaParser.ts) bilan materiallar ro'yxati olinadi. Natija "AI orqali o'qildi — tekshiring" ogohlantirishi
// bilan qaytadi: rahbar saqlashdan oldin ko'rib chiqadi.
import path from 'path';
import fs from 'fs';
import { parseSmeta as aiParse } from '../services/smetaParser';
import { applyCategories } from './categorize';
import { groupOf } from './excelTable';
import type { ParseResult, ResourceRow } from './types';

export async function aiSmetaFallback(filePath: string, mimetype: string, ext: string, filename: string): Promise<ParseResult | null> {
  // services/smetaParser kengaytmani fayl nomidan aniqlaydi — multer vaqtinchalik faylida kengaytma yo'q
  const withExt = `${filePath}${ext}`;
  try { fs.copyFileSync(filePath, withExt); } catch { return null; }
  try {
    const items = await aiParse(withExt, mimetype);
    if (!items.length) return null;
    const resources: ResourceRow[] = items.slice(0, 2000).map((m, i) => {
      const qty = Number(m.quantity) || 0;
      const price = typeof m.price === 'number' && Number.isFinite(m.price) ? m.price : null;
      return {
        index: i + 1, shifr: m.code || null, shifrNote: null,
        rawName: String(m.name || '').slice(0, 300), shortName: String(m.name || '').split(' ').slice(0, 4).join(' '),
        spec: null, unit: String(m.unit || ''), qty, price, total: price !== null ? Math.round(qty * price) : null,
        group: groupOf(String(m.unit || ''), '', String(m.name || '')),
        rawLine: '', warnings: ['AI orqali o\'qildi'],
      };
    }).filter((r) => r.rawName && r.qty > 0);
    if (!resources.length) return null;
    applyCategories(resources);
    const total = Math.round(resources.reduce((s, r) => s + (r.total ?? 0), 0));
    return {
      meta: {
        objectName: null, subObject: null, organization: null,
        totalWithVat: null, totalWithoutVat: total || null, vatAmount: null,
        currency: 'UZS', sourceFile: path.basename(filename), parsedAt: new Date().toISOString(),
      },
      resources, works: [],
      totals: [{ group: 'Jami (AI)', declared: 0, computed: total, diff: 0, passed: true }],
      validation: { ok: true, checks: [], warnings: ["Smeta AI orqali o'qildi — miqdor va narxlarni saqlashdan oldin tekshiring"], errors: [] },
    };
  } finally {
    fs.unlink(withExt, () => {});
  }
}
