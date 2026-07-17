// ─── Smeta parser — umumiy tiplar ───────────────────────────────────────────
// Deterministik parser (AI'siz). Barcha maydonlar hujjatdan xom holda olinadi.

export type Unit = string; // normalizatsiya qilingan: "М3", "ЧЕЛ.-Ч", "ШТ"...

export type ResourceGroup = 'labor' | 'general' | 'machinery' | 'material' | 'equipment';

// ─── Extraction bosqichi natijasi (extract.ts) ───────────────────────────────
export interface ExtractedLine {
  text: string;   // tozalangan fizik qator (NBSP/thin-space normalizatsiya qilingan)
  page: number;   // "-- N of M --" markerlaridan aniqlangan sahifa raqami
  raw: string;    // asl (tozalanmagan) qator — audit uchun
}

export interface ExtractResult {
  pageCount: number;
  rawText: string;         // to'liq matn (\n bilan)
  lines: ExtractedLine[];  // har bir fizik qator + sahifa raqami
  library: 'pdf-parse';    // qaysi kutubxona ishlatilgani
  warnings: string[];      // extraction darajasidagi ogohlantirishlar
}

// ─── Meta (titul + izoh + startovaya stoimost) ───────────────────────────────
export interface SmetaMeta {
  objectName: string | null;      // "TOSHKENT VILOYATI, OLMALIQ SHAHRIDA..."
  subObject: string | null;
  organization: string | null;
  totalWithVat: number | null;    // 865180958
  totalWithoutVat: number | null;
  vatAmount: number | null;
  currency: 'UZS';
  sourceFile: string;
  parsedAt: string;
}

// ─── 4-bo'lim: ЛОКАЛЬНЫЙ РЕСУРСНЫЙ СМЕТНЫЙ РАСЧЕТ ─────────────────────────────
export interface ResourceRow {
  index: number;              // № п.п. (1..N)
  shifr: string | null;       // "9219" | "С" | null
  shifrNote: string | null;   // "МИНСТРОЙ РУЗ 05.01.21 N 9", "К=2", "ДОП. 4"
  rawName: string;            // TO'LIQ asl nom
  shortName: string;          // birinchi 2-4 so'z — UI uchun
  spec: string | null;        // marka/o'lcham qismi (ixtiyoriy)
  unit: Unit;
  qty: number;
  price: number | null;       // "-"/"--" bo'lsa null
  total: number | null;
  group: ResourceGroup;
  category?: string;          // ixtiyoriy — categorize.ts
  rawLine: string;            // birlashtirilgan asl matn
  warnings: string[];
}

// ─── 5-bo'lim: ЛОКАЛЬНАЯ РЕСУРСНАЯ ВЕДОМОСТЬ ──────────────────────────────────
export interface NormRow {     // kasrli qatorlar (3.1, 3.2...)
  index: string;               // "3.1"
  shifr: string | null;
  name: string;
  unit: Unit;
  perUnit: number;             // на ед. измерения
  byProject: number;           // по проектным данным
  rawLine: string;
}

export interface WorkRow {     // butun raqamli ishlar
  index: number;
  shifr: string | null;        // "Е1101-013-03"
  shifrNote: string | null;
  name: string;
  unit: Unit;
  volume: number | null;
  section: string | null;      // "ЗЕМЛЯННЫЕ РАБОТЫ", "КРОВЛЯ"...
  norms: NormRow[];
  rawLine: string;
  warnings: string[];
}

// ─── Validatsiya ─────────────────────────────────────────────────────────────
export interface GroupTotal {
  group: string;
  declared: number;   // fayldagi СУМ
  computed: number;   // biz hisoblagan
  diff: number;
  passed: boolean;
}

export interface ValidationCheck {
  name: string;
  expected: number | string | null;
  actual: number | string | null;
  diff?: number;
  passed: boolean;
}

export interface Validation {
  ok: boolean;
  checks: ValidationCheck[];
  warnings: string[];
  errors: string[];
}

// ─── Yakuniy natija ──────────────────────────────────────────────────────────
export interface ParseResult {
  meta: SmetaMeta;
  resources: ResourceRow[];   // 4-bo'lim
  works: WorkRow[];           // 5-bo'lim
  totals: GroupTotal[];
  validation: Validation;
}
