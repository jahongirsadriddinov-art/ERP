import { useEffect, useRef, useState } from "react";
import { API_BASE } from "./api";

const DEFAULT_INTERVAL_MS = 60_000; // backend /api/gps/config berolmasa shu ishlatiladi

const WORKER_ROLES = ['ishchi', 'prorab', 'brigadir'];

// GPS kuzatuv — SAYTда endi "Ishga keldim" tugmasiga QAT'IY BOG'LIQ (foydalanuvchi
// aniq talabi bilan): "Ishga keldim" bosilmaguncha GPS UMUMAN ishlamaydi,
// "Ishni tugatdim" bosilgach to'xtaydi. (Botда bu boshqacha — u doim location
// qabul qiladi, chunki Telegram'ning o'zi shunday ishlaydi; qarang bot.ts.)
//
// Bu App komponenti darajasida (sahifadan tashqarida) chaqirilishi kerak —
// shunda ichki navigatsiya GPS'ni to'xtatmaydi, faqat logout/foydalanuvchi
// almashishi yoki isWorking o'zgarishi to'xtatadi/boshlaydi.
//
// MUHIM: effekt `userId` VA `isWorking`ga bog'liq — ikkinchisi o'zgarganda
// (checkin/checkout) effekt qayta ishlab, GPS'ni mos ravishda to'xtatadi/
// boshlaydi. `role`ni ham dependency qilish xavfsiz (primitiv string), lekin
// `userId` o'rniga butun user obyektini bermaslik SHART — aks holda har bir
// bog'liqsiz re-render intervalni qayta boshlab yuboradi.
// enabled=false (masalan sayt texnik ishlar rejimida bo'lganda) — kuzatuv
// UMUMAN boshlanmaydi/darhol to'xtaydi. Aniq talab: "sayt ochirilgan
// bolsa ham locatsiya ochmasin, joylashuv uzatip turishi ochmasin" — bunsiz
// ilova qulflangan ekranda ham fonda GPS so'rashda/yuborishda davom etaverar,
// tarmoq/batareyani behuda sarflab, 503 bilan rad etiladigan so'rovlar
// yuborardi.
export function useGeoTracker(userId: string | undefined, role: string | undefined, isWorking: boolean, enabled: boolean = true) {
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
    // XATO TUZATILDI ("aniqlikni yahshiroq olsin"): maximumAge=60000 interval
    // (odatda ham 60s) bilan bir xil edi — eng yomon holatda brauzer/OS
    // hozirgi vaqtdan 2 intervalgacha (120s) ESKI keshlangan koordinatani
    // qaytarishi mumkin edi, "jonli" kuzatuvni sezilarli kechiktirib. Endi
    // 20s — batareya uchun baribir keshlashga ruxsat beradi, lekin xaritadagi
    // nuqta haqiqiy joylashuvdan sezilarli orqada qolmasligini kafolatlaydi.
    navigator.geolocation.getCurrentPosition(
      post,
      () => navigator.geolocation.getCurrentPosition(post, giveUp, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 20000 }
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
    if (!enabled) return;
    if (!userId || !isWorking) return;
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
  }, [userId, isWorking, enabled]);

  return { gpsTracking };
}
