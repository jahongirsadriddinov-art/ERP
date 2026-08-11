import { Router } from 'express';

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

// GET /api/currency/rates
router.get('/rates', async (_req, res) => {
  // Refresh rates every hour
  if (Date.now() - lastFetch > 3600_000) {
    await fetchCBURates();
  }
  res.json({
    UZS: 1,
    USD: cachedRates.USD,
    EUR: cachedRates.EUR,
    date: new Date().toISOString().split('T')[0],
    source: lastFetch > 0 ? 'CBU Uzbekistan' : 'hardcoded',
  });
});

export { cachedRates };
export default router;
