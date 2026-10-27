// ─── Excel smeta/oferta — ustun sarlavhalari bo'yicha o'qish ────────────────────────────────────────────────
// (owner 2026-10-19: "smetani kuchaytir"; owner 2026-10-26: "oferta to'liq va aniq chiqmayapti, narxlarini
//  umuman ko'rsatmayapti, pastdagi boshqa varaqlarni ham o'qisin")
//
// Jadval katak-katak o'qiladi, sarlavha qatori (rus / o'zbek lotin / kirill) topiladi va ustunlar NOMI bo'yicha
// bog'lanadi. Nimalar hisobga olinadi:
//   • birlashtirilgan kataklar ochiladi — "Жами" ustuni ikkiga bo'linib ostida "бирлик нархи | сумма" turgan
//     ofertalarda narx ustuni "summa" deb tanilib, narxlar umuman chiqmay qolardi;
//   • sarlavha 1, 2 yoki 3 qatorga bo'lingan bo'lishi mumkin — eng to'liq moslik tanlanadi;
//   • narx yoki summa yetishmasa — ikkinchisidan hisoblab to'ldiriladi;
//   • sarlavhasi tanilmagan varaq ham bo'sh qolmaydi: birlik katagi bo'yicha zaxira o'qish ishlaydi;
//   • har bir varaqdan nechta qator olingani ogohlantirishlarda ko'rinadi.

import { applyCategories } from './categorize';
import type { ParseResult, ResourceGroup, ResourceRow, SmetaMeta, SummaryLine } from './types';

type Col = 'name' | 'unit' | 'qty' | 'price' | 'total' | 'code';

const HEAD: Record<Col, RegExp> = {
  name: /наимен|nomi|nomlan|номи|номлан|ресурс|resurs|материал(?!ы\b)|naimen|ish\s*turi|ишлар/i,
  unit: /ед\.?\s*изм|единиц|ўлчов|улчов|o['ʻ`’]?lchov|olchov|birlig|бирлиг|^birlik$|^бирлик$|ед\.$|^ед$|изм\./i,
  qty: /кол[-.\s]*во|количеств|miqdor|миқдор|микдор|hajm|ҳажм|хажм|объ[её]м|soni|сони/i,
  price: /цена|нарх|narx|стоим[а-яёa-z]*\s*ед|за\s*ед|бирлик\s*нарх|birlik\s*narx|баҳо|бахо|baho|таклиф|taklif/i,
  total: /сумма|всего|jami|жами|summa|итого|общ[а-яёa-z]*\s*стоим|umumiy/i,
  code: /шифр|код|обосн|shifr|^kod|asos/i,
};

/** Har doim tashlanadigan jamlanma qatorlar. */
const SUMMARY_ROW = /^(итого|всего|jami|жами|итог|ндс|qqs|ққс)/i;
/** Smeta oxiridagi xarajat jamlanmalari — birligi bo'lmasa tashlanadi (bo'lim sarlavhasi bo'lsa — qoladi). */
const SOFT_SKIP = /^(накладн|сметная\s*прибыль|зарплата|эксплуатац|строительные\s*материалы|транспортные\s*расход|прочие\s*затраты|страхование)/i;

/** Jamlanma qatori: birligi "СУМ"/"SUM" yoki nomi ВСЕГО/ИТОГО/НДС kabi. */
const MONEY_UNIT = /^(сум|сўм|сӹм|sum|so'?m|сумма)$/i;
const SUMMARY_NAME = /^(зарплат|эксплуатац|строительные\s*материал|транспортн|оборудован|всего|итог|прочие|страхован|ндс|накладн|сметная\s*прибыл|qqs|ққс|jami|жами)/i;

const norm = (v: unknown) => String(v ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Kasrni yo'qotmasdan, suzuvchi nuqta shovqinini tozalaydi (0.1+0.2 kabi) — yaxlitlash EMAS. */
export const exact = (n: number): number => Number(n.toFixed(6));

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

/** r qatoridan boshlab `span` qatorni ustunlar bo'yicha birlashtirib sarlavhani o'qiydi. */
function matchCols(rows: unknown[][], r: number, span: number): Partial<Record<Col, number>> {
  let width = 0;
  for (let i = 0; i < span; i++) width = Math.max(width, rows[r + i]?.length || 0);
  const cols: Partial<Record<Col, number>> = {};
  for (let c = 0; c < width; c++) {
    let text = '';
    for (let i = 0; i < span; i++) {
      const part = norm(rows[r + i]?.[c]);
      // birlashtirilgan katak ochilgandan keyin bir xil matn takrorlanishi mumkin
      if (part && !text.includes(part)) text += (text ? ' ' : '') + part;
    }
    if (!text || text.length > 80) continue;
    for (const k of ['unit', 'qty', 'price', 'total', 'code', 'name'] as Col[]) {
      if (cols[k] === undefined && HEAD[k].test(text)) {
        // "Стоимость единицы" / "бирлик нархи" — narx, umumiy summa emas
        if (k === 'total' && HEAD.price.test(text)) continue;
        cols[k] = c;
        break;
      }
    }
  }
  return cols;
}

const isHeaderCols = (c: Partial<Record<Col, number>>) =>
  c.name !== undefined && (c.unit !== undefined || c.code !== undefined) &&
  (c.qty !== undefined || c.price !== undefined || c.total !== undefined);

function findHeader(rows: unknown[][]): Header | null {
  // Owner 2026-10-26: katta ofertalarda jadval sarlavhasi 40-qatordan ancha pastda bo'ladi
  const limit = Math.min(rows.length, 400);
  for (let r = 0; r < limit; r++) {
    // Bir xil qator uchun 1/2/3 qatorli sarlavhani sinab, eng ko'p ustun tanilganini olamiz:
    // "Жами" ikki ustunga bo'linib ostida "бирлик нархи | сумма" turgan ofertalar shu sababli to'g'ri o'qiladi.
    let best: { cols: Partial<Record<Col, number>>; span: number; score: number } | null = null;
    for (const span of [1, 2, 3]) {
      if (r + span > rows.length) break;
      const cols = matchCols(rows, r, span);
      if (!isHeaderCols(cols)) continue;
      const score = Object.keys(cols).length + (cols.price !== undefined ? 1 : 0);
      if (!best || score > best.score) best = { cols, span, score };
    }
    if (best) return { row: r + best.span - 1, cols: best.cols };
  }
  return null;
}

/** "1 2 3 4 5 …" — sarlavha ostidagi ustun raqamlari. */
const isNumberingRow = (row: unknown[]) => {
  const cells = row.map(norm).filter(Boolean);
  return cells.length > 2 && cells.every((x, i) => /^\d{1,2}$/.test(x) && (i === 0 || Number(x) === Number(cells[i - 1]) + 1));
};

// ─── Zaxira yo'l: sarlavhasi tanilmagan varaq ham bo'sh qolmasin ─────────────
const LOOSE_UNITS = new Set([
  'М2', 'М3', 'М', 'ШТ', 'КГ', 'Т', 'ТН', 'КОМ', 'КОМПЛ', 'КОМП', 'Л', 'ЕД', 'ПОГМ', 'ПМ', 'РУЛОН', 'МЕШОК',
  'ПАЧКА', 'ЯЩИК', 'УПАК', 'ПАР', 'ДОН', 'ТА', 'ДОНА', 'ЧЕЛЧ', 'МАШЧ', 'ТОНН', 'КВМ', 'КУБМ',
  'M2', 'M3', 'M', 'SHT', 'KG', 'T', 'TN', 'DONA', 'DON', 'TA', 'L', 'KOMPL', 'QOP', 'QUTI', 'METR', 'SM',
  'MM', 'GR', 'LITR', 'TONNA',
]);
const unitKey = (s: string) => s.toUpperCase().replace(/[-.\s ]/g, '');

function parseSheetLoose(rows: unknown[][], startIndex: number): ResourceRow[] {
  const out: ResourceRow[] = [];
  let index = startIndex;
  for (const row of rows) {
    const cells = (row || []).map(norm);
    if (cells.length < 3) continue;
    const ui = cells.findIndex((c, i) => i >= 1 && !!c && LOOSE_UNITS.has(unitKey(c)));
    if (ui < 1) continue;
    const name = cells.slice(0, ui).filter((c) => c && !/^[\d  ,.\-–]+$/.test(c)).join(' ').trim();
    if (name.length < 2 || SUMMARY_ROW.test(name)) continue;
    const nums: number[] = [];
    for (let i = ui + 1; i < Math.min(ui + 7, cells.length); i++) {
      const n = num(cells[i]);
      if (n !== null && n > 0) nums.push(n);
    }
    if (!nums.length) continue;
    const qty = nums[0];
    const price = nums.length >= 2 ? nums[1] : null;
    const total = nums.length >= 3 ? nums[nums.length - 1] : (price !== null ? exact(qty * price) : null);
    index++;
    out.push({
      index, shifr: null, shifrNote: null,
      rawName: name, shortName: name.split(' ').slice(0, 4).join(' '),
      spec: null, unit: cells[ui], qty, price, total,
      group: groupOf(cells[ui], '', name),
      rawLine: cells.join('\t'), warnings: [],
    });
  }
  return out;
}

/** Sarlavhada narx/summa tanilmagan bo'lsa — ularni qatorlardagi raqamlar joylashuvidan topadi
 *  (owner 2026-10-27: "narx berilgan, lekin obyektda ko'rinmayapti").
 *  Smeta jadvallarida odatda eng o'ngdagi son — SUMMA, undan oldingisi — NARX. Faqat ko'pchilik
 *  qatorda son turgan ustunlar hisobga olinadi; nom/birlik/miqdor/shifr ustunlariga tegilmaydi. */
function inferMoneyCols(rows: unknown[][], h: Header): void {
  // Namuna qatorlar — sonlari bor haqiqiy qatorlar (sarlavha ostidan)
  const sample: number[][] = [];
  for (let r = h.row + 1; r < rows.length && sample.length < 80; r++) {
    const row = rows[r] || [];
    if (isNumberingRow(row)) continue;
    const name = norm(row[h.cols.name!]);
    if (!name || SUMMARY_ROW.test(name)) continue;
    const vals: number[] = [];
    let width = 0;
    for (let c = 0; c < row.length; c++) { const v = num(row[c]); vals[c] = v === null ? NaN : v; if (v !== null) width++; }
    if (width >= 3) sample.push(vals);
  }
  if (sample.length < 3) return;   // kichik jadvallar ham tekshiriladi
  const width = Math.max(...sample.map((v) => v.length));
  const skip = new Set([h.cols.name, h.cols.unit, h.cols.code].filter((v) => v !== undefined) as number[]);

  // MUHIM (owner 2026-10-27 hujjati): sarlavha bo'yicha topilgan ustunlar noto'g'ri bo'lishi mumkin
  // (masalan "summa" o'rniga guruh kodi ustuni olingan). Shuning uchun qaysi uchlik (miqdor, narx, summa)
  // miqdor x narx = summa tenglamasini eng ko'p qatorda bajarishiga qarab tanlanadi — bu hujjatning
  // o'z raqamlari bilan tekshirish, taxmin emas.
  let best: { q: number; p: number; t: number; hits: number } | null = null;
  for (let q = 0; q < width; q++) {
    if (skip.has(q)) continue;
    for (let p = 0; p < width; p++) {
      if (p === q || skip.has(p)) continue;
      for (let t = 0; t < width; t++) {
        if (t === q || t === p || skip.has(t)) continue;
        let hits = 0;
        for (const v of sample) {
          const a = v[q], b = v[p], c = v[t];
          if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue;
          if (a <= 0 || b <= 0 || c <= 0) continue;
          if (Math.abs(a * b - c) <= Math.abs(c) * 0.01) hits++;
        }
        if (hits && (!best || hits > best.hits)) best = { q, p, t, hits };
      }
    }
  }
  if (best && best.hits >= Math.max(2, sample.length * 0.25)) {
    h.cols.qty = best.q; h.cols.price = best.p; h.cols.total = best.t;
    return;
  }

  // Tenglama bo'yicha topilmadi — eski yo'l: eng o'ngdagi son ustuni summa, undan oldingisi narx
  if (h.cols.price !== undefined && h.cols.total !== undefined) return;
  const filled: Record<number, number> = {};
  for (const v of sample) for (let c = 0; c < width; c++) if (Number.isFinite(v[c]) && v[c] > 0) filled[c] = (filled[c] || 0) + 1;
  const cols = Object.keys(filled).map(Number)
    .filter((c) => !skip.has(c) && c !== h.cols.qty && filled[c] >= sample.length / 2)
    .sort((a2, b2) => a2 - b2);
  if (!cols.length) return;
  const last = cols[cols.length - 1], prev = cols.length >= 2 ? cols[cols.length - 2] : undefined;
  if (h.cols.total === undefined) h.cols.total = last;
  if (h.cols.price === undefined && prev !== undefined && prev !== h.cols.total) h.cols.price = prev;
}

/** Varaq bo'yicha tashxis — xatolik bo'lsa dasturchiga aynan nima o'qilmagani ko'rinsin (owner 2026-10-27). */
export interface SheetDiag {
  sheet: string; rows: number; parsed: number; header: number | null;
  cols: Record<string, number | undefined>; noPrice: number; noTotal: number; note: string;
}
let lastDiag: SheetDiag[] = [];
export const takeSmetaDiag = (): SheetDiag[] => lastDiag;

export function parseExcelRows(sheets: Array<{ name: string; rows: unknown[][] }>, filename: string): ParseResult | null {
  const resources: ResourceRow[] = [];
  const summary: SummaryLine[] = [];
  const diag: SheetDiag[] = [];
  const notes: string[] = [];
  let index = 0;
  for (const sh of sheets) {
    const before = resources.length;
    const h = findHeader(sh.rows);
    if (h) {
      inferMoneyCols(sh.rows, h);
      let section = '';
      for (let r = h.row + 1; r < sh.rows.length; r++) {
        const row = sh.rows[r] || [];
        if (isNumberingRow(row)) continue;
        const name = norm(row[h.cols.name!]);
        if (!name) continue;
        const unit = h.cols.unit !== undefined ? norm(row[h.cols.unit]) : '';
        let qty = h.cols.qty !== undefined ? num(row[h.cols.qty]) : null;
        let price = h.cols.price !== undefined ? num(row[h.cols.price]) : null;
        let total = h.cols.total !== undefined ? num(row[h.cols.total]) : null;
        // MUHIM (owner 2026-10-27): jamlanma blok (ВСЕГО, ИТОГО, НДС …) shu yerda ushlanadi — avval
        // SUMMARY_ROW bilan tashlab yuborilardi va hujjatning rasmiy summalari butunlay yo'qolardi.
        const summaryLike = (MONEY_UNIT.test(unit) || !unit) && (SUMMARY_NAME.test(name) || SUMMARY_ROW.test(name));
        if (!summaryLike && SUMMARY_ROW.test(name)) continue;   // jadval ichidagi "Итого по …" qatori
        // Raqamsiz qator — bo'lim sarlavhasi ("Материалы", "Оборудование", "Трудовые затраты")
        if (!qty && !price && !total) { section = name.slice(0, 120); continue; }
        // Owner 2026-10-27: "hujjatdagi barcha ma'lumot ko'rinsin". Smeta oxiridagi jamlanma blok
        // (ЗАРПЛАТА, ЭКСПЛУАТАЦИЯ МАШИН, ВСЕГО, ПРОЧИЕ 17.27%, НДС 12%, ВСЕГО…) — material emas,
        // alohida ro'yxat sifatida saqlanadi (summalarga ikki marta qo'shilmasin).
        if (summaryLike) {
          // Owner 2026-10-27: summalar noto'g'ri chiqqandi (yonidagi "farq"/koeffitsient ustunlari olingan).
          // Jamlanma qatorida haqiqiy summa — eng katta (mutlaq qiymat bo'yicha) son.
          let amt: number | null = null;
          for (const cell of row) {
            const v = num(cell);
            if (v === null) continue;
            if (amt === null || Math.abs(v) > Math.abs(amt)) amt = v;
          }
          if (amt !== null && Math.abs(amt) >= 1) {
            // foiz ustuni: qator ichidagi 0 < v <= 100 bo'lgan va summadan boshqa son
            let percent: number | null = null;
            for (const cell of row) {
              const v = num(cell);
              if (v === null || v === amt || v <= 0 || v > 100) continue;
              percent = v <= 1 ? Math.round(v * 10000) / 100 : v;   // 0.1727 -> 17.27
              break;
            }
            summary.push({ name, percent, amount: amt });
          }
          continue;
        }
        const isSummaryCost = SOFT_SKIP.test(name) && !unit;
        // Yetishmaganini ikkinchisidan hisoblaymiz — narx ustuni bo'lmagan ofertalarda ham narx ko'rinadi
        if ((qty === null || qty <= 0) && price && total) qty = exact(total / price);
        if (qty === null || qty <= 0) qty = 1;   // miqdor yozilmagan qator ham yo'qolmasin
        if (price === null && total) price = exact(total / qty);
        if (total === null && price !== null) total = exact(qty * price);
        // Miqdorni summaga qarab aniqlashtiramiz: qator ichida qaysi son narxga ko'paytirilganda
        // summani beradi, o'sha haqiqiy miqdor (resurs varaqlarida "birlik uchun" va "loyiha bo'yicha"
        // ikkita ustun bo'ladi — sarlavha bo'yicha tanlangani noto'g'ri bo'lishi mumkin).
        if (price && total && Math.abs(qty * price - total) > Math.abs(total) * 0.01) {
          let best: { v: number; err: number } | null = null;
          for (let c = 0; c < row.length; c++) {
            if (c === h.cols.price || c === h.cols.total || c === h.cols.name || c === h.cols.unit || c === h.cols.code) continue;
            const v = num(row[c]);
            if (v === null || v <= 0) continue;
            const err = Math.abs(v * price - total);
            if (!best || err < best.err) best = { v, err };
          }
          if (best && best.err <= Math.abs(total) * 0.01) qty = best.v;
        }
        const code = h.cols.code !== undefined ? norm(row[h.cols.code]) || null : null;
        index++;
        resources.push({
          index, shifr: code, shifrNote: null,
          rawName: name, shortName: name.split(' ').slice(0, 4).join(' '),
          spec: null, unit: unit || '-', qty, price, total,
          group: isSummaryCost ? 'general' : groupOf(unit, section, name),
          rawLine: row.map(norm).join('\t'), warnings: [], sheet: sh.name,
        });
      }
    }
    // Sarlavha topilmadi yoki undan hech narsa chiqmadi — birlik katagi bo'yicha zaxira o'qish
    if (resources.length === before) {
      const loose = parseSheetLoose(sh.rows, index).map((r) => ({ ...r, sheet: sh.name }));
      resources.push(...loose);
      index += loose.length;
    }
    const got = resources.length - before;
    const mine = resources.slice(before);
    diag.push({
      sheet: sh.name, rows: sh.rows.length, parsed: got, header: h ? h.row + 1 : null,
      cols: h ? { ...h.cols } : {},
      noPrice: mine.filter((r) => r.price === null).length,
      noTotal: mine.filter((r) => r.total === null).length,
      note: got ? (h ? 'sarlavha bo\'yicha' : 'sarlavhasiz (birlik katagi bo\'yicha)') : 'jadval topilmadi',
    });
    notes.push(`${sh.name}: ${got ? `${got} qator${h ? '' : " (sarlavhasiz o'qildi)"}` : 'jadval topilmadi'}`);
  }
  lastDiag = diag;
  if (!resources.length && !summary.length) return null;
  applyCategories(resources);
  const sumOf = (g?: ResourceGroup) => Math.round(resources.filter((x) => !g || x.group === g).reduce((s, x) => s + (x.total ?? 0), 0) * 100) / 100;
  const grandTotal = sumOf();
  // Owner 2026-10-27 hujjati: oxirgi jamlanma blokdagi rasmiy raqamlar (ВСЕГО / ИТОГО / НДС).
  // Qatorlarni qo'shib chiqish noto'g'ri bo'ladi — ОФЕРТА va РЕСУРС bir xil xarajatni ikki marta ko'rsatadi.
  const lastOf = (re: RegExp) => { const m = summary.filter((x) => re.test(x.name.trim())); return m.length ? m[m.length - 1].amount : null; };
  const vatAmount = lastOf(/^(ндс|qqs|ққс)/i);
  const totalWithVat = lastOf(/^всего/i);
  const itogo = lastOf(/^итого\s*$/i) ?? lastOf(/^итого/i);
  const withoutVat = itogo ?? (totalWithVat !== null && vatAmount !== null ? Math.round((totalWithVat - vatAmount) * 100) / 100 : null);
  const meta: SmetaMeta = {
    objectName: null, subObject: null, organization: null,
    totalWithVat: totalWithVat ?? null,
    totalWithoutVat: withoutVat ?? (grandTotal || null),
    vatAmount: vatAmount ?? null,
    currency: 'UZS', sourceFile: filename, parsedAt: new Date().toISOString(),
  };
  const LABEL: Record<ResourceGroup, string> = { labor: 'Mehnat', machinery: 'Mashina va mexanizmlar', material: 'Materiallar', equipment: 'Jihozlar', general: 'Umumiy xarajatlar' };
  const groups = (['labor', 'machinery', 'material', 'equipment', 'general'] as ResourceGroup[]).filter((g) => resources.some((x) => x.group === g));
  const noPrice = resources.filter((r) => r.price === null).length;
  return {
    meta, resources, works: [], ...(summary.length ? { summary } : {}),
    totals: groups.map((g) => ({ group: LABEL[g], declared: 0, computed: sumOf(g), diff: 0, passed: true })),
    validation: {
      ok: resources.length > 0,
      checks: [],
      warnings: [
        `Varaqlar — ${notes.join('; ')}`,
        ...(noPrice ? [`${noPrice} qatorda narx ko'rsatilmagan (faylning o'zida ham bo'sh)`] : []),
      ],
      errors: [],
    },
  };
}

/** Birlashtirilgan kataklar — qiymat butun maydonga yoziladi (ustunlar to'g'ri taqsimlanishi uchun). */
function expandMerges(xlsx: any, sheet: any): void {
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = sheet?.['!merges'] || [];
  for (const m of merges) {
    const src = sheet[xlsx.utils.encode_cell({ r: m.s.r, c: m.s.c })];
    if (!src) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const addr = xlsx.utils.encode_cell({ r, c });
        if (!sheet[addr]) sheet[addr] = { t: src.t, v: src.v, w: src.w };
      }
    }
  }
}

/** Excel faylidan (buffer) — har bir varaq katak-katak. Hech narsa topilmasa null (eski yo'lga qaytiladi). */
export function parseExcelTable(buf: Buffer, filename: string): ParseResult | null {
  const xlsx = require('xlsx');
  const wb = xlsx.read(buf, { type: 'buffer', cellText: true, cellDates: false });
  const sheets = wb.SheetNames.map((name: string) => {
    const sheet = wb.Sheets[name];
    expandMerges(xlsx, sheet);
    return {
      name,
      rows: xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true }) as unknown[][],
    };
  });
  return parseExcelRows(sheets, filename);
}
