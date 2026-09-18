// Butun sayt bo'ylab bosiladigan elementlarga (tugmalar, havolalar,
// checkbox/switch/radio, tab/menyu bandlari) MARKAZLASHTIRILGAN "zen"
// bosish tovushini ulaydi — har bir komponentni (App.tsx, modal, forma va
// h.k.) alohida o'zgartirmasdan, bitta delegated listener orqali.
//
// Nega document darajasida bitta listener: sahifada minglab tugma/havola
// bor va ularning aksariyati App.tsx kabi doim o'zgarib turadigan katta
// fayllarda joylashgan — har birini qo'lda o'zgartirish ham amaliy emas,
// ham xatoga moyil.
//
// XATO TUZATILDI ("modallarda ovoz ba'zi joylarda ishlamaydi"): avval bu
// listener BUBBLE fazasida edi — lekin ko'pgina modallar "tashqariga
// bosilsa yopish" naqshini backdrop'da onClick, ichki kontent qatlamida
// esa `e.stopPropagation()` bilan amalga oshiradi (App.tsx'da 20+ joyda).
// stopPropagation() hodisani document'ga YETIB BORISHDAN oldin to'xtatib
// qo'yar edi — natijada AYNAN o'sha modallar ichidagi tugmalar ovozsiz
// qolardi. Endi CAPTURE fazasida ro'yxatdan o'tkazilgan (document — zanjir
// boshi, hech kim undan oldin stopPropagation qila olmaydi), shu sabab
// hech qanday ichki stopPropagation ovozni bloklay olmaydi. Checkbox/
// switch/aria-pressed kabi holat o'qishlari esa endi `queueMicrotask`
// bilan kechiktiriladi — hodisa TO'LIQ tugab (React o'z onClick'ini
// bajarib, DOM holatini yangilab) bo'lgandan keyin o'qiladi, shu sabab
// capture fazasida ham HAR DOIM YANGILANGAN holat ko'rinadi.
import { playSound } from "./sound";

const CLICKABLE_SELECTOR = [
  "button",
  "a[href]",
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
].join(", ");

function isDisabled(el: HTMLElement): boolean {
  return (
    el.hasAttribute("disabled") ||
    el.getAttribute("aria-disabled") === "true" ||
    el.closest("fieldset[disabled]") !== null
  );
}

function isChecked(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  const aria = el.getAttribute("aria-checked");
  if (aria !== null) return aria === "true";
  return el.getAttribute("data-state") === "checked";
}

function handleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const el = target.closest<HTMLElement>(CLICKABLE_SELECTOR);
  if (!el || isDisabled(el)) return;
  // data-no-sound="" — kelajakda ovoz kerak bo'lmagan alohida joylar uchun
  // (masalan tez-tez bosiladigan +/- steplar) opt-out eshigi.
  if (el.dataset.noSound !== undefined) return;

  const role = el.getAttribute("role");
  const isCheckboxLike =
    (el instanceof HTMLInputElement && el.type === "checkbox") ||
    role === "checkbox" ||
    role === "switch" ||
    role === "menuitemcheckbox";
  const isRadioLike =
    (el instanceof HTMLInputElement && el.type === "radio") ||
    role === "radio" ||
    role === "menuitemradio";
  const isPressToggle = el.hasAttribute("aria-pressed");

  if (isCheckboxLike || isRadioLike || isPressToggle) {
    // Capture fazasida hali React o'z onClick'ini bajarmagan — holat
    // (checked/aria-pressed) hali ESKI qiymatni ko'rsatishi mumkin. Butun
    // hodisa zanjiri (capture+target+bubble) sinxron tugagach ishga
    // tushadigan microtask'da o'qisak — har doim YANGI holat kafolatlanadi.
    queueMicrotask(() => {
      if (isCheckboxLike) { playSound(isChecked(el) ? "check" : "uncheck", { cooldownMs: 0 }); return; }
      if (isRadioLike) { playSound("select", { cooldownMs: 30 }); return; }
      playSound(el.getAttribute("aria-pressed") === "true" ? "toggle-on" : "toggle-off", { cooldownMs: 0 });
    });
    return;
  }

  if (role === "tab" || role === "option") {
    playSound("select", { cooldownMs: 30 });
    return;
  }

  if (role === "menuitem") {
    playSound("select", { cooldownMs: 20 });
    return;
  }

  playSound("press");
}

let attached = false;

/** Ilova ishga tushganda BIR MARTA chaqiriladi (main.tsx). */
export function attachGlobalClickSounds(): void {
  if (attached || typeof document === "undefined") return;
  attached = true;
  // capture:true — modal/dialog ichidagi `stopPropagation()` (tashqariga
  // bosilsa yopish naqshi) ovozni bloklamasin uchun SHART.
  document.addEventListener("click", handleClick, { capture: true });
}
