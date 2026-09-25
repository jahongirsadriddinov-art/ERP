import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Toshkent — qiymat bo'lmaganda xaritaning boshlang'ich markazi.
const DEFAULT_CENTER: [number, number] = [41.2995, 69.2401];

const pinIcon = L.divIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#ef4444;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);transform:rotate(-45deg)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

// Kartadan joy tanlash: xaritaga bosilsa yoki markerni sudrab qo'yilsa onPick(lat, lng) chaqiriladi.
export default function LocationPicker({ value, onPick, height = 260 }: { value: { lat: number; lng: number } | null; onPick: (lat: number, lng: number) => void; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const lastInternal = useRef("");
  const emit = (lat: number, lng: number) => { lastInternal.current = `${lat},${lng}`; onPickRef.current(lat, lng); };

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const center: [number, number] = value ? [value.lat, value.lng] : DEFAULT_CENTER;
    const map = L.map(ref.current, { center, zoom: value ? 16 : 12, zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
    const place = (lat: number, lng: number) => {
      if (!markerRef.current) {
        markerRef.current = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map);
        markerRef.current.on("dragend", () => { const p = markerRef.current!.getLatLng(); emit(p.lat, p.lng); });
      } else markerRef.current.setLatLng([lat, lng]);
    };
    if (value) place(value.lat, value.lng);
    map.on("click", (e: L.LeafletMouseEvent) => { place(e.latlng.lat, e.latlng.lng); emit(e.latlng.lat, e.latlng.lng); });
    mapRef.current = map;
    // Konteyner endigina ko'rinadigan bo'lgani uchun o'lchamni qayta hisoblash shart
    setTimeout(() => map.invalidateSize(), 50);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tashqaridan (qidiruv/GPS) qiymat o'zgarsa — marker va xarita siljiydi
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !value) return;
    if (lastInternal.current === `${value.lat},${value.lng}`) return; // xaritaning o'zidan tanlangan — qayta markazlanmaydi
    if (!markerRef.current) {
      markerRef.current = L.marker([value.lat, value.lng], { icon: pinIcon, draggable: true }).addTo(map);
      markerRef.current.on("dragend", () => { const p = markerRef.current!.getLatLng(); emit(p.lat, p.lng); });
    } else markerRef.current.setLatLng([value.lat, value.lng]);
    map.setView([value.lat, value.lng], Math.max(map.getZoom(), 16));
  }, [value?.lat, value?.lng]);

  return <div ref={ref} className="w-full rounded-xl overflow-hidden border border-border" style={{ height }} />;
}
