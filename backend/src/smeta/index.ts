// ─── Smeta parser — asosiy kirish nuqtasi ────────────────────────────────────
// parseSmeta(buffer|path, filename) → ParseResult (AI'siz, deterministik).

import { extractText } from './extract';
import { splitSections } from './sections';
import { parseResources } from './parseResources';
import { parseWorks } from './parseWorks';
import { validate } from './validate';
import { applyCategories } from './categorize';
import { parseNum } from './normalize';
import { ExtractedLine, ParseResult, SmetaMeta } from './types';

function parseMeta(lines: ExtractedLine[], filename: string): SmetaMeta {
  const text = lines.map(l => l.text);
  const find = (re: RegExp): RegExpMatchArray | null => {
    for (const l of text) { const m = l.match(re); if (m) return m; }
    return null;
  };

  // Bosh summa (С УЧЕТОМ НДС) — odatda ТЫС.СУМ (mingда), shuning uchun ×1000
  let totalWithVat: number | null = null;
  const vat = find(/С\s*УЧЕТОМ\s*НДС\s*[-–—:]?\s*([\d][\d  .,]*)/i);
  if (vat) {
    const n = parseNum(vat[1].replace(/[.\s]+$/, ''));
    if (n != null) totalWithVat = Math.round(n * 1000);
  }

  // Obyekt nomi (best-effort — titul qisman buzuq bo'lishi mumkin)
  const objLines = text.filter(l => /VILOYAT|SHAHAR|SHAHRIDA|QURISH|KOMPANIYA|OBYEKT|ОБЪЕКТА/i.test(l) && l.length > 8);
  const objectName = objLines.length
    ? objLines.slice(0, 2).join(' ').replace(/[<>()«»"]/g, ' ').replace(/\s+/g, ' ').trim()
    : null;

  // Tashkilot (best-effort)
  const org = find(/(ООО|OOO|МЧЖ|MChJ|АО|ЧП)\s+[A-Za-zА-Яа-яЁё0-9_ -]{2,40}/);
  const organization = org ? org[0].replace(/\s+/g, ' ').trim() : null;

  return {
    objectName, subObject: null, organization,
    totalWithVat, totalWithoutVat: null, vatAmount: null,
    currency: 'UZS', sourceFile: filename, parsedAt: new Date().toISOString(),
  };
}

export async function parseSmeta(input: Buffer | string, filename = 'smeta.pdf'): Promise<ParseResult> {
  const ex = await extractText(input);
  const sec = splitSections(ex.lines);

  const meta = parseMeta(sec.metaLines.length ? sec.metaLines : ex.lines, filename);
  const { resources, declaredTotals, warnings: rw } = parseResources(sec.section4);
  const { works, warnings: ww } = parseWorks(sec.section5);
  applyCategories(resources); // lug'at asosida kategoriya (parsing'ga daxlsiz)
  const { validation, totals } = validate(resources, works, declaredTotals, meta);

  // Umumiy summa (ИТОГО ПО РЕСУРСНОМУ РАСЧЕТУ) — 5 guruh yig'indisi = byudjet manbai.
  // Byudjet HAR DOIM shu yerdан olinadi (Gemini yoki noto'g'ri hisobdan emas).
  const grandTotal = Math.round(totals.reduce((s, t) => s + t.computed, 0));
  meta.totalWithoutVat = grandTotal;
  if (meta.totalWithVat != null) meta.vatAmount = meta.totalWithVat - grandTotal;

  validation.warnings.push(...ex.warnings, ...rw, ...ww);
  if (sec.bounds.s4start < 0) validation.errors.push('4-bo\'lim (РЕСУРСНЫЙ РАСЧЕТ) topilmadi — noto\'g\'ri format?');

  return { meta, resources, works, totals, validation };
}

export * from './types';
export { extractText } from './extract';
