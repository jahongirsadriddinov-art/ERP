// ─── Raqam / birlik / nom / shifr tozalash — deterministik ───────────────────

// ─── Raqamlar ────────────────────────────────────────────────────────────────
// Format: bo'shliq = minglik ajratgich, vergul = kasr. "-"/"--"/"—" = null.
// Manfiy qiymatlar bor: "-0,03162", "-2,601" (ВЫЧИТАЕТСЯ ПОЗИЦИЯ) — saqlanadi.

const DASH_RE = /^[-–—]{1,3}$/;
// "Bo'shliq" turlari (oddiy, NBSP, figure, thin, narrow-NBSP)
const SP = '[\\u0020\\u00A0\\u2007\\u2009\\u202F]';

// Bitta token: raqam (ichida minglik bo'shliqlari, ixtiyoriy ",kasr") YOKI dash.
// "\\d+" (\\d{1,3} emas) — qty ba'zan bo'shliqsiz: "4558,9629". Minglik guruhlari
// aynan 3 xonali (?:SP\\d{3})* — shu tufayli "36 030,00 164 259 433,29" to'g'ri ajraladi.
const TOKEN_RE = new RegExp(`-?\\d+(?:${SP}\\d{3})*(?:,\\d+)?|—|–|--|-`, 'g');
const WS_STRIP = new RegExp(`[\\u0020\\u00A0\\u2007\\u2009\\u202F\\t]`, 'g');

/** Bitta raqam satrini songa aylantiradi. Dash/bo'sh/yaroqsiz → null. */
export function parseNum(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === '' || DASH_RE.test(t)) return null;
  const cleaned = t.replace(WS_STRIP, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function isDash(s: string): boolean {
  return DASH_RE.test(s.trim());
}

export interface NumToken { type: 'num' | 'dash'; value: number | null; raw: string; }

/**
 * Satr oxiridagi raqam/dash tokenlarini ketma-ket ajratadi (qty, price, total).
 * "4558,9629 36 030,00 164 259 433,29" → [4558.9629, 36030, 164259433.29]
 * "217,2842 - -" → [217.2842, dash, dash]
 * "8 42 232,00 337 856,00" → [8, 42232, 337856]
 */
export function tokenizeNumbers(tail: string): NumToken[] {
  const s = tail.replace(/\t/g, ' ');
  const out: NumToken[] = [];
  const matches = s.match(TOKEN_RE) || [];
  for (const m of matches) {
    if (DASH_RE.test(m)) { out.push({ type: 'dash', value: null, raw: m }); continue; }
    const n = parseNum(m);
    if (n == null) continue;
    out.push({ type: 'num', value: n, raw: m });
  }
  return out;
}

// ─── Birliklar ───────────────────────────────────────────────────────────────
// Uzunroqni oldin (100М3 ni М3 dan oldin). Nuqta/probel normalizatsiya.
export const UNITS: string[] = [
  '1000ШТ', '100ШТ', '10ШТ',
  '1000М2', '100М2', '100М3', '100М', '10М',
  '10КОМПЛ.', 'КОМПЛ.', 'КОМПЛ',
  'ЧЕЛ.-Ч', 'МАШ.-Ч',
  'М2', 'М3', 'ПМ', 'КМ', 'ТН', 'КГ', 'ШТ', 'КОТЕЛ',
  'М', 'Т', 'Л',
];
const normUnitKey = (s: string) => s.toUpperCase().replace(/[.\s -]/g, '');
const UNIT_KEYS = new Map<string, string>();
for (const u of UNITS) if (!UNIT_KEYS.has(normUnitKey(u))) UNIT_KEYS.set(normUnitKey(u), u);
const UNITS_SORTED = [...UNITS].sort((a, b) => normUnitKey(b).length - normUnitKey(a).length);

/** Token birlikmi? Ha bo'lsa normalizatsiya qilingan birlikni qaytaradi. */
export function asUnit(token: string): string | null {
  const key = normUnitKey(token);
  if (!key) return null;
  return UNIT_KEYS.get(key) || null;
}

export interface UnitMatch {
  unit: string;
  before: string;
  after: string;         // afterParts probel bilan birlashtirilgan (tekshiruv uchun)
  afterParts: string[];  // birlikdan keyingi TAB-kataklar (har biri alohida tokenlashtiriladi)
}

/**
 * Satrda birlik + undan keyin raqam bor joyni topadi (anchor).
 * MUHIM: birlikdan keyingi qism TAB-kataklarга ajratib qaytariladi — chunki qty,
 * price, total ko'pincha alohida tab-kataklarda. Ularni bitta satrga qo'shib
 * tokenlashtirilsa "160 350,00" → "160350" bo'lib xato birlashadi.
 */
export function findUnitInLine(line: string): UnitMatch | null {
  const parts = line.split(/\t/).map(p => p.trim());
  for (let i = 0; i < parts.length; i++) {
    const u = asUnit(parts[i]);
    if (u) {
      const afterParts = parts.slice(i + 1).filter(p => p !== '');
      return { unit: u, before: parts.slice(0, i).join(' ').trim(), after: afterParts.join(' ').trim(), afterParts };
    }
  }
  // Tabsiz: "...so'z БИРЛИК raqam raqam" — bitta bo'lakda; comma-guruh bo'yicha ajraladi
  for (const u of UNITS_SORTED) {
    const esc = u.replace(/[.\-]/g, '\\$&');
    const re = new RegExp('(^|\\s)(' + esc + ')(?=\\s|$)', 'i');
    const m = line.match(re);
    if (m && m.index != null) {
      const at = m.index + m[1].length;
      const before = line.slice(0, at).trim();
      const after = line.slice(at + m[2].length).replace(/\t/g, ' ').trim();
      if (/[-\d]/.test(after) || after === '') {
        return { unit: asUnit(m[2]) || m[2].toUpperCase(), before, after, afterParts: after ? [after] : [] };
      }
    }
  }
  return null;
}

// ─── Nom ─────────────────────────────────────────────────────────────────────
export function shortName(rawName: string, words = 4): string {
  return rawName.split(/\s+/).filter(Boolean).slice(0, words).join(' ');
}

// ─── Shifr ───────────────────────────────────────────────────────────────────
const NORMATIVE_RE = /^[А-ЯЁA-Z]?\d{3,4}-\d{2,3}-\d{2,3}$/;
export function isNormativeShifr(s: string): boolean { return NORMATIVE_RE.test(s.trim()); }
export function isNumericShifr(s: string): boolean { return /^\d{1,6}$/.test(s.trim()); }
export function isIndividualShifr(s: string): boolean { return /^С$/i.test(s.trim()); }
export function isShifr(s: string): boolean {
  const t = s.trim();
  return isNumericShifr(t) || isIndividualShifr(t) || isNormativeShifr(t);
}
