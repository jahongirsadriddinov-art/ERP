// Lotin yozuvidagi o'zbekcha matnni Kirill yozuviga o'giradi (qoidaviy, tarjima
// emas — bu ikkalasi BIR til, faqat yozuv turi boshqa). Shu tufayli har bir UI
// matnini alohida "uz-cyrl" tiliga tarjima qilish shart emas: manba (lotin)
// matn qanday bo'lsa, shundan avtomatik hosil qilinadi — yangi qo'shilgan har
// qanday matn ham darhol to'liq qamrab olinadi.
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
    const ch = s[i];
    const lower = ch.toLowerCase();
    const isUpper = ch !== lower;

    // o' / g' — apostrofli digraflar (turli apostrof belgilarini qo'llab-quvvatlaydi)
    if ((lower === 'o' || lower === 'g') && APOSTROPHES.has(s[i + 1] || '')) {
      const cy = lower === 'o' ? 'ў' : 'ғ';
      out += isUpper ? cy.toUpperCase() : cy;
      i += 2;
      continue;
    }

    // sh / ch / yo / yu / ya / ts — ikki harfli digraflar
    if (i + 1 < n) {
      const two = lower + s[i + 1].toLowerCase();
      const cy = DIGRAPHS[two];
      if (cy) {
        out += isUpper ? cy.toUpperCase() : cy;
        i += 2;
        continue;
      }
    }

    // bitta harflar
    const single = SINGLE[lower];
    if (single) {
      let cy = single;
      // so'z boshidagi "e" -> "э" (masalan "ega" -> "эга"), so'z ichida -> "е"
      if (lower === 'e' && !isWordChar(s[i - 1])) cy = 'э';
      out += isUpper ? cy.toUpperCase() : cy;
      i += 1;
      continue;
    }

    // raqam, tinish belgisi, emoji, allaqachon kirill/rus matni — o'zgarishsiz o'tadi
    out += ch;
    i += 1;
  }

  return out;
}

// Butun bir kalit-qiymat lug'atini (yoki ichma-ich obyektni) rekursiv ravishda
// lotin-o'zbekchadan kirillga o'giradi — uz.json manba lug'atidan uz-cyrl'ni
// avtomatik hosil qilish uchun.
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
