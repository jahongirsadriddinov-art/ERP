// Yangi versiya chiqqanda (Vercel'ga deploy) eski ochiq oynadagi sahifa o'chirilgan eski bo'lakni
// (masalan assets/CallOverlay-xxxx.js) so'raydi va yuklay olmaydi. Bu xato emas — shunchaki sahifani bir
// marta yangilash kerak. Bu yordamchilar shunday holatni taniydi va jimgina qayta yuklaydi.
const KEY = "erp_boot_reload_at"; // index.html'dagi nazoratchi bilan bir xil kalit — ikkalasi birga 1 daqiqada 1 marta

const CHUNK_RE = /valid JavaScript MIME type|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk \S+ failed/i;

export function isChunkError(e: unknown): boolean {
  const msg = typeof e === "string" ? e : (e as any)?.message || "";
  return CHUNK_RE.test(String(msg));
}

// Owner 2026-11-06: Mac Tauri ilovasida yangilanishdan keyin "Yangi versiya
// chiqdi" ekrani yolg'ondan chiqib, "Yangilash" tugmasi bosilsa ham hech narsa
// o'zgarmasdi. Sabab: `window.location.reload()` WKWebView'ning HTTP keshidan
// ESKI index.html'ni qaytarardi — bu kesh ilova yangilanganda (yangi .app fayllari
// disk ustiga yozilganda) TOZALANMAYDI, chunki WebKit keshi ilova bundle'iga
// emas, foydalanuvchi profiliga bog'langan. Natijada eski index.html eski (endi
// o'chirilgan) JS bo'lak nomlarini so'rayverardi — reload har safar bir xil
// xatoga qaytib kelardi. Yechim: shunchaki reload emas, URL'ga o'zgaruvchi
// so'rov parametri qo'shib ketish — bu WKWebView'ni keshni chetlab, haqiqiy
// (yangi) index.html'ni diskdan qayta o'qishga majburlaydi.
export function hardReload(): void {
  const u = new URL(window.location.href);
  u.searchParams.set("_r", String(Date.now()));
  window.location.replace(u.toString());
}

/** Bir daqiqada ko'pi bilan bir marta qayta yuklaydi. Qayta yuklash boshlangan bo'lsa true. */
export function reloadForNewVersion(): boolean {
  try {
    const last = +(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* sessionStorage yo'q — baribir yangilaymiz */ }
  hardReload();
  return true;
}
