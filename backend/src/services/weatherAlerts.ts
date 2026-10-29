// Ob-havo ogohlantirishi (owner 2026-10-29: "ob-havoni ogohlantirishini qo'shish kerak,
// AI telefon qilib va profilidan yozadi").
//
// Har kuni kechqurun ERTANGI kun prognozi tekshiriladi va qurilishga xavfli shart-sharoit
// bo'lsa rahbarga xabar beriladi. Maqsad — "yomg'ir yog'di" deb aytish emas, balki
// ERTAGA QANDAY ISH QILIB BO'LMASLIGINI oldindan aytish: beton, suvoq, bo'yoq, kran.
//
// Joy: firmaning faol obyektlari koordinatasidan olinadi (LocationPicker orqali kiritilgan).
// Koordinata yo'q bo'lsa — Toshkent.

export interface DayForecast {
  date: string;
  tMin: number;
  tMax: number;
  rainProb: number;
  rainMm: number;
  snowCm: number;
  windMax: number;
}

export interface WeatherRisk { kind: 'rain' | 'frost' | 'heat' | 'wind' | 'snow'; text: string }

const TASHKENT = { lat: 41.31, lon: 69.28 };
const TIMEOUT_MS = 10_000;
const CACHE_MS = 3 * 3600_000;
const cache = new Map<string, { at: number; v: DayForecast | null }>();

/** Ertangi kun prognozi (Open-Meteo, bepul va kalitsiz). */
export async function tomorrowForecast(
  lat = TASHKENT.lat, lon = TASHKENT.lon, fetchImpl: typeof fetch = fetch,
): Promise<DayForecast | null> {
  // Koordinatani yaxlitlaymiz: bir shahardagi obyektlar uchun bitta so'rov yetadi
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;

  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + '&daily=temperature_2m_min,temperature_2m_max,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_speed_10m_max'
    + '&timezone=Asia%2FTashkent&forecast_days=2';
  let out: DayForecast | null = null;
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.ok) {
      const j: any = await r.json();
      const d = j?.daily;
      // [0] — bugun, [1] — ertaga
      if (d && Array.isArray(d.time) && d.time.length > 1) {
        out = {
          date: String(d.time[1]),
          tMin: Number(d.temperature_2m_min?.[1]),
          tMax: Number(d.temperature_2m_max?.[1]),
          rainProb: Number(d.precipitation_probability_max?.[1]) || 0,
          rainMm: Number(d.precipitation_sum?.[1]) || 0,
          snowCm: Number(d.snowfall_sum?.[1]) || 0,
          windMax: Number(d.wind_speed_10m_max?.[1]) || 0,
        };
      }
    }
  } catch { /* prognoz olinmasa — ogohlantirish ham yo'q */ }
  cache.set(key, { at: Date.now(), v: out });
  return out;
}

/**
 * Prognozdan qurilish uchun xavflarni chiqaradi. Hech qanday xavf bo'lmasa — bo'sh ro'yxat
 * (bo'sh bo'lsa HECH KIMGA xabar yuborilmaydi: har kuni "bugun yaxshi kun" deb yozish — spam).
 */
export function risksFor(f: DayForecast | null): WeatherRisk[] {
  if (!f) return [];
  const out: WeatherRisk[] = [];
  const mm = Math.round(f.rainMm);

  if (f.snowCm >= 1) {
    out.push({ kind: 'snow', text: `qor kutilmoqda (${f.snowCm.toFixed(0)} sm) — ochiq maydondagi ishlar va yetkazib berish qiyinlashadi` });
  } else if (f.rainProb >= 60 || f.rainMm >= 3) {
    out.push({ kind: 'rain', text: `yomg'ir ehtimoli ${f.rainProb}%${mm ? ` (${mm} mm)` : ''} — beton quyish, suvoq va bo'yoq ishlarini ko'chiring` });
  }
  // Beton +5°C dan past haroratda normal qotmaydi
  if (Number.isFinite(f.tMin) && f.tMin <= 5) {
    out.push({ kind: 'frost', text: `kechasi ${Math.round(f.tMin)}°C — beton qotishi buziladi, quyilgan joyni yoping yoki ishni ko'chiring` });
  }
  if (Number.isFinite(f.tMax) && f.tMax >= 38) {
    out.push({ kind: 'heat', text: `kunduzi ${Math.round(f.tMax)}°C — ishchilarga suv va soya, og'ir ishni ertalabki soatlarga oling` });
  }
  // Kran va balandlikdagi ish uchun shamol xavfli
  if (f.windMax >= 12) {
    out.push({ kind: 'wind', text: `shamol ${Math.round(f.windMax)} m/s — kran va balandlikdagi ishlar xavfli` });
  }
  return out;
}

/** Rahbarga yuboriladigan xabar matni. Xavf bo'lmasa — bo'sh satr. */
export function alertText(f: DayForecast | null, place: string): string {
  const risks = risksFor(f);
  if (!risks.length || !f) return '';
  const head = `🌦 Ertaga (${f.date})${place ? ` — ${place}` : ''}: ${Math.round(f.tMin)}…${Math.round(f.tMax)}°C`;
  return [head, '', ...risks.map((r) => `• ${r.text[0].toUpperCase()}${r.text.slice(1)}`)].join('\n');
}

/** Xavf jiddiymi — AI qo'ng'iroq qilsinmi yoki xabar yetarlimi. */
export function severe(risks: WeatherRisk[]): boolean {
  return risks.some((r) => r.kind === 'snow' || r.kind === 'frost' || r.kind === 'wind');
}
