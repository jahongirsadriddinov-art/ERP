import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { X, Navigation } from "lucide-react";
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
    html: `<div class="wm-marker-inner" style="border-color:${ring}">${pulse}<span>${initial}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
}

export default function WorkerMap({ users, gpsLocations }: { users: AppUser[]; gpsLocations: GpsPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const [navTarget, setNavTarget] = useState<{ lat: number; lng: number; name: string } | null>(null);

  // Xarita — bir marta yaratiladi
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(DEFAULT_CENTER, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markersRef.current = {}; };
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
      markersRef.current[loc.userId].bindTooltip(
        `${user.name}${live ? (stale ? ' · eskirgan' : ' · jonli') : ' · oxirgi ma\'lum joy'}`,
        { direction: 'top', offset: [0, -18] }
      );
    });

    // Endi GPS'i yo'q xodimlarning eski markerini olib tashlaymiz
    Object.keys(markersRef.current).forEach(uid => {
      if (!seen.has(uid)) { markersRef.current[uid].remove(); delete markersRef.current[uid]; }
    });

    // Birinchi marta ma'lumot kelganda — barcha markerlarni ko'rsatadigan qilib markazlashtirish
    const pts = gpsLocations.map(l => [l.lat, l.lng] as [number, number]);
    if (pts.length > 0 && !map.__wmFitted) {
      map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
      (map as any).__wmFitted = true;
    }
  }, [gpsLocations, users]);

  return (
    <div className="relative w-full h-[340px] rounded-2xl overflow-hidden surface">
      <div ref={containerRef} className="w-full h-full" />
      {gpsLocations.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 pointer-events-none">
          <p className="text-xs text-muted-foreground">Xaritada ko'rsatish uchun GPS ma'lumoti yo'q</p>
        </div>
      )}
      {navTarget && <NavigateChoiceModal target={navTarget} onClose={() => setNavTarget(null)} />}
      {/* Leaflet marker/pulse uslubi — komponentga xos, globals.css'ga chiqarilmadi
          (faqat shu joyda ishlatiladi, Leaflet o'z className'lari bilan ziddiyat
          bo'lmasligi uchun aniq "wm-" prefiksi bilan). */}
      <style>{`
        .wm-marker { background: transparent; border: none; }
        .wm-marker-inner {
          position: relative;
          width: 30px; height: 30px;
          border-radius: 9999px;
          border: 2.5px solid;
          background: #1B3A6B;
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700;
          box-shadow: 0 2px 8px rgba(0,0,0,0.35);
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
        .leaflet-container { background: #eef2f8; font-family: inherit; }
      `}</style>
    </div>
  );
}

// Xodim joylashuviga yo'naltirish — qaysi xarita ilovasi orqali ochish
// tanlovi (aniq foydalanuvchi talabi: "Google Maps, Yandex Maps yoki boshqa").
export function NavigateChoiceModal({ target, onClose }: { target: { lat: number; lng: number; name: string }; onClose: () => void }) {
  const { lat, lng, name } = target;
  const options = [
    { label: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving` },
    { label: 'Yandex Maps', url: `https://yandex.com/maps/?rtext=~${lat},${lng}&rtt=auto` },
    // geo: URI — Android'da o'rnatilgan standart xarita ilovasini tanlash oynasini ochadi.
    { label: "Standart ilova (qurilma)", url: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})` },
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
            <p className="text-sm font-bold flex items-center gap-1.5"><Navigation className="w-4 h-4 text-primary" /> Yo'naltirish</p>
            <p className="text-xs text-muted-foreground mt-0.5">{name} — qaysi ilova orqali ochilsin?</p>
          </div>
          <button onClick={onClose} aria-label="Yopish" className="p-1.5 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button>
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
