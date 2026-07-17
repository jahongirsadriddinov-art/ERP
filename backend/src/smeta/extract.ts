// ─── PDF → matn qatorlari (deterministik, AI'siz) ────────────────────────────
// pdf-parse v2 `getText()` ishlatiladi. Tekshirildi: smeta jadval qatorlari TAB
// (\t) bilan ajratilgan holda chiqadi; `getTable()` esa bo'sh (PDF'da jadval
// chizig'i yo'q). Shuning uchun getText + tab-aware parsing eng ishonchli yo'l.
//
// Tablar ATAYLAB saqlanadi — ular ustun chegarasi. Faqat NBSP/thin-space kabi
// "ko'rinmas" bo'shliqlar oddiy probelga aylantiriladi (raqam tozalash uchun).

import { PDFParse } from 'pdf-parse';
import * as fs from 'fs';
import { ExtractResult, ExtractedLine } from './types';

// "-- 9 of 31 --" — pdf-parse sahifa ajratgichi
const PAGE_MARKER = /^--\s*(\d+)\s+of\s+(\d+)\s*--$/i;

// Ko'rinmas bo'shliqlarni oddiy probelga aylantiramiz (TABGA TEGMAYMIZ):
//   NBSP,   figure,   thin,   narrow-NBSP, ⁠ word-joiner
function normalizeSpaces(s: string): string {
  return s
    .replace(/[    ⁠]/g, ' ')
    .replace(/​/g, ''); // zero-width space
}

function trimEdges(s: string): string {
  // faqat chetdagi probel/tabni olib tashlaymiz; ichki tablar qoladi
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

/**
 * PDF (Buffer yoki fayl yo'li) → strukturalangan qatorlar.
 * Struktura tanilmasa throw QILMAYDI — bo'sh/notekis natija ham qaytariladi.
 * Faqat PDF butunlay o'qib bo'lmasa xato ko'tariladi.
 */
export async function extractText(input: Buffer | string): Promise<ExtractResult> {
  const data: Buffer = typeof input === 'string' ? fs.readFileSync(input) : input;
  const warnings: string[] = [];

  const parser = new PDFParse({ data });
  let text = '';
  let pageCount = 0;
  try {
    const info = await parser.getInfo().catch(() => null as any);
    pageCount = (info && (info.total || info.numPages || info.pages)) || 0;
    const res: any = await parser.getText();
    text = (res && res.text) || '';
    if (!pageCount && res && res.total) pageCount = res.total;
  } finally {
    await parser.destroy().catch(() => {});
  }

  if (!text.trim()) warnings.push('PDF dan matn chiqmadi (skaner yoki matn qatlamsiz bo\'lishi mumkin)');

  const physical = text.split(/\r?\n/);
  const lines: ExtractedLine[] = [];
  let currentPage = 1;
  let seenMarker = false;

  for (const raw of physical) {
    const trimmed = trimEdges(normalizeSpaces(raw));

    const pm = trimmed.match(PAGE_MARKER);
    if (pm) {
      // marker sahifa oxirini bildiradi — keyingi qatorlar N+1 sahifada
      currentPage = parseInt(pm[1], 10) + 1;
      seenMarker = true;
      continue; // markerni kontent sifatida saqlamaymiz
    }

    if (trimmed === '') continue; // bo'sh qatorlarni tashlaymiz

    lines.push({ text: trimmed, page: seenMarker ? currentPage : 1, raw });
  }

  if (!pageCount) pageCount = Math.max(1, ...lines.map(l => l.page));

  return { pageCount, rawText: text, lines, library: 'pdf-parse', warnings };
}

// ─── CLI demo: `ts-node src/smeta/extract.ts <fayl.pdf>` ─────────────────────
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Foydalanish: ts-node src/smeta/extract.ts <fayl.pdf>'); process.exit(1); }
  extractText(file).then(r => {
    console.log(`Kutubxona: ${r.library}`);
    console.log(`Sahifalar: ${r.pageCount}`);
    console.log(`Qatorlar (bo'sh emas): ${r.lines.length}`);
    if (r.warnings.length) console.log('Ogohlantirishlar:', r.warnings);
    const idx = r.lines.findIndex(l => /ЛОКАЛЬНЫЙ РЕСУРСНЫЙ СМЕТНЫЙ/i.test(l.text));
    console.log(`\n--- 4-bo'lim atrofidan 12 qator (sahifa|matn) ---`);
    r.lines.slice(idx >= 0 ? idx : 0, (idx >= 0 ? idx : 0) + 12)
      .forEach(l => console.log(`p${l.page} | ${JSON.stringify(l.text)}`));
  }).catch(e => { console.error('XATO:', e.message); process.exit(1); });
}
