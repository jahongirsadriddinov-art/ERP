// Kamera/mikrofon xatolari — foydalanuvchi holati (ruxsat berilmagan, qurilma yo'q yoki band), dastur xatosi EMAS.
// Xato tuzatildi (error tracker: "call media: NotAllowedError … user denied permission" — "Video qo'ng'iroq"
// bosilganda): bunday holatlar dasturchiga xato sifatida yuborilmaydi, foydalanuvchiga esa qanday ruxsat
// berish kerakligi (iPhone / Android / Telegram) tushunarli o'zbekcha matnda aytiladi.

export type MediaErrorKind = 'denied' | 'notfound' | 'busy' | 'insecure' | 'other';
export type MediaPlatform = 'telegram-ios' | 'telegram-android' | 'telegram' | 'ios' | 'android' | 'desktop';

export function classifyMediaError(e: unknown): MediaErrorKind {
  const err = e as { name?: string; message?: string } | null | undefined;
  const name = err?.name || '';
  const msg = err?.message || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError' || /denied|not allowed|permission/i.test(msg)) {
    return name === 'SecurityError' && /secure|https/i.test(msg) ? 'insecure' : 'denied';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || /not found|no device/i.test(msg)) return 'notfound';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError' || /in use|could not start|busy/i.test(msg)) return 'busy';
  return 'other';
}

/** Foydalanuvchi holatimi (dasturchiga xato hisobotini yubormaslik kerak). */
export const isUserMediaState = (e: unknown): boolean => classifyMediaError(e) !== 'other';

export function detectMediaPlatform(): MediaPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  let tg = false;
  try { tg = !!(window as any).Telegram?.WebApp?.initData || /tgWebAppData/.test(window.location.hash) || !!sessionStorage.getItem('tg_init'); } catch { /* */ }
  if (tg) return ios ? 'telegram-ios' : android ? 'telegram-android' : 'telegram';
  return ios ? 'ios' : android ? 'android' : 'desktop';
}

/** Ruxsatni qanday yoqish — platformaga qarab. */
export function permissionHowTo(platform: MediaPlatform, what: 'camera' | 'mic' | 'both' = 'both'): string {
  const dev = what === 'camera' ? 'Kamera' : what === 'mic' ? 'Mikrofon' : 'Kamera va Mikrofon';
  switch (platform) {
    case 'telegram-ios': return `iPhone: Sozlamalar → Telegram → ${dev}ni yoqing, so'ng Telegram'ni qayta oching.`;
    case 'telegram-android': return `Android: Sozlamalar → Ilovalar → Telegram → Ruxsatlar → ${dev} → "Ruxsat berish".`;
    case 'telegram': return `Telegram sozlamalarida ${dev.toLowerCase()} ruxsatini yoqing va ilovani qayta oching.`;
    case 'ios': return `iPhone: Sozlamalar → Safari → ${dev} → "Ruxsat berish" (yoki manzil satridagi "aA" → Sayt sozlamalari).`;
    case 'android': return `Manzil satridagi qulf belgisi → Ruxsatlar → ${dev}ni yoqing (yoki Sozlamalar → Ilovalar → brauzer → Ruxsatlar).`;
    default: return `Manzil satridagi qulf/kamera belgisini bosing va ${dev.toLowerCase()}ga ruxsat bering, so'ng qayta urinib ko'ring.`;
  }
}

/** Foydalanuvchiga ko'rsatiladigan sarlavha + izoh. */
export function mediaErrorMessage(e: unknown, opts: { video?: boolean; platform?: MediaPlatform } = {}): { title: string; description: string } {
  const kind = classifyMediaError(e);
  const platform = opts.platform ?? detectMediaPlatform();
  const what = opts.video ? 'both' : 'mic';
  switch (kind) {
    case 'denied': return {
      title: opts.video ? "Kamera va mikrofonga ruxsat berilmagan" : "Mikrofonga ruxsat berilmagan",
      description: permissionHowTo(platform, what),
    };
    case 'notfound': return { title: opts.video ? "Kamera yoki mikrofon topilmadi" : "Mikrofon topilmadi", description: "Qurilma ulanganini tekshiring yoki boshqa qurilmadan qo'ng'iroq qiling." };
    case 'busy': return { title: "Kamera/mikrofon band", description: "Uni ishlatayotgan boshqa ilova yoki oynani yoping va qayta urinib ko'ring." };
    case 'insecure': return { title: "Kamera faqat xavfsiz (https) sahifada ishlaydi", description: "Ilovani rasmiy manzil orqali oching." };
    default: return { title: "Kamera/mikrofonni ishga tushirib bo'lmadi", description: "Qayta urinib ko'ring." };
  }
}
