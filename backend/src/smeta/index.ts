// ─── Smeta parser — asosiy kirish nuqtasi ────────────────────────────────────
// parseSmeta(buffer|path, filename) → ParseResult (AI'siz, deterministik).
// Qo'llab-quvvatlanadigan: PDF, Excel (.xlsx/.xls), Word (.docx), TXT/CSV

import * as path from 'path';
import { extractText } from './extract';
import { splitSections } from './sections';
import { parseResources } from './parseResources';
import { parseWorks } from './parseWorks';
import { validate } from './validate';
import { applyCategories } from './categorize';
import { parseNum } from './normalize';
import { ExtractedLine, ParseResult, ResourceRow, SmetaMeta } from './types';

function parseMeta(lines: ExtractedLine[], filename: string): SmetaMeta {
  const text = lines.map(l => l.text);
  const find = (re: RegExp): RegExpMatchArray | null => {
    for (const l of text) { const m = l.match(re); if (m) return m; }
    return null;
  };

  let totalWithVat: number | null = null;
  const vat = find(/С\s*УЧЕТОМ\s*НДС\s*[-–—:]?\s*([\d][\d  .,]*)/i);
  if (vat) {
    const n = parseNum(vat[1].replace(/[.\s]+$/, ''));
    if (n != null) totalWithVat = Math.round(n * 1000);
  }

  const objLines = text.filter(l => /VILOYAT|SHAHAR|SHAHRIDA|QURISH|KOMPANIYA|OBYEKT|ОБЪЕКТА/i.test(l) && l.length > 8);
  const objectName = objLines.length
    ? objLines.slice(0, 2).join(' ').replace(/[<>()«»"]/g, ' ').replace(/\s+/g, ' ').trim()
    : null;

  const org = find(/(ООО|OOO|МЧЖ|MChJ|АО|ЧП)\s+[A-Za-zА-Яа-яЁё0-9_ -]{2,40}/);
  const organization = org ? org[0].replace(/\s+/g, ' ').trim() : null;

  return {
    objectName, subObject: null, organization,
    totalWithVat, totalWithoutVat: null, vatAmount: null,
    currency: 'UZS', sourceFile: filename, parsedAt: new Date().toISOString(),
  };
}

// ─── Excel uchun to'g'ridan-to'g'ri parser ───────────────────────────────────
// Excel smeta jadvalidagi qatorlarni ParseResult.resources ga aylantiradi.
// Umumiy formatlar: №, Naim., Ed.izm., Miqdor, Narx, Jami

const KNOWN_UNITS_NORM = new Set([
  'М2','М3','КВМ','КУБМ','ШТ','КГ','Т','ТН','М','КОМ','ЧЕЛЧас','МАШЧас',
  'ЧНЧАС','ЧЕЛ','МАШ','Л','ЕД','НОРМ','КОМП','КОМПЛ','РУЛОН','МЕШОК','ПАЧКА',
  'БАНКА','ВЕДРО','ПАР','ЯЩИК','УПАК','ПОГ','ПМ','ЛМ','ДОН','ТА','ДОНА',
  'M2','M3','KG','T','SHT','DON','M','L','TA','DONA','KOMPL','QOP','QUTI',
  'METR','SM','MM','GR','MG','OPC','LITR','ТОНН','ЕДИНИЦ',
].map(u => u.replace(/[.\s ]/g, '')));

function normalizeUnitStr(s: string): string {
  return s.toUpperCase().replace(/[.\s ]/g, '');
}

function parseExcelDirect(lines: ExtractedLine[], filename: string): ParseResult {
  const resources: ResourceRow[] = [];
  let index = 0;

  for (const ln of lines) {
    const cells = ln.text.split('\t').map(c => c.trim());
    if (cells.length < 3) continue;

    // Birlik katakni topamiz
    let unitIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      if (KNOWN_UNITS_NORM.has(normalizeUnitStr(cells[i]))) { unitIdx = i; break; }
    }
    if (unitIdx < 1) continue;

    // Nom: birlikdan oldingi matnli kataklar (raqam bo'lmaganlar)
    const nameParts: string[] = [];
    for (let i = 0; i < unitIdx; i++) {
      const c = cells[i];
      if (!c) continue;
      if (/^\d{1,4}$/.test(c)) continue; // tartib raqam
      if (/^[\d ,.\-–]+$/.test(c)) continue; // faqat raqamlar
      nameParts.push(c);
    }
    const rawName = nameParts.join(' ').replace(/\s+/g, ' ').trim();
    if (!rawName || rawName.length < 2) continue;

    // Raqamlar: birlikdan keyingi kataklar
    const nums: number[] = [];
    for (let i = unitIdx + 1; i < Math.min(unitIdx + 6, cells.length); i++) {
      const n = parseFloat(cells[i].replace(/\s/g, '').replace(',', '.'));
      if (!isNaN(n) && n > 0) nums.push(n);
    }
    if (!nums.length) continue;

    const qty = nums[0] ?? 0;
    const price = nums.length >= 2 ? nums[1] : null;
    const total = nums.length >= 3 ? nums[nums.length - 1] : (price ? Math.round(qty * price) : null);

    index++;
    resources.push({
      index, shifr: null, shifrNote: null,
      rawName, shortName: rawName.split(' ').slice(0, 4).join(' '),
      spec: null, unit: cells[unitIdx],
      qty, price, total, group: 'material',
      rawLine: ln.text, warnings: [],
    });
  }

  applyCategories(resources);

  const grandTotal = resources.reduce((s, r) => s + (r.total ?? 0), 0);
  const meta: SmetaMeta = {
    objectName: null, subObject: null, organization: null,
    totalWithVat: null, totalWithoutVat: Math.round(grandTotal), vatAmount: null,
    currency: 'UZS', sourceFile: filename, parsedAt: new Date().toISOString(),
  };

  return {
    meta, resources, works: [],
    totals: [{ group: 'Jami materiallar', declared: 0, computed: Math.round(grandTotal), diff: 0, passed: true }],
    validation: {
      ok: resources.length > 0,
      checks: [],
      warnings: resources.length === 0 ? ['Jadvaldan material topilmadi — birlik ustuni tanilmadi'] : [],
      errors: [],
    },
  };
}

// ─── Asosiy parser ────────────────────────────────────────────────────────────

export async function parseSmeta(input: Buffer | string, filename = 'smeta.pdf'): Promise<ParseResult> {
  const ext = path.extname(filename).toLowerCase();

  // Excel uchun — to'g'ridan-to'g'ri strukturaviy parser (tekst-pattern yo'q)
  if (ext === '.xlsx' || ext === '.xls') {
    const ex = await extractText(input, filename);
    return parseExcelDirect(ex.lines, filename);
  }

  // PDF / Word / TXT — matn asosida pipeline
  const ex = await extractText(input, filename);
  const sec = splitSections(ex.lines);

  const meta = parseMeta(sec.metaLines.length ? sec.metaLines : ex.lines, filename);
  const { resources, declaredTotals, warnings: rw } = parseResources(sec.section4);
  const { works, warnings: ww } = parseWorks(sec.section5);
  applyCategories(resources);
  const { validation, totals } = validate(resources, works, declaredTotals, meta);

  const grandTotal = Math.round(totals.reduce((s, t) => s + t.computed, 0));
  meta.totalWithoutVat = grandTotal;
  if (meta.totalWithVat != null) meta.vatAmount = meta.totalWithVat - grandTotal;

  validation.warnings.push(...ex.warnings, ...rw, ...ww);
  if (sec.bounds.s4start < 0) {
    validation.warnings.push("4-bo'lim (РЕСУРСНЫЙ РАСЧЕТ) topilmadi — fayl boshqa formatdami?");
  }

  // Word/TXT dan 0 resurs chiqsa — to'g'ridan-to'g'ri jadval parsingini urinib ko'ramiz
  if (resources.length === 0 && ex.library !== 'pdf-parse') {
    const direct = parseExcelDirect(ex.lines, filename);
    if (direct.resources.length > 0) return direct;
  }

  return { meta, resources, works, totals, validation };
}

export * from './types';
export { extractText } from './extract';
