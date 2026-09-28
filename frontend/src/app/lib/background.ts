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

export async function stopBackground() {
  if (!isAndroid()) return;
  lastKey = "";
  try {
    const { registerPlugin } = await import("@capacitor/core");
    await registerPlugin<any>("Background").stop();
  } catch { /* eski APK — plagin yo'q */ }
}
