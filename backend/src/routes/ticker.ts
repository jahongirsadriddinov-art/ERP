// ─── Sarlavhadagi aylanma satr (owner 2026-10-26) ───────────────────────────────────────────────────────────
// "Logo yonidagi dollar kursi almashib tursin — faqat kurs emas, yangiliklar, ob-havo va hokazo bo'lsin."
// Bitta so'rovda: valyuta kursi, Toshkent ob-havosi va bugungi yangilik sarlavhalari. Barchasi keshlanadi —
// yangiliklar 30 daqiqa, ob-havo 10 daqiqa (weather.ts o'zi keshlaydi). Tashqi manba ishlamasa, shu band
// tushib qoladi, qolganlari baribir ko'rinadi.
import { Router } from 'express';
import { getOfficeWeather, wmoToMode } from '../aiVoice/officeMedia/weather';
import ObjectModel from '../models/Object';
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
    out.push({ kind: 'news', text: title.length > 80 ? title.slice(0, 78).replace(/[\s,;:—-]+\S*$/, '') + '…' : title, icon: '📰', ...(/^https?:/.test(url) ? { url } : {}) });
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

// ── Obyekt joylashuvidagi ob-havo (owner 2026-10-27: "obyektlarning joylashuviga qarab, shu obyektda
// ob-havo shunaqa deb ko'rsatsin"). Koordinata 0.05° ga yaxlitlanib keshlanadi (10 daqiqa) — bir tumandagi
// bir nechta obyekt bitta so'rov bilan kifoyalanadi.
const geoCache = new Map<string, { at: number; temp: number | null; mode: string }>();
const GEO_TTL = 10 * 60_000;

export async function weatherAt(lat: number, lng: number): Promise<{ temp: number | null; mode: string } | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < GEO_TTL) return { temp: hit.temp, mode: hit.mode };
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}`
      + '&current=weather_code,temperature_2m,cloud_cover,precipitation,snowfall&timezone=Asia%2FTashkent';
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const c = j?.current || {};
    const temp = typeof c.temperature_2m === 'number' ? c.temperature_2m : null;
    const mode = wmoToMode(c.weather_code, { precipitation: c.precipitation, snowfall: c.snowfall, cloud: c.cloud_cover });
    geoCache.set(key, { at: Date.now(), temp, mode });
    return { temp, mode };
  } catch { return null; }
}

/** Firmaning koordinatasi bor faol obyektlari (eng ko'pi 3 ta — satr juda uzayib ketmasin). */
async function companySites(companyId?: string) {
  if (!companyId) return [];
  try {
    const rows: any[] = await ObjectModel.find({ companyId, status: 'active', lat: { $ne: null }, lng: { $ne: null } })
      .select('name lat lng').limit(3).lean();
    return rows.filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lng));
  } catch { return []; }
}

/** Kurs + ob-havo + yangiliklar (sarlavha satri va bot guruh buyruqlari uchun). */
export async function getTickerItems(companyId?: string): Promise<TickerItem[]> {
  const items: TickerItem[] = [];

  try {
    const r = await getRatesForCompany(companyId, 'sell');
    if (r?.USD) items.push({ kind: 'rate', icon: '💵', text: `${Math.round(r.USD).toLocaleString('ru-RU').replace(/ /g, '.')} so'm` });
  } catch { /* kurs bo'lmasa — qolganlari ko'rinadi */ }

  // Ob-havo: avval firmaning obyektlari bo'yicha (har biri alohida band), bo'lmasa — Toshkent
  try {
    const sites = await companySites(companyId);
    let added = 0;
    for (const o of sites) {
      const w = await weatherAt(Number(o.lat), Number(o.lng));
      if (w?.temp == null) continue;
      items.push({ kind: 'weather', icon: WEATHER_ICON[w.mode] || '🌡', text: `${o.name} ${Math.round(w.temp)}°` });
      added++;
    }
    if (!added) {
      const w = await getOfficeWeather();
      if (w?.temp != null) items.push({ kind: 'weather', icon: WEATHER_ICON[w.mode] || '🌡', text: `Toshkent ${Math.round(w.temp)}°` });
    }
  } catch { /* ob-havo bo'lmasa */ }

  try { items.push(...(await getNews())); } catch { /* yangilik bo'lmasa */ }
  return items;
}

// GET /api/ticker — sarlavha satri uchun bandlar
router.get('/', async (_req, res) => {
  const t = getTenant();
  const items = await getTickerItems(t?.companyId ? String(t.companyId) : undefined);
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ items });
});

export default router;
