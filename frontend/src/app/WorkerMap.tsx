import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Navigation from "@hugeicons/core-free-icons/Navigation01Icon";
import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import MinusIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import FitIcon from "@hugeicons/core-free-icons/CenterFocusIcon";
import GpsIcon from "@hugeicons/core-free-icons/Gps01Icon";
import SatIcon from "@hugeicons/core-free-icons/Satellite01Icon";
import MapIcon from "@hugeicons/core-free-icons/MapsIcon";
import { MorphIcon } from "morphicons/react";
import { useTranslation } from "react-i18next";
import { AppUser } from "./App";
import { memojiHtml } from "./components/UserAvatar";

interface GpsPoint { userId: string; lat: number; lng: number; accuracy?: number; timestamp: string; source?: 'site'|'bot_live'|'bot_once'; speed?: number; battery?: number; charging?: boolean; network?: string }

// Toshkent — hech qanday xodim GPS ma'lumoti bo'lmaganda xaritaning boshlang'ich
// markazi (aks holda [0,0] — Gvineya qo'ltig'ida ochiladi).
const DEFAULT_CENTER: [number, number] = [41.2995, 69.2401];

// "Jonli" (doimiy kuzatilayotgan) manba — marker nafas oladi (pulse), harakat
// qilganda joyidan siljiydi. "bot_once" — bir martalik pin, statik, o'zgarmas
// oxirgi ma'lum joy sifatida ko'rsatiladi.
const isLiveSource = (s?: string) => s === 'site' || s === 'bot_live';

// Xarita uslublari (owner 2026-10-22: "kartaning dizaynini o'zgartir") — toza CARTO plitkalari (yorug'/qorong'i) va
// sun'iy yo'ldosh; eski OSM plitkalari qorong'i rejimda teskari ranglanib, chalkash ko'rinardi.
// CARTO endi API kalit talab qiladi — kalitsiz Esri plitkalari. Qorong'i: to'q kulrang asos + nomlar qatlami.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const TILES: Record<'light' | 'dark' | 'sat', { url: string; maxNative: number }[]> = {
  light: [{ url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, maxNative: 19 }],
  dark: [
    { url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, maxNative: 16 },
    { url: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxNative: 16 },
  ],
  sat: [
    { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, maxNative: 19 },
    { url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, maxNative: 19 },
  ],
};
const isDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
const escHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Marker ichida — foydalanuvchi rasmi yoki uning barqaror 3D memoji'si (components/UserAvatar.tsx)
function workerDivIcon(user: AppUser, live: boolean, stale: boolean) {
  const name = user.name;
  const short = escHtml((name || '').split(' ')[0].slice(0, 12));
  const ring = live ? (stale ? '#f59e0b' : '#22c55e') : '#94a3b8';
  const pulse = live && !stale ? `<span class="wm-pulse" style="background:${ring}"></span>` : '';
  return L.divIcon({
    className: 'wm-marker',
    html: `<div class="wm-marker-wrap"><div class="wm-marker-inner" style="border-color:${ring}">${pulse}${memojiHtml(user.id, user.avatar)}</div><span class="wm-marker-tail" style="border-top-color:${ring}"></span><span class="wm-marker-name">${short}</span></div>`,
    iconSize: [40, 60],
    iconAnchor: [20, 44],
    popupAnchor: [0, -42],
  });
}

export interface TrackPoint { lat: number; lng: number; timestamp: string; accuracy?: number }

// Kuzatuv (owner 2026-10-22): telefonda xarita butun ekran (className bilan balandlik beriladi), markerni bosish —
// onSelect (ro'yxatdagi xodimni tanlash), tanlangan xodimning bugungi izi — track (chiziq + boshlanish/oxirgi nuqta).
export default function WorkerMap({ users, gpsLocations, focusUserId, track, onSelect, className }: {
  users: AppUser[]; gpsLocations: GpsPoint[]; focusUserId?: string | null;
  track?: TrackPoint[] | null; onSelect?: (userId: string) => void; className?: string;
}) {
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
  const trackLayerRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const tileRef = useRef<L.LayerGroup | null>(null);
  const [layer, setLayer] = useState<'map' | 'sat'>(() => { try { return localStorage.getItem('erp_mapLayer') === 'sat' ? 'sat' : 'map'; } catch { return 'map'; } });
  const [dark, setDark] = useState(isDark());
  // Mavzu (yorug'/qorong'i) almashsa — plitkalar ham almashsin
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(() => setDark(isDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  // Xarita — bir marta yaratiladi
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // XATO TUZATILDI ("mapda nimadir yozuv qirqilib qolgan"): Leaflet'ning
    // standart zoom tugmalari (+/-) ham TEPA-CHAP burchakda, "jonli · N jami"
    // yorlig'imiz HAM xuddi shu burchakda (`top-3 left-3`) — ikkalasi
    // ustma-ust tushib, matn/tugma qirqilib/siqilib ko'rinardi. Zoom
    // tugmalari pastki-chap burchakka ko'chirildi (bu yerda hech narsa yo'q).
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true }).setView(DEFAULT_CENTER, 12);
    mapRef.current = map;
    // Konteyner o'lchami o'zgarsa (telefonda pastki panel, burilish) — plitalar kulrang bo'lib qolmasin
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(containerRef.current);
    return () => { ro?.disconnect(); map.remove(); trackLayerRef.current = null; mapRef.current = null; markersRef.current = {}; circlesRef.current = {}; };
  }, []);

  // Plitka qatlami: xarita (yorug'/qorong'i) yoki sun'iy yo'ldosh
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const defs = layer === 'sat' ? TILES.sat : dark ? TILES.dark : TILES.light;
    tileRef.current?.remove();
    const g = L.layerGroup();
    defs.forEach((d, i) => L.tileLayer(d.url, { maxZoom: 19, maxNativeZoom: d.maxNative, ...(i === 0 ? { attribution: '&copy; Esri, OpenStreetMap' } : {}) }).addTo(g));
    tileRef.current = g.addTo(map);
    try { localStorage.setItem('erp_mapLayer', layer); } catch { /* */ }
  }, [layer, dark]);

  const fitAll = () => {
    const map = mapRef.current;
    const pts = gpsLocations.map(l => [l.lat, l.lng] as [number, number]);
    if (map && pts.length) map.fitBounds(pts, { padding: [48, 48], maxZoom: 16 });
  };
  const locateMe = () => {
    const map = mapRef.current;
    if (!map || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => map.flyTo([p.coords.latitude, p.coords.longitude], 16, { duration: 0.6 }), () => {}, { enableHighAccuracy: true, timeout: 8000 });
  };

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
      const icon = workerDivIcon(user, live, stale);
      const existing = markersRef.current[loc.userId];
      if (existing) {
        existing.setLatLng([loc.lat, loc.lng]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([loc.lat, loc.lng], { icon }).addTo(map);
        marker.on('click', () => {
          if (onSelectRef.current) { onSelectRef.current(loc.userId); return; }
          const ll = marker.getLatLng();
          setNavTarget({ lat: ll.lat, lng: ll.lng, name: user.name });
        });
        markersRef.current[loc.userId] = marker;
      }
      const veryRough = (loc.accuracy || 0) > 300; // ~300m'dan katta — odatda tarmoq/IP-asosli, GPS chip emas
      const statusWord = live ? (stale ? t('map.stale') : t('map.live')) : t('map.lastKnown');
      markersRef.current[loc.userId].bindTooltip(
        `${user.name} · ${statusWord}${loc.accuracy ? ` · ±${Math.round(loc.accuracy)}m` : ''}${loc.battery != null ? ` · 🔋${Math.round(loc.battery)}%` : ''}`,
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

  // Tanlangan xodimning bugungi izi
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    trackLayerRef.current?.remove();
    trackLayerRef.current = null;
    const pts = (track || []).filter(p => (p.accuracy ?? 0) <= 200).map(p => [p.lat, p.lng] as [number, number]);
    if (!pts.length) return;
    const g = L.layerGroup();
    if (pts.length > 1) {
      L.polyline(pts, { color: '#ffffff', weight: 7, opacity: 0.7 }).addTo(g);
      let primary = '#2563eb';
      try { primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || primary; } catch { /* */ }
      L.polyline(pts, { color: primary, weight: 4, opacity: 0.95 }).addTo(g);
    }
    L.circleMarker(pts[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 }).bindTooltip(t('gps.trailStart')).addTo(g);
    g.addTo(map);
    trackLayerRef.current = g;
    // Iz va xodimning hozirgi joyi birga ko'rinsin
    const cur = focusUserId ? markersRef.current[focusUserId]?.getLatLng() : undefined;
    const all = cur ? [...pts, [cur.lat, cur.lng] as [number, number]] : pts;
    if (all.length > 1) map.fitBounds(all, { padding: [56, 56], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, t]);

  // Jonli (live) deb hisoblanadigan xodimlar soni — xarita ustidagi
  // yorliqda ko'rsatish uchun (foydali ma'lumot + "premium" texnik detal,
  // LandingPage'dagi bilan bir xil monospace/burchak-belgi uslubida).
  const nowTs = Date.now();
  const liveCount = gpsLocations.filter(l => isLiveSource(l.source) && (nowTs - new Date(l.timestamp).getTime()) <= 15 * 60 * 1000).length;

  return (
    <div data-testid="worker-map" className={`wm-map relative w-full overflow-hidden surface ${className || 'h-[340px] rounded-2xl'}`}>
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

      {/* Boshqaruv (owner 2026-10-22: "boshqarishga noqulay") — o'ng tomonda katta tugmalar */}
      <div className="absolute right-3 top-[5.5rem] sm:top-1/2 sm:-translate-y-1/2 z-[402] flex flex-col gap-2" data-testid="map-controls">
        {[
          { k: 'in', label: t('map.zoomIn', { defaultValue: 'Yaqinlashtirish' }), icon: PlusIcon, on: () => mapRef.current?.zoomIn() },
          { k: 'out', label: t('map.zoomOut', { defaultValue: 'Uzoqlashtirish' }), icon: MinusIcon, on: () => mapRef.current?.zoomOut() },
          { k: 'fit', label: t('map.fitAll', { defaultValue: 'Hammani ko\'rsatish' }), icon: FitIcon, on: fitAll },
          { k: 'me', label: t('map.myLocation', { defaultValue: 'Mening joyim' }), icon: GpsIcon, on: locateMe },
          { k: 'layer', label: layer === 'sat' ? t('map.layerMap', { defaultValue: 'Xarita' }) : t('map.layerSat', { defaultValue: "Sun'iy yo'ldosh" }), icon: layer === 'sat' ? MapIcon : SatIcon, on: () => setLayer(v => v === 'sat' ? 'map' : 'sat') },
        ].map(b => (
          <button key={b.k} type="button" onClick={b.on} aria-label={b.label} title={b.label} data-testid={`map-${b.k}`}
            className={`${b.k === 'in' || b.k === 'out' ? 'hidden sm:flex' : 'flex'} w-11 h-11 rounded-2xl bg-card/95 backdrop-blur border border-border shadow-lg text-lg font-bold text-foreground items-center justify-center active:scale-95 liquid-transition`}>
            <MorphIcon icon={b.icon} className="w-5 h-5" />
          </button>
        ))}
      </div>

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
        .wm-marker-wrap { position: relative; width: 40px; height: 60px; }
        .wm-marker-name {
          position: absolute; top: 44px; left: 50%; transform: translateX(-50%);
          white-space: nowrap; font-size: 11px; font-weight: 700; line-height: 1;
          padding: 3px 6px; border-radius: 9999px;
          background: var(--card); color: var(--foreground); border: 1px solid var(--border);
          box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        }
        .wm-marker-inner {
          position: relative;
          width: 34px; height: 34px;
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
        .wm-marker-inner .memoji-avatar { width: 100%; height: 100%; }
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
            <p className="text-sm font-bold flex items-center gap-1.5"><MorphIcon icon={Navigation} className="w-4 h-4 text-primary"  /> {t('map.navigateTitle')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('map.navigateSubtitle', { name })}</p>
          </div>
          <button onClick={onClose} aria-label={t('map.close')} className="p-1.5 rounded-lg hover:bg-muted"><MorphIcon icon={X} className="w-4 h-4"  /></button>
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
