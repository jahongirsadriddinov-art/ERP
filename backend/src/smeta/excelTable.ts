// ─── Excel smeta — ustun sarlavhalari bo'yicha o'qish (owner 2026-10-19: "smetani kuchaytir") ─────────────────
// Avvalgi Excel yo'li ustunlarni "birlik katagini topib" taxmin qilardi: birinchi ustun bo'sh qatorlarda siljib
// ketar, mehnat/texnika ham "material" bo'lib qolardi. Bu modul jadvalni katak-katak o'qiydi, sarlavha qatorini
// (rus / o'zbek lotin / kirill) topadi va ustunlarni NOMI bo'yicha bog'laydi. Bo'lim sarlavhalari ("Трудовые
// затраты", "Материалы", "Mashina va mexanizmlar") va birlik ("чел.-ч", "маш.-ч") bo'yicha guruh aniqlanadi.

import { applyCategories } from './categorize';
import type { ParseResult, ResourceGroup, ResourceRow, SmetaMeta } from './types';

type Col = 'name' | 'unit' | 'qty' | 'price' | 'total' | 'code';

const HEAD: Record<Col, RegExp> = {
  name: /наимен|nomi|nomlan|номи|номлан|ресурс|resurs|материал(?!ы\b)|naimen/i,
  unit: /ед\.?\s*изм|единиц|ўлчов|o['ʻ`’]?lchov|olchov|birlik|бирлик|ед\.$|^ед$|изм\./i,
  qty: /кол[-.\s]*во|количеств|miqdor|миқдор|микдор|hajm|ҳажм|объ[её]м|soni|сони/i,
  price: /цена|narx|нарх|стоим[а-яёa-z]*\s*ед|за\s*ед|бирлик\s*нарх|birlik\s*narx/i,
  total: /сумма|всего|jami|жами|summa|итого|общ[а-яёa-z]*\s*стоим|umumiy/i,
  code: /шифр|код|обосн|shifr|kod|asos/i,
};

const SKIP_ROW = /^(итого|всего|jami|жами|итог|ндс|qqs|ққс|накладн|сметная\s*прибыль|зарплата|эксплуатац|строительные\s*материалы|транспортные\s*расход|оборудование|прочие\s*затраты|страхование)/i;

const norm = (v: unknown) => String(v ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = norm(v).replace(/\s/g, '');
  if (!s || /^[-–—]+$/.test(s)) return null;
  // "1.234,56" / "1,234.56" / "1234,5"
  let t = s;
  if (/,\d{1,3}$/.test(t) && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{1,3}$/.test(t) && t.includes(',')) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Birlik, bo'lim va nom bo'yicha resurs guruhi. */
export function groupOf(unit: string, section: string, name: string): ResourceGroup {
  const u = unit.toUpperCase().replace(/\s/g, '');
  if (/ЧЕЛ|КИШИ|ODAM|CHEL|Н\.?-?Ч$|НОРМ/.test(u)) return 'labor';
  if (/МАШ|MASH|МЕХ/.test(u)) return 'machinery';
  const s = `${section} ${name}`.toLowerCase();
  if (/трудов|затраты\s*труда|mehnat|меҳнат|рабоч/.test(s)) return 'labor';
  if (/машин|механизм|mashina|mexanizm|техник|texnika/.test(s)) return 'machinery';
  if (/оборудован|jihoz|жиҳоз|uskuna/.test(s)) return 'equipment';
  if (/накладн|прочи|общ[а-яёa-z]+\s*затрат|umumiy\s*xarajat/.test(s)) return 'general';
  return 'material';
}

interface Header { row: number; cols: Partial<Record<Col, number>> }

function matchCols(rows: unknown[][], r: number, combine: boolean): Partial<Record<Col, number>> {
  const width = Math.max(rows[r]?.length || 0, combine ? rows[r + 1]?.length || 0 : 0);
  const cols: Partial<Record<Col, number>> = {};
  for (let c = 0; c < width; c++) {
    const text = (combine ? `${norm(rows[r]?.[c])} ${norm(rows[r + 1]?.[c])}` : norm(rows[r]?.[c])).trim();
    if (!text || text.length > 80) continue;
    for (const k of ['unit', 'qty', 'price', 'total', 'code', 'name'] as Col[]) {
      if (cols[k] === undefined && HEAD[k].test(text)) {
        // "Стоимость единицы" — narx, umumiy summa emas
        if (k === 'total' && HEAD.price.test(text)) continue;
        cols[k] = c;
        break;
      }
    }
  }
  return cols;
}

const isHeaderCols = (c: Partial<Record<Col, number>>) => c.name !== undefined && c.unit !== undefined && c.qty !== undefined;

function findHeader(rows: unknown[][]): Header | null {
  // Owner 2026-10-26: katta ofertalarda jadval sarlavhasi 40-qatordan ancha pastda bo'ladi
  const limit = Math.min(rows.length, 400);
  // Avval bitta qator; topilmasa — 2 qatorga bo'lingan (birlashtirilgan kataklar) sarlavha
  for (const combine of [false, true]) {
    for (let r = 0; r < limit; r++) {
      const cols = matchCols(rows, r, combine);
      if (isHeaderCols(cols)) return { row: combine ? r + 1 : r, cols };
    }
  }
  return null;
}

/** "1 2 3 4 5 …" — sarlavha ostidagi ustun raqamlari. */
const isNumberingRow = (row: unknown[]) => {
  const cells = row.map(norm).filter(Boolean);
  return cells.length > 2 && cells.every((x, i) => /^\d{1,2}$/.test(x) && (i === 0 || Number(x) === Number(cells[i - 1]) + 1));
};

export function parseExcelRows(sheets: Array<{ name: string; rows: unknown[][] }>, filename: string): ParseResult | null {
  const resources: ResourceRow[] = [];
  let matchedSheets = 0;
  let index = 0;
  for (const sh of sheets) {
    const h = findHeader(sh.rows);
    if (!h) continue;
    matchedSheets++;
    let section = '';
    for (let r = h.row + 1; r < sh.rows.length; r++) {
      const row = sh.rows[r] || [];
      if (isNumberingRow(row)) continue;
      const name = norm(row[h.cols.name!]);
      const unit = norm(row[h.cols.unit!]);
      const qty = num(row[h.cols.qty!]);
      if (!name) continue;
      if (SKIP_ROW.test(name)) continue;
      if (!unit && (qty === null || qty === 0)) { section = name.slice(0, 120); continue; }   // bo'lim sarlavhasi
      if (qty === null || qty <= 0 || !unit) continue;
      const price = h.cols.price !== undefined ? num(row[h.cols.price]) : null;
      let total = h.cols.total !== undefined ? num(row[h.cols.total]) : null;
      if (total === null && price !== null) total = Math.round(qty * price);
      const code = h.cols.code !== undefined ? norm(row[h.cols.code]) || null : null;
      index++;
      resources.push({
        index, shifr: code, shifrNote: null,
        rawName: name, shortName: name.split(' ').slice(0, 4).join(' '),
        spec: null, unit, qty, price, total,
        group: groupOf(unit, section, name),
        rawLine: row.map(norm).join('\t'), warnings: [],
      });
    }
  }
  if (!matchedSheets) return null;
  applyCategories(resources);
  const sumOf = (g?: ResourceGroup) => Math.round(resources.filter((x) => !g || x.group === g).reduce((s, x) => s + (x.total ?? 0), 0));
  const grandTotal = sumOf();
  const meta: SmetaMeta = {
    objectName: null, subObject: null, organization: null,
    totalWithVat: null, totalWithoutVat: grandTotal || null, vatAmount: null,
    currency: 'UZS', sourceFile: filename, parsedAt: new Date().toISOString(),
  };
  const LABEL: Record<ResourceGroup, string> = { labor: 'Mehnat', machinery: 'Mashina va mexanizmlar', material: 'Materiallar', equipment: 'Jihozlar', general: 'Umumiy xarajatlar' };
  const groups = (['labor', 'machinery', 'material', 'equipment', 'general'] as ResourceGroup[]).filter((g) => resources.some((x) => x.group === g));
  return {
    meta, resources, works: [],
    totals: groups.map((g) => ({ group: LABEL[g], declared: 0, computed: sumOf(g), diff: 0, passed: true })),
    validation: {
      ok: resources.length > 0,
      checks: [],
      warnings: resources.length ? [] : ['Sarlavha topildi, lekin qatorlarda miqdor/birlik yo\'q'],
      errors: [],
    },
  };
}

/** Excel faylidan (buffer) — har bir varaq katak-katak. Sarlavha topilmasa null (eski yo'lga qaytiladi). */
export function parseExcelTable(buf: Buffer, filename: string): ParseResult | null {
  const xlsx = require('xlsx');
  const wb = xlsx.read(buf, { type: 'buffer', cellText: true, cellDates: false });
  const sheets = wb.SheetNames.map((name: string) => ({
    name,
    rows: xlsx.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: true }) as unknown[][],
  }));
  return parseExcelRows(sheets, filename);
}
