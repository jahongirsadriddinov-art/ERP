import { Router } from 'express';
import Company from '../models/Company';
import { getTenant } from '../middleware/tenantContext';
import { requireAuth, requireOwnerOrAdmin } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';

const router = Router();

// Hardcoded exchange rates (can be replaced with a real API like CBU Uzbekistan)
// Format: 1 USD = X UZS, 1 EUR = X UZS
const DEFAULT_RATES = {
  USD: 12900,
  EUR: 14100,
};

let cachedRates = { ...DEFAULT_RATES };
let lastFetch = 0;

// Try to fetch rates from CBU (Central Bank of Uzbekistan)
async function fetchCBURates(): Promise<void> {
  try {
    const res = await fetch('https://cbu.uz/uz/arkhiv-kursov-valyut/json/', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const data: any[] = await res.json();
    const usd = data.find((r: any) => r.Ccy === 'USD');
    const eur = data.find((r: any) => r.Ccy === 'EUR');
    if (usd?.Rate) cachedRates.USD = parseFloat(usd.Rate);
    if (eur?.Rate) cachedRates.EUR = parseFloat(eur.Rate);
    lastFetch = Date.now();
  } catch {
    // fallback to hardcoded rates
  }
}

// ── Kapitalbank kursi (owner 2026-10-23: "Markaziy bankdan emas, Kapitalbankdagidek real, doim yangilanib tursin") ──
// kapitalbank.uz Cloudflare himoyasi ortida (server so'roviga 403), shuning uchun kurs bank.uz'dagi Kapitalbank
// sahifasidan olinadi: har valyuta uchun bank SOTIB OLISH (kirim — dollar bankka sotiladi) va SOTISH (chiqim — dollar
// sotib olinadi) kursi. 30 daqiqa keshlanadi; olinmasa — Markaziy bank kursi (zaxira).
export type BankRates = { USD?: { buy: number; sell: number }; EUR?: { buy: number; sell: number }; updatedAt?: string };
let kapital: BankRates = {};
let kapitalFetchedAt = 0;
let kapitalLoading: Promise<void> | null = null;
const KAPITAL_URL = 'https://bank.uz/uz/currency/bank/kapitalbank';

/** bank.uz sahifasi matnidan Kapitalbank kurslari (test uchun eksport). */
export function parseKapitalRates(html: string): BankRates {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const out: BankRates = {};
  const re = /Kod (USD|EUR) Birlik (\d+) Valyuta .{1,40}? Sotib olish ([\d ]+?(?:[.,]\d+)?) Sotish ([\d ]+?(?:[.,]\d+)?) Yangilanish vaqti ([\d.]+ [\d:]+)/g;
  const num = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.'));
  for (const m of text.matchAll(re)) {
    const unit = Number(m[2]) || 1;
    const buy = num(m[3]) / unit, sell = num(m[4]) / unit;
    // aqlga sig'adigan oraliq (sahifa tuzilishi o'zgarsa noto'g'ri raqam olinmasin)
    if (!(buy > 1000 && sell > 1000 && buy < 100_000 && sell < 100_000 && sell >= buy * 0.9)) continue;
    out[m[1] as 'USD' | 'EUR'] = { buy, sell };
    out.updatedAt = out.updatedAt || m[5];
  }
  return out;
}

async function fetchKapitalRates(): Promise<void> {
  try {
    const res = await fetch(KAPITAL_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'uz,ru;q=0.8' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = parseKapitalRates(await res.text());
    if (r.USD) { kapital = r; }
    else console.warn('[currency] Kapitalbank kursi sahifadan topilmadi');
  } catch (e: any) {
    console.warn('[currency] Kapitalbank kursi olinmadi:', e?.message);
  } finally { kapitalFetchedAt = Date.now(); }
}
async function ensureKapital(): Promise<void> {
  if (Date.now() - kapitalFetchedAt < 30 * 60_000) return;
  kapitalLoading = kapitalLoading || fetchKapitalRates().finally(() => { kapitalLoading = null; });
  await kapitalLoading;
}
export function getKapitalRates(): BankRates { return kapital; }

// Bot/serverda boshqa valyutadagi summani so'mga o'girish uchun. Tartib: firma o'z kursi → Kapitalbank → Markaziy bank.
// side: 'buy' — kirim (bank dollarni sotib oladi), 'sell' — chiqim (dollar sotib olinadi).
export async function getRatesForCompany(companyId?: string, side: 'buy' | 'sell' = 'sell'): Promise<{ USD: number; EUR: number }> {
  if (Date.now() - lastFetch > 3600_000) await fetchCBURates();
  await ensureKapital();
  let usd = kapital.USD?.[side] || cachedRates.USD, eur = kapital.EUR?.[side] || cachedRates.EUR;
  if (companyId) {
    const company: any = await Company.findById(companyId).select('customUsdRate customEurRate').lean().catch(() => null);
    if (company?.customUsdRate) usd = company.customUsdRate;
    if (company?.customEurRate) eur = company.customEurRate;
  }
  return { USD: usd, EUR: eur };
}

// GET /api/currency/rates — firma o'z kursini belgilagan bo'lsa O'SHANI, aks
// holda CBU (yoki standart) kursini qaytaradi. Firma konteksti bo'lmasa
// (masalan dasturchi yoki auth'siz so'rov) doim CBU/standart qaytadi.
router.get('/rates', async (_req, res) => {
  // Refresh rates every hour
  if (Date.now() - lastFetch > 3600_000) {
    await fetchCBURates();
  }
  await ensureKapital();

  let usd = kapital.USD?.sell || cachedRates.USD;
  let eur = kapital.EUR?.sell || cachedRates.EUR;
  let custom = false;

  const t = getTenant();
  if (t?.companyId) {
    const company = await Company.findById(t.companyId).select('customUsdRate customEurRate').lean();
    if (company?.customUsdRate) { usd = company.customUsdRate; custom = true; }
    if (company?.customEurRate) { eur = company.customEurRate; custom = true; }
  }

  res.json({
    UZS: 1,
    USD: usd,
    EUR: eur,
    date: new Date().toISOString().split('T')[0],
    source: custom ? 'company' : kapital.USD ? 'Kapitalbank' : (lastFetch > 0 ? 'CBU Uzbekistan' : 'hardcoded'),
    // Kapitalbank: sotib olish (kirim) va sotish (chiqim) kurslari, bank yangilagan vaqt
    kapital: kapital.USD ? kapital : null,
    // Admin panelda "CBU kursiga qaytarish" tugmasi uchun — firma o'z kursini
    // qo'ymagan bo'lsa ham CBU qiymati qanday ekanini frontend bilib turishi kerak.
    cbuUsd: cachedRates.USD,
    cbuEur: cachedRates.EUR,
  });
});

// PUT /api/currency/custom — firma o'z ichki valyuta kursini belgilaydi
// (masalan buxgalteriya CBU'dan bir oz farqli, o'zlari kelishgan kursni
// ishlatishni xohlashi mumkin — Oʻzbekistonda odatiy amaliyot). Faqat
// direktor/o'rinbosar/egasi o'zgartira oladi. usdRate/eurRate — null yoki 0
// yuborilsa, o'sha valyuta uchun qayta CBU kursiga qaytadi (custom o'chadi).
router.put('/custom', requireAuth, requireOwnerOrAdmin, requireFeature('multi_currency'), async (req, res) => {
  const t = getTenant();
  if (!t?.companyId) return res.status(400).json({ error: "Firma konteksti topilmadi" });

  const { usdRate, eurRate } = req.body || {};
  const update: any = {};
  if (usdRate !== undefined) update.customUsdRate = (usdRate && usdRate > 0) ? usdRate : null;
  if (eurRate !== undefined) update.customEurRate = (eurRate && eurRate > 0) ? eurRate : null;

  try {
    const company = await Company.findByIdAndUpdate(t.companyId, update, { new: true }).select('customUsdRate customEurRate').lean();
    if (!company) return res.status(404).json({ error: 'Firma topilmadi' });
    res.json({ ok: true, customUsdRate: company.customUsdRate || null, customEurRate: company.customEurRate || null });
  } catch (err) {
    console.error('[currency/custom]', err);
    res.status(500).json({ error: 'Server xatoligi' });
  }
});

export { cachedRates };
export default router;
