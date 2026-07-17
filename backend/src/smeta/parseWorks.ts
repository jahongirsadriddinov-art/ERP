// ─── 5-bo'lim: ЛОКАЛЬНАЯ РЕСУРСНАЯ ВЕДОМОСТЬ (Форма N5) ───────────────────────
// Ierarxiya: butun № = ish (работа), kasrli № (3.1) = shu ishning norma sarfi.
// Bo'lim nomlari (ЗЕМЛЯННЫЕ РАБОТЫ, КРОВЛЯ...) raqamsiz/birliksiz qatorlar —
// dinamik aniqlanadi (hardcode yo'q).

import { ExtractedLine, WorkRow, NormRow } from './types';
import { findUnitInLine, tokenizeNumbers, isShifr, isNormativeShifr } from './normalize';

const NORM_RE = /^(\d+\.\d+)\s+(.*)$/;      // "3.1 ..."
const WORK_RE = /^(\d+)\s+(\S.*)$/;          // "3 Е1101-013-03 ..."
// Bo'lim sarlavhasi: to'liq katta harf (Cyrillic), raqam/vergul yo'q, qisqa
const SECTION_RE = /^[А-ЯЁ][А-ЯЁ\s\-]{2,38}$/;
// Ish nomi odatda shu fe'llardan biri bilan boshlanadi — shifr izohidan ajratish uchun
const NAME_VERBS = /(УСТРОЙСТВО|УСТАНОВКА|РАЗРАБОТКА|ЗАСЫПКА|УКЛАДКА|МОНТАЖ|ПРОКЛАДКА|ОКРАСКА|ОКРАШИВАНИЕ|ОБЛИЦОВКА|ШТУКАТУРКА|ОШТУКАТУРИВАНИЕ|БЕТОНИРОВАНИЕ|АРМИРОВАНИЕ|КЛАДКА|ГИДРОИЗОЛЯЦИЯ|ИЗОЛЯЦИЯ|УТЕПЛЕНИЕ|ПОКРАСКА|ПОКРЫТИ|ЗАЛИВКА|ДЕМОНТАЖ|ПЛАНИРОВКА|РАЗБОРКА|СВАРКА|БУРЕНИЕ|ЗАБИВКА|ОГРУНТОВКА|ГРУНТОВКА|ПРОБИВКА|СВЕРЛЕНИЕ|РЕЗКА|НАВЕСКА|ОСТЕКЛЕНИЕ|ЗАПОЛНЕНИЕ|ПРИБОРЫ|БЛОК|РАДИАТОР|ТРУБ)/i;

export interface WorksParseResult {
  works: WorkRow[];
  warnings: string[];
}

// 4-bo'lim guruh nomlari 5-bo'limда bo'lim sarlavhasi EMAS
const NOT_SECTION = /^(ТРУДОВЫЕ\s+РЕСУРСЫ|РЕСУРСЫ\s+ОБЩЕГО|СТРОИТЕЛЬНЫЕ\s+МАШИНЫ|МАТЕРИАЛЬНЫЕ\s+РЕСУРСЫ|ОБОРУДОВАНИЕ)/i;
function looksLikeSection(line: string): boolean {
  if (!SECTION_RE.test(line)) return false;
  if (/\d/.test(line)) return false;
  if (line.includes(',')) return false;
  if (NOT_SECTION.test(line)) return false;
  // ko'p so'zli uzun ta'rif emas
  return line.split(/\s+/).length <= 5;
}

// Buferdagi ish sarlavhasini WorkRow ga aylantiradi (birlik topilgan bo'lsa)
function buildWork(buf: string[], section: string | null): WorkRow | null {
  if (!buf.length) return null;
  let unitIdx = -1;
  let unitInfo: ReturnType<typeof findUnitInLine> = null;
  for (let i = buf.length - 1; i >= 0; i--) {
    const info = findUnitInLine(buf[i]);
    if (info) { unitIdx = i; unitInfo = info; break; }
  }
  const rawLine = buf.join(' ⏎ ');
  const warnings: string[] = [];
  if (!unitInfo) { warnings.push('birlik topilmadi'); }

  const headerText = [...buf.slice(0, unitIdx >= 0 ? unitIdx : buf.length), unitInfo ? unitInfo.before : '']
    .join(' ').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();

  const index = parseInt(headerText, 10);
  const rest = headerText.replace(/^\d+\s*/, '');
  let shifr: string | null = null;
  let shifrNote: string | null = null;
  let name = rest.trim();

  // Normativ shifr — bo'lingan bo'lsa ham (dash atrofида probel) yig'amiz.
  // "Е1001-037- 02ДОП. 11 ..." → shifr "Е1001-037-02", note "ДОП. 11 ...".
  const nm = rest.match(/^([А-ЯЁA-Z]?\d{3,4})\s*-\s*(\d{1,3})\s*-\s*(\d{1,3})\s*(.*)$/);
  if (nm) {
    shifr = `${nm[1]}-${nm[2]}-${nm[3]}`;
    const after = nm[4].trim();
    const at = after.search(NAME_VERBS);
    if (at > 0) { shifrNote = after.slice(0, at).trim() || null; name = after.slice(at).trim(); }
    else { name = after; } // fe'l boshda yoki topilmadi — hammasi nom
  } else if (/^С(\s|$)/i.test(rest)) {
    shifr = 'С';
    name = rest.replace(/^С\s*/i, '').trim();
  }

  // Ishning hajmi (по проектным данным) — birlikdan keyin raqam bo'lsa
  const nums = unitInfo ? unitInfo.afterParts.flatMap(p => tokenizeNumbers(p)) : [];
  const volume = nums.length ? nums[nums.length - 1].value : null;

  return {
    index, shifr, shifrNote, name,
    unit: unitInfo ? unitInfo.unit : '',
    volume, section,
    norms: [], rawLine, warnings,
  };
}

function buildNorm(buf: string[]): NormRow | null {
  if (!buf.length) return null;
  let unitInfo: ReturnType<typeof findUnitInLine> = null;
  let unitIdx = -1;
  for (let i = buf.length - 1; i >= 0; i--) {
    const info = findUnitInLine(buf[i]);
    if (info) { unitIdx = i; unitInfo = info; break; }
  }
  const rawLine = buf.join(' ⏎ ');
  const headerText = [...buf.slice(0, unitIdx >= 0 ? unitIdx : buf.length), unitInfo ? unitInfo.before : '']
    .join(' ').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
  const htokens = headerText.split(' ').filter(Boolean);
  const index = htokens[0];
  let shifr: string | null = null;
  let nameStart = 1;
  if (htokens[1] && isShifr(htokens[1])) { shifr = htokens[1]; nameStart = 2; }
  const name = htokens.slice(nameStart).join(' ').trim();
  const nums = unitInfo ? unitInfo.afterParts.flatMap(p => tokenizeNumbers(p)) : [];
  return {
    index, shifr, name,
    unit: unitInfo ? unitInfo.unit : '',
    perUnit: nums[0]?.value ?? 0,
    byProject: nums[1]?.value ?? nums[0]?.value ?? 0,
    rawLine,
  };
}

export function parseWorks(section5: ExtractedLine[]): WorksParseResult {
  const works: WorkRow[] = [];
  const warnings: string[] = [];
  let currentSection: string | null = null;
  let currentWork: WorkRow | null = null;
  let workBuf: string[] = [];
  let normBuf: string[] = [];

  const finishWork = () => {
    if (!workBuf.length) return;
    const w = buildWork(workBuf, currentSection);
    if (w) { works.push(w); currentWork = w; }
    workBuf = [];
  };
  const finishNorm = () => {
    if (!normBuf.length || !currentWork) { normBuf = []; return; }
    const n = buildNorm(normBuf);
    if (n) currentWork.norms.push(n);
    normBuf = [];
  };

  // header/noise qatorlarni o'tkazamiz — birinchi ish/norma topilguncha
  let started = false;
  // 6-bo'lim (ИТОГО ПО ЛОКАЛЬНОЙ ВЕДОМОСТИ — 4-bo'limning narxsiz takrori) boshlanishi
  const S6_STOP = /^(ИТОГО\s+ПО\s+ЛОКАЛЬНОЙ|ТРУДОВЫЕ\s+РЕСУРСЫ|РЕСУРСЫ\s+ОБЩЕГО\s+НАЗНАЧ|СТРОИТЕЛЬНЫЕ\s+МАШИНЫ|МАТЕРИАЛЬНЫЕ\s+РЕСУРСЫ|ОБОРУДОВАНИЕ\s*$)/i;

  for (const ln of section5) {
    const line = ln.text;

    // 6-bo'lim boshlandi — ishlar tugadi, to'xtaymiz
    if (started && S6_STOP.test(line)) break;

    if (NORM_RE.test(line)) {
      started = true;
      finishWork();        // ish sarlavhasi yakunlansin
      finishNorm();        // oldingi norma
      normBuf = [line];
      if (findUnitInLine(line)) finishNorm();
      continue;
    }

    const wm = line.match(WORK_RE);
    if (wm && !NORM_RE.test(line)) {
      // Ish boshi FAQAT: "№ <normativ shifr yoki С> ..." — plain raqamli shifr
      // (norma) yoki wrapped nom bo'lagi ("100 ММ", "686 КПА") emas.
      const tok2 = wm[2].split(/\s+/)[0];
      // Ish boshi: (a) normativ shifr (to'liq/bo'lingan) yoki С, YOKI
      // (b) shifrsiz ish — lekin shu qatorда birlik bor (masalan "103 ЩИТ ... ШТ").
      const noShifrWork = /^\d+\s*\t/.test(line) && !isShifr(tok2) && !!findUnitInLine(line);
      if (/^[А-ЯЁA-Z]?\d{3,4}-\d/.test(tok2) || /^С$/i.test(tok2) || noShifrWork) {
        started = true;
        finishNorm();
        finishWork();
        workBuf = [line];
        if (findUnitInLine(line)) finishWork();
        continue;
      }
      // aks holda — davomi bo'lishi mumkin (pastda ko'rib chiqiladi)
    }

    if (started && looksLikeSection(line) && !workBuf.length && !normBuf.length) {
      finishNorm(); finishWork();
      currentSection = line.trim();
      continue;
    }

    // davomi (wrapped) — qaysi buferga tegishli bo'lsa
    if (!started) continue; // hali sarlavhalar
    if (normBuf.length) { normBuf.push(line); if (findUnitInLine(line)) finishNorm(); }
    else if (workBuf.length) { workBuf.push(line); if (findUnitInLine(line)) finishWork(); }
    // aks holda — ortiqcha qator, o'tkazamiz
  }
  finishNorm(); finishWork();

  return { works, warnings };
}
