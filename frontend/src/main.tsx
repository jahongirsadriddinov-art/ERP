
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import App from "./app/App.tsx";
import { ErrorBoundary } from "./app/ErrorBoundary.tsx";
import { API_BASE } from "./app/api.ts";
import "./app/i18n";
import "./styles/index.css";

// Chrome-ning built-in Translator/Language Detection API (window.translation)
// sahifada ishlamasa "Language detection is not supported for this page" xatosini
// unhandledrejection sifatida chiqaradi. Bu ilovamiz xatosi emas — brauzer xatosi.
// translate="no" atributi ko'p holda oldini oladi, lekin ba'zi brauzerlarda
// API sinxron emas, shuning uchun global handler bilan ham to'xtatamiz.
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message ?? String(event.reason ?? '');
  if (msg.includes('Language detection is not supported')) {
    event.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </ErrorBoundary>
);

// Service Worker — offline support + asset caching + push notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      // Push notification subscription — faqat login bo'lgandan keyin
      // VAPID public key backenddan olinadi, shundan so'ng subscribe qilinadi.
      const setupPush = async () => {
        const token = localStorage.getItem('token');
        if (!token) return;

        // Permission already denied — skip
        if (Notification.permission === 'denied') return;

        // Request permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        try {
          // Fetch VAPID key from backend (uses canonical API_BASE from api.ts)
          const keyRes = await fetch(`${API_BASE}/api/push/vapidPublicKey`);
          if (!keyRes.ok) return;
          const { key } = await keyRes.json();
          if (!key) return;

          // Subscribe
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
          });

          // Send to backend
          await fetch(`${API_BASE}/api/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(sub.toJSON()),
          });
        } catch {
          // Push setup optional — silently ignore
        }
      };

      // Setup push when user logs in (token appears in localStorage)
      setupPush();
      window.addEventListener('storage', (e) => { if (e.key === 'token' && e.newValue) setupPush(); });
    } catch {
      // SW registration optional
    }
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
