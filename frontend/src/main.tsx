
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import App, { ClientViewPage } from "./app/App.tsx";
import UpdateChecker from "./app/UpdateChecker.tsx";
import MediaViewer from "./app/MediaViewer.tsx";
import { ErrorBoundary } from "./app/ErrorBoundary.tsx";
import { API_BASE } from "./app/api.ts";
import "./app/i18n";
import "./styles/index.css";
import { attachSoundUnlock } from "./app/sound.ts";
import { attachGlobalClickSounds } from "./app/soundClicks.ts";
import "./app/soundToast.ts"; // sonner toast'lariga avtomatik ovoz ulaydi (butun sayt uchun)

// UI ovoz effektlari (uisfx, "zen" pack) — birinchi bosishda audio
// kontekstni ochadi va butun sayt bo'ylab tugma/havola bosishlariga
// markazlashtirilgan tovush qo'shadi.
attachSoundUnlock();
attachGlobalClickSounds();

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

// Mijoz portali (client portal) — /client/:token ochilsa, login talab
// qiladigan asosiy ilova o'rniga faqat shu (ochiq, xavfsiz) sahifa
// render qilinadi. React Router yo'q (butun ilova bitta SPA holat
// mashinasi) — shu sabab bu yerda oddiy pathname tekshiruvi kifoya.
const clientViewMatch = window.location.pathname.match(/^\/client\/([0-9a-f]{48})$/);

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <MotionConfig reducedMotion="user">
      {clientViewMatch ? <ClientViewPage token={clientViewMatch[1]} /> : (
        <>
          <App />
          <UpdateChecker />
          <MediaViewer />
        </>
      )}
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

      // MUHIM: setupPush() o'zi allaqachon token/ruxsat borligini tekshirib
      // ketadi (render'ni bloklamaydi) — lekin window.load paytida darhol
      // chaqirilsa, aynan shu payt mobil tarmoqda ilova uchun ENG KRITIK
      // so'rovlar (dashboard/objects/transactions) ham ketayotgan bo'ladi va
      // ular bilan cheklangan bir vaqtdagi ulanishlar uchun raqobatlashadi.
      // requestIdleCallback bilan brauzer bo'sh vaqt topgandagina ishga
      // tushiramiz (Safari'da requestIdleCallback yo'q — setTimeout zaxira).
      const runWhenIdle = (fn: () => void) => {
        if ('requestIdleCallback' in window) (window as any).requestIdleCallback(fn, { timeout: 4000 });
        else setTimeout(fn, 2000);
      };
      runWhenIdle(setupPush);
      // XATO TUZATILDI: 'storage' hodisasi FAQAT BOSHQA tab/oynada localStorage
      // o'zgarsa ishga tushadi — o'sha o'zgarishni QILGAN tabning O'ZIDA
      // HECH QACHON ishlamaydi (brauzer standarti). Demak login shu sahifada
      // (odatiy holat) sodir bo'lganda setupPush() umuman QAYTA
      // chaqirilmasdi — ilk sahifa yuklanishida hali token yo'q edi, keyin
      // esa hech narsa uni push-ro'yxatga yozdirmasdi. Shu sabab push
      // bildirishnomalar deyarli hech qachon kelmasdi (aniq xabar qilingan
      // xato). Endi App.tsx login/ro'yxatdan o'tish muvaffaqiyatli bo'lgan
      // ZAHOTI shu funksiyani to'g'ridan-to'g'ri chaqiradi.
      (window as any).__setupPush = () => runWhenIdle(setupPush);
      window.addEventListener('storage', (e) => { if (e.key === 'token' && e.newValue) runWhenIdle(setupPush); });
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
