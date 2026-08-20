import { useEffect, useRef, useState } from "react";
import { API_BASE } from "./api";

const DEFAULT_INTERVAL_MS = 60_000; // backend /api/gps/config berolmasa shu ishlatiladi

const WORKER_ROLES = ['ishchi', 'prorab', 'brigadir'];

// GPS kuzatuv — "Ishga keldim" tugmasidan MUSTAQIL — xodim saytga/ilovaga
// kirgan zahoti (check-in/check-out bosilgan-bosilmaganidan qat'i nazar)
// joylashuvi darhol va keyin har intervalMs'da avtomatik yuborilib turishi
// kerak, direktor/o'rinbosar esa istalgan vaqt "Kuzatuv" sahifasida
// "Yangilash"ni bosib eng so'nggi joylashuvni ko'ra oladi — xodim hech
// qanday qo'shimcha tugma bosishi shart emas. Bu App komponenti darajasida
// (sahifadan tashqarida) chaqirilishi kerak — shunda navigatsiya GPS'ni
// to'xtatmaydi, faqat logout/foydalanuvchi almashishi to'xtatadi.
//
// MUHIM: effekt faqat `userId` o'zgarganda qayta ishga tushadi (asl App.tsx
// implementatsiyasidagi `[liveUser?.id]` bilan bir xil) — `role`ni ham
// dependency qilib qo'yish xavfsiz (u primitiv string, obyekt referensi
// emas), lekin `userId` o'rniga butun user obyektini bermaslik SHART —
// aks holda har bir bog'liqsiz re-render intervalni qayta boshlab yuboradi.
export function useGeoTracker(userId: string | undefined, role: string | undefined) {
  const [gpsTracking, setGpsTracking] = useState(false);
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsWarnedRef = useRef(false); // bir marta ogohlantirish uchun — har daqiqada konsolni to'ldirmaslik uchun

  // MUHIM: agar yuqori aniqlik (GPS chip) 10s ichida javob bermasa (bino ichida,
  // signal yomon, va h.k.) — darhol taslim bo'lmasdan past aniqlik (tarmoq/Wi-Fi
  // asosidagi joylashuv)ga tushib, baribir bitta koordinata yuborishga urinamiz.
  // Ikkalasi ham muvaffaqiyatsiz bo'lsagina (masalan ruxsat rad etilgan) — bir
  // marta (har safar emas) konsolga ogohlantirish yoziladi.
  const sendGpsNow = (token: string) => {
    if (!navigator.geolocation) return;
    const post = (pos: GeolocationPosition) => {
      fetch(`${API_BASE}/api/gps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      }).catch(()=>{});
    };
    const giveUp = (err: GeolocationPositionError) => {
      if (!gpsWarnedRef.current) {
        gpsWarnedRef.current = true;
        console.warn('[GPS] joylashuvni olib bo\'lmadi (ruxsat rad etilgan yoki signal yo\'q):', err?.message);
      }
    };
    navigator.geolocation.getCurrentPosition(
      post,
      () => navigator.geolocation.getCurrentPosition(post, giveUp, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const startGpsInterval = (intervalMs: number) => {
    if (gpsIntervalRef.current) return;
    const token = localStorage.getItem('token') || '';
    sendGpsNow(token);
    gpsIntervalRef.current = setInterval(() => sendGpsNow(token), intervalMs);
    setGpsTracking(true);
  };

  const stopGpsInterval = () => {
    if (gpsIntervalRef.current) { clearInterval(gpsIntervalRef.current); gpsIntervalRef.current = null; }
    setGpsTracking(false);
  };

  useEffect(() => {
    if (!userId) return;
    if (!role || !WORKER_ROLES.includes(role)) return;
    let cancelled = false;
    const token = localStorage.getItem('token') || '';

    // Interval backend'dan (GPS_INTERVAL_MS) olinadi — muvaffaqiyatsiz bo'lsa
    // yoki sekin javob bersa ham GPS boshlanishi kechikmasin/bloklanmasin
    // uchun standart qiymat bilan darhol boshlab, faqat interval sonini
    // (agar konfiguratsiya kelsa) moslashtiramiz.
    startGpsInterval(DEFAULT_INTERVAL_MS);
    fetch(`${API_BASE}/api/gps/config`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d?.intervalMs || d.intervalMs === DEFAULT_INTERVAL_MS) return;
        // Serverdan boshqacha interval kelsa — eskisini to'xtatib, yangisi bilan qayta boshlaymiz.
        stopGpsInterval();
        if (!cancelled) startGpsInterval(d.intervalMs);
      })
      .catch(() => {}); // standart interval bilan davom etadi

    return () => { cancelled = true; stopGpsInterval(); };
  }, [userId]);

  return { gpsTracking };
}
