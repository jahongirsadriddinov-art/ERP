import * as xlsx from 'xlsx';
import mammoth from 'mammoth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';

export interface ParsedMaterial {
  name: string;
  unit: string;
  quantity: number;
  price?: number;
  code?: string;
}

type ProgressFn = (msg: string, percent: number) => void;

// ─── Key rotation ─────────────────────────────────────────────────────────────
const GEMINI_KEYS: string[] = (
  process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || ''
).split(',').map(k => k.trim()).filter(Boolean);

let keyIdx = 0;
function currentKey(): string { return GEMINI_KEYS[keyIdx] || ''; }
function rotateKey(): boolean {
  const next = (keyIdx + 1) % GEMINI_KEYS.length;
  if (next === keyIdx) return false;
  keyIdx = next;
  console.warn(`[Gemini] Key ${keyIdx + 1}/${GEMINI_KEYS.length} ga o'tildi`);
  return true;
}
function isQuotaError(err: any): boolean {
  const msg = String(err?.message || err?.toString() || '');
  return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
}
function isTransientError(err: any): boolean {
  const msg = String(err?.message || err?.toString() || '');
  return msg.includes('503') || msg.includes('502') || msg.includes('high demand') || msg.includes('overloaded') || msg.includes('unavailable');
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Units list for direct Excel parsing ─────────────────────────────────────
const KNOWN_UNITS = new Set([
  'М2', 'М3', 'КВ.М', 'КВМ', 'КУБ.М', 'КУБМ', 'КВ М', 'КУБ М',
  'ШТ', 'ШТУК', 'ШТ.', 'ШТУ', 'ШТУКА',
  'КГ', 'Т', 'ТН', 'ТОНН', 'ТОННА', 'ТНА',
  'М', 'ПМ', 'ЛМ', 'РМ', 'МП', 'Л.М',
  'КОМ', 'КПЛ', 'ЕД', 'ЕД.', 'ЕДИНИЦА',
  'НОР', 'НОРМ', 'НОРМ.ЧАС', 'НОР.ЧАС',
  'ЧЕЛ.Ч', 'ЧЕЛ-Ч', 'МАШ.Ч', 'МАШ-Ч', 'ЧЕЛ Ч', 'МАШ Ч',
  'Л', 'ЛИТ', 'ЛТР',
  'ДОН', 'ТА', 'ДОНА',
  'М2/ШТ', 'ЛМ/ШТ', 'М3/ШТ',
  'КОМП', 'КОМПЛ', 'КОМПЛЕКТ',
  'УП', 'УПА', 'УП.', 'УПАК',
  'М.П', 'Л.М', 'П.М',
  'КВ.М2', 'ПОГ.М', 'ПОГМ', 'П/М', 'РУЛОН', 'МЕШОК', 'ПАЧКА', 'БАНКА', 'ВЕДРО',
  'М.КВ', 'М.КУБ', 'МКВ', 'МКУБ', 'КВ', 'КУБ', 'ПОГ', 'ЯЩ', 'ЯЩИК', 'ПАР', 'ПАРА',
  // Latin/Uzbek variants
  'M2', 'M3', 'KG', 'T', 'SHT', 'DON', 'M', 'L', 'TA', 'DONA', 'KOMPLEKT', 'QOP', 'QUTI',
]);

// Punktuatsiya/probelsiz normalizatsiya — "шт." , "м2." , "кв. м" kabi variantlar mos kelsin
const KNOWN_UNITS_NORM = new Set(
  Array.from(KNOWN_UNITS).map(u => u.replace(/[.\s ]/g, ''))
);
const normalizeUnit = (s: string) => s.toUpperCase().replace(/[.\s ]/g, '');

// ─── Direct Excel parser — no Gemini API ─────────────────────────────────────
function parseExcelDirect(filePath: string, onProgress?: ProgressFn): ParsedMaterial[] {
  onProgress?.("Excel o'qilmoqda...", 20);
  const workbook = xlsx.readFile(filePath);
  const results: ParsedMaterial[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    }) as string[][];

    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const cells = row.map(c => (c != null ? String(c).trim() : ''));

      // Find unit cell (punktuatsiyani inobatga olmay)
      let unitIdx = -1;
      let unitStr = '';
      for (let i = 0; i < cells.length; i++) {
        const norm = normalizeUnit(cells[i]);
        if (norm && KNOWN_UNITS_NORM.has(norm)) {
          unitIdx = i;
          unitStr = cells[i];
          break;
        }
      }
      if (unitIdx === -1) continue;

      // Collect name: all text cells before unit, skip row numbers and codes
      const nameParts: string[] = [];
      let code = '';
      for (let i = 0; i < unitIdx; i++) {
        const cell = cells[i];
        if (!cell) continue;
        if (/^\d{1,4}$/.test(cell)) continue; // skip row/index numbers
        // Smeta code patterns: "01-01-001", "ТЕР01-01-001", "ГЭСН...", "ФЕР..."
        if (
          !code &&
          /^(ТЕР|ГЭСН|ФЕР|ТСН|ФЭС|ФЕС|ССЦ|ТЦ)?[\s]?\d{2}[-–]\d{2}[-–]\d{3}/.test(cell)
        ) {
          code = cell;
          continue;
        }
        nameParts.push(cell);
      }

      const name = nameParts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (!name || name.length < 2) continue;

      // Quantity: first positive number after unit
      let quantity = 0;
      for (let i = unitIdx + 1; i < Math.min(unitIdx + 6, cells.length); i++) {
        const num = parseFloat(cells[i].replace(/\s/g, '').replace(',', '.'));
        if (!isNaN(num) && num > 0) {
          quantity = num;
          break;
        }
      }
      if (quantity <= 0) continue;

      // Price: second positive number after unit (unit price column)
      let price: number | undefined;
      let numCount = 0;
      for (let i = unitIdx + 1; i < Math.min(unitIdx + 7, cells.length); i++) {
        const num = parseFloat(cells[i].replace(/\s/g, '').replace(',', '.'));
        if (!isNaN(num) && num > 0) {
          numCount++;
          if (numCount === 2) { price = num; break; }
        }
      }

      results.push({
        name,
        unit: unitStr,
        quantity,
        ...(price ? { price } : {}),
        ...(code ? { code } : {}),
      });
    }
  }

  onProgress?.(`Excel tayyor: ${results.length} ta qator`, 90);
  console.log(`[Excel-Direct] ${results.length} ta qator (API chaqirilmadi)`);
  return results;
}

// ─── Gemini generate with key rotation ───────────────────────────────────────
async function geminiGenerate(
  parts: any[],
  onProgress?: ProgressFn,
  progressMsg?: string
): Promise<string> {
  const tried = new Set<number>();
  while (true) {
    if (tried.has(keyIdx)) {
      console.error("[Gemini] Barcha keylar limitga to'ldi");
      return '[]';
    }
    tried.add(keyIdx);
    const key = currentKey();
    if (!key) return '[]';
    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 65536, responseMimeType: 'application/json' },
      });
      if (progressMsg) onProgress?.(progressMsg, 50);
      const result = await model.generateContent(parts);
      return result.response.text().trim();
    } catch (err: any) {
      if (isQuotaError(err)) {
        console.warn(`[Gemini] Key ${keyIdx + 1} limitga to'ldi, rotatsiya...`);
        if (!rotateKey()) return '[]';
        continue;
      }
      throw err;
    }
  }
}

// ─── PDF upload with key rotation ────────────────────────────────────────────
async function geminiUploadPDF(
  filePath: string
): Promise<{ uri: string; mimeType: string; key: string }> {
  const tried = new Set<number>();
  while (true) {
    if (tried.has(keyIdx)) throw new Error("Barcha keylar limitga to'ldi (upload)");
    tried.add(keyIdx);
    const key = currentKey();
    if (!key) throw new Error('Gemini API key topilmadi');
    try {
      const fileManager = new GoogleAIFileManager(key);
      const res = await fileManager.uploadFile(filePath, {
        mimeType: 'application/pdf',
        displayName: 'Smeta PDF',
      });
      return { uri: res.file.uri, mimeType: res.file.mimeType, key };
    } catch (err: any) {
      if (isQuotaError(err)) {
        console.warn(`[Gemini] Upload key ${keyIdx + 1} limitga to'ldi, rotatsiya...`);
        if (!rotateKey()) throw err;
        continue;
      }
      throw err;
    }
  }
}

// ─── Gemini prompt — hech narsa skip qilinmaydi ──────────────────────────────
const GEMINI_PROMPT = `
Sizga qurilish smetasi berilgan.
Sizning vazifangiz hujjatdagi BARCHA materiallar, mashina-mexanizmlar, mehnat resurslari va xizmatlarni topish.
DIQQAT: Hujjatda yuzlab yoki minglab qatorlar bo'lishi mumkin. Ularning BARCHASINI bittama-bitta chiqarishingiz SHART!
Hech narsani o'tkazib yubormang, qisqartirmang, "va hokazo" yoki "..." deb yozmang.
Agar 500 ta qator bo'lsa, JSON massivda 500 ta obyekt chiqishi kerak.
ASLO QISQARTIRMANG! DO NOT TRUNCATE!

MUHIM: Hujjatda "ИТОГО", "РЕСУРСЫ" yoki yakuniy jadvallar bo'lsa, aynan o'sha jadvaldan o'qi — u to'liqroq.

Javob FAQAT JSON massiv (boshqa hech narsa yozma):
[
  { "name": "Sement M400", "unit": "т", "quantity": 15.5, "price": 850000, "code": "ТЕР01-01-001" }
]

Qoidalar:
- name, unit, quantity — majburiy. price va code — mavjud bo'lsa qo'y, bo'lmasa qo'yma.
- Raqamlar faqat son (matn emas, probel yoki vergul ishlatma).
- Hech qanday qo'shimcha matn yozmang — faqat JSON massiv.
`;

// ─── PDF parser ───────────────────────────────────────────────────────────────
async function parsePDF(filePath: string, onProgress?: ProgressFn): Promise<ParsedMaterial[]> {
  onProgress?.('PDF Gemini ga yuklanmoqda...', 30);
  const { uri, mimeType, key } = await geminiUploadPDF(filePath);

  onProgress?.('Gemini PDF tahlil qilmoqda...', 52);
  const parts = [GEMINI_PROMPT, { fileData: { mimeType, fileUri: uri } }];

  const tried = new Set<number>();
  let responseText = '[]';
  let transientRetries = 0;
  while (true) {
    if (tried.has(keyIdx)) break;
    tried.add(keyIdx);
    try {
      const genAI = new GoogleGenerativeAI(currentKey());
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 65536, responseMimeType: 'application/json' },
      });
      responseText = (await model.generateContent(parts)).response.text().trim();
      break;
    } catch (err: any) {
      if (isTransientError(err) && transientRetries < 3) {
        transientRetries++;
        console.warn(`[PDF] Vaqtinchalik xato (${transientRetries}/3), ${transientRetries * 3}s kutilmoqda...`);
        await sleep(transientRetries * 3000);
        tried.delete(keyIdx); // retry same key
        continue;
      }
      if (isQuotaError(err) && rotateKey()) { tried.clear(); transientRetries = 0; continue; }
      throw err;
    }
  }

  // Cleanup uploaded file
  try {
    const fm = new GoogleAIFileManager(key);
    const fn = uri.split('/').pop();
    if (fn) fm.deleteFile(`files/${fn}`).catch(() => {});
  } catch {}

  onProgress?.('Natijalar qayta ishlanmoqda...', 82);
  return parseGeminiResponse(responseText);
}

// ─── DOCX parser ──────────────────────────────────────────────────────────────
async function parseDocx(filePath: string, onProgress?: ProgressFn): Promise<ParsedMaterial[]> {
  onProgress?.("Word fayli o'qilmoqda...", 20);
  const { value } = await mammoth.extractRawText({ path: filePath });
  console.log(`[DOCX] Matn: ${value.length} belgi`);
  const prompt = GEMINI_PROMPT + `\nHujjat matni:\n${value.substring(0, 100000)}`;
  const responseText = await geminiGenerate([prompt], onProgress, 'Gemini Word tahlil qilmoqda...');
  onProgress?.('Natijalar qayta ishlanmoqda...', 82);
  return parseGeminiResponse(responseText);
}

// ─── Kesilgan JSON massivini qutqarish ───────────────────────────────────────
// Katta smeta 65k token limitidan oshsa, Gemini javobi yarim uzilib qoladi va
// JSON.parse xato beradi. Barcha qatorlarni yo'qotish o'rniga oxirgi to'liq
// obyektgacha kesib, massivni yopib qayta parse qilamiz.
function salvageTruncatedJson(text: string): any[] | null {
  const start = text.indexOf('[');
  if (start === -1) return null;
  const lastObjEnd = text.lastIndexOf('}');
  if (lastObjEnd === -1 || lastObjEnd < start) return null;
  const candidate = text.slice(start, lastObjEnd + 1) + ']';
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mapGeminiItems(parsed: any[]): ParsedMaterial[] {
  const results: ParsedMaterial[] = [];
  for (const item of parsed) {
    if (!item || !item.name || !item.unit || item.quantity === undefined) continue;
    const qty = parseFloat(item.quantity);
    if (isNaN(qty)) continue;
    results.push({
      name: item.name,
      unit: item.unit,
      quantity: qty,
      ...(item.price != null && !isNaN(parseFloat(item.price)) ? { price: parseFloat(item.price) } : {}),
      ...(item.code ? { code: String(item.code) } : {}),
    });
  }
  return results;
}

// ─── Gemini response parser ───────────────────────────────────────────────────
function parseGeminiResponse(responseText: string): ParsedMaterial[] {
  let parsed: any;
  try {
    parsed = JSON.parse(responseText);
  } catch (err) {
    // Kesilgan JSON — qutqarishga urinamiz
    const salvaged = salvageTruncatedJson(responseText);
    if (salvaged) {
      console.warn(`[Gemini] JSON kesilgan edi — ${salvaged.length} ta qator qutqarildi`);
      parsed = salvaged;
    } else {
      console.error('[Gemini] JSON parse xatosi:', err);
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const results = mapGeminiItems(parsed);
  console.log(`[Gemini] ${results.length} ta qator (key ${keyIdx + 1}/${GEMINI_KEYS.length})`);
  return results;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export const parseSmeta = async (
  filePath: string,
  mimetype: string,
  onProgress?: ProgressFn
): Promise<ParsedMaterial[]> => {
  if (GEMINI_KEYS.length === 0) {
    console.error('GEMINI_API_KEY topilmadi!');
    return [];
  }

  console.log(`[Smeta] ${filePath} | ${mimetype}`);
  const ext = filePath.split('.').pop()?.toLowerCase();

  try {
    let parsedMaterials: ParsedMaterial[] = [];
    if (mimetype === 'application/pdf' || ext === 'pdf') {
      onProgress?.('PDF tayyorlanmoqda...', 15);
      parsedMaterials = await parsePDF(filePath, onProgress);
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimetype === 'application/vnd.ms-excel' ||
      ext === 'xlsx' || ext === 'xls'
    ) {
      parsedMaterials = parseExcelDirect(filePath, onProgress);
    } else if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx'
    ) {
      parsedMaterials = await parseDocx(filePath, onProgress);
    } else {
      console.warn(`[Smeta] Noto'g'ri fayl turi: ${mimetype}`);
      return [];
    }

    // Bir xil nomli va o'lchovli materiallarni birlashtirish (aggregate)
    const aggregated = new Map<string, ParsedMaterial>();
    for (const mat of parsedMaterials) {
      const key = `${mat.name.toLowerCase().trim()}_${mat.unit.toLowerCase().trim()}`;
      if (aggregated.has(key)) {
        const existing = aggregated.get(key)!;
        existing.quantity += mat.quantity;
        if (!existing.price && mat.price) existing.price = mat.price;
      } else {
        aggregated.set(key, { ...mat });
      }
    }
    
    return Array.from(aggregated.values());
  } catch (error) {
    console.error('[Smeta] Xato:', error);
    return [];
  }
};
