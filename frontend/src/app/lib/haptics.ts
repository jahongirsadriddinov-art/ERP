// Tugma bosilganda yengil titrash (haptic). Owner 2026-10-30: "saytdagiga ham
// Telegram app dagi haptic qo'sh, vibratsiya" — avval FAQAT Apple qurilmalarida
// ishlardi, endi hamma joyda (qurilma qo'llab-quvvatlasa).
//
// Har bir muhit o'z yo'li bilan:
//   • Telegram mini ilova → Telegram.WebApp.HapticFeedback (eng aniq "tap" hissi)
//   • Ilova (Capacitor, iOS/Android) → @capacitor/haptics
//   • Android/Chrome brauzeri → navigator.vibrate(10)
//   • iOS Safari 18+ → yashirin <input type="checkbox" switch> ni bosish
//     (Safari aynan shu element uchun haptic beradi — boshqa yo'li yo'q)
//
// CHEKLOV: eski iOS Safari'da (18 dan past) haptic umuman yo'q — bu brauzer
// cheklovi, aylanib o'tib bo'lmaydi.
import { isCapacitor } from "../platform";

const isApple = () => typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

let switchLabel: HTMLLabelElement | null = null;
function safariTick() {
  if (!switchLabel) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.id = "erp-haptic-switch";
    input.style.cssText = "position:fixed;opacity:0;pointer-events:none;width:0;height:0";
    switchLabel = document.createElement("label");
    switchLabel.htmlFor = input.id;
    switchLabel.style.display = "none";
    document.body.append(input, switchLabel);
  }
  switchLabel.click();
}

let last = 0;
function tick() {
  const now = Date.now();
  if (now - last < 60) return;
  last = now;
  try {
    // Telegram birinchi: mini ilovada eng to'g'ri his shu beradi
    const tg = (window as any).Telegram?.WebApp?.HapticFeedback;
    if (tg?.impactOccurred) { tg.impactOccurred("light"); return; }
    if (isCapacitor()) {
      import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
      return;
    }
    if (isApple()) { safariTick(); return; }
    navigator.vibrate?.(10);
  } catch { /* haptic bo'lmasa ham ilova ishlayveradi */ }
}

let attached = false;
/** Tugma bosilishlariga haptic ulaydi (hamma qurilmada — qo'llab-quvvatlanmasa jim o'tadi). */
export function attachHaptics(): void {
  if (attached || typeof document === "undefined") return;
  attached = true;
  document.addEventListener("click", (e) => {
    const el = (e.target as Element | null)?.closest?.('button, [role="button"], a[href], [role="tab"], [role="switch"], input[type="checkbox"]');
    if (!el || (el as HTMLElement).id === "erp-haptic-switch") return;
    tick();
  }, { capture: true, passive: true });
}

/** Eski nom — boshqa joylarda ishlatilgan bo'lsa buzilmasin. */
export const attachAppleHaptics = attachHaptics;
