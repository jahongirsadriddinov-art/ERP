// Telegram Mini App (bot ichidagi "Ilovani ochish"): Telegram initData'ni URL hash
// (#tgWebAppData=...) orqali beradi. Tashqi skript kerak emas.
export function getTelegramInitData(): string {
  try {
    const d = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('tgWebAppData');
    if (d) { try { sessionStorage.setItem('tg_init', d); } catch {} return d; }
  } catch {}
  try { const w = (window as any).Telegram?.WebApp?.initData; if (w) return String(w); } catch {}
  try { return sessionStorage.getItem('tg_init') || ''; } catch { return ''; }
}

export const isTelegramMiniApp = (): boolean => !!getTelegramInitData();

// Foydalanuvchi o'zi "Chiqish"ni bosgan bo'lsa — Mini App qayta avtomatik kirmaydi,
// faqat login ekrani chiqadi (keyingi qo'lda kirishdan so'ng yana yoqiladi).
export const markManualLogout = () => { try { if (isTelegramMiniApp()) localStorage.setItem('tg_auto_off', '1'); } catch {} };
export const clearManualLogout = () => { try { localStorage.removeItem('tg_auto_off'); } catch {} };
export const telegramAutoLoginAllowed = (): boolean => {
  try { return isTelegramMiniApp() && !localStorage.getItem('token') && localStorage.getItem('tg_auto_off') !== '1'; } catch { return false; }
};
