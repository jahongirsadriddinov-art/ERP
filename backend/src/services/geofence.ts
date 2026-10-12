// Geozona: ishchi "Ishga keldim"ni faqat obyekt hududida bosa oladi (keyin obyektda turishi shart emas).
// Obyekt koordinatasi: yaratishda xaritadan tanlangan nuqta; eski obyektlarda manzil matnidan bir marta
// aniqlanib, obyektga saqlab qo'yiladi. Hech bir obyektning koordinatasi bo'lmasa — cheklov qo'llanmaydi.
import ObjectModel from '../models/Object';
import User from '../models/User';

export const DEFAULT_GEOFENCE_M = 300;

export const distanceM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

async function geocodeOnce(q: string): Promise<{ lat: number; lng: number } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=uz&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'QurilishERP/1.0 (https://erp-firma.uz)' }, signal: ctl.signal });
    if (!r.ok) return null;
    const d = await r.json() as Array<{ lat: string; lon: string }>;
    const lat = Number(d[0]?.lat), lng = Number(d[0]?.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

export type GeofenceResult = { ok: true; objectName?: string; distance?: number } | { ok: false; nearestName: string; distance: number; radius: number };

/** Ishchining joylashuvi uning obyektlaridan birining hududida-mi? */
export async function checkGeofence(userId: string, companyId: string | undefined, lat: number, lng: number): Promise<GeofenceResult> {
  if (!companyId) return { ok: true };
  const user: any = await User.findById(userId).select('projectIds').lean().catch(() => null);
  const assigned: string[] = (user?.projectIds || []).map(String);
  const q: any = { companyId, status: { $ne: 'completed' } };
  if (assigned.length) q._id = { $in: assigned };
  let objs: any[] = await ObjectModel.find(q).select('name location lat lng geofenceRadius').lean();
  if (!objs.length && assigned.length) objs = await ObjectModel.find({ companyId, status: { $ne: 'completed' } }).select('name location lat lng geofenceRadius').lean();

  // Koordinatasi yo'q obyektlar — manzildan bir marta aniqlab saqlaymiz (ko'pi bilan 3 ta, so'rov sekinlashmasin)
  let geocoded = 0;
  for (const o of objs) {
    if ((o.lat == null || o.lng == null) && o.location && geocoded < 3) {
      geocoded++;
      const c = await geocodeOnce(String(o.location));
      if (c) { o.lat = c.lat; o.lng = c.lng; ObjectModel.updateOne({ _id: o._id }, { $set: { lat: c.lat, lng: c.lng } }).catch(() => {}); }
    }
  }
  const withCoords = objs.filter(o => Number.isFinite(o.lat) && Number.isFinite(o.lng));
  if (!withCoords.length) return { ok: true };
  let best: { o: any; d: number } | null = null;
  for (const o of withCoords) {
    const d = distanceM({ lat, lng }, { lat: o.lat, lng: o.lng });
    const r = Number(o.geofenceRadius) || DEFAULT_GEOFENCE_M;
    if (d <= r) return { ok: true, objectName: o.name, distance: Math.round(d) };
    if (!best || d < best.d) best = { o, d };
  }
  return { ok: false, nearestName: best!.o.name, distance: Math.round(best!.d), radius: Number(best!.o.geofenceRadius) || DEFAULT_GEOFENCE_M };
}

export const geofenceMessage = (r: Extract<GeofenceResult, { ok: false }>, ru?: boolean) => {
  const km = r.distance >= 1000 ? `${(r.distance / 1000).toFixed(1)} km` : `${r.distance} m`;
  return ru
    ? `📍 Отметиться можно только на объекте. Вы в ${km} от ближайшего объекта «${r.nearestName}» (допустимо ${r.radius} м).`
    : `📍 "Ishga keldim"ni faqat obyektda bosish mumkin. Siz eng yaqin obyekt — «${r.nearestName}»dan ${km} uzoqdasiz (ruxsat: ${r.radius} m).`;
};
