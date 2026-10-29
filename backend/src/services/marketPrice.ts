import MarketPrice from '../models/MarketPrice';
import { translit } from './nameMatch';

// "Narx razvedkasi" — O'zbekiston bo'yicha o'rtacha bozor narxi (owner 2026-10-29).
//
// NEGA MEDIANA, O'RTACHA EMAS: bitta xato kiritilgan chek (masalan 1 tonna sementni
// "1 qop" deb yozish) o'rtachani butunlay buzadi. Mediana bunday chetdagi qiymatlarga
// deyarli befarq — 100 ta narxning 1 tasi xato bo'lsa ham natija to'g'ri qoladi.
//
// NEGA BIRLIK QAT'IY: "qop" va "tonna" narxini solishtirish ma'nosiz. Birligi boshqa
// bo'lsa — umuman taqqoslanmaydi (noto'g'ri ogohlantirish berishdan ko'ra, jim turish yaxshi).
//
// TEZLIK: foydalanuvchi so'raganda HECH QACHON tashqariga chiqilmaydi. Hamma narx oldindan
// yig'ilgan indeksda (MarketPrice) turadi, ustiga xotira keshi — javob millisekundlarda.

/** Shu muddatdagi narxlar hisobga olinadi (bozor o'zgaradi — eskisi ma'nosiz). */
const WINDOW_DAYS = 45;
/** Kamida shuncha kuzatuv bo'lmasa — xulosa chiqarilmaydi (tasodifiy raqamga ishonmaymiz). */
const MIN_POINTS = 4;
/** Kamida shuncha TURLI firma bo'lmasa — ko'rsatilmaydi (maxfiylik: bitta firma narxi oshkor bo'lmasin). */
const MIN_COMPANIES = 2;
/** Qimmat deb hisoblash chegarasi (medianadan necha foiz yuqori). */
export const EXPENSIVE_PCT = 15;
const CACHE_MS = 5 * 60_000;

/** O'lchov birligini bitta ko'rinishga keltiradi ("КГ", "kilogram", "kg" → "kg"). */
export function normUnit(unit: unknown): string {
  const u = translit(String(unit || '').toLowerCase()).replace(/[^a-z0-9]/g, '');
  if (!u) return '';
  const map: Record<string, string> = {
    kg: 'kg', kilogramm: 'kg', kilogram: 'kg',
    tonna: 't', t: 't', tn: 't',
    qop: 'qop', kop: 'qop', meshok: 'qop', mesok: 'qop',
    dona: 'dona', dona1: 'dona', sht: 'dona', shtuka: 'dona', pcs: 'dona',
    m: 'm', metr: 'm', pogmetr: 'm',
    m2: 'm2', kvm: 'm2', kvadrat: 'm2',
    m3: 'm3', kub: 'm3', kubometr: 'm3',
    litr: 'l', l: 'l',
    rulon: 'rulon', quti: 'quti', kuti: 'quti', upakovka: 'quti',
  };
  return map[u] || u.slice(0, 12);
}

/** Nomni qidiruv kalitiga aylantiradi: kirill→lotin, fonetik soddalashtirish, RAQAMLAR saqlanadi. */
export function itemKey(name: unknown): string {
  // Raqam muhim: "sement M400" va "sement M500" — boshqa-boshqa mahsulot.
  const base = translit(String(name || '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!base) return '';
  const STOP = new Set(['uchun', 'dona', 'ta', 'xaridi', 'xarid', 'olindi', 'yangi', 'sotib']);
  const toks = base.split(' ')
    .filter((t) => t && !STOP.has(t))
    // fonetik: q→k, x→h, qo'sh harf → bitta ("shag'al"/"shagal", "g'isht"/"gisht" bir xil bo'lsin)
    .map((t) => t.replace(/q/g, 'k').replace(/x/g, 'h').replace(/(.)\1+/g, '$1'))
    .slice(0, 5);
  return toks.sort().join(' ');
}

export interface PriceStats {
  key: string;
  name: string;
  unit: string;
  /** O'rtacha bozor narxi (mediana), so'm */
  median: number;
  /** Odatdagi oraliq — pastki va yuqori chorak */
  low: number;
  high: number;
  points: number;
  companies: number;
  region?: string;
  updatedAt: Date;
}

const cache = new Map<string, { at: number; v: PriceStats | null }>();

function median(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
}
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];
}

/**
 * O'zbekiston bo'yicha narx xulosasi. Ma'lumot yetarli bo'lmasa — null
 * (noaniq raqam ko'rsatgandan ko'ra "ma'lumot yo'q" degan halol).
 */
export async function lookupPrice(name: string, unit?: string, opts: { region?: string } = {}): Promise<PriceStats | null> {
  const key = itemKey(name);
  if (!key) return null;
  const u = normUnit(unit);
  const ck = `${key}|${u}|${opts.region || ''}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600_000);
  const q: Record<string, unknown> = { key, at: { $gte: since } };
  if (u) q.unit = u;
  if (opts.region) q.region = opts.region;
  const rows: any[] = await MarketPrice.find(q).select('price unit companyId name at').limit(500).lean();
  let out: PriceStats | null = null;

  if (rows.length >= MIN_POINTS) {
    // Birlik berilmagan bo'lsa — eng ko'p uchragan birlikni olamiz (aralashtirib bo'lmaydi)
    const byUnit = new Map<string, any[]>();
    for (const r of rows) byUnit.set(r.unit, [...(byUnit.get(r.unit) || []), r]);
    const [bestUnit, list] = [...byUnit.entries()].sort((a, b) => b[1].length - a[1].length)[0];

    const companies = new Set(list.map((r: any) => String(r.companyId || r._id)));
    if (list.length >= MIN_POINTS && companies.size >= MIN_COMPANIES) {
      const prices = list.map((r: any) => Number(r.price)).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
      if (prices.length >= MIN_POINTS) {
        out = {
          key, name: String(list[0].name || name), unit: bestUnit,
          median: median(prices), low: quantile(prices, 0.25), high: quantile(prices, 0.75),
          points: prices.length, companies: companies.size,
          ...(opts.region ? { region: opts.region } : {}),
          updatedAt: new Date(Math.max(...list.map((r: any) => new Date(r.at).getTime()))),
        };
      }
    }
  }
  cache.set(ck, { at: Date.now(), v: out });
  return out;
}

/** Narx qimmatmi? Ma'lumot yetarli bo'lmasa — null (ogohlantirmaymiz). */
export function compare(price: number, s: PriceStats | null): { pct: number; expensive: boolean; stats: PriceStats } | null {
  if (!s || !(price > 0) || !(s.median > 0)) return null;
  const pct = Math.round(((price - s.median) / s.median) * 100);
  return { pct, expensive: pct >= EXPENSIVE_PCT, stats: s };
}

/** Xaridni indeksga qo'shadi (takror bo'lsa jim o'tadi). Xato hech qachon chaqiruvchini buzmaydi. */
export async function recordPoint(p: {
  name: string; unit?: string; price: number; at?: Date;
  source?: IMarketSource; companyId?: string; refId?: string; region?: string;
}): Promise<void> {
  try {
    const key = itemKey(p.name);
    const unit = normUnit(p.unit);
    // Birligi yoki nomi yo'q narxni indekslash ma'nosiz — solishtirib bo'lmaydi
    if (!key || !unit || !(p.price > 0)) return;
    const doc = {
      key, name: String(p.name).slice(0, 120), unit, price: Math.round(p.price),
      source: p.source || 'receipt', at: p.at || new Date(),
      ...(p.companyId ? { companyId: String(p.companyId) } : {}),
      ...(p.refId ? { refId: String(p.refId) } : {}),
      ...(p.region ? { region: String(p.region).slice(0, 60) } : {}),
    };
    if (p.refId) {
      // Bitta xarid ikki marta hisoblanmasin (qayta indekslash xavfsiz)
      await MarketPrice.updateOne({ source: doc.source, refId: doc.refId }, { $setOnInsert: doc }, { upsert: true });
    } else {
      await MarketPrice.create(doc);
    }
    cache.clear();
  } catch { /* indeks — ikkilamchi ish, asosiy amal buzilmasin */ }
}

export type IMarketSource = 'receipt' | 'telegram' | 'olx' | 'manual';
