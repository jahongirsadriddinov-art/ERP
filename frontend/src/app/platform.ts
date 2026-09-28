// Platform detection + Capacitor/Tauri bridge
// Web, Android (Capacitor), Windows (Tauri) — barcha platformalar uchun bir xil API.

// Tauri v2 — `window.__TAURI__` FAQAT `withGlobalTauri: true` bo'lsa paydo bo'ladi (bizda o'chiq),
// shuning uchun avval Windows ilovasi o'zini "oddiy brauzer" deb hisoblardi: avtomatik yangilanish,
// fayl yuklash va landing'ni yashirish exe ichida ISHLAMASDI. `__TAURI_INTERNALS__` esa Tauri v2
// har doim o'rnatadigan ichki ko'prik (invoke shu orqali ishlaydi).
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

// Capacitor — HAQIQIY native qobiq (Android/iOS) ichida ekanini tekshiradi.
// XATO TUZATILDI: avval faqat `'Capacitor' in window` tekshirilardi — lekin
// @capacitor/core, ANY @capacitor/* plugin dinamik import qilinganda (masalan
// boshqa funksiya birinchi marta ishga tushganda), o'zining WEB FALLBACK
// implementatsiyasi uchun ham `window.Capacitor` ob'ektini yaratib qo'yadi
// (getPlatform()==='web' bilan) — bu HAQIQIY native emas. Natijada, Windows
// exe'da (Tauri) ham, oddiy brauzerda ham, biror joyda bitta Capacitor plugin
// bir marta import qilinishi bilan `isCapacitor()` NOTO'G'RI "true" qaytara
// boshlardi, shundan keyingi BARCHA chaqiruvlar (masalan saveOrShareBlob)
// Android-ga mo'ljallangan yo'lni Windows'da ham ishga tushirardi — aniq
// misol: Excel/CSV yuklab olishda `Share.share()`ning web-fallback'i
// `navigator.share()`ni chaqirib, Windows'ning tizim "Share" oynasini
// (ishlamaydigan havola bilan) ochib yuborardi. `isNativePlatform()` esa
// Capacitor'ning O'ZI native ko'prik (bridge) bor-yo'qligini tekshiradigan
// rasmiy usuli — web-fallback stub uchun har doim `false` qaytaradi.
export const isCapacitor = (): boolean =>
  typeof window !== 'undefined' && 'Capacitor' in window && (window as any).Capacitor?.isNativePlatform?.() === true;

export const isAndroid = (): boolean =>
  isCapacitor() && (window as any).Capacitor?.getPlatform?.() === 'android';

export const isNative = (): boolean => isTauri() || isCapacitor();

// "Sichqoncha asosiy kirish qurilmasi" — laptop/desktop (Windows exe yoki
// oddiy desktop brauzer), teginish-asosiy telefon/planshetdan farqli.
// PIN klaviatura kiritish kabi "faqat desktopda mos" narsalar uchun.
export const isDesktopPointer = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// Ekran KENGLIGIGA qarab — "telefon" EMAS (planshet/laptop/desktop, ya'ni
// >=768px). isDesktopPointer()'dan farqi: planshet odatda teginish-asosiy
// (hover:none) bo'lgani uchun isDesktopPointer() FALSE qaytaradi, lekin bu
// yerda "laptop VA planshet" (faqat telefon emas) kerak bo'lgan joylar
// uchun (masalan login sahifasidagi QR-orqali-kirish varianti — QRScanner
// component'ining o'zi FAQAT telefon kamerasidan foydalanadi, shu sabab bu
// variant telefon ekranida ma'nosiz).
export const isTabletOrLarger = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches;

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
const guessMime = (name: string, blob: Blob) => {
  if (blob.type) return blob.type;
  const ext = name.split('.').pop()?.toLowerCase();
  return ({ csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', json: 'application/json',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf', mp4: 'video/mp4' } as Record<string, string>)[ext || ''] || 'application/octet-stream';
};
async function toastSaved(where: string, onOpen?: () => void) {
  try {
    const { toast } = await import('sonner');
    toast.success(`Yuklab olindi: ${where}`, onOpen ? { action: { label: 'Ochish', onClick: onOpen } } : undefined);
  } catch { /* toast ixtiyoriy */ }
}

// Mahalliy hosil qilingan faylni (Excel/CSV hisobot, backup, QR, rasm) saqlash.
//  - Windows ilovasi (Tauri): WebView2'da <a download> ISHLAMAYDI → Rust buyrug'i faylni
//    "Yuklanmalar" papkasiga yozadi, "Ochish" — Explorer'da ko'rsatadi.
//  - Android ilovasi: WebView'da ham <a download> ishlamaydi → FileSaver plagini faylni
//    "Download/QurilishERP" papkasiga yozadi (Android 10+), "Ochish" — mos ilovada ochadi.
//    Eski Android'da — vaqtinchalik papka + "Ulashish" oynasi (avvalgi yo'l).
//  - Veb brauzer: oddiy <a download>.
export async function saveOrShareBlob(filename: string, blob: Blob): Promise<{ ok: boolean; shared?: boolean }> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string>('save_to_downloads', { filename, dataB64: await blobToBase64(blob) });
      toastSaved(path, () => { invoke('reveal_file', { path }).catch(() => {}); });
      return { ok: true };
    } catch (err) {
      console.error('saveOrShareBlob (tauri) xatosi:', err);
      return { ok: false };
    }
  }
  if (isAndroid()) {
    const base64 = await blobToBase64(blob);
    const mime = guessMime(filename, blob);
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const FileSaver = registerPlugin<any>('FileSaver');
      const r = await FileSaver.saveToDownloads({ name: filename, data: base64, mime });
      toastSaved(r.path, () => { FileSaver.openFile({ uri: r.uri, mime }).catch(() => {}); });
      return { ok: true };
    } catch (err) {
      console.warn('FileSaver ishlamadi — ulashish yo\'liga o\'tiladi:', err);
    }
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    let writtenUri: string;
    try {
      const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      writtenUri = written.uri;
    } catch (err) {
      console.error('saveOrShareBlob (writeFile) xatosi:', err);
      return { ok: false };
    }
    try {
      await Share.share({ url: writtenUri, title: filename, dialogTitle: filename });
      return { ok: true, shared: true };
    } catch {
      return { ok: true, shared: false }; // foydalanuvchi ulashishni bekor qildi — fayl baribir yozilgan
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  } catch (err) {
    console.error('saveOrShareBlob (web) xatosi:', err);
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
  // Windows ilovasi: window.open WebView2'da hech narsa qilmaydi — tizim brauzerida ochiladi
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_external', { url });
      return;
    } catch (err) {
      console.error('open_external xatosi:', err);
    }
  }
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
