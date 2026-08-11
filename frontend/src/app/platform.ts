// Platform detection + Capacitor/Tauri bridge
// Web, Android (Capacitor), Windows (Tauri) — barcha platformalar uchun bir xil API.

// Tauri — window.__TAURI__ window ob'ektida mavjud bo'ladi
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI__' in window;

// Capacitor — Capacitor global ob'ekti yoki user-agent tekshiruvi
export const isCapacitor = (): boolean =>
  typeof window !== 'undefined' && 'Capacitor' in window;

export const isAndroid = (): boolean =>
  isCapacitor() && (window as any).Capacitor?.getPlatform?.() === 'android';

export const isNative = (): boolean => isTauri() || isCapacitor();

// Android back button handler — Capacitor orqali
// ChatView da: orqaga chat ro'yxatiga; root sahifada: chiqish dialog
let _backHandlerInstalled = false;
export function installAndroidBackHandler(onBack: () => boolean) {
  if (!isAndroid() || _backHandlerInstalled) return;
  _backHandlerInstalled = true;

  import('@capacitor/app')
    .then(({ App }) => {
      App.addListener('backButton', ({ canGoBack }) => {
        const handled = onBack();
        if (!handled && !canGoBack) {
          // Root sahifada — chiqish dialog
          if (confirm('Ilovadan chiqmoqchimisiz?')) {
            App.exitApp();
          }
        }
      });
    })
    .catch(() => {
      // Capacitor App plugin mavjud emas — web rejimida ishlaydi
    });
}

// Status bar rangini o'rnatish (Android/iOS)
export function setStatusBarColor(color: string, isDark = false) {
  if (!isCapacitor()) return;
  import('@capacitor/status-bar')
    .then(({ StatusBar, Style }) => {
      StatusBar.setBackgroundColor({ color });
      StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
    })
    .catch(() => {});
}

// Sahifa nomini native title bar'ga o'rnatish (Tauri)
export function setWindowTitle(title: string) {
  if (!isTauri()) {
    document.title = title;
    return;
  }
  import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => {
      getCurrentWindow().setTitle(title).catch(() => {});
    })
    .catch(() => { document.title = title; });
}

// Desktop notification (Tauri yoki Web Push)
export async function sendNativeNotification(title: string, body: string) {
  if (isTauri()) {
    try {
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      await sendNotification({ title, body });
      return;
    } catch {}
  }
  // Web fallback
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}
