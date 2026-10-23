// AI ofis — Toshkent vaqti va quyosh holati (sof hisob, unit test qilinadi). Toshkent: UTC+5 (yozgi vaqt yo'q), kenglik 41.31°,
// uzunlik 69.28°. Quyosh balandligi/azimuti — soddalashtirilgan astronomik formula (±1° — sahna uchun yetarli).
// Sahna koordinatalari: -z — shimol, +x — sharq.

export type WeatherMode = "sunny" | "cloudy" | "rain" | "snow" | "fog";
export const WEATHER_MODES: WeatherMode[] = ["sunny", "cloudy", "rain", "snow", "fog"];
const LAT = (41.31 * Math.PI) / 180;
const LON = 69.28;
const TZ = 5;

/** Toshkent mahalliy vaqti (soat, kasr bilan) va yilning kuni. */
export function tashkentTime(d = new Date()): { hour: number; doy: number } {
  const t = new Date(d.getTime() + TZ * 3600_000);
  const hour = t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600;
  const start = Date.UTC(t.getUTCFullYear(), 0, 0);
  const doy = Math.floor((Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - start) / 86400_000);
  return { hour, doy };
}

/** Quyosh: balandlik (radian; < 0 — tun) va azimut (radian, shimoldan soat yo'nalishida). */
export function sunPosition(hour: number, doy: number): { elevation: number; azimuth: number } {
  const decl = ((23.44 * Math.PI) / 180) * Math.sin(((2 * Math.PI) / 365) * (284 + doy));
  const solar = hour + (LON - TZ * 15) / 15; // mahalliy quyosh vaqti
  const H = ((solar - 12) * 15 * Math.PI) / 180;
  const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const cosAz = (Math.sin(decl) - Math.sin(elevation) * Math.sin(LAT)) / (Math.cos(elevation) * Math.cos(LAT) || 1e-6);
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (H > 0) azimuth = 2 * Math.PI - azimuth;
  return { elevation, azimuth };
}
/** Azimut/balandlik → sahna yo'nalishi (birlik vektor; -z shimol, +x sharq). */
export function skyDir(elevation: number, azimuth: number): [number, number, number] {
  const c = Math.cos(elevation);
  return [Math.sin(azimuth) * c, Math.sin(elevation), -Math.cos(azimuth) * c];
}

const mixC = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const k = Math.max(0, Math.min(1, t));
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
};

export interface SkyLook {
  top: string; horizon: string; fog: string;
  sunColor: string; sunIntensity: number; hemi: number; night: number; dusk: number;
}
/** Osmon ranglari va yorug'lik — quyosh balandligi va ob-havoga qarab (kun, shom/tong qizilligi, tun). */
export function skyLook(elevation: number, mode: WeatherMode): SkyLook {
  const deg = (elevation * 180) / Math.PI;
  const day = Math.max(0, Math.min(1, (deg + 4) / 14));          // -4° … 10° — tong/shom o'tishi
  const dusk = Math.max(0, 1 - Math.abs(deg - 2) / 9) * (deg > -8 ? 1 : 0); // ufqda qizillik
  const night = 1 - day;
  let top = mixC("#0b1530", "#3d82d6", day), horizon = mixC("#1a2340", "#bfdcf5", day);
  horizon = mixC(horizon, "#f08a4b", dusk * 0.75);
  top = mixC(top, "#5a5aa0", dusk * 0.35);
  const grey = mode === "sunny" ? 0 : mode === "cloudy" ? 0.55 : mode === "fog" ? 0.75 : 0.7;
  top = mixC(top, mixC("#1c2028", "#8a929c", day), grey);
  horizon = mixC(horizon, mixC("#252a33", "#b4bac2", day), grey);
  const sunColor = mixC("#ffd7a8", "#fff4e6", Math.max(0, Math.min(1, deg / 25)));
  const clear = mode === "sunny" ? 1 : mode === "cloudy" ? 0.45 : mode === "fog" ? 0.3 : 0.35;
  return {
    top, horizon, fog: mixC(horizon, "#c9ced4", mode === "fog" ? 0.5 : 0),
    sunColor, sunIntensity: Math.max(0, Math.sin(elevation)) * 2.2 * clear, hemi: 0.35 + day * 0.85 * (0.6 + 0.4 * clear), night, dusk,
  };
}
