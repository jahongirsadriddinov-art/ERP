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

// "Sichqoncha asosiy kirish qurilmasi" — laptop/desktop (Windows exe yoki
// oddiy desktop brauzer), teginish-asosiy telefon/planshetdan farqli.
// PIN klaviatura kiritish kabi "faqat desktopda mos" narsalar uchun.
export const isDesktopPointer = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

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

// Yengil bosish tuyg'usi (haptic feedback) — bottom navbar va AI tugmasi
// bosilganda chaqiriladi. Native Android'da (Capacitor) haqiqiy qurilma
// vibratsiyasi, web'da esa Vibration API fallback (qo'llab-quvvatlamasa
// jim o'tkazib yuboradi — hech qanday brauzerda xato tashlamaydi).
export function haptic() {
  if (isCapacitor()) {
    import('@capacitor/haptics')
      .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
      .catch(() => { navigator.vibrate?.(10); });
    return;
  }
  navigator.vibrate?.(10);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // data:<mime>;base64,XXXX — Filesystem.writeFile faqat XXXX qismini kutadi
      resolve(result.split(',')[1] ?? result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Mahalliy hosil qilingan faylni (masalan CSV hisobot) saqlash/ulashish.
// MUHIM: bu faqat Android (Capacitor) uchun maxsus yo'l — WEB'da va
// Windows exe'da (Tauri/WebView2) standart <a download> + blob: URL
// ishonchli ishlaydi, shuning uchun ular o'zgartirilmagan. LEKIN Android
// tizim WebView'ida bunday sintetik <a>.click() hech qanday xatosiz
// "hech narsa qilmaydi" — WebView'da ishlab chiquvchi/foydalanuvchiga
// ko'rinadigan "Downloads" integratsiyasi yo'q (bu Chrome tab emas).
// Shu sabab hisobot/eksport fayllari APK'da "yuklab bo'lmayapti" edi.
// Yechim: @capacitor/filesystem orqali Cache papkasiga yozib, so'ng
// @capacitor/share orqali OS ulashish oynasini ochamiz — foydalanuvchi
// "Fayllar"/istalgan ilovaga saqlashni tanlaydi. Bu saqlash RUXSATISIZ
// (Cache papkasi ilova ichida) ishlaydigan eng ishonchli yo'l.
export async function saveOrShareBlob(filename: string, blob: Blob): Promise<{ ok: boolean; shared?: boolean }> {
  if (!isCapacitor()) {
    // XATO TUZATILDI: bu blok avval try/catch'siz edi — "{ok:true}" har
    // doim SO'ZSIZ qaytardi, hatto a.click() biror sababdan (masalan
    // iOS Safari'ning tracking-prevention/pop-up cheklovlari) chindan
    // ishlamay qolsa ham. Natijada muvaffaqiyatsizlik HECH QACHON
    // ko'rinmasdi (na "Fayl saqlanmadi" xabari, na konsolda iz) — endi
    // haqiqiy xato bo'lsa {ok:false} qaytadi VA sababi konsolga yoziladi.
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { ok: true };
    } catch (err) {
      console.error('saveOrShareBlob (web) xatosi:', err);
      return { ok: false };
    }
  }
  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const base64 = await blobToBase64(blob);
    const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ url: written.uri, title: filename, dialogTitle: filename });
    return { ok: true, shared: true };
  } catch (err) {
    console.error('saveOrShareBlob xatosi:', err);
    return { ok: false };
  }
}

// Masofadagi URL'ni (APK/exe yuklab olish, chat media va h.k.) ochish.
// Android'da @capacitor/browser (Chrome Custom Tabs) orqali — to'g'ridan-
// to'g'ri fayl bo'lsa (APK/EXE/rasm), Android'ning haqiqiy tizim yuklab
// olish menejeri (bildirishnoma + progress) ishga tushadi. Web/Tauri'da
// oddiy window.open — brauzer/WebView2 o'zi to'g'ri saqlash oynasini
// ko'rsatadi (bu yerda muammo yo'q, faqat Android WebView buzilgan edi).
export async function openExternalUrl(url: string): Promise<void> {
  if (isCapacitor()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch (err) {
      console.error('Browser.open xatosi:', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
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
