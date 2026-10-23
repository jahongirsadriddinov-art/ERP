// Obyekt / xodim nomini "eshitilgan" matnga moslash (owner 2026-10-23: ovozli chiqimda obyekt va "kimga"
// noto'g'ri chiqyapti). Ovozdan kelgan nom lotin yoki kirill yozuvida, qo'shimchali ("Botirga", "12-maktabdagi"),
// qisqartirilgan ("Aziz" ← "Abdulaziz"), xato eshitilgan ("Yunusabad") bo'lishi mumkin. Shu sabab:
//   1) kirill → lotin transliteratsiya + fonetik soddalashtirish (q→k, x→h, kh→h, ikki harf → bitta);
//   2) o'zbek/rus qo'shimchalari va murojaat so'zlari (aka, opa, ака, uchun…) olib tashlanadi;
//   3) har so'z uchun eng yaxshi moslik (Levenshtein + prefiks), raqamlar ("12") aniq mos kelishi shart;
//   4) avtomatik taxalluslar: ism, familiya, "Abdu-"/"-jon"/"-bek"siz shakllar, obyektning qisqa nomi, raqami.
// Natija: eng yaxshi nomzod yoki — bir nechtasi deyarli teng bo'lsa — "ambiguous" (botda tugma bilan so'raladi).

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '',
  ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h', ң: 'ng', ә: 'a', ө: 'o', ү: 'u', і: 'i',
};

/** Kirill → lotin (o'zbek/rus), kichik harf, apostroflarsiz. */
export function translit(s: string): string {
  let out = '';
  for (const ch of String(s || '').toLowerCase()) out += CYR[ch] ?? ch;
  return out.replace(/[ʻʼ'’`‘´]/g, '');
}

// Murojaat / bog'lovchi / umumiy so'zlar — nom emas
const STOP = new Set([
  'aka', 'akа', 'opa', 'apa', 'oga', 'ogа', 'uka', 'singil', 'domla', 'brat', 'bratan', 'xola', 'amaki', 'tog', 'toga', 'janob',
  'uchun', 'ga', 'ka', 'qa', 'va', 'bilan', 'dlya', 'na', 'v', 'k', 'u', 'i', 'mr', 'obyekt', 'obekt', 'obyektga', 'obyekti',
  'loyiha', 'proekt', 'project', 'ob', 'the', 'kishi', 'odam', 'sum', 'som',
]);

// Obyekt nomidagi sinonimlar — bir xil kalitga keltiriladi
const SYN: [RegExp, string][] = [
  [/^(maktab\w*|shkol\w*|skol\w*)$/, 'maktab'],
  [/^(bogcha\w*|detsad\w*|sad(ik)?)$/, 'bogcha'],
  [/^(shifoxona\w*|bolnits\w*|kasalxona\w*)$/, 'shifoxona'],
  [/^(uy|uyi|uyga|dom|doma|domu)$/, 'uy'],
  [/^(jk|jm|zhk|turarjoy)$/, 'turarjoy'],
  [/^(kvartal\w*|mavze\w*|mavzu\w*|massiv\w*)$/, 'kvartal'],
];

const SUFFIXES = [
  // o'zbek (uzunidan qisqasiga)
  'larimizga', 'larimiz', 'laridagi', 'larning', 'lariga', 'larida', 'laridan', 'akaga', 'opaga', 'dagilar', 'dagi', 'idagi',
  'lariga', 'larga', 'larda', 'lardan', 'ning', 'niki', 'ning', 'dan', 'ga', 'ka', 'qa', 'da', 'ni', 'ga', 'lar', 'imiz', 'iga', 'ida',
  // rus kelishiklari
  'ovichu', 'evichu', 'ovicha', 'evicha', 'ovichem', 'ovna', 'ovne', 'ovoy', 'ovu', 'evu', 'omu', 'emu', 'ogo', 'ego', 'oy', 'om', 'em', 'u', 'yu', 'e', 'a', 'y',
];

function stripSuffix(tok: string): string {
  if (/^\d+$/.test(tok) || tok.length <= 4) return tok;
  for (const s of SUFFIXES) {
    if (tok.length - s.length >= 3 && tok.endsWith(s)) return tok.slice(0, -s.length);
  }
  return tok;
}

/** Fonetik soddalashtirish: eshitilganda chalkashadigan harflar bir xil kalitga (rus "а" ↔ o'zbek "o": Юнусабад = Yunusobod). */
export function phonetic(tok: string): string {
  return tok
    .replace(/kh/g, 'h').replace(/x/g, 'h').replace(/q/g, 'k').replace(/w/g, 'v').replace(/dj|dzh|zh/g, 'j')
    .replace(/ts/g, 's').replace(/yo/g, 'o').replace(/o/g, 'a').replace(/iy/g, 'i').replace(/ey/g, 'e').replace(/(.)\1+/g, '$1');
}

/** Matn → solishtirish uchun so'zlar (raqam va harflar alohida: "12-maktab" → ["12", "maktab"]). */
export function nameTokens(s: string, keepStop = false): string[] {
  const t = translit(s).replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  for (let w of t.split(' ')) {
    if (!w) continue;
    // "12-chi", "12-inchi", "12 nchi" → 12
    if (/^(chi|nchi|inchi|ynchi|inci|ji|go|oy|iy|y)$/.test(w) && out.length && /^\d+$/.test(out[out.length - 1])) continue;
    if (!keepStop && STOP.has(w)) continue;
    w = stripSuffix(w);
    if (!keepStop && STOP.has(w)) continue;
    for (const [re, k] of SYN) if (re.test(w)) { w = k; break; }
    out.push(phonetic(w));
  }
  return out;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Ikki so'z o'xshashligi 0..1. Raqamlar — faqat aniq moslik. */
export function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  const da = /^\d+$/.test(a), db = /^\d+$/.test(b);
  if (da || db) return 0;
  const short = a.length <= b.length ? a : b, long = a.length <= b.length ? b : a;
  // "aziz" ⊂ "abdulaziz", "botir" ⊂ "botirjon" — qisqartirilgan ism
  if (short.length >= 3 && (long.startsWith(short) || long.endsWith(short))) return 0.86 + 0.1 * (short.length / long.length);
  const d = levenshtein(a, b);
  const r = 1 - d / Math.max(a.length, b.length);
  // juda qisqa so'zlarda bitta xato ham katta farq
  return short.length <= 3 && d > 0 ? Math.min(r, 0.5) : r;
}

// Lavozim so'zlari — nom emas, lekin "prorabga" yagona prorabni bildiradi
const ROLE_WORDS = new Set(['prorab', 'brigadir', 'direktor', 'orinbosar', 'zam', 'ishchi', 'omborchi', 'buxgalter', 'hisobchi', 'haydovchi',
  'voditel', 'master', 'nachalnik', 'menejer', 'manager', 'kassir', 'farrosh', 'qorovul', 'storoj', 'mardikor', 'usta'].map((w) => phonetic(w)));

export interface MatchCandidate { id: string; name: string; aliases?: string[]; role?: string }
export interface ScoredCandidate extends MatchCandidate { score: number }

function variantScore(q: string[], v: string[]): number {
  if (!q.length || !v.length) return 0;
  let sum = 0, weight = 0;
  for (const qt of q) {
    const w = /^\d+$/.test(qt) ? 2 : 1;
    let best = 0;
    for (const vt of v) best = Math.max(best, tokenSim(qt, vt));
    // raqam aytilgan, lekin nomda bu raqam yo'q — bu boshqa obyekt
    if (w === 2 && best < 1 && v.some((t) => /^\d+$/.test(t))) return 0;
    sum += best * w; weight += w;
  }
  const qScore = sum / weight;
  // nomzodning qancha qismi aytildi (to'liq aytilsa — biroz ustunlik)
  let cov = 0;
  for (const vt of v) cov += Math.max(...q.map((qt) => tokenSim(qt, vt)));
  const coverage = cov / v.length;
  // butun satr bo'yicha (bo'sh joylarsiz) — "yunusobod" ~ "yunus obod"
  const qs = q.join(''), vs = v.join('');
  const whole = 1 - levenshtein(qs, vs) / Math.max(qs.length, vs.length);
  return Math.max(qScore * 0.85 + coverage * 0.15, whole);
}

/** Har nomzodga ball (0..1), kamayish tartibida. */
export function scoreCandidates(query: string, cands: MatchCandidate[]): ScoredCandidate[] {
  const all = nameTokens(query);
  if (!all.length) return [];
  const roleQ = all.filter((t) => ROLE_WORDS.has(t));
  const named = all.filter((t) => !ROLE_WORDS.has(t));
  const q = named.length ? named : all;
  const out: ScoredCandidate[] = [];
  for (const c of cands) {
    let best = 0;
    for (const v of [c.name, ...(c.aliases || [])]) {
      const vt = nameTokens(v);
      best = Math.max(best, variantScore(q, vt));
      if (best >= 1) break;
    }
    // "prorab Botir" / "prorabga" — lavozim so'zi ham yordam beradi (faqat lavozim aytilsa — shu lavozimdagi xodim)
    if (c.role && roleQ.length) {
      const role = phonetic(translit(c.role));
      if (roleQ.some((t) => tokenSim(t, role) >= 0.85)) best = named.length ? Math.min(1, best + 0.05) : 0.75;
      else if (!named.length) best = 0;
    }
    if (best > 0) out.push({ ...c, score: Math.round(best * 1000) / 1000 });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface PickResult { match?: ScoredCandidate; ambiguous?: ScoredCandidate[]; top: ScoredCandidate[] }

/**
 * Eng mos nomzod. min — minimal ball; margin — birinchi va ikkinchi orasidagi farq shundan kam bo'lsa
 * (va ikkalasi ham yetarli bo'lsa) natija noaniq: `ambiguous` (2–4 ta nomzod) qaytadi.
 */
export function pickCandidate(query: string, cands: MatchCandidate[], opts: { min?: number; margin?: number } = {}): PickResult {
  const min = opts.min ?? 0.72, margin = opts.margin ?? 0.06;
  const top = scoreCandidates(query, cands).slice(0, 6);
  if (!top.length || top[0].score < min) return { top };
  const close = top.filter((c) => c.score >= min && top[0].score - c.score < margin);
  if (close.length > 1 && top[0].score < 0.999) return { ambiguous: close.slice(0, 4), top };
  if (close.length > 1 && close[1].score >= 0.999) return { ambiguous: close.slice(0, 4), top };
  return { match: top[0], top };
}

// ── Taxalluslar ───────────────────────────────────────────────────────────────
const NAME_PREFIX = /^(abdu[lr]?|abd)(?=[a-z]{3,})/;
const NAME_SUFFIX = /(jon|bek|boy|bay|xon|hon|voy|qul|ali)$/;

/** Xodim uchun avtomatik taxalluslar: ism, familiya, "Abdulaziz" → "Aziz", "Botirjon" → "Botir". */
export function personAliases(first: string, last?: string): string[] {
  const out = new Set<string>();
  const f = translit(first || '').trim(), l = translit(last || '').trim();
  if (f) out.add(f);
  if (l) { out.add(l); out.add(`${l} ${f}`.trim()); out.add(l.replace(/(ov|ev|ova|eva|iy|aya)$/, '')); }
  for (const w of f.split(/\s+/).filter(Boolean)) {
    const a = w.replace(NAME_PREFIX, '');
    if (a !== w && a.length >= 3) out.add(a);
    const b = w.replace(NAME_SUFFIX, '');
    if (b !== w && b.length >= 3) out.add(b);
    const c = a.replace(NAME_SUFFIX, '');
    if (c !== a && c.length >= 3) out.add(c);
  }
  out.delete('');
  return [...out];
}

/** Obyekt uchun: umumiy so'zlarsiz qisqa nom, bosh harflar ("YTJM"), raqam + tur ("12 maktab"). */
export function objectAliases(name: string): string[] {
  const out = new Set<string>();
  const words = translit(name).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const generic = /^(obyekt|obekt|qurilish|stroy|stroitelstvo|majmua\w*|kompleks\w*|bino\w*|binosi|zdanie|turar|joy|mfy|mahalla\w*|tumani|tuman|rayon|shahar|shahri|gorod|ko'chasi|kochasi|ulitsa|uy)$/;
  const core = words.filter((w) => !generic.test(w));
  if (core.length && core.length < words.length) out.add(core.join(' '));
  if (words.length >= 3) out.add(words.map((w) => w[0]).join(''));
  const num = words.find((w) => /^\d+$/.test(w));
  if (num) out.add(num);
  return [...out].filter((a) => a && a !== translit(name));
}
