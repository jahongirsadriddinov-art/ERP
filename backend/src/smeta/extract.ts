// ─── Multi-format → matn qatorlari (deterministik, AI'siz) ──────────────────
// Qo'llab-quvvatlanadigan formatlar: PDF, Excel (.xlsx/.xls), Word (.docx), TXT/CSV
//
// Barcha formatlar uchun bir xil ExtractResult qaytariladi — keyingi parsing
// bosqichlari format-agnostik ishlaydi.

import * as fs from 'fs';
import * as path from 'path';
import { ExtractResult, ExtractedLine } from './types';

// ─── PDF ─────────────────────────────────────────────────────────────────────

const PAGE_MARKER = /^--\s*(\d+)\s+of\s+(\d+)\s*--$/i;

function normalizeSpaces(s: string): string {
  return s
    .replace(/[    ⁠]/g, ' ')
    .replace(/​/g, '');
}

function trimEdges(s: string): string {
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

async function extractPdf(data: Buffer): Promise<ExtractResult> {
  const { PDFParse } = require('pdf-parse');
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

  if (!text.trim()) warnings.push("PDF dan matn chiqmadi (skaner yoki matn qatlamsiz bo'lishi mumkin)");

  const physical = text.split(/\r?\n/);
  const lines: ExtractedLine[] = [];
  let currentPage = 1;
  let seenMarker = false;

  for (const raw of physical) {
    const trimmed = trimEdges(normalizeSpaces(raw));
    const pm = trimmed.match(PAGE_MARKER);
    if (pm) { currentPage = parseInt(pm[1], 10) + 1; seenMarker = true; continue; }
    if (trimmed === '') continue;
    lines.push({ text: trimmed, page: seenMarker ? currentPage : 1, raw });
  }

  if (!pageCount) pageCount = Math.max(1, ...lines.map(l => l.page));
  return { pageCount, rawText: text, lines, library: 'pdf-parse', warnings };
}

// ─── Excel (.xlsx / .xls) ────────────────────────────────────────────────────

async function extractExcel(data: Buffer): Promise<ExtractResult> {
  const xlsx = require('xlsx');
  const warnings: string[] = [];

  const workbook = xlsx.read(data, { type: 'buffer', cellText: true, cellDates: false });
  const lines: ExtractedLine[] = [];
  let rawText = '';
  let page = 1;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Sheet chegaralarini aniqlaymiz
    const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const rows: string[][] = [];

    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddr = xlsx.utils.encode_cell({ r, c });
        const cell = sheet[cellAddr];
        if (!cell) { row.push(''); continue; }
        // Raqamli katakni formatsiz ko'rinishda olamiz
        const val = cell.t === 'n'
          ? (Number.isInteger(cell.v) ? String(cell.v) : String(Math.round(cell.v * 100) / 100))
          : String(cell.v ?? '').trim();
        row.push(val);
      }
      rows.push(row);
    }

    // Har bir qatorni tab bilan ajratib chiqaramiz (PDF ning tab-ustun formati bilan mos)
    for (const row of rows) {
      const line = row.join('\t').replace(/\t+$/, '').trim();
      if (!line) continue;
      lines.push({ text: line, page, raw: line });
      rawText += line + '\n';
    }

    // Har bir list yangi "sahifa"
    page++;
  }

  if (!lines.length) warnings.push('Excel faylidan matn chiqmadi yoki fayl bo\'sh');
  return { pageCount: workbook.SheetNames.length, rawText, lines, library: 'xlsx', warnings };
}

// ─── Word (.docx) ────────────────────────────────────────────────────────────

async function extractWord(data: Buffer): Promise<ExtractResult> {
  const mammoth = require('mammoth');
  const warnings: string[] = [];

  let text = '';
  try {
    const result = await mammoth.extractRawText({ buffer: data });
    text = result.value || '';
    if (result.messages?.length) {
      const msgs = result.messages.filter((m: any) => m.type === 'error').map((m: any) => m.message);
      warnings.push(...msgs.slice(0, 3));
    }
  } catch (err: any) {
    warnings.push('Word fayl o\'qishda xatolik: ' + err.message);
  }

  if (!text.trim()) warnings.push("Word faylidan matn chiqmadi (himoyalangan yoki bo'sh bo'lishi mumkin)");

  const physical = text.split(/\r?\n/);
  const lines: ExtractedLine[] = [];

  for (const raw of physical) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    lines.push({ text: trimmed, page: 1, raw });
  }

  return { pageCount: 1, rawText: text, lines, library: 'mammoth', warnings };
}

// ─── Oddiy matn (CSV, TXT) ───────────────────────────────────────────────────

async function extractText_plain(data: Buffer): Promise<ExtractResult> {
  const text = data.toString('utf8');
  const physical = text.split(/\r?\n/);
  const lines: ExtractedLine[] = [];

  for (const raw of physical) {
    // CSV → tab separator ga o'tkazamiz (oddiy vergul bilan ajratilgan bo'lsa)
    const normalized = raw.includes('\t') ? raw.trim() : raw.replace(/,/g, '\t').trim();
    if (!normalized) continue;
    lines.push({ text: normalized, page: 1, raw });
  }

  return { pageCount: 1, rawText: text, lines, library: 'text', warnings: [] };
}

// ─── Asosiy dispatcher ────────────────────────────────────────────────────────

/**
 * Faylni o'qib ExtractResult qaytaradi.
 * @param input  — fayl Buffer yoki yo'l (string)
 * @param filename — original fayl nomi (format aniqlash uchun)
 */
export async function extractText(input: Buffer | string, filename = ''): Promise<ExtractResult> {
  const data: Buffer = typeof input === 'string' ? fs.readFileSync(input) : input;
  const ext = path.extname(filename).toLowerCase().slice(1) || detectExtFromBuffer(data);

  switch (ext) {
    case 'xlsx':
    case 'xls':
      return extractExcel(data);

    case 'docx':
    case 'doc':
      return extractWord(data);

    case 'csv':
    case 'txt':
      return extractText_plain(data);

    case 'pdf':
    default:
      return extractPdf(data);
  }
}

// Agar extension yo'q bo'lsa — magic bytes dan format aniqlash
function detectExtFromBuffer(buf: Buffer): string {
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf'; // %PDF
  if (buf[0] === 0x50 && buf[1] === 0x4B) return 'xlsx'; // PK (ZIP-based: xlsx, docx)
  if (buf[0] === 0xD0 && buf[1] === 0xCF) return 'xls'; // CFBF (legacy Office)
  return 'pdf'; // fallback
}

// ─── CLI demo: `ts-node src/smeta/extract.ts <fayl>` ─────────────────────────
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Foydalanish: ts-node src/smeta/extract.ts <fayl>'); process.exit(1); }
  extractText(fs.readFileSync(file), file).then(r => {
    console.log(`Kutubxona: ${r.library}`);
    console.log(`Sahifalar: ${r.pageCount}`);
    console.log(`Qatorlar (bo'sh emas): ${r.lines.length}`);
    if (r.warnings.length) console.log('Ogohlantirishlar:', r.warnings);
    r.lines.slice(0, 15).forEach(l => console.log(`p${l.page} | ${JSON.stringify(l.text)}`));
  }).catch(e => { console.error('XATO:', e.message); process.exit(1); });
}
