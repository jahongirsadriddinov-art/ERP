// Owner 2026-11-06: WKWebView macOS desktop ilovasida `navigator.geolocation`
// tizim ruxsat oynasini umuman ko'rsatmaydi va xatolik ham bermaydi — WKWebView
// CoreLocation'ga avtomatik ulanmagan. Shu sabab "mening joylashuvim" tugmasi
// Mac ilovasida ishlamasdi. Bu fayl Mac Tauri'da native CoreLocation ko'prigiga
// (src-tauri `get_current_location` komandasi) o'tadi, boshqa hamma joyda
// (brauzer, Windows, Android, iOS) oddiy `navigator.geolocation`'dan foydalanadi.
import { isTauri, isMac } from "../platform";

export type GeoPosition = { coords: { latitude: number; longitude: number; accuracy: number } };
export type GeoErrorCb = (err: unknown) => void;

const isMacNative = (): boolean => isTauri() && isMac();

async function invokeMacLocation(): Promise<GeoPosition> {
  const { invoke } = await import("@tauri-apps/api/core");
  const [lat, lon, accuracy] = await invoke<[number, number, number]>("get_current_location");
  return { coords: { latitude: lat, longitude: lon, accuracy } };
}

export function getCurrentPositionCompat(
  onSuccess: (pos: GeoPosition) => void,
  onError: GeoErrorCb,
  opts?: PositionOptions,
): void {
  if (isMacNative()) {
    invokeMacLocation().then(onSuccess).catch(onError);
    return;
  }
  if (!navigator.geolocation) { onError(new Error("geolocation yo'q")); return; }
  navigator.geolocation.getCurrentPosition(onSuccess, onError, opts);
}

const macWatchIds = new Set<number>();

export function watchPositionCompat(
  onSuccess: (pos: GeoPosition) => void,
  onError: GeoErrorCb,
  opts?: PositionOptions,
): number {
  if (isMacNative()) {
    const tick = () => { invokeMacLocation().then(onSuccess).catch(onError); };
    tick();
    const id = window.setInterval(tick, 5000);
    macWatchIds.add(id);
    return id;
  }
  if (!navigator.geolocation) return -1;
  return navigator.geolocation.watchPosition(onSuccess, onError, opts);
}

export function clearWatchCompat(id: number): void {
  if (macWatchIds.has(id)) {
    window.clearInterval(id);
    macWatchIds.delete(id);
    return;
  }
  if (navigator.geolocation) navigator.geolocation.clearWatch(id);
}
