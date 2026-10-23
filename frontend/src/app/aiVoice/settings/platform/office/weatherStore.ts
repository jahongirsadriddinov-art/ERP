import { useSyncExternalStore } from "react";
import { call } from "../../api";
import { WEATHER_MODES, tashkentTime, type WeatherMode } from "./sky";

// AI ofis — ob-havo va kun vaqti: standart — Toshkentdagi HAQIQIY ob-havo (backend /platform/office/weather, Open-Meteo) va
// haqiqiy Toshkent vaqti; qo'lda tanlash (Avto / Quyosh / Bulut / Yomg'ir / Qor / Tuman) va vaqtni o'zgartirish — eslab qolinadi.
export interface RealWeather { mode: WeatherMode; code: number | null; temp: number | null; isDay: boolean | null; source: string }
export interface WState { real: RealWeather | null; override: WeatherMode | "auto"; hourOverride: number | null }
const K_MODE = "aiOffice.weather", K_HOUR = "aiOffice.timeOverride";
const read = <T,>(k: string, f: T, ok: (v: any) => boolean): T => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return ok(v) ? v : f; } catch { return f; } };
let st: WState = {
  real: null,
  override: read<WeatherMode | "auto">(K_MODE, "auto", (v) => v === "auto" || WEATHER_MODES.includes(v)),
  hourOverride: read<number | null>(K_HOUR, null, (v) => v === null || (typeof v === "number" && v >= 0 && v < 24)),
};
const ls = new Set<() => void>();
const set = (p: Partial<WState>) => { st = { ...st, ...p }; ls.forEach((l) => l()); };
let timer: ReturnType<typeof setInterval> | null = null;

export const weatherStore = {
  get state() { return st; },
  subscribe(l: () => void) {
    ls.add(l);
    if (!timer) { void weatherStore.refresh(); timer = setInterval(() => { if (!document.hidden) void weatherStore.refresh(); }, 10 * 60_000); }
    return () => { ls.delete(l); if (!ls.size && timer) { clearInterval(timer); timer = null; } };
  },
  async refresh() {
    const r = await call<RealWeather>("GET", "/platform/office/weather");
    if (r.ok && r.data?.mode) set({ real: r.data });
  },
  setMode(m: WeatherMode | "auto") { try { localStorage.setItem(K_MODE, JSON.stringify(m)); } catch { /* */ } set({ override: m }); },
  setHour(h: number | null) { try { localStorage.setItem(K_HOUR, JSON.stringify(h)); } catch { /* */ } set({ hourOverride: h }); },
};
export const useWeather = () => useSyncExternalStore(weatherStore.subscribe, () => st, () => st);
/** Amaldagi rejim: qo'lda tanlangan yoki haqiqiy (bo'lmasa — quyosh). */
export const effectiveMode = (s: WState): WeatherMode => (s.override !== "auto" ? s.override : s.real?.mode || "sunny");
/** Amaldagi Toshkent soati (qo'lda tanlangan yoki hozirgi). */
export const effectiveHour = (s: WState, d = new Date()) => (s.hourOverride ?? tashkentTime(d).hour);
export const WEATHER_ICON: Record<WeatherMode, string> = { sunny: "☀️", cloudy: "☁️", rain: "🌧️", snow: "❄️", fog: "🌫️" };
