// ─── 4-bo'lim: ЛОКАЛЬНЫЙ РЕСУРСНЫЙ СМЕТНЫЙ РАСЧЕТ ─────────────────────────────
// State machine: guruh sarlavhalari + СУМ yakunlari orasidagi qatorlar.
// Ko'p qatorli nomlar birlik+raqam topilguncha buferga yig'iladi.

import { ExtractedLine, ResourceRow, ResourceGroup } from './types';
import { findUnitInLine, tokenizeNumbers, isShifr, shortName, parseNum } from './normalize';

const GROUP_HEADERS: { re: RegExp; group: ResourceGroup }[] = [
  { re: /^ТРУДОВЫЕ\s+РЕСУРСЫ/i, group: 'labor' },
  { re: /^РЕСУРСЫ\s+ОБЩЕГО\s+НАЗНАЧЕНИЯ/i, group: 'general' },
  { re: /^СТРОИТЕЛЬНЫЕ\s+МАШИНЫ/i, group: 'machinery' },
  { re: /^МАТЕРИАЛЬНЫЕ\s+РЕСУРСЫ/i, group: 'material' },
  { re: /^ОБОРУДОВАНИЕ(?:\s|$)/i, group: 'equipment' }, // Cyrillic uchun \b ISHLAMAYDI
];

// СУМ yakun qatori — DIQQAT: Cyrillic uchun \b ishlamaydi (\w faqat lotin).
const SUM_RE = /^СУМ(?:\s|\t|$)/i;
// Rasm rasurs qatorlari tugagan blok (yakuniy summalar)
const END_RE = /^(ИТОГО\s+ПРЯМЫЕ|НАКЛАДНЫЕ\s+РАСХОД|СМЕТНАЯ\s+ПРИБЫЛЬ|ИТОГО\s+ПО\s+РЕСУРСНОМУ|ИТОГО\s+С\s+НАКЛАДНЫМИ|ИТОГО\s+ПО\s+СТРОИТЕЛЬНЫМ\s+МАТЕРИАЛАМ|ИТОГО\s+ОБОРУДОВАНИЕ)/i;
// Yangi qator boshi: "№ ..." (raqam bilan boshlanadi)
const ROW_START_RE = /^\d+\s+\S/;

export interface ResourceParseResult {
  resources: ResourceRow[];
  declaredTotals: { group: ResourceGroup; declared: number | null }[];
  warnings: string[];
}

function groupOf(line: string): ResourceGroup | null {
  for (const g of GROUP_HEADERS) if (g.re.test(line)) return g.group;
  return null;
}

// Buferdagi qatorlardan bitta resurs qatorini quradi.
function buildRow(buf: string[], group: ResourceGroup): ResourceRow | null {
  if (!buf.length) return null;
  // Pastdan yuqoriga birlik+raqam bor qatorni topamiz (value line)
  let unitIdx = -1;
  let unitInfo: ReturnType<typeof findUnitInLine> = null;
  for (let i = buf.length - 1; i >= 0; i--) {
    const info = findUnitInLine(buf[i]);
    if (info && /[-\d]/.test(info.after)) { unitIdx = i; unitInfo = info; break; }
  }
  const rawLine = buf.join(' ⏎ ');
  const warnings: string[] = [];

  if (!unitInfo) {
    return null; // birlik topilmadi — bu resurs qatori emas (yakun/sarlavha bo'lishi mumkin)
  }

  // Header = unitIdx dan oldingi qatorlar + shu qatorning birlikdan oldingi qismi
  const headerText = [...buf.slice(0, unitIdx), unitInfo.before]
    .join(' ').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
  const htokens = headerText.split(' ').filter(Boolean);

  const index = parseInt(htokens[0], 10);
  let shifr: string | null = null;
  let shifrNote: string | null = null;
  let nameStart = 1;
  if (htokens[1] && isShifr(htokens[1])) {
    shifr = htokens[1];
    nameStart = 2;
    // shifr'dan keyingi qo'shimcha izoh (К=2, ДОП. 4)
    const noteBits: string[] = [];
    while (htokens[nameStart] && /^(К=|ДОП\.?|N)$|^\d+$/.test(htokens[nameStart]) && noteBits.length < 3) {
      noteBits.push(htokens[nameStart]); nameStart++;
    }
    if (noteBits.length) shifrNote = noteBits.join(' ');
  }
  const rawName = htokens.slice(nameStart).join(' ').trim();

  // Raqamlar: qty, price, total — HAR BIR tab-katakni ALOHIDA tokenlashtiramiz
  // (aks holda "160 350,00" → "160350" bo'lib qty va price birlashib ketadi).
  const nums = unitInfo.afterParts.flatMap(p => tokenizeNumbers(p));
  let qty: number | null = null, price: number | null = null, total: number | null = null;
  if (nums.length >= 3) {
    qty = nums[0].value; price = nums[1].value; total = nums[2].value;
    if (nums.length > 3) warnings.push(`kutilmagan qo'shimcha raqamlar: ${nums.length}`);
  } else if (nums.length === 2) {
    qty = nums[0].value; total = nums[1].value; warnings.push('narx ustuni yo\'q (2 ta raqam)');
  } else if (nums.length === 1) {
    qty = nums[0].value; warnings.push('faqat miqdor topildi');
  } else {
    warnings.push('raqamlar topilmadi');
  }

  if (qty == null) warnings.push('miqdor (qty) yaroqsiz');
  if (!Number.isFinite(index)) warnings.push('№ yaroqsiz');
  if (!rawName) warnings.push('nom bo\'sh');

  return {
    index, shifr, shifrNote,
    rawName, shortName: shortName(rawName), spec: null,
    unit: unitInfo.unit,
    qty: qty ?? 0,
    price, total,
    group,
    rawLine,
    warnings,
  };
}

export function parseResources(section4: ExtractedLine[]): ResourceParseResult {
  const resources: ResourceRow[] = [];
  const declaredTotals: { group: ResourceGroup; declared: number | null }[] = [];
  const warnings: string[] = [];

  let currentGroup: ResourceGroup | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (!buf.length || !currentGroup) { buf = []; return; }
    const row = buildRow(buf, currentGroup);
    if (row) resources.push(row);
    buf = [];
  };

  for (const ln of section4) {
    const line = ln.text;

    // Guruh sarlavhasi?
    const g = groupOf(line);
    if (g) { flush(); currentGroup = g; continue; }

    // СУМ yakuni?
    if (SUM_RE.test(line)) {
      flush();
      const nums = tokenizeNumbers(line.replace(/^СУМ/i, ''));
      declaredTotals.push({ group: currentGroup ?? 'material', declared: nums.length ? nums[nums.length - 1].value : null });
      continue;
    }

    // Rasurs qatorlari tugadi (yakuniy summalar bloki)?
    if (END_RE.test(line)) { flush(); break; }

    // Guruhga kirmagan bo'lsak — hali sarlavha/tayyorgarlik qatorlari, o'tkazamiz
    if (!currentGroup) continue;

    // Yangi qator boshi (raqam bilan) va buferda tugallangan qator bor bo'lsa — flush
    if (ROW_START_RE.test(line) && buf.length && buf.some(b => findUnitInLine(b))) {
      flush();
    }
    buf.push(line);
  }
  flush();

  return { resources, declaredTotals, warnings };
}
