import { Router } from 'express';
import Company from '../models/Company';
import { getTenant } from '../middleware/tenantContext';
import { requireAuth, requireOwnerOrAdmin } from '../middleware/auth';

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

// GET /api/currency/rates — firma o'z kursini belgilagan bo'lsa O'SHANI, aks
// holda CBU (yoki standart) kursini qaytaradi. Firma konteksti bo'lmasa
// (masalan dasturchi yoki auth'siz so'rov) doim CBU/standart qaytadi.
router.get('/rates', async (_req, res) => {
  // Refresh rates every hour
  if (Date.now() - lastFetch > 3600_000) {
    await fetchCBURates();
  }

  let usd = cachedRates.USD;
  let eur = cachedRates.EUR;
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
    source: custom ? 'company' : (lastFetch > 0 ? 'CBU Uzbekistan' : 'hardcoded'),
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
router.put('/custom', requireAuth, requireOwnerOrAdmin, async (req, res) => {
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
