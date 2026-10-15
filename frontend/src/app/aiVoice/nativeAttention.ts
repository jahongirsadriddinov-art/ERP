import { isCapacitor, isTauri, sendNativeNotification } from "../platform";
import { playSound } from "../sound";

// Kiruvchi AI qo'ng'irog'iga e'tibor tortish (design §8):
//  - Windows (Tauri): oynani ko'rsatish, yig'ilgan bo'lsa ochish, fokus va panelda miltillash;
//  - Android (Capacitor) / telefon brauzeri: takroriy tebranish;
//  - ilova orqa fonda bo'lsa — tizim bildirishnomasi (Service Worker orqali, Android'da shu ishlaydi).
// Qaytgan funksiya hammasini to'xtatadi. Hech qachon xato tashlamaydi.

const NOTIF_TAG = "aiv-incoming";

export function startIncomingAttention(info: { title: string; body: string }): () => void {
  let stopped = false;
  let vibTimer: ReturnType<typeof setInterval> | null = null;

  const vibrateOnce = () => {
    if (stopped) return;
    if (isCapacitor()) {
      import("@capacitor/haptics")
        .then(({ Haptics }) => Haptics.vibrate({ duration: 700 }))
        .catch(() => { try { navigator.vibrate?.(700); } catch { /* */ } });
      return;
    }
    try { navigator.vibrate?.([700, 300]); } catch { /* */ }
  };
  vibrateOnce();
  vibTimer = setInterval(vibrateOnce, 1600);

  if (isTauri()) {
    import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow, UserAttentionType }) => {
        if (stopped) return;
        const w = getCurrentWindow();
        await w.unminimize().catch(() => {});
        await w.show().catch(() => {});
        await w.setFocus().catch(() => {});
        await w.requestUserAttention(UserAttentionType.Critical).catch(() => {});
      })
      .catch(() => {});
    if (typeof document !== "undefined" && (document.hidden || !document.hasFocus())) {
      sendNativeNotification(info.title, info.body).catch(() => {});
    }
  } else if (typeof document !== "undefined" && document.hidden) {
    showSwNotification(info.title, info.body);
  }

  return () => {
    if (stopped) return;
    stopped = true;
    if (vibTimer) clearInterval(vibTimer);
    try { navigator.vibrate?.(0); } catch { /* */ }
    if (isTauri()) {
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().requestUserAttention(null))
        .catch(() => {});
    }
    closeSwNotification();
  };
}

function showSwNotification(title: string, body: string) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.showNotification(title, {
        body,
        icon: "/favicon-192.png",
        badge: "/favicon-192.png",
        tag: NOTIF_TAG,
        requireInteraction: true,
        data: { url: "/" },
        vibrate: [700, 300, 700, 300, 700],
      } as NotificationOptions))
      .catch(() => {});
  } catch { /* */ }
}

function closeSwNotification() {
  try {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.getNotifications({ tag: NOTIF_TAG }))
      .then((list) => list.forEach((n) => n.close()))
      .catch(() => {});
  } catch { /* */ }
}

/** Qo'ng'iroq ohangi (mavjud UI ovozlari — sound.ts). Qaytgan funksiya to'xtatadi. */
export function startRingtone(): () => void {
  const h = playSound("connecting", { loop: true });
  return () => { try { h?.stop(); } catch { /* */ } };
}
