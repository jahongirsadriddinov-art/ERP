import { lookupPrice, recordPoint } from './marketPrice';
import { parsePost, UNIT_WORDS, PRICE_BAND } from './priceChannels';

// OLX e'lonlaridan narx yig'ish — BETA (owner 2026-10-29: "faqat OLX emas, boshqa
// joylar ham bor, o'shalardan ham qidirsin").
//
// NEGA OLX'NING RAQAMLI NARXI O'ZI YETARLI EMAS: sinovda "sement" bo'yicha birinchi
// e'lonlar 200 va 585 so'm ko'rsatdi — ya'ni sotuvchilar maydonga qop narxini emas,
// kelishuv uchun ramziy raqam yoki kilogramm narxini yozadi. Bunday raqamlarni
// to'g'ridan-to'g'ri indeksga qo'yish butun o'rtachani buzadi.
//
// Shuning uchun ikki qadam:
//  1) AVVAL e'lon MATNI o'qiladi (sarlavha + tavsif) — sotuvchi "52 000 so'm/qop" deb
//     o'zi yozgan bo'lsa, bu eng ishonchli ma'lumot. Telegram kanallari uchun yozilgan
//     tahlilchi aynan shuni qiladi, shuning uchun qayta yozilmadi.
//  2) Matnda narx yo'q bo'lsagina raqamli maydon olinadi — va faqat qat'iy shartlarda:
//     "kelishiladi" emas, valyuta so'm, birlik sarlavhada aytilgan va narx shu birlik
//     uchun aqlga sig'adigan pastki chegaradan yuqori.
//  3) Birlik sarlavhada ham aytilmagan bo'lsa — INDEKSNING O'ZIDAN so'raladi: shu
//     material bo'yicha haqiqiy xaridlardan allaqachon ishonchli birlik va mediana
//     bo'lsa, OLX narxi shu birlikka bog'lanadi va medianadan 5 barobar chetga
//     chiqmasligi tekshiriladi. Ya'ni birlik TAXMIN QILINMAYDI — faqat bilingan
//     joyda ishlatiladi, va raqam o'sha bilingan narxga yaqin bo'lishi shart.
//     (Sinovda: g'isht bo'yicha OLX medianasi ~1000 so'm/dona — haqiqatga mos;
//      sement bo'yicha ~470, chunki sotuvchilar kilogramm narxini yozadi. Shuning
//      uchun birliksiz raqamni ko'r-ko'rona olish mumkin emas.)
//
// Hech qanday kalit yoki akkaunt kerak emas — ochiq ro'yxat sahifasining API'si.

const FETCH_TIMEOUT_MS = 12_000;
const PER_QUERY = 40;

/** Shu birlik uchun real bo'lishi mumkin bo'lgan eng past narx (so'm). Ramziy "200 so'm"ni kesadi. */
const UNIT_FLOOR: Record<string, number> = {
  kg: 500, qop: 10_000, t: 500_000, dona: 300,
  m2: 5_000, m3: 30_000, m: 2_000, l: 3_000, rulon: 20_000,
};

export interface OlxPoint { name: string; price: number; unit: string; refId: string; region?: string }

interface OlxOffer {
  id?: number | string; title?: string; description?: string;
  params?: { key?: string; value?: { value?: number; type?: string; arranged?: boolean; currency?: string } }[];
  location?: { city?: { name?: string }; region?: { name?: string } };
}

/** "1 kg", "Tonna narxi", "коп" kabi nomlar material NOMI emas — qidiruvga foydasi yo'q. */
const NAME_STOP = new Set(['narx', 'narxi', 'nархи', 'cena', 'сена', 'цена', 'optom', 'оптом', 'dostavka', 'доставка', 'sotiladi', 'сотилади', 'arzon', 'арзон']);
function usableName(name: string): boolean {
  const words = String(name || '').toLowerCase().split(/[^a-zа-яё0-9']+/i).filter(Boolean);
  return words.some((w) => w.length >= 4 && /[a-zа-яё]/i.test(w) && !NAME_STOP.has(w) && !UNIT_WORDS[w]);
}

/** Sarlavhada aytilgan birlik ("Sement M400 qop") — yo'q bo'lsa e'lon tashlanadi. */
function unitInText(text: string): string {
  const t = String(text || '').toLowerCase();
  for (const [w, u] of Object.entries(UNIT_WORDS)) {
    if (new RegExp(`(^|[^a-zа-я0-9])${w}([^a-zа-я0-9]|$)`, 'i').test(t)) return u;
  }
  return '';
}

/** Bitta e'londan narx nuqtalari. Ishonchli ma'lumot bo'lmasa — bo'sh ro'yxat. */
export function parseOlxOffer(o: OlxOffer): OlxPoint[] {
  const id = String(o?.id || '').trim();
  const title = String(o?.title || '').replace(/\s+/g, ' ').trim();
  if (!id || title.length < 3) return [];
  const region = o?.location?.region?.name || o?.location?.city?.name || undefined;

  // 1-qadam: sotuvchi matnda yozgan narx (eng ishonchli)
  const desc = String(o?.description || '').slice(0, 4000);
  const fromText = [...parsePost(title), ...parsePost(desc)]
    // Chegara matn yo'liga ham qo'llanadi: sinovda "M400 qop 530 so'm" kabi qiymatlar
    // chiqdi — qop 530 so'mga bo'lmaydi, bu sotuvchining xatosi yoki boshqa birlik.
    .filter((p) => p.price >= (UNIT_FLOOR[p.unit] ?? 0) && usableName(p.name));
  if (fromText.length) {
    return fromText.slice(0, 5).map((p, i) => ({ ...p, refId: `${id}:${i}`, region }));
  }

  // 2-qadam: raqamli maydon — faqat qat'iy shartlarda
  const pr = (o?.params || []).find((p) => p?.key === 'price')?.value;
  if (!pr || pr.type !== 'price' || pr.arranged) return [];
  if (String(pr.currency || '').toUpperCase() !== 'UZS') return [];
  const price = Number(pr.value);
  if (!Number.isFinite(price) || price < PRICE_BAND.min || price > PRICE_BAND.max) return [];
  const unit = unitInText(title);
  if (!unit) return [];
  if (price < (UNIT_FLOOR[unit] ?? 0)) return [];

  // Nom: sarlavhadan birlik va bezaklar olib tashlanadi
  const name = cleanName(title);
  if (!usableName(name)) return [];
  return [{ name, price, unit, refId: id, region }];
}

function cleanName(title: string): string {
  return String(title).replace(/[|/\•*_=«»"']+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * 3-qadam: birlik sarlavhada aytilmagan e'lon. Indeksda shu material bo'yicha
 * ishonchli birlik va mediana bo'lsa — narx shunga bog'lanadi, lekin medianadan
 * {RATIO} barobar chetga chiqsa tashlanadi (noto'g'ri birlikda yozilgan narx shunda
 * kesiladi: kilogramm narxi qop medianasiga hech qachon yaqin bo'lmaydi).
 */
const RATIO = 5;

export async function olxPointFromIndex(o: OlxOffer): Promise<OlxPoint | null> {
  const id = String(o?.id || '').trim();
  const title = String(o?.title || '').replace(/\s+/g, ' ').trim();
  if (!id || !title) return null;
  const pr = (o?.params || []).find((p) => p?.key === 'price')?.value;
  if (!pr || pr.type !== 'price' || pr.arranged) return null;
  if (String(pr.currency || '').toUpperCase() !== 'UZS') return null;
  const price = Number(pr.value);
  if (!Number.isFinite(price) || price < PRICE_BAND.min || price > PRICE_BAND.max) return null;
  const name = cleanName(title);
  if (!usableName(name)) return null;

  const known = await lookupPrice(name).catch(() => null);
  if (!known || !(known.median > 0)) return null;
  if (price < known.median / RATIO || price > known.median * RATIO) return null;
  if (price < (UNIT_FLOOR[known.unit] ?? 0)) return null;
  return { name, price, unit: known.unit, refId: id, region: o?.location?.region?.name || o?.location?.city?.name || undefined };
}

/** OLX ochiq ro'yxati: bitta so'rov bo'yicha e'lonlar. */
export async function fetchOlxOffers(query: string, fetchImpl: typeof fetch = fetch): Promise<OlxOffer[]> {
  const q = String(query || '').trim().slice(0, 60);
  if (q.length < 2) return [];
  const url = `https://www.olx.uz/api/v1/offers/?offset=0&limit=${PER_QUERY}&query=${encodeURIComponent(q)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QurilishERP narx indeksi)', Accept: 'application/json' },
    });
    if (!r.ok) return [];
    const body: any = await r.json();
    return Array.isArray(body?.data) ? (body.data as OlxOffer[]) : [];
  } catch {
    return [];      // tashqi sayt — xatosi hech qachon serverni to'xtatmasin
  } finally {
    clearTimeout(timer);
  }
}

/** Bitta so'rovni to'liq o'tkazadi: olib keladi, tahlil qiladi, indeksga yozadi. */
export async function collectOlxQuery(query: string, opts: { fetchImpl?: typeof fetch } = {}): Promise<number> {
  const offers = await fetchOlxOffers(query, opts.fetchImpl || fetch);
  let n = 0;
  for (const o of offers) {
    const pts = parseOlxOffer(o);
    // Matn ham, sarlavhadagi birlik ham yordam bermasa — indeks bilgan birlikka suyanamiz
    if (!pts.length) {
      const p = await olxPointFromIndex(o);
      if (p) pts.push(p);
    }
    for (const p of pts) {
      await recordPoint({
        name: p.name, unit: p.unit, price: p.price,
        source: 'olx', refId: `olx:${p.refId}`, region: p.region,
      });
      n++;
    }
  }
  return n;
}

/** Odatda qidiriladigan materiallar — kunlik yig'ish shu ro'yxat bo'yicha ketadi. */
export const DEFAULT_QUERIES = [
  'sement', "g'isht", 'armatura', "shag'al", 'qum', 'gipsokarton', 'profil',
  'bo\u2018yoq', 'keramzit', 'penoblok', 'shifer', 'metalloprofil', 'kabel', 'quvur',
];

export interface OlxCollectResult { queries: number; prices: number }

export async function collectFromOlx(queries: string[] = DEFAULT_QUERIES, opts: { fetchImpl?: typeof fetch } = {}): Promise<OlxCollectResult> {
  let prices = 0;
  for (const q of queries) {
    prices += await collectOlxQuery(q, opts);
    // Ketma-ket so'rovlar orasida kichik tanaffus — tashqi saytga hurmat
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (prices) console.log(`[narx/olx] ${prices} ta narx yig'ildi (${queries.length} so'rov)`);
  return { queries: queries.length, prices };
}
