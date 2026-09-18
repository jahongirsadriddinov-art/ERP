// `sonner`ning umumiy `toast` obyektini JOYIDA (in place) o'zgartirib, har
// bir toast.success/error/warning/message chaqiruviga mos "zen" ovoz
// effektini avtomatik ulaydi.
//
// NEGA BUNDAY: `toast`ni "sonner"dan import qilgan BARCHA fayllar
// (App.tsx, CallOverlay.tsx, DeveloperPanel.tsx, ReportsPage.tsx,
// RegisterWizard.tsx) aslida BITTA module-singleton obyektga ishora
// qiladi — sonner uni `const toast = Object.assign(basicToast, {...})`
// tarzida eksport qiladi, ya'ni metodlari mutatsiya qilinishi mumkin.
// Shu sabab har bir faylni alohida o'zgartirish shart emas: ushbu faylni
// (import "./soundToast";) bir marta ilova kirish nuqtasida (main.tsx)
// import qilish — butun sayt bo'ylab har qanday toast chaqiruviga ovoz
// qo'shish uchun kifoya.
import { toast } from "sonner";
import type { CueName } from "uisfx";
import { playSound } from "./sound";

type AnyFn = (...args: any[]) => any;

function withSound<T extends AnyFn>(fn: T, cue: CueName): T {
  return ((...args: Parameters<T>) => {
    playSound(cue);
    return fn(...args);
  }) as T;
}

let patched = false;

export function patchToastSounds(): void {
  if (patched) return;
  patched = true;

  const originalSuccess = toast.success;
  const originalError = toast.error;
  const originalWarning = toast.warning;
  const originalMessage = toast.message;
  const originalPromise = toast.promise;

  toast.success = withSound(originalSuccess, "success");
  toast.error = withSound(originalError, "error");
  toast.warning = withSound(originalWarning, "warning");
  toast.message = withSound(originalMessage, "notification");

  // toast.promise(): sonner o'zi loading → success/error holatlarini
  // ICHKI ravishda ko'rsatadi (yuqoridagi toast.success/error orqali
  // EMAS), shu sabab natijani shu yerda alohida kuzatib, mos ovozni
  // to'g'ridan-to'g'ri chalamiz. Original promise xatti-harakati (UI,
  // qiymatni unwrap qilish) o'zgarishsiz qoladi.
  toast.promise = ((promiseInput: any, data?: any) => {
    const settled = typeof promiseInput === "function" ? promiseInput() : promiseInput;
    Promise.resolve(settled).then(
      () => playSound("success"),
      () => playSound("error"),
    );
    return originalPromise(promiseInput, data);
  }) as typeof toast.promise;

  // Diqqat: bare `toast("...")` chaqiruvi (metodsiz) ovozsiz qoladi —
  // funksiyaning o'z chaqiriluvchanligini tashqaridan almashtirib
  // bo'lmaydi (faqat uning propertylari mutatsiya qilinadi). Bu holatlar
  // App.tsx'da juda kam uchraydi (bir nechta joy) va toast.message()'ga
  // o'tkazilganda avtomatik ovoz oladi.
}

patchToastSounds();
