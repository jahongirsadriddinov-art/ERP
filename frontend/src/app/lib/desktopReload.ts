// Owner 2026-11-06: "cmd r ni bossam rfresh bolishi kere osha ishlamayapdi".
// Brauzerda Cmd+R/Ctrl+R sahifani qayta yuklaydi, lekin Tauri oynasida bu — oddiy veb
// sahifa emas, maxsus menyu/qisqa yo'l bog'lanmagan bo'lsa hech narsa bosilmaydi (bu ilovada
// na oyna menyusi, na global shortcut ro'yxatga olingan). Shu sabab Windows/macOS ilovasida
// Cmd+R/Ctrl+R hech narsa qilmasdi. Bu yerda faqat Tauri ichida ishlaydi — veb/Telegram
// Mini App'da brauzerning o'z Cmd+R'i (yoki pull-to-refresh) allaqachon ishlaydi.
import { isTauri } from "../platform";

export function installDesktopReload(): void {
  if (!isTauri()) return;
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      window.location.reload();
    }
  }, true);
}
