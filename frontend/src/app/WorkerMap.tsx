import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { X, Navigation } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppUser } from "./App";

interface GpsPoint { userId: string; lat: number; lng: number; accuracy?: number; timestamp: string; source?: 'site'|'bot_live'|'bot_once' }

// Toshkent — hech qanday xodim GPS ma'lumoti bo'lmaganda xaritaning boshlang'ich
// markazi (aks holda [0,0] — Gvineya qo'ltig'ida ochiladi).
const DEFAULT_CENTER: [number, number] = [41.2995, 69.2401];

// "Jonli" (doimiy kuzatilayotgan) manba — marker nafas oladi (pulse), harakat
// qilganda joyidan siljiydi. "bot_once" — bir martalik pin, statik, o'zgarmas
// oxirgi ma'lum joy sifatida ko'rsatiladi.
const isLiveSource = (s?: string) => s === 'site' || s === 'bot_live';

function workerDivIcon(name: string, live: boolean, stale: boolean) {
  const initial = (name || '?').charAt(0).toUpperCase();
  const ring = live ? (stale ? '#f59e0b' : '#22c55e') : '#94a3b8';
  const pulse = live && !stale ? `<span class="wm-pulse" style="background:${ring}"></span>` : '';
  return L.divIcon({
    className: 'wm-marker',
    html: `<div class="wm-marker-wrap"><div class="wm-marker-inner" style="border-color:${ring}">${pulse}<span>${initial}</span></div><span class="wm-marker-tail" style="border-top-color:${ring}"></span></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -38],
  });
}

export default function WorkerMap({ users, gpsLocations, focusUserId }: { users: AppUser[]; gpsLocations: GpsPoint[]; focusUserId?: string | null }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  // XATO TUZATILDI ("aniqroq" — accuracy): `accuracy` maydoni bazadan
  // kelayotgan edi, lekin xaritada UMUMAN ishlatilmasdi — GPS-asosli aniq
  // joylashuv bilan qo'pol (masalan IP/tarmoq-asosli, yuzlab metr xato)
  // joylashuv BIR XIL nuqta sifatida ko'rsatilardi, foydalanuvchi qay
  // birига ishonish kerakligini bilmasdi. Endi har bir markerni o'rab
  // turgan doira — radiusi haqiqiy aniqlik (metr), qanchalik katta doira
  // — shunchalik noaniq joylashuv.
  const circlesRef = useRef<Record<string, L.Circle>>({});
  const [navTarget, setNavTarget] = useState<{ lat: number; lng: number; name: string } | null>(null);

  // Xarita — bir marta yaratiladi
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // XATO TUZATILDI ("mapda nimadir yozuv qirqilib qolgan"): Leaflet'ning
    // standart zoom tugmalari (+/-) ham TEPA-CHAP burchakda, "jonli · N jami"
    // yorlig'imiz HAM xuddi shu burchakda (`top-3 left-3`) — ikkalasi
    // ustma-ust tushib, matn/tugma qirqilib/siqilib ko'rinardi. Zoom
    // tugmalari pastki-chap burchakka ko'chirildi (bu yerda hech narsa yo'q).
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true }).setView(DEFAULT_CENTER, 12);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markersRef.current = {}; circlesRef.current = {}; };
  }, []);

  // Markerlar — gpsLocations o'zgarganda yangilanadi (yangi socket yangilanishi kelganda ham)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const now = Date.now();
    const seen = new Set<string>();

    gpsLocations.forEach(loc => {
      const user = users.find(u => u.id === loc.userId);
      if (!user) return;
      seen.add(loc.userId);
      const live = isLiveSource(loc.source);
      const stale = (now - new Date(loc.timestamp).getTime()) > 15 * 60 * 1000; // 15 daqiqadan katta — "eskirgan"
      const icon = workerDivIcon(user.name, live, stale);
      const existing = markersRef.current[loc.userId];
      if (existing) {
        existing.setLatLng([loc.lat, loc.lng]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([loc.lat, loc.lng], { icon }).addTo(map);
        marker.on('click', () => setNavTarget({ lat: loc.lat, lng: loc.lng, name: user.name }));
        markersRef.current[loc.userId] = marker;
      }
      const veryRough = (loc.accuracy || 0) > 300; // ~300m'dan katta — odatda tarmoq/IP-asosli, GPS chip emas
      const statusWord = live ? (stale ? t('map.stale') : t('map.live')) : t('map.lastKnown');
      markersRef.current[loc.userId].bindTooltip(
        `${user.name} · ${statusWord}${loc.accuracy ? ` · ±${Math.round(loc.accuracy)}m` : ''}`,
        { direction: 'top', offset: [0, -18] }
      );

      // Aniqlik doirasi — real GPS radiusi bo'lsa yashil/ko'k, juda qo'pol
      // (tarmoq-asosli) bo'lsa sarg'ish-shtrixli, joylashuvga umuman
      // ishonmaslik kerakligini ko'rsatadi.
      if (loc.accuracy && loc.accuracy > 5) {
        const circleStyle = { radius: loc.accuracy, color: veryRough ? '#f59e0b' : '#3b82f6', weight: 1, fillOpacity: 0.08, dashArray: veryRough ? '4 4' : undefined };
        if (circlesRef.current[loc.userId]) {
          circlesRef.current[loc.userId].setLatLng([loc.lat, loc.lng]).setStyle(circleStyle).setRadius(loc.accuracy);
        } else {
          circlesRef.current[loc.userId] = L.circle([loc.lat, loc.lng], circleStyle).addTo(map);
        }
      } else if (circlesRef.current[loc.userId]) {
        circlesRef.current[loc.userId].remove();
        delete circlesRef.current[loc.userId];
      }
    });

    // Endi GPS'i yo'q xodimlarning eski markerini olib tashlaymiz
    Object.keys(markersRef.current).forEach(uid => {
      if (!seen.has(uid)) {
        markersRef.current[uid].remove(); delete markersRef.current[uid];
        if (circlesRef.current[uid]) { circlesRef.current[uid].remove(); delete circlesRef.current[uid]; }
      }
    });

    // Birinchi marta ma'lumot kelganda — barcha markerlarni ko'rsatadigan qilib markazlashtirish
    const pts = gpsLocations.map(l => [l.lat, l.lng] as [number, number]);
    if (pts.length > 0 && !map.__wmFitted) {
      map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
      (map as any).__wmFitted = true;
    }
  }, [gpsLocations, users, t]);

  // "Ishchilar ro'yxati"dan farqli — bu yerda (Jonli xarita) ismi bosilgan
  // xodim FULL profil OCHMAYDI, faqat xaritani o'sha xodimning markeriga
  // suzib olib boradi ("qayerda bo'lsa mapla orqali uni oldiga olib
  // boradigan qil" — aniq talab). Marker allaqachon chizilgan bo'lishi
  // kerak, shu sabab bu ALOHIDA effekt (marker-chizish effektidan keyin).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusUserId) return;
    const marker = markersRef.current[focusUserId];
    if (!marker) return;
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.6 });
    marker.openTooltip();
  }, [focusUserId, gpsLocations]);

  // Jonli (live) deb hisoblanadigan xodimlar soni — xarita ustidagi
  // yorliqda ko'rsatish uchun (foydali ma'lumot + "premium" texnik detal,
  // LandingPage'dagi bilan bir xil monospace/burchak-belgi uslubida).
  const nowTs = Date.now();
  const liveCount = gpsLocations.filter(l => isLiveSource(l.source) && (nowTs - new Date(l.timestamp).getTime()) <= 15 * 60 * 1000).length;

  return (
    <div className="wm-map relative w-full h-[340px] rounded-2xl overflow-hidden surface">
      <div ref={containerRef} className="w-full h-full" />

      {/* Chizma-uslubidagi burchak-belgilar — LandingPage'dagi CornerMarks bilan
          bir xil chizgi uslubi, lekin RANGI ATAYLAB oq qoldirilgan: bu yerda
          (LandingPage'dan farqli) belgilar bir xil sirt emas, xilma-xil
          rangdagi xarita RASTRINING (suv/o'rmon/yo'l) USTIDA turadi — agar
          firmaning primary rangi (masalan ko'k) tasodifan suv yuzasi bilan
          bir xil ohangda bo'lsa, belgi butunlay yo'qolib qolishi mumkin edi.
          Shu sabab kontrast uchun oq saqlanadi, lekin firmaning rangi bilan
          BOG'LASH uchun yumshoq primary drop-shadow qo'shildi — brend bilan
          "begona" emas, aloqador ko'rinadi, kontrast esa har doim kafolatli. */}
      <div className="pointer-events-none absolute inset-2 z-[401]" aria-hidden="true" style={{ filter: 'drop-shadow(0 0 2px var(--primary))' }}>
        <span className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-white/85 dark:border-white/60 rounded-tl-[3px]" />
        <span className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-white/85 dark:border-white/60 rounded-tr-[3px]" />
        <span className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-white/85 dark:border-white/60 rounded-bl-[3px]" />
        <span className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-white/85 dark:border-white/60 rounded-br-[3px]" />
      </div>

      {/* Jonli xodimlar yorlig'i — chap yuqori burchak */}
      {gpsLocations.length > 0 && (
        <div className="absolute top-3 left-3 z-[401] flex items-center gap-1.5 bg-background/85 backdrop-blur-md border border-border/60 rounded-full pl-2 pr-3 py-1 shadow-sm">
          <span className={`w-1.5 h-1.5 rounded-full ${liveCount > 0 ? "bg-green-500 animate-pulse" : "bg-muted-foreground/50"}`} />
          <span className="text-[10px] font-semibold tracking-wide" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            {t('map.liveTotal', { live: liveCount, total: gpsLocations.length })}
          </span>
        </div>
      )}

      {gpsLocations.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 pointer-events-none">
          <p className="text-xs text-muted-foreground">{t('map.noData')}</p>
        </div>
      )}
      {navTarget && <NavigateChoiceModal target={navTarget} onClose={() => setNavTarget(null)} />}
      {/* Leaflet marker/pulse uslubi — komponentga xos, globals.css'ga chiqarilmadi
          (faqat shu joyda ishlatiladi, Leaflet o'z className'lari bilan ziddiyat
          bo'lmasligi uchun aniq "wm-" prefiksi bilan). */}
      <style>{`
        .wm-marker { background: transparent; border: none; }
        .wm-marker-wrap { position: relative; width: 34px; height: 42px; }
        .wm-marker-inner {
          position: relative;
          width: 30px; height: 30px;
          margin: 0 auto;
          border-radius: 9999px;
          border: 2.5px solid;
          /* XATO TUZATILDI: avval qattiq kodlangan #1B3A6B (standart tema
             navy) edi — firma COLOR_THEMES'dan boshqa rang (forest/rose/
             amber va h.k.) tanlagan bo'lsa ham marker doim standart ko'k
             bo'lib qolardi, ilovaning qolgan qismi bilan mos kelmasdi. Endi
             joriy temaning --primary o'zgaruvchisidan olinadi. */
          background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 70%, black));
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700;
          box-shadow: 0 3px 10px rgba(0,0,0,0.4);
        }
        .wm-marker-tail {
          position: absolute; left: 50%; bottom: 2px;
          width: 0; height: 0; margin-left: -5px;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-top: 8px solid;
          filter: drop-shadow(0 2px 2px rgba(0,0,0,0.25));
        }
        .wm-pulse {
          position: absolute; inset: -6px;
          border-radius: inherit;
          opacity: 0.45;
          animation: wm-pulse-anim 2s ease-out infinite;
        }
        @keyframes wm-pulse-anim {
          0% { transform: scale(0.8); opacity: 0.5; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) { .wm-pulse { animation: none; opacity: 0.2; } }
        /* Tema-mos xarita foni — avval doim och kulrang edi, qorong'i
           rejimda tayanch (surface) bilan mos kelmasdi. Endi CSS
           o'zgaruvchisidan olinadi. */
        .wm-map .leaflet-container { background: var(--muted); font-family: inherit; }
        /* Qorong'i rejimda OSM plitalarini (tile) invert qilib, xaritani
           ilovaning qolgan qismi bilan uyg'un qorong'i ko'rinishga
           keltiradi — markerlar/yorliqlar ta'sirlanmasligi uchun faqat
           tile-pane'ga qo'llaniladi. */
        .dark .wm-map .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.92) saturate(0.9); }
        .wm-map .leaflet-control-zoom a { color: var(--foreground); background: var(--card); border-color: var(--border) !important; }
        .wm-map .leaflet-control-zoom a:hover { background: var(--muted); }
        .wm-map .leaflet-control-attribution { background: color-mix(in srgb, var(--background) 75%, transparent) !important; color: var(--muted-foreground) !important; font-size: 9px !important; }
        .wm-map .leaflet-control-attribution a { color: var(--muted-foreground) !important; }
      `}</style>
    </div>
  );
}

// Xodim joylashuviga yo'naltirish — qaysi xarita ilovasi orqali ochish
// tanlovi (aniq foydalanuvchi talabi: "Google Maps, Yandex Maps yoki boshqa").
export function NavigateChoiceModal({ target, onClose }: { target: { lat: number; lng: number; name: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const { lat, lng, name } = target;
  const options = [
    { label: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving` },
    { label: 'Yandex Maps', url: `https://yandex.com/maps/?rtext=~${lat},${lng}&rtt=auto` },
    // geo: URI — Android'da o'rnatilgan standart xarita ilovasini tanlash oynasini ochadi.
    { label: t('map.defaultApp'), url: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})` },
  ];
  // document.body'ga portal orqali chiqariladi — aks holda xarita konteyneri
  // (yoki uni o'rab turgan animatsiyalangan sahifa) haqiqiy "fixed"ni buzib,
  // modal xarita ichida "kesilib qolgan" holda ko'rinardi (App.tsx'dagi
  // kontekst-menyusida ham xuddi shu sabab bilan portal ishlatilgan).
  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm surface rounded-3xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-bold flex items-center gap-1.5"><Navigation className="w-4 h-4 text-primary" /> {t('map.navigateTitle')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('map.navigateSubtitle', { name })}</p>
          </div>
          <button onClick={onClose} aria-label={t('map.close')} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-2">
          {options.map(o => (
            <a key={o.label} href={o.url} target="_blank" rel="noopener noreferrer" onClick={onClose}
              className="block w-full text-center text-sm font-semibold py-3 rounded-2xl border border-border/60 hover:bg-muted liquid-transition">
              {o.label}
            </a>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
