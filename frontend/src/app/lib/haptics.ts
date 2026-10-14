// Tugma bosilganda yengil titrash (haptic) — FAQAT Apple qurilmalarida (iPhone/iPad). Egasi qarori: UI ovozlari
// o'chirilgan, ularning o'rniga Apple'da haptic. Boshqa qurilmalarda hech narsa qilmaydi.
//   • iOS ilova (Capacitor) → @capacitor/haptics
//   • Telegram mini ilova (iOS) → Telegram.WebApp.HapticFeedback
//   • iOS Safari 18+ → yashirin <input type="checkbox" switch> ni bosish (Safari shu orqali haptic beradi)
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
    if (isCapacitor()) {
      import("@capacitor/haptics").then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
      return;
    }
    const tg = (window as any).Telegram?.WebApp?.HapticFeedback;
    if (tg?.impactOccurred) { tg.impactOccurred("light"); return; }
    safariTick();
  } catch { /* haptic bo'lmasa ham ilova ishlayveradi */ }
}

let attached = false;
export function attachAppleHaptics(): void {
  if (attached || typeof document === "undefined" || !isApple()) return;
  attached = true;
  document.addEventListener("click", (e) => {
    const el = (e.target as Element | null)?.closest?.('button, [role="button"], a[href], [role="tab"], [role="switch"], input[type="checkbox"]');
    if (!el || (el as HTMLElement).id === "erp-haptic-switch") return;
    tick();
  }, { capture: true, passive: true });
}
