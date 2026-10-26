// ─── Sarlavhadagi aylanma satr (owner 2026-10-26) ───────────────────────────────────────────────────────────
// "Logo yonidagi dollar kursi almashib tursin — faqat kurs emas, yangiliklar, ob-havo va hokazo bo'lsin."
// Bitta so'rovda: valyuta kursi, Toshkent ob-havosi va bugungi yangilik sarlavhalari. Barchasi keshlanadi —
// yangiliklar 30 daqiqa, ob-havo 10 daqiqa (weather.ts o'zi keshlaydi). Tashqi manba ishlamasa, shu band
// tushib qoladi, qolganlari baribir ko'rinadi.
import { Router } from 'express';
import { getOfficeWeather } from '../aiVoice/officeMedia/weather';
import { getRatesForCompany } from './currency';
import { getTenant } from '../middleware/tenantContext';

const router = Router();

export interface TickerItem { kind: 'rate' | 'weather' | 'news'; text: string; icon?: string; url?: string }

const NEWS_SOURCES = ['https://kun.uz/news/rss', 'https://www.gazeta.uz/uz/rss/'];
const NEWS_TTL = 30 * 60_000;
let newsCache: { at: number; items: TickerItem[] } = { at: 0, items: [] };

const clean = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }[m] || ' '))
    .replace(/\s+/g, ' ').trim();

/** RSS matnidan birinchi N ta sarlavha (havolasi bilan). */
export function parseRss(xml: string, limit = 6): TickerItem[] {
  const out: TickerItem[] = [];
  const items = xml.split(/<item[\s>]/i).slice(1);
  for (const it of items) {
    const title = clean((it.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const url = clean((it.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
    if (title.length < 10) continue;
    out.push({ kind: 'news', text: title.slice(0, 120), icon: '📰', ...(/^https?:/.test(url) ? { url } : {}) });
    if (out.length >= limit) break;
  }
  return out;
}

async function getNews(): Promise<TickerItem[]> {
  if (Date.now() - newsCache.at < NEWS_TTL && newsCache.items.length) return newsCache.items;
  for (const src of NEWS_SOURCES) {
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'QurilishERP/1.0' } });
      if (!r.ok) continue;
      const items = parseRss(await r.text());
      if (items.length) { newsCache = { at: Date.now(), items }; return items; }
    } catch { /* keyingi manba */ }
  }
  return newsCache.items;
}

const WEATHER_ICON: Record<string, string> = { sunny: '☀️', cloudy: '☁️', rain: '🌧', snow: '❄️', fog: '🌫' };

// GET /api/ticker — sarlavha satri uchun bandlar
router.get('/', async (_req, res) => {
  const items: TickerItem[] = [];

  try {
    const t = getTenant();
    const r = await getRatesForCompany(t?.companyId ? String(t.companyId) : undefined, 'sell');
    if (r?.USD) items.push({ kind: 'rate', icon: '💵', text: `$ ${Math.round(r.USD).toLocaleString('ru-RU').replace(/ /g, '.')} so'm` });
  } catch { /* kurs bo'lmasa — qolganlari ko'rinadi */ }

  try {
    const w = await getOfficeWeather();
    if (w?.temp != null) items.push({ kind: 'weather', icon: WEATHER_ICON[w.mode] || '🌡', text: `Toshkent ${Math.round(w.temp)}°` });
  } catch { /* ob-havo bo'lmasa */ }

  try { items.push(...(await getNews())); } catch { /* yangilik bo'lmasa */ }

  res.set('Cache-Control', 'public, max-age=300');
  res.json({ items });
});

export default router;
