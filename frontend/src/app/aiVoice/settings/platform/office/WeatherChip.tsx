import "../../../../i18n/aiVoiceNs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { WEATHER_MODES, tashkentTime } from "./sky";
import { effectiveHour, effectiveMode, useWeather, WEATHER_ICON, weatherStore } from "./weatherStore";

// AI ofis — sarlavhadagi ob-havo: belgisi + harorat (Toshkent, haqiqiy); bosilsa — tanlash: Avto / Quyosh / Bulut / Yomg'ir /
// Qor / Tuman va kun vaqti (Avto — Toshkentning hozirgi vaqti yoki qo'lda soat).
type K = (key: string, o?: any) => string;

/** Sahna uchun amaldagi ob-havo va soat (har daqiqada yangilanadi). */
export function useOfficeWeather() {
  const w = useWeather();
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(i); }, []);
  return { mode: effectiveMode(w), hour: effectiveHour(w), w };
}

export default function WeatherChip({ dark = false }: { dark?: boolean }) {
  const { t } = useTranslation();
  const k: K = (key, o) => t(`aiVoice.office.${key}`, o) as string;
  const { mode, hour, w } = useOfficeWeather();
  const [open, setOpen] = useState(false);
  const night = hour < 6 || hour >= 19.5;
  const icon = mode === "sunny" && night ? "🌙" : WEATHER_ICON[mode];
  const temp = w.real?.temp;
  const hh = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
  return (
    <div className="relative flex-shrink-0" data-ui>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="ai-office-weather" title={k(`weather.${mode}`)}
        className={dark ? "h-9 px-3 rounded-full bg-black/60 text-white text-[13px] font-semibold backdrop-blur inline-flex items-center gap-1.5"
          : "h-8 px-3 rounded-full border border-border bg-card/60 text-[12px] font-semibold inline-flex items-center gap-1.5"}>
        <span>{icon}</span>
        {temp !== null && temp !== undefined && <span className="tabular-nums" data-testid="ai-office-temp">{Math.round(temp)}°</span>}
        <span className="opacity-70 tabular-nums">{hh(hour)}</span>
      </button>
      {open && (
        <div className={`absolute z-50 ${dark ? "left-0" : "right-0"} mt-1 w-[min(290px,calc(100vw-16px))] rounded-2xl bg-card text-foreground border border-border shadow-2xl p-3 space-y-2.5`} data-testid="ai-office-weather-menu">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{k("weather.title")}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {(["auto", ...WEATHER_MODES] as const).map((m) => (
              <button key={m} type="button" onClick={() => weatherStore.setMode(m)} aria-pressed={w.override === m} data-testid={`ai-office-weather-${m}`}
                className={`h-9 rounded-xl text-[12px] font-semibold ${w.override === m ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70"}`}>
                {m === "auto" ? "🛰 " : `${WEATHER_ICON[m]} `}{k(`weather.${m}`)}
              </button>
            ))}
          </div>
          {w.override === "auto" && (
            <p className="text-[11.5px] text-muted-foreground" data-testid="ai-office-weather-real">
              {w.real ? `${k("weather.real")}: ${WEATHER_ICON[w.real.mode]} ${k(`weather.${w.real.mode}`)}${w.real.temp !== null ? `, ${Math.round(w.real.temp)}°C` : ""}` : "…"}
            </p>
          )}
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{k("weather.time")}</p>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={w.hourOverride === null} data-testid="ai-office-time-auto"
              onChange={(e) => weatherStore.setHour(e.target.checked ? null : Math.floor(tashkentTime().hour))} />
            {k("weather.timeAuto")}
          </label>
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={23.75} step={0.25} value={hour} disabled={w.hourOverride === null} data-testid="ai-office-time" className="flex-1"
              onChange={(e) => weatherStore.setHour(Number(e.target.value))} aria-label={k("weather.time")} />
            <span className="tabular-nums text-[12px] w-11 text-right">{hh(hour)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
