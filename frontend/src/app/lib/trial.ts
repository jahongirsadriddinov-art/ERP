// Bepul sinov muddati — bitta manbadan (owner 2026-10-27: "admin paneldan qancha bepulligi
// belgilanadi, o'shanda hamma joyda o'zgarsin"). Qiymat /api/plans dagi narxi 0 bo'lgan tarifdan
// olinadi (hozir "7-kun Tekin" → 7). Tarif admin panelidan o'zgartirilsa, sayt ham o'zi o'zgaradi.
import { useEffect, useState } from "react";
import { API_BASE } from "../api";

const KEY = "erp_trialDays";
const FALLBACK = 7;

const read = (): number => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : FALLBACK;
  } catch { return FALLBACK; }
};

let cached: number = read();
let inflight: Promise<number> | null = null;

/** Oxirgi ma'lum qiymat (so'rovsiz) — matnni darhol chizish uchun. */
export const trialDays = (): number => cached;

/** Serverdan yangilaydi (bir martalik, keshlanadi). */
export function loadTrialDays(): Promise<number> {
  if (inflight) return inflight;
  inflight = fetch(`${API_BASE}/api/plans`)
    .then((r) => (r.ok ? r.json() : null))
    .then((list: Array<{ amount: number; days: number; active?: boolean }> | null) => {
      const free = Array.isArray(list)
        ? list.filter((p) => Number(p.amount) === 0 && Number(p.days) > 0 && p.active !== false)
            .sort((a, b) => Number(b.days) - Number(a.days))[0]
        : null;
      if (free) {
        cached = Number(free.days);
        try { localStorage.setItem(KEY, String(cached)); } catch { /* */ }
      }
      return cached;
    })
    .catch(() => cached)
    .finally(() => { inflight = null; });
  return inflight;
}

/** React uchun: qiymat kelganda sahifa o'zi yangilanadi. */
export function useTrialDays(): number {
  const [days, setDays] = useState<number>(cached);
  useEffect(() => { let alive = true; void loadTrialDays().then((d) => { if (alive) setDays(d); }); return () => { alive = false; }; }, []);
  return days;
}
