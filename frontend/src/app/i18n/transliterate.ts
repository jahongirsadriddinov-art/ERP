// Lotin yozuvidagi o'zbekcha matnni Kirill yozuviga o'giradi (qoidaviy, tarjima
// emas — bu ikkalasi BIR til, faqat yozuv turi boshqa). Backend'dagi
// (backend/src/utils/transliterate.ts) bilan bir xil — sayt va bot bir xil
// natija bersin uchun ataylab ikkalasida ham saqlangan (umumiy paket yo'q).
const APOSTROPHES = new Set(["'", "‘", "’", "ʻ", "ʼ", "`"]);

const DIGRAPHS: Record<string, string> = { sh: 'ш', ch: 'ч', yo: 'ё', yu: 'ю', ya: 'я', ts: 'ц' };

const SINGLE: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к',
  l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у',
  v: 'в', x: 'х', y: 'й', z: 'з', c: 'к',
};

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[a-zA-Z]/.test(ch);
}

export function latinToCyrillicUz(input: string): string {
  if (!input) return input;
  let out = '';
  const s = input;
  const n = s.length;
  let i = 0;

  while (i < n) {
    // i18next interpolatsiya belgilari — {{param}} — o'zgarishsiz o'tishi shart,
    // aks holda "param" ichidagi lotin harflari ham kirillga aylanib, i18next
    // buni topa olmay qoladi (masalan {{time}} -> {{тиме}} bo'lib singan).
    if (s[i] === '{' && s[i + 1] === '{') {
      const end = s.indexOf('}}', i + 2);
      if (end !== -1) {
        out += s.slice(i, end + 2);
        i = end + 2;
        continue;
      }
    }
    const ch = s[i];
    const lower = ch.toLowerCase();
    const isUpper = ch !== lower;

    if ((lower === 'o' || lower === 'g') && APOSTROPHES.has(s[i + 1] || '')) {
      const cy = lower === 'o' ? 'ў' : 'ғ';
      out += isUpper ? cy.toUpperCase() : cy;
      i += 2;
      continue;
    }

    if (i + 1 < n) {
      const two = lower + s[i + 1].toLowerCase();
      const cy = DIGRAPHS[two];
      if (cy) {
        out += isUpper ? cy.toUpperCase() : cy;
        i += 2;
        continue;
      }
    }

    const single = SINGLE[lower];
    if (single) {
      let cy = single;
      if (lower === 'e' && !isWordChar(s[i - 1])) cy = 'э';
      out += isUpper ? cy.toUpperCase() : cy;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

export function transliterateDict<T>(dict: T): T {
  if (typeof dict === 'string') return latinToCyrillicUz(dict) as unknown as T;
  if (Array.isArray(dict)) return dict.map(transliterateDict) as unknown as T;
  if (dict && typeof dict === 'object') {
    const result: any = {};
    for (const [k, v] of Object.entries(dict as any)) result[k] = transliterateDict(v);
    return result;
  }
  return dict;
}
