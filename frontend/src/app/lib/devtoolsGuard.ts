// Owner 2026-10-23: "developer'ni o'chir — kodlarni o'zgartirib bo'lmasin".
// Brauzerda DevTools'ni BUTUNLAY o'chirib bo'lmaydi (menyudan ochsa bo'ladi) — bu faqat to'siq. Haqiqiy himoya
// serverda: har bir so'rov huquq bilan tekshiriladi, brauzerda kodni o'zgartirish faqat o'sha odamning ekraniga ta'sir
// qiladi. Shu yerda: production'da F12 / Ctrl+Shift+I/J/C / Ctrl+U tugmalari va (ilovalardan tashqari) sahifadagi
// o'ng tugma menyusi yopiladi. Dasturchi (role 'dasturchi') uchun hammasi ochiq qoladi.

function isDeveloper(): boolean {
  try { return JSON.parse(localStorage.getItem("currentUser") || "null")?.role === "dasturchi"; } catch { return false; }
}

/** Bloklanadigan tugmalar birikmasi (test uchun eksport). */
export function isDevtoolsShortcut(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): boolean {
  const key = (e.key || "").toUpperCase();
  const code = e.code || "";
  if (key === "F12" || code === "F12") return true;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && ["I", "J", "C", "K"].includes(key)) return true;
  if (e.metaKey && e.altKey && ["I", "J", "C"].includes(key)) return true; // macOS
  if (mod && !e.shiftKey && key === "U") return true; // sahifa manbasi
  return false;
}

export function installDevtoolsGuard(): void {
  if (!import.meta.env.PROD) return;
  window.addEventListener("keydown", (e) => {
    if (isDevtoolsShortcut(e) && !isDeveloper()) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener("contextmenu", (e) => {
    if (isDeveloper() || e.defaultPrevented) return;
    const el = e.target as HTMLElement | null;
    // matn maydoni va belgilangan matnda menyu qoladi (nusxa olish/qo'yish)
    if (el?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""], a[href]')) return;
    if (window.getSelection()?.toString().trim()) return;
    e.preventDefault();
  });
}
