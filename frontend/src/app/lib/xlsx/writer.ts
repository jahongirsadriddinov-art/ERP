// Kichik, tashqi kutubxonasiz .xlsx yozuvchi (owner 2026-10-22: "Excel'ga yuklangan hamma narsa tartibsiz").
// Nega o'zimizniki: npm'dagi "xlsx" paketida tuzatilmagan zaiflik bor, SheetJS CE esa uslub (qalin sarlavha,
// rang), muzlatilgan qator va pul formatini yozmaydi. Bu fayl faqat kerakli qismni yozadi: varaqlar, uslublar,
// son formatlari (so'm, sana, vaqt, %), muzlatilgan sarlavha, avtofiltr, ustun kengligi, birlashtirilgan katak,
// SUM formulasi (hisoblangan qiymati bilan — Excel qayta hisoblamasa ham to'g'ri ko'rinadi), chop etish sozlamasi.
// Matn doim "inlineStr" — "=..." bilan boshlangan matn formula bo'lib ishlab ketmaydi (formula-injection yo'q).
// Backend'da xuddi shu fayl nusxasi bor: backend/src/utils/xlsxWriter.ts — o'zgartirsangiz ikkalasini ham.

export type StyleName =
  | 'text' | 'muted' | 'bold' | 'header' | 'title' | 'subtitle' | 'section'
  | 'money' | 'moneyBold' | 'moneySigned' | 'moneyBig' | 'moneyBigSigned' | 'usd' | 'eur'
  | 'int' | 'intBold' | 'dec1' | 'dec1Bold' | 'pct' | 'pctBold'
  | 'date' | 'datetime' | 'time'
  | 'totalLabel' | 'total' | 'good' | 'bad' | 'warn';

export interface Cell { v?: string | number | boolean | Date | null; s?: StyleName; f?: string }
export type CellInput = string | number | boolean | Date | null | undefined | Cell;

export interface SheetDef {
  name: string;
  rows: CellInput[][];
  /** Ustun kengliklari (belgilar soni). */
  cols?: number[];
  /** Yuqoridagi nechta qator (va chapdagi nechta ustun) muzlatiladi. */
  freeze?: { rows: number; cols?: number };
  /** Masalan "A4:K120" */
  autoFilter?: string;
  merges?: string[];
  /** Chop etishda har sahifada takrorlanadigan qatorlar (1-asosli, masalan [4,4]). */
  printTitleRows?: [number, number];
  landscape?: boolean;
  /** 1-asosli qator raqami → balandlik (pt). */
  rowHeights?: Record<number, number>;
}

export type Deflate = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

// ─── Uslublar ───────────────────────────────────────────────────────────────────────────────────────────────
const NAVY = 'FF1B3A6B';
const FMT = {
  money: '#,##0', signed: '#,##0;[Red]-#,##0', usd: '#,##0.00" USD"', eur: '#,##0.00" EUR"',
  int: '#,##0', dec1: '0.0', pct: '0.0%', date: 'dd.mm.yyyy', datetime: 'dd.mm.yyyy hh:mm', time: 'hh:mm',
};
interface Xf { fmt?: string; font?: string; fill?: string; border?: string; align?: string }
const FONTS: Record<string, string> = {
  normal: '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>',
  bold: '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>',
  header: '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>',
  title: `<font><b/><sz val="16"/><color rgb="${NAVY}"/><name val="Calibri"/><family val="2"/></font>`,
  subtitle: '<font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/><family val="2"/></font>',
  section: `<font><b/><sz val="12"/><color rgb="${NAVY}"/><name val="Calibri"/><family val="2"/></font>`,
  muted: '<font><sz val="10"/><color rgb="FF808080"/><name val="Calibri"/><family val="2"/></font>',
  big: '<font><b/><sz val="13"/><name val="Calibri"/><family val="2"/></font>',
  good: '<font><b/><sz val="11"/><color rgb="FF1B7A4B"/><name val="Calibri"/><family val="2"/></font>',
  bad: '<font><b/><sz val="11"/><color rgb="FFC0392B"/><name val="Calibri"/><family val="2"/></font>',
  warn: '<font><b/><sz val="11"/><color rgb="FFB7791F"/><name val="Calibri"/><family val="2"/></font>',
};
const FILLS: Record<string, string> = {
  none: '<fill><patternFill patternType="none"/></fill>',
  gray125: '<fill><patternFill patternType="gray125"/></fill>',
  navy: `<fill><patternFill patternType="solid"><fgColor rgb="${NAVY}"/><bgColor indexed="64"/></patternFill></fill>`,
  total: '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill>',
};
const BORDERS: Record<string, string> = {
  none: '<border><left/><right/><top/><bottom/><diagonal/></border>',
  thin: '<border><left style="thin"><color rgb="FFB4C0D3"/></left><right style="thin"><color rgb="FFB4C0D3"/></right><top style="thin"><color rgb="FFB4C0D3"/></top><bottom style="thin"><color rgb="FFB4C0D3"/></bottom><diagonal/></border>',
  top: `<border><left/><right/><top style="medium"><color rgb="${NAVY}"/></top><bottom/><diagonal/></border>`,
  bottom: `<border><left/><right/><top/><bottom style="medium"><color rgb="${NAVY}"/></bottom><diagonal/></border>`,
};
const STYLES: Record<StyleName, Xf> = {
  text: {},
  muted: { font: 'muted' },
  bold: { font: 'bold' },
  header: { font: 'header', fill: 'navy', border: 'thin', align: '<alignment horizontal="center" vertical="center" wrapText="1"/>' },
  title: { font: 'title' },
  subtitle: { font: 'subtitle' },
  section: { font: 'section', border: 'bottom' },
  money: { fmt: FMT.money },
  moneyBold: { fmt: FMT.money, font: 'bold' },
  moneySigned: { fmt: FMT.signed },
  moneyBig: { fmt: FMT.money, font: 'big' },
  moneyBigSigned: { fmt: FMT.signed, font: 'big' },
  usd: { fmt: FMT.usd },
  eur: { fmt: FMT.eur },
  int: { fmt: FMT.int },
  intBold: { fmt: FMT.int, font: 'bold' },
  dec1: { fmt: FMT.dec1 },
  dec1Bold: { fmt: FMT.dec1, font: 'bold', fill: 'total', border: 'top' },
  pct: { fmt: FMT.pct },
  pctBold: { fmt: FMT.pct, font: 'bold', fill: 'total', border: 'top' },
  date: { fmt: FMT.date, align: '<alignment horizontal="left"/>' },
  datetime: { fmt: FMT.datetime, align: '<alignment horizontal="left"/>' },
  time: { fmt: FMT.time, align: '<alignment horizontal="center"/>' },
  totalLabel: { font: 'bold', fill: 'total', border: 'top' },
  total: { fmt: FMT.signed, font: 'bold', fill: 'total', border: 'top' },
  good: { font: 'good' },
  bad: { font: 'bad' },
  warn: { font: 'warn' },
};
const STYLE_NAMES = Object.keys(STYLES) as StyleName[];
const STYLE_INDEX = new Map(STYLE_NAMES.map((n, i) => [n, i]));

function stylesXml(): string {
  const fmts = [...new Set(STYLE_NAMES.map(n => STYLES[n].fmt).filter(Boolean) as string[])];
  const fmtId = new Map(fmts.map((f, i) => [f, 164 + i]));
  const fontKeys = Object.keys(FONTS), fillKeys = Object.keys(FILLS), borderKeys = Object.keys(BORDERS);
  const xfs = STYLE_NAMES.map(n => {
    const x = STYLES[n];
    const numFmtId = x.fmt ? fmtId.get(x.fmt)! : 0;
    const fontId = fontKeys.indexOf(x.font || 'normal');
    const fillId = fillKeys.indexOf(x.fill || 'none');
    const borderId = borderKeys.indexOf(x.border || 'none');
    const attrs = `numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"`
      + (numFmtId ? ' applyNumberFormat="1"' : '') + (fontId ? ' applyFont="1"' : '') + (fillId ? ' applyFill="1"' : '')
      + (borderId ? ' applyBorder="1"' : '') + (x.align ? ' applyAlignment="1"' : '');
    return x.align ? `<xf ${attrs}>${x.align}</xf>` : `<xf ${attrs}/>`;
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<numFmts count="${fmts.length}">${fmts.map(f => `<numFmt numFmtId="${fmtId.get(f)}" formatCode="${esc(f)}"/>`).join('')}</numFmts>`
    + `<fonts count="${fontKeys.length}">${fontKeys.map(k => FONTS[k]).join('')}</fonts>`
    + `<fills count="${fillKeys.length}">${fillKeys.map(k => FILLS[k]).join('')}</fills>`
    + `<borders count="${borderKeys.length}">${borderKeys.map(k => BORDERS[k]).join('')}</borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

// ─── Yordamchilar ──────────────────────────────────────────────────────────────────────────────────────────
// XML'da ruxsat etilmagan boshqaruv belgilarini olib tashlaymiz (aks holda Excel "fayl buzilgan" deydi).
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export function esc(s: string): string {
  return s.replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function colLetter(i: number): string { // 0 → A
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export const ref = (row: number, col: number) => `${colLetter(col)}${row + 1}`; // 0-asosli → "A1"

/** "YYYY-MM-DD" → Excel sana raqami (vaqt mintaqasiga bog'liq emas). Yaroqsiz bo'lsa null. */
export function dateSerial(ymd: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
}
/** ISO vaqt tamg'asi → Toshkent (UTC+5, yozgi vaqt yo'q) bo'yicha Excel sana-vaqt raqami. */
export function tashkentSerial(iso: string | Date | null | undefined): number | null {
  if (!iso) return null;
  const ms = iso instanceof Date ? iso.getTime() : Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return (ms + 5 * 3600_000) / 86400000 + 25569;
}
/** Faqat vaqt qismi (0..1) — "hh:mm" katagi uchun. */
export function tashkentTimeOfDay(iso: string | null | undefined): number | null {
  const s = tashkentSerial(iso);
  return s == null ? null : s - Math.floor(s);
}

/** Excel varaq nomi qoidalari: ≤31 belgi, []:*?/\ yo'q, takrorlanmasin. */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Varaq';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n.toLowerCase());
  return n;
}
const quoteSheet = (n: string) => `'${n.replace(/'/g, "''")}'`;

function cellXml(r: number, c: number, input: CellInput): string {
  if (input == null || input === '') return '';
  const cell: Cell = typeof input === 'object' && !(input instanceof Date) ? input : { v: input };
  let { v } = cell;
  let s = cell.s;
  if (v instanceof Date) {
    v = (v.getTime() - v.getTimezoneOffset() * 60000) / 86400000 + 25569;
    s = s || 'date';
  }
  const sAttr = s && s !== 'text' ? ` s="${STYLE_INDEX.get(s)}"` : '';
  const at = ref(r, c);
  if (cell.f) {
    const val = typeof v === 'number' && Number.isFinite(v) ? `<v>${v}</v>` : '';
    return `<c r="${at}"${sAttr}><f>${esc(cell.f)}</f>${val}</c>`;
  }
  if (v == null || v === '') return sAttr ? `<c r="${at}"${sAttr}/>` : '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${at}"${sAttr}><v>${v}</v></c>` : '';
  if (typeof v === 'boolean') return `<c r="${at}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
  const text = String(v);
  const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${at}"${sAttr} t="inlineStr"><is><t${space}>${esc(text)}</t></is></c>`;
}

function sheetXml(sh: SheetDef, selected: boolean): string {
  const maxCols = Math.max(1, sh.cols?.length || 0, ...sh.rows.map(r => r.length));
  const dim = `A1:${ref(Math.max(0, sh.rows.length - 1), maxCols - 1)}`;
  let views = `<sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>`;
  if (sh.freeze && (sh.freeze.rows || sh.freeze.cols)) {
    const fr = sh.freeze.rows || 0, fc = sh.freeze.cols || 0;
    const tl = ref(fr, fc);
    const pane = fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight';
    views += `<pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${tl}" activePane="${pane}" state="frozen"/>`
      + `<selection pane="${pane}" activeCell="${tl}" sqref="${tl}"/>`;
  }
  views += '</sheetView>';
  const cols = sh.cols?.length
    ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const rows = sh.rows.map((row, r) => {
    const cells = row.map((c, ci) => cellXml(r, ci, c)).join('');
    const h = sh.rowHeights?.[r + 1];
    if (!cells && !h) return '';
    return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="${dim}"/><sheetViews>${views}</sheetViews><sheetFormatPr defaultRowHeight="15"/>`
    + cols + `<sheetData>${rows}</sheetData>`
    + (sh.autoFilter ? `<autoFilter ref="${sh.autoFilter}"/>` : '')
    + (sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '')
    + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
    + `<pageSetup paperSize="9" orientation="${sh.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`
    + '</worksheet>';
}

// ─── ZIP (xlsx — bu ZIP arxiv) ──────────────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(d: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function zip(files: { name: string; data: Uint8Array }[], deflate?: Deflate): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let body = f.data, method = 0;
    if (deflate) {
      try { const z = await deflate(f.data); if (z.length < f.data.length) { body = z; method = 8; } } catch { /* siqmasdan */ }
    }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, DOS_TIME, true); lh.setUint16(12, DOS_DATE, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, DOS_TIME, true); ch.setUint16(14, DOS_DATE, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

/** Brauzer/Node 18+: CompressionStream('deflate-raw') bo'lsa — siqadi, yo'q bo'lsa fayl siqilmagan holda yoziladi. */
export const streamDeflate: Deflate | undefined = typeof (globalThis as any).CompressionStream === 'function'
  ? async (data: Uint8Array) => {
    const cs = new (globalThis as any).CompressionStream('deflate-raw');
    const buf = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(buf);
  }
  : undefined;

export interface WorkbookMeta { title?: string; author?: string; created?: Date }

export async function buildXlsx(sheets: SheetDef[], meta: WorkbookMeta = {}, deflate: Deflate | undefined = streamDeflate): Promise<Uint8Array> {
  if (!sheets.length) throw new Error('kamida bitta varaq kerak');
  const used = new Set<string>();
  const names = sheets.map(s => safeSheetName(s.name, used));
  const enc = new TextEncoder();
  const x = (s: string) => enc.encode(s);
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const defined: string[] = [];
  sheets.forEach((s, i) => {
    if (s.autoFilter) {
      const [a, b] = s.autoFilter.split(':');
      const abs = (r: string) => r.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
      defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(quoteSheet(names[i]))}!${abs(a)}:${abs(b || a)}</definedName>`);
    }
    if (s.printTitleRows) defined.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(quoteSheet(names[i]))}!$${s.printTitleRows[0]}:$${s.printTitleRows[1]}</definedName>`);
  });
  const created = (meta.created || new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  const files = [
    { name: '[Content_Types].xml', data: x(HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
      + '</Types>') },
    { name: '_rels/.rels', data: x(HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
      + '</Relationships>') },
    { name: 'docProps/core.xml', data: x(HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dc:title>${esc(meta.title || '')}</dc:title><dc:creator>${esc(meta.author || 'QurilishERP')}</dc:creator>`
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>`
      + '</cp:coreProperties>') },
    { name: 'docProps/app.xml', data: x(HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>QurilishERP</Application></Properties>') },
    { name: 'xl/workbook.xml', data: x(HEAD + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<bookViews><workbookView activeTab="0"/></bookViews>'
      + `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
      + (defined.length ? `<definedNames>${defined.join('')}</definedNames>` : '')
      + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: x(HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>') },
    { name: 'xl/styles.xml', data: x(stylesXml()) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x(sheetXml(s, i === 0)) })),
  ];
  return zip(files, deflate);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ─── Jadval varag'i yordamchisi ────────────────────────────────────────────────────────────────────────────
export interface TableColumn {
  header: string;
  width: number;
  /** Ma'lumot katagining standart uslubi (masalan 'money', 'date'). */
  style?: StyleName;
  /** Jami qatorida: 'sum' — SUM formulasi, 'count' — qatorlar soni, matn — shu matn. */
  total?: 'sum' | 'count' | string;
  /** Jami katagining uslubi (standart: 'total'). */
  totalStyle?: StyleName;
}
export interface TableSheetOpts {
  name: string;
  title: string;
  subtitle?: string;
  columns: TableColumn[];
  rows: CellInput[][];
  emptyText?: string;
  landscape?: boolean;
  /** Jadval tagidagi izoh qatorlari. */
  notes?: string[];
}
/**
 * Standart jadval varag'i: 1-qator sarlavha, 2-qator izoh (kompaniya/davr), 4-qator ustun nomlari (muzlatilgan,
 * avtofiltr), keyin ma'lumotlar va darhol ostida "JAMI" qatori (SUM formulalari hisoblangan qiymati bilan).
 */
export function tableSheet(o: TableSheetOpts): SheetDef & { headerRow: number; firstDataRow: number; totalRow: number | null } {
  const HEADER = 3; // 0-asosli → Excel'da 4-qator
  const cols = o.columns;
  const rows: CellInput[][] = [
    [{ v: o.title, s: 'title' }],
    [{ v: o.subtitle || '', s: 'subtitle' }],
    [],
    cols.map(c => ({ v: c.header, s: 'header' as StyleName })),
  ];
  const data = o.rows.map(r => r.map((v, ci) => {
    const st = cols[ci]?.style;
    if (v == null || !st) return v;
    if (typeof v === 'object' && !(v instanceof Date)) return v.s ? v : { ...v, s: st };
    return { v, s: st };
  }));
  rows.push(...data);
  const first = HEADER + 1, last = HEADER + data.length; // 0-asosli
  let totalRow: number | null = null;
  if (!data.length) {
    rows.push([{ v: o.emptyText || "Tanlangan davrda ma'lumot yo'q", s: 'muted' }]);
  } else if (cols.some(c => c.total)) {
    totalRow = rows.length;
    rows.push(cols.map((c, ci) => {
      const s: StyleName = c.totalStyle || 'total';
      if (c.total === 'sum') {
        let sum = 0;
        for (const r of data) { const v = r[ci]; const n = typeof v === 'object' && v && !(v instanceof Date) ? v.v : v; if (typeof n === 'number' && Number.isFinite(n)) sum += n; }
        return { v: Math.round(sum * 100) / 100, f: `SUBTOTAL(9,${ref(first, ci)}:${ref(last, ci)})`, s };
      }
      if (c.total === 'count') return { v: data.length, f: `SUBTOTAL(3,${ref(first, ci)}:${ref(last, ci)})`, s: c.totalStyle || 'totalLabel' };
      return { v: c.total || '', s: 'totalLabel' as StyleName };
    }));
  }
  if (o.notes?.length) { rows.push([]); for (const n of o.notes) rows.push([{ v: n, s: 'muted' }]); }
  const lastCol = colLetter(cols.length - 1);
  return {
    name: o.name, rows, cols: cols.map(c => c.width),
    freeze: { rows: HEADER + 1 },
    autoFilter: data.length ? `A${HEADER + 1}:${lastCol}${last + 1}` : undefined,
    printTitleRows: [HEADER + 1, HEADER + 1],
    landscape: o.landscape ?? cols.length > 6,
    rowHeights: { 1: 24, [HEADER + 1]: 30 },
    headerRow: HEADER + 1, firstDataRow: first + 1, totalRow: totalRow == null ? null : totalRow + 1,
  };
}
