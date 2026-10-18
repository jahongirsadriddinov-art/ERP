// Android: ilova yopilgan / orqa fonda bo'lsa ham joylashuv va bildirishnomalar ishlashi uchun
// native foreground xizmat (BackgroundService.java). Veb va Windows'da hech narsa qilmaydi.
import { isAndroid } from "../platform";
import { API_BASE } from "../api";

let lastKey = "";
export async function startBackground(opts: { trackLocation: boolean; intervalSec?: number }) {
  if (!isAndroid()) return;
  const token = localStorage.getItem("token") || "";
  if (!token) return;
  const key = `${token.slice(-12)}|${opts.trackLocation}|${opts.intervalSec || 60}`;
  if (key === lastKey) return;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    const Background = registerPlugin<any>("Background");
    await Background.start({ token, apiBase: API_BASE, intervalSec: opts.intervalSec || 60, trackLocation: opts.trackLocation });
    lastKey = key;
  } catch (e) { console.warn("[background]", e); }
}

/** Android: ilova batareya cheklovidan chiqarilganmi (fonda uxlatilmaydi). Eski APK/veb — null. */
export async function backgroundPermission(): Promise<{ ignoring: boolean; manufacturer: string } | null> {
  if (!isAndroid()) return null;
  try {
    const { registerPlugin } = await import("@capacitor/core");
    return await registerPlugin<any>("Background").batteryStatus();
  } catch { return null; }
}

/** Fonda ishlash ruxsatini so'raydi: bildirishnomalar (Android 13+) va batareya cheklovidan chiqarish. */
export async function requestBackgroundPermission(): Promise<void> {
  if (!isAndroid()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const st = await LocalNotifications.checkPermissions();
    if (st.display !== "granted") await LocalNotifications.requestPermissions();
  } catch { /* plagin yo'q */ }
  try {
    const { registerPlugin } = await import("@capacitor/core");
    await registerPlugin<any>("Background").requestBatteryExemption();
  } catch { /* eski APK */ }
}

export async function openAppSettings(): Promise<void> {
  try {
    const { registerPlugin } = await import("@capacitor/core");
    await registerPlugin<any>("Background").openAppSettings();
  } catch { /* eski APK */ }
}

export async function stopBackground() {
  if (!isAndroid()) return;
  lastKey = "";
  try {
    const { registerPlugin } = await import("@capacitor/core");
    await registerPlugin<any>("Background").stop();
  } catch { /* eski APK — plagin yo'q */ }
}
