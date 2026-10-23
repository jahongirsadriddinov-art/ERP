// AI ofis — Toshkentdagi HAQIQIY ob-havo (owner 2026-10-23): Open-Meteo (bepul, kalitsiz) — 10 daqiqalik kesh.
// WMO kodlari → ofis ob-havo rejimi (quyosh / bulut / yomg'ir / qor / tuman). Tarmoq xatosida — oxirgi kesh yoki "quyosh" (zaxira).
export type WeatherMode = 'sunny' | 'cloudy' | 'rain' | 'snow' | 'fog';
export interface OfficeWeather {
  mode: WeatherMode; code: number | null; temp: number | null; isDay: boolean | null; cloud: number | null;
  precipitation: number | null; snowfall: number | null; at: string; source: 'open-meteo' | 'cache' | 'fallback';
}

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast?latitude=41.31&longitude=69.28&current=weather_code,temperature_2m,is_day,cloud_cover,precipitation,snowfall&timezone=Asia%2FTashkent';
const TTL = 10 * 60_000;

/** WMO ob-havo kodi (https://open-meteo.com/en/docs) → rejim. Yog'in miqdori kodni aniqlashtiradi. */
export function wmoToMode(code: number | null | undefined, opts: { precipitation?: number | null; snowfall?: number | null; cloud?: number | null } = {}): WeatherMode {
  if ((opts.snowfall ?? 0) > 0) return 'snow';
  const c = code === null || code === undefined ? NaN : Number(code);
  if (!Number.isFinite(c)) return (opts.precipitation ?? 0) > 0 ? 'rain' : (opts.cloud ?? 0) >= 70 ? 'cloudy' : 'sunny';
  if (c === 45 || c === 48) return 'fog';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99)) return 'rain';
  if (c === 3 || c === 2) return (opts.precipitation ?? 0) > 0 ? 'rain' : 'cloudy';
  if (c === 0 || c === 1) return (opts.precipitation ?? 0) > 0 ? 'rain' : 'sunny';
  return 'cloudy';
}

let cache: { at: number; data: OfficeWeather } | null = null;
let inflight: Promise<OfficeWeather> | null = null;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (u, i) => fetch(u, i);
/** Faqat testlar. */
export function __setWeatherFetcherForTests(f: Fetcher | null): void { fetcher = f || ((u, i) => fetch(u, i)); cache = null; inflight = null; }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function getOfficeWeather(now = Date.now()): Promise<OfficeWeather> {
  if (cache && now - cache.at < TTL) return { ...cache.data, source: 'cache' };
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetcher(OPEN_METEO_URL, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(`open-meteo ${r.status}`);
      const j: any = await r.json();
      const c = j?.current || {};
      const code = num(c.weather_code), precipitation = num(c.precipitation), snowfall = num(c.snowfall), cloud = num(c.cloud_cover);
      const data: OfficeWeather = {
        mode: wmoToMode(code, { precipitation, snowfall, cloud }), code, temp: num(c.temperature_2m),
        isDay: c.is_day === 1 ? true : c.is_day === 0 ? false : null, cloud, precipitation, snowfall,
        at: new Date(now).toISOString(), source: 'open-meteo',
      };
      cache = { at: now, data };
      return data;
    } catch {
      if (cache) return { ...cache.data, source: 'cache' as const };
      return { mode: 'sunny' as const, code: null, temp: null, isDay: null, cloud: null, precipitation: null, snowfall: null, at: new Date(now).toISOString(), source: 'fallback' as const };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
