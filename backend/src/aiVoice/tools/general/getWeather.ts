import GpsLocation from '../../../models/GpsLocation';
import ObjectModel from '../../../models/Object';
import { isObjectIdString } from '../../lib/ids';
import { localDate } from '../../lib/zonedTime';
import { sanitizeForPrompt } from '../../lib/untrusted';
import type { AiToolDef, ToolCtx } from '../types';
import { inCompany } from '../types';
import { ALL_CHANNELS, ALL_ROLES, L, ok, visibleObjectIds } from '../erp/common';

// getWeather — ob-havo (owner 2026-10-17 #2: AI kundalik savollarga ham javob bersin). Bepul Open-Meteo
// (kalitsiz): avval geokodlash (shahar nomi → koordinata), keyin prognoz. Shahar aytilmasa — foydalanuvchi
// obyektining nuqtasi (lat/lng) yoki joy nomi, bo'lmasa Toshkent. Natija 10 daqiqa keshlanadi.

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FC_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 8_000;
const WTTR_URL = 'https://wttr.in';
/** Joylashuv (GPS) shuncha vaqtdan eski bo'lmasa — "shu yerdagi ob-havo" uchun ishlatiladi. */
const GPS_MAX_AGE_MS = 3 * 24 * 3600_000;
const CACHE_TTL_MS = 10 * 60_000;
const TASHKENT = { name: 'Toshkent', lat: 41.2995, lng: 69.2401 };

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
let fetcher: Fetcher = (url, init) => fetch(url, init as RequestInit) as any;
/** Testlar uchun: soxta fetch. */
export function setWeatherFetch(f: Fetcher | null): void { fetcher = f || ((url, init) => fetch(url, init as RequestInit) as any); cache.clear(); }

const cache = new Map<string, { at: number; data: any }>();
async function getJson(url: string): Promise<any> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  // Bir marta qayta urinish (Render'dan tarmoq vaqtinchalik uzilishi)
  let r: Awaited<ReturnType<Fetcher>> | null = null;
  let last: unknown = null;
  for (let i = 0; i < 2 && !r; i++) {
    try {
      const x = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!x.ok) throw new Error(`HTTP_${x.status}`);
      r = x;
    } catch (e) { last = e; }
  }
  if (!r) throw last || new Error('FETCH_FAILED');
  const data = await r.json();
  cache.set(url, { at: Date.now(), data });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return data;
}

/** WMO ob-havo kodi → qisqa matn. */
export function weatherText(code: number, lang: 'uz' | 'ru'): string {
  const T: [number[], string, string][] = [
    [[0], 'ochiq osmon', 'ясно'],
    [[1, 2], 'qisman bulutli', 'переменная облачность'],
    [[3], 'bulutli', 'пасмурно'],
    [[45, 48], 'tuman', 'туман'],
    [[51, 53, 55, 56, 57], 'mayda yomg\'ir', 'морось'],
    [[61, 63, 65, 66, 67, 80, 81, 82], 'yomg\'ir', 'дождь'],
    [[71, 73, 75, 77, 85, 86], 'qor', 'снег'],
    [[95, 96, 99], 'momaqaldiroq', 'гроза'],
  ];
  const row = T.find(([codes]) => codes.includes(Number(code)));
  return row ? (lang === 'ru' ? row[2] : row[1]) : (lang === 'ru' ? 'без данных' : "ma'lumot yo'q");
}

interface Place { name: string; lat: number; lng: number }

async function geocode(q: string, lang: 'uz' | 'ru'): Promise<Place | null> {
  const name = q.trim().replace(/\s+(tumani|shahri|viloyati|shahar|tuman|район|город)$/i, '').slice(0, 60);
  if (!name) return null;
  // Avval O'zbekiston ichida (Jondor, G'ijduvon ...), topilmasa — butun dunyo
  let d = await getJson(`${GEO_URL}?name=${encodeURIComponent(name)}&count=1&language=${lang}&format=json&countryCode=UZ`);
  if (!Array.isArray(d?.results) || !d.results.length) d = await getJson(`${GEO_URL}?name=${encodeURIComponent(name)}&count=1&language=${lang}&format=json`);
  const r = Array.isArray(d?.results) ? d.results[0] : null;
  if (!r || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) return null;
  return { name: sanitizeForPrompt(String(r.name || name), 40) || 'joy', lat: r.latitude, lng: r.longitude };
}

/**
 * Shahar aytilmasa (owner 2026-10-19: "joylashuvimga qarab"): 1) foydalanuvchining oxirgi GPS nuqtasi (≤3 kun),
 * 2) ko'ra oladigan obyekt nuqtasi, 3) Toshkent.
 */
async function defaultPlace(ctx: ToolCtx, lang: 'uz' | 'ru'): Promise<Place> {
  if (isObjectIdString(ctx.userId)) {
    try {
      const g: any = await GpsLocation.findOne({ userId: String(ctx.userId) }).sort({ timestamp: -1 }).select('lat lng timestamp').lean();
      const at = g?.timestamp ? new Date(g.timestamp).getTime() : 0;
      if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng) && Date.now() - at < GPS_MAX_AGE_MS) {
        return { name: lang === 'ru' ? 'Ваше местоположение' : 'Joylashuvingiz', lat: g.lat, lng: g.lng };
      }
    } catch { /* GPS yo'q — keyingisi */ }
  }
  if (!isObjectIdString(ctx.companyId)) return TASHKENT;
  try {
    const visible = await visibleObjectIds(ctx);
    if (visible !== null && !visible.length) return TASHKENT;
    const filter: Record<string, unknown> = visible === null ? { status: 'active' } : { _id: { $in: visible } };
    const o: any = await ObjectModel.findOne(inCompany(ctx, filter)).select('name location lat lng').sort({ updatedAt: -1 }).lean();
    if (o && Number.isFinite(o.lat) && Number.isFinite(o.lng)) return { name: sanitizeForPrompt(String(o.location || o.name || 'obyekt'), 40) || 'obyekt', lat: o.lat, lng: o.lng };
    if (o?.location) return (await geocode(String(o.location), lang).catch(() => null)) || TASHKENT;
  } catch { /* zaxira — Toshkent */ }
  return TASHKENT;
}

const DAY_IDX: Record<string, number> = { today: 0, tomorrow: 1, after_tomorrow: 2 };

/** wttr.in (WWO) kodi → WMO kodi (weatherText bilan bir xil matn). */
function wwoToWmo(c: number): number {
  if (c === 113) return 0;
  if (c === 116) return 2;
  if (c === 119 || c === 122) return 3;
  if ([143, 248, 260].includes(c)) return 45;
  if ([200, 386, 389, 392, 395].includes(c)) return 95;
  if ([179, 182, 185, 227, 230, 281, 284, 311, 314, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377].includes(c)) return 71;
  return 61;
}

/** Zaxira manba (Open-Meteo ishlamasa): wttr.in → Open-Meteo shakliga. */
async function wttrForecast(lat: number, lng: number): Promise<any> {
  const d = await getJson(`${WTTR_URL}/${lat.toFixed(3)},${lng.toFixed(3)}?format=j1`);
  const c = d?.current_condition?.[0];
  const days: any[] = Array.isArray(d?.weather) ? d.weather.slice(0, 3) : [];
  if (!c && !days.length) throw new Error('WTTR_EMPTY');
  const rainOf = (w: any) => Math.max(0, ...(Array.isArray(w?.hourly) ? w.hourly.map((h: any) => Number(h.chanceofrain) || 0) : [0]));
  const codeOf = (w: any) => wwoToWmo(Number(w?.hourly?.[4]?.weatherCode ?? w?.hourly?.[0]?.weatherCode));
  return {
    current: c ? {
      temperature_2m: Number(c.temp_C), apparent_temperature: Number(c.FeelsLikeC), weather_code: wwoToWmo(Number(c.weatherCode)),
      wind_speed_10m: Number(c.windspeedKmph), relative_humidity_2m: Number(c.humidity),
    } : undefined,
    daily: {
      time: days.map((w) => w.date), weather_code: days.map(codeOf),
      temperature_2m_max: days.map((w) => Number(w.maxtempC)), temperature_2m_min: days.map((w) => Number(w.mintempC)),
      precipitation_probability_max: days.map(rainOf),
    },
  };
}

export const getWeather: AiToolDef<{ city?: string; day?: 'today' | 'tomorrow' | 'after_tomorrow' }> = {
  name: 'getWeather',
  description: {
    uz: "Ob-havo: hozirgi harorat va bugun/ertaga/indinga prognoz (shahar aytilmasa — obyekt joyi yoki Toshkent).",
    ru: 'Погода: текущая температура и прогноз на сегодня/завтра/послезавтра (без города — место объекта или Ташкент).',
  },
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 60, description: 'Shahar yoki joy nomi (masalan "Samarqand")' },
      day: { type: 'string', enum: ['today', 'tomorrow', 'after_tomorrow'] },
    },
  },
  kind: 'read',
  confirm: 'never',
  general: true,
  maxRoles: ALL_ROLES,
  defaultRoles: ALL_ROLES,
  purposes: ['assistant'],
  channels: ALL_CHANNELS,
  behavior: 'BLOCKING',
  handler: async (ctx, args) => {
    const lang = ctx.lang === 'ru' ? 'ru' : 'uz';
    let place: Place | null;
    try {
      place = args.city ? await geocode(args.city, lang) : await defaultPlace(ctx, lang);
    } catch (e) {
      console.warn('[aiVoice/weather] geokodlash xatosi:', (e as Error)?.message?.slice(0, 80));
      // Geokodlash ishlamasa ham ob-havo — obyekt/GPS yoki Toshkent bo'yicha (shahar aytilgan bo'lsa ham javobsiz qolmasin)
      place = args.city ? null : TASHKENT;
      if (!place) return { status: 'error', message: L(ctx, "Joyni hozir aniqlab bo'lmadi, birozdan keyin so'rang.", 'Сейчас не удалось определить место, попробуйте позже.'), retryable: true };
    }
    if (!place) return { status: 'not_found', message: L(ctx, 'Bunday joy topilmadi.', 'Место не найдено.'), retryable: false };
    let d: any;
    try {
      d = await getJson(`${FC_URL}?latitude=${place.lat.toFixed(3)}&longitude=${place.lng.toFixed(3)}`
        + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTashkent&forecast_days=3');
    } catch (e) {
      console.warn('[aiVoice/weather] Open-Meteo xatosi, zaxira wttr.in:', (e as Error)?.message?.slice(0, 80));
      try {
        d = await wttrForecast(place.lat, place.lng);
      } catch (e2) {
        console.warn('[aiVoice/weather] wttr.in ham ishlamadi:', (e2 as Error)?.message?.slice(0, 80));
        return { status: 'error', message: L(ctx, "Ob-havo xizmatiga hozir ulanib bo'lmadi, birozdan keyin so'rang.", 'Не удалось получить погоду, попробуйте позже.'), retryable: true };
      }
    }
    const i = DAY_IDX[args.day || 'today'] ?? 0;
    const daily = d?.daily || {};
    const day = {
      date: String(daily.time?.[i] || localDate()),
      max: Math.round(Number(daily.temperature_2m_max?.[i])),
      min: Math.round(Number(daily.temperature_2m_min?.[i])),
      rainChance: Number.isFinite(daily.precipitation_probability_max?.[i]) ? Number(daily.precipitation_probability_max[i]) : null,
      sky: weatherText(daily.weather_code?.[i], lang),
    };
    const cur = d?.current && i === 0 ? {
      temp: Math.round(Number(d.current.temperature_2m)),
      feels: Math.round(Number(d.current.apparent_temperature)),
      wind: Math.round(Number(d.current.wind_speed_10m)),
      humidity: Math.round(Number(d.current.relative_humidity_2m)),
      sky: weatherText(d.current.weather_code, lang),
    } : null;
    if (!Number.isFinite(day.max) && !cur) return { status: 'error', message: L(ctx, "Ob-havo ma'lumoti yo'q.", 'Нет данных о погоде.'), retryable: true };
    const rain = day.rainChance !== null ? L(ctx, `, yog'ingarchilik ehtimoli ${day.rainChance}%`, `, вероятность осадков ${day.rainChance}%`) : '';
    const msg = cur
      ? L(ctx, `${place.name}: hozir ${cur.temp}°C, ${cur.sky}. Bugun ${day.min}…${day.max}°C${rain}.`, `${place.name}: сейчас ${cur.temp}°C, ${cur.sky}. Сегодня ${day.min}…${day.max}°C${rain}.`)
      : L(ctx, `${place.name}, ${day.date}: ${day.min}…${day.max}°C, ${day.sky}${rain}.`, `${place.name}, ${day.date}: ${day.min}…${day.max}°C, ${day.sky}${rain}.`);
    return ok(msg, { place: place.name, current: cur, day });
  },
};
