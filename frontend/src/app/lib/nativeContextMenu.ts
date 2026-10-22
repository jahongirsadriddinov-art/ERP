import { isNative, isTauri } from "../platform";

// Owner 2026-10-22: Windows ilovasida o'ng tugma bosilganda brauzerning menyusi ("Назад, Обновить, Сохранить как,
// Печать") chiqardi — ilovada bu begona. Ilovalarda (Tauri/Capacitor) standart menyu o'chiriladi; matn maydonlarida va
// belgilangan matnda qoldiriladi (nusxa olish/qo'yish uchun). Ilovaning o'z menyulari (chat, ro'yxat qatori) ishlayveradi.
export function installNativeContextMenuGuard(): void {
  if (!(isTauri() || isNative())) return;
  document.addEventListener("contextmenu", (e) => {
    const el = e.target as HTMLElement | null;
    const editable = !!el?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]');
    const hasSelection = !!window.getSelection()?.toString().trim();
    if (!editable && !hasSelection) e.preventDefault();
  });
}
