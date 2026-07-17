// ─── Hujjatni mantiqiy bo'limlarga ajratish ──────────────────────────────────
import { ExtractedLine } from './types';

export interface Sections {
  metaLines: ExtractedLine[];   // titul + izoh + стартовая стоимость
  section4: ExtractedLine[];    // ЛОКАЛЬНЫЙ РЕСУРСНЫЙ СМЕТНЫЙ РАСЧЕТ
  section5: ExtractedLine[];    // ЛОКАЛЬНАЯ РЕСУРСНАЯ ВЕДОМОСТЬ (Форма N5)
  bounds: { s4start: number; s5start: number; s5end: number };
}

export function splitSections(lines: ExtractedLine[]): Sections {
  const find = (re: RegExp, from = 0) => {
    for (let i = Math.max(0, from); i < lines.length; i++) if (re.test(lines[i].text)) return i;
    return -1;
  };

  // 4-bo'lim: "ЛОКАЛЬНЫЙ РЕСУРСНЫЙ СМЕТНЫЙ РАСЧЕТ"
  const s4start = find(/ЛОКАЛЬНЫЙ\s+РЕСУРСНЫЙ\s+СМЕТНЫЙ/i);

  // 5-bo'lim: "Форма N 5" ishonchli anchor (титулда garbled "вЕдомость" ham uchraydi)
  let s5start = find(/Форма\s*N\s*5/i, s4start >= 0 ? s4start : 0);
  if (s5start < 0) s5start = find(/ЛОКАЛЬНАЯ\s+РЕСУРСНАЯ\s+ВЕДОМОСТ/i, s4start >= 0 ? s4start + 1 : 0);

  // 5-bo'lim oxiri: 6-bo'lim (ИТОГО ПО ЛОКАЛЬНОЙ...) yoki Лицензия yoki hujjat oxiri
  let s5end = find(/ИТОГО\s+ПО\s+ЛОКАЛЬНОЙ\s+РЕСУРСНОЙ/i, s5start >= 0 ? s5start + 1 : 0);
  if (s5end < 0) s5end = find(/Лицензия/i, s5start >= 0 ? s5start + 1 : 0);
  if (s5end < 0) s5end = lines.length;

  return {
    metaLines: lines.slice(0, s4start >= 0 ? s4start : Math.min(lines.length, 80)),
    section4: s4start >= 0 ? lines.slice(s4start, s5start >= 0 ? s5start : lines.length) : [],
    section5: s5start >= 0 ? lines.slice(s5start, s5end) : [],
    bounds: { s4start, s5start, s5end },
  };
}
