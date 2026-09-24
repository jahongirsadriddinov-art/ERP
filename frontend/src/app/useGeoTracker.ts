import { useEffect, useRef, useState } from "react";
import { API_BASE } from "./api";

const DEFAULT_INTERVAL_MS = 60_000; // backend /api/gps/config berolmasa shu ishlatiladi
const MIN_INTERVAL_MS = 20_000;
const MAX_INTERVAL_MS = 10 * 60_000;
const QUEUE_KEY = 'erp_gps_queue';
const QUEUE_MAX = 500;

const WORKER_ROLES = ['ishchi', 'prorab', 'brigadir'];

export interface GpsStatus {
  state: 'idle' | 'ok' | 'denied' | 'unavailable' | 'timeout';
  accuracy?: number;        // oxirgi nuqtaning aniqligi (±metr)
  lastFixAt?: number;       // oxirgi MUVAFFAQIYATLI o'lchov vaqti (ms)
  battery?: number;         // 0-100 (Battery Status API bo'lmasa — undefined)
  charging?: boolean;
  intervalMs?: number;      // hozirgi (moslashtirilgan) yuborish oralig'i
  moving?: boolean;
  queued: number;           // internet yo'qligi sababli yuborilmay turgan nuqtalar
  network?: string;
}

interface QueuedPoint { lat: number; lng: number; accuracy?: number; speed?: number; heading?: number; altitude?: number; battery?: number; charging?: boolean; network?: string; timestamp: string }

const readQueue = (): QueuedPoint[] => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } };
const writeQueue = (q: QueuedPoint[]) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))); } catch {} };

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Bir necha soniya davomida watchPosition orqali ENG ANIQ o'lchovni tanlaydi
// (yagona getCurrentPosition ko'pincha GPS chip "qizib ulgurmasdan" ±100m+
// aniqlik bilan qaytadi). ±20m ga yetgach darhol to'xtaydi — batareyani ortiqcha
// sarflamaydi. Ruxsat rad etilsa (code 1) — darhol to'xtaydi.
function getBestFix(windowMs = 12000): Promise<{ pos: GeolocationPosition | null; err?: GeolocationPositionError }> {
  return new Promise(resolve => {
    let best: GeolocationPosition | null = null;
    let lastErr: GeolocationPositionError | undefined;
    let done = false;
    let watchId: number | null = null;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(timer);
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      resolve({ pos: best, err: best ? undefined : lastErr });
    };
    const timer = setTimeout(finish, windowMs);
    watchId = navigator.geolocation.watchPosition(
      p => { if (!best || p.coords.accuracy < best.coords.accuracy) best = p; if (p.coords.accuracy <= 20) finish(); },
      e => { lastErr = e; if (e.code === 1) finish(); },
      { enableHighAccuracy: true, timeout: windowMs, maximumAge: 0 },
    );
  });
}

// GPS kuzatuv — SAYTda "Ishga keldim" tugmasiga QAT'IY BOG'LIQ: "Ishga keldim"
// bosilmaguncha GPS UMUMAN ishlamaydi, "Ishni tugatdim" bosilgach to'xtaydi.
// (Botda bu boshqacha — u doim location qabul qiladi; qarang bot.ts.)
//
// Endi (yaxshilangan):
//  • ANIQLIK — eng yaxshi o'lchov tanlanadi (yuqoridagi getBestFix), past
//    aniqlikka faqat GPS umuman javob bermasa tushiladi.
//  • BATAREYA + HARAKAT — yuborish oralig'i moslashadi: harakatda tezroq
//    (asosiy/2), turganda sekinroq (asosiy×2), batareya ≤20% da ×2, ≤10% da
//    ×4 (quvvatlanayotgan bo'lsa ta'sir qilmaydi).
//  • OFFLINE — internet yo'q paytda nuqtalar qurilmada saqlanadi va aloqa
//    tiklangach bir yo'la (batch) yuboriladi, asl vaqti bilan.
//  • TELEMETRIYA — tezlik, yo'nalish, balandlik, batareya, tarmoq turi ham
//    yuboriladi (rahbariyat "Kuzatuv"da ko'radi).
//  • Sahifa fondan qaytganda darhol yangi o'lchov (brauzer fonda taymerlarni
//    to'xtatib qo'yadi).
//
// Bu App komponenti darajasida chaqirilishi kerak — ichki navigatsiya GPS'ni
// to'xtatmasin. enabled=false (sayt texnik ishlar rejimi) — kuzatuv boshlanmaydi.
export function useGeoTracker(userId: string | undefined, role: string | undefined, isWorking: boolean, enabled: boolean = true) {
  const [gpsTracking, setGpsTracking] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>({ state: 'idle', queued: readQueue().length });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runNowRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !userId || !isWorking) return;
    if (!role || !WORKER_ROLES.includes(role)) return;
    if (!navigator.geolocation) { setGpsStatus(s => ({ ...s, state: 'unavailable' })); return; }

    let cancelled = false;
    let baseMs = DEFAULT_INTERVAL_MS;
    let lowPct = 20, critPct = 10;
    let prevFix: { lat: number; lng: number } | null = null;
    let stillCount = 0;
    let running = false;
    let battery: any = null;
    (navigator as any).getBattery?.().then((b: any) => { battery = b; }).catch(() => {});

    setGpsTracking(true);

    const netType = (): string => {
      if (!navigator.onLine) return 'offline';
      const c = (navigator as any).connection;
      return (c?.type === 'wifi' ? 'wifi' : c?.effectiveType) || 'online';
    };

    const flushQueue = async () => {
      if (!navigator.onLine) return;
      let q = readQueue();
      while (q.length && !cancelled) {
        const chunk = q.slice(0, 100);
        try {
          const r = await fetch(`${API_BASE}/api/gps/batch`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
            body: JSON.stringify({ points: chunk }),
          });
          // 400 (yaroqsiz/eskirgan nuqtalar) — qayta urinishning foydasi yo'q, tashlab yuboramiz
          if (!r.ok && r.status !== 400) break;
        } catch { break; }
        q = q.slice(chunk.length);
        writeQueue(q);
      }
      setGpsStatus(s => ({ ...s, queued: readQueue().length }));
    };

    const nextInterval = (moving: boolean): number => {
      const lvl = battery && typeof battery.level === 'number' ? battery.level * 100 : undefined;
      const charging = !!battery?.charging;
      const batFactor = lvl != null && !charging ? (lvl <= critPct ? 4 : lvl <= lowPct ? 2 : 1) : 1;
      const motionFactor = moving ? 0.5 : stillCount >= 3 ? 2 : 1;
      const v = baseMs * batFactor * motionFactor;
      return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(v)));
    };

    const cycle = async () => {
      if (cancelled || running) return;
      running = true;
      let waitMs = baseMs;
      try {
        let { pos, err } = await getBestFix();
        // GPS chip javob bermadi — past aniqlik (tarmoq/Wi-Fi) bilan bir marta urinamiz.
        if (!pos && !cancelled && err?.code !== 1) {
          pos = await new Promise<GeolocationPosition | null>(res =>
            navigator.geolocation.getCurrentPosition(p => res(p), () => res(null), { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }));
        }
        const lvl = battery && typeof battery.level === 'number' ? Math.round(battery.level * 100) : undefined;
        const charging = battery ? !!battery.charging : undefined;

        if (!pos) {
          waitMs = err?.code === 1 ? Math.max(baseMs * 3, 3 * 60_000) : baseMs; // ruxsat rad etilgan — kamroq urinamiz
          setGpsStatus(s => ({
            ...s, state: err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable',
            battery: lvl, charging, intervalMs: waitMs, network: netType(), queued: readQueue().length,
          }));
        } else {
          const c = pos.coords;
          const cur = { lat: c.latitude, lng: c.longitude };
          const moved = prevFix ? distanceM(prevFix, cur) : 0;
          const moving = (c.speed != null && c.speed >= 1) || moved > Math.max(40, c.accuracy);
          stillCount = moving ? 0 : stillCount + 1;
          prevFix = cur;
          waitMs = nextInterval(moving);

          const point: QueuedPoint = {
            lat: c.latitude, lng: c.longitude, accuracy: c.accuracy,
            speed: c.speed ?? undefined, heading: c.heading ?? undefined, altitude: c.altitude ?? undefined,
            battery: lvl, charging, network: netType(), timestamp: new Date(pos.timestamp || Date.now()).toISOString(),
          };
          let sent = false;
          if (navigator.onLine) {
            try {
              const r = await fetch(`${API_BASE}/api/gps`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
                body: JSON.stringify(point),
              });
              sent = r.ok;
            } catch {}
          }
          if (sent) flushQueue(); else writeQueue([...readQueue(), point]);
          setGpsStatus({
            state: 'ok', accuracy: Math.round(c.accuracy), lastFixAt: Date.now(), battery: lvl, charging,
            intervalMs: waitMs, moving, network: netType(), queued: readQueue().length,
          });
        }
      } finally {
        running = false;
      }
      if (!cancelled) timerRef.current = setTimeout(cycle, waitMs);
    };

    const runNow = () => {
      if (cancelled) return;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      cycle();
    };
    runNowRef.current = runNow;

    // Interval backend'dan olinadi — GPS boshlanishi kutmasligi uchun standart
    // qiymat bilan DARHOL boshlab, konfiguratsiya kelsa keyingi siklda ishlatiladi.
    const token = localStorage.getItem('token') || '';
    fetch(`${API_BASE}/api/gps/config`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d || cancelled) return;
        if (d.intervalMs) baseMs = d.intervalMs;
        if (d.lowBatteryPercent) lowPct = d.lowBatteryPercent;
        if (d.criticalBatteryPercent) critPct = d.criticalBatteryPercent;
      })
      .catch(() => {});

    const onVisible = () => { if (document.visibilityState === 'visible') runNow(); };
    const onOnline = () => { flushQueue(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    runNow();

    return () => {
      cancelled = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      runNowRef.current = null;
      setGpsTracking(false);
      setGpsStatus(s => ({ ...s, state: 'idle' }));
    };
  }, [userId, isWorking, enabled]);

  return { gpsTracking, gpsStatus };
}

// Aniqlik darajasi (±metr): yaxshi ≤30, o'rta ≤100, yomon >100.
export type AccuracyQuality = 'good' | 'ok' | 'poor';
export const accuracyQuality = (m?: number | null): AccuracyQuality | null =>
  m == null ? null : m <= 30 ? 'good' : m <= 100 ? 'ok' : 'poor';
export const QUALITY_COLOR: Record<AccuracyQuality, string> = {
  good: 'text-green-600 dark:text-green-400', ok: 'text-amber-600 dark:text-amber-400', poor: 'text-red-600 dark:text-red-400',
};
