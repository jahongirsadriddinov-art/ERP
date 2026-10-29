// Enter bosilganda asosiy tugma bosilsin — HAMMA joyda (owner 2026-10-29:
// "kirish kodini olish, joylash, shunga o'xshash narsalar — Enter bosilsa
// bosilsin, hamma joyda ishlasin").
//
// Nega kerak: forma ichidagi maydonlarda Enter brauzerning O'ZIDA ishlaydi, lekin
// loyihadagi ko'p oyna (profil, obyekt, dasturchi paneli, admin oynalari) <form>siz
// qurilgan — u yerda Enter umuman hech nima qilmasdi, sichqoncha bilan tugmani
// bosish shart edi.
//
// Xavfsizlik: tasodifan "O'chirish" bosilib ketmasligi uchun tugma TAXMIN
// QILINMAYDI. Faqat quyidagilar qabul qilinadi:
//   1) data-enter-submit bilan aniq belgilangan tugma;
//   2) type="submit" tugma;
//   3) loyihadagi "asosiy amal" ko'rinishidagi tugma (bg-primary / primary gradient /
//      bg-green-600). Qizil (o'chirish/bekor) va o'chirilgan tugmalar HECH QACHON.
// Mos tugma topilmasa — hech nima qilinmaydi (avvalgidek).

/** Matn kiritiladigan input turlari (textarea — yangi qator uchun, tegilmaydi). */
const TEXT_TYPES = new Set(['text', 'tel', 'email', 'number', 'password', 'search', 'url', '']);

/** Yuqoriga nechta ota-elementgacha qaraladi — oyna/karta doirasidan chiqib ketmasin. */
const MAX_DEPTH = 10;

const PRIMARY_RE = /(^|\s)bg-primary(\s|$)|from-primary|bg-green-600/;
const DANGER_RE = /bg-red|text-red|bg-destructive/;

/** Tugma ko'rinishi "asosiy amal"ga o'xshaydimi (DOM'siz tekshiriladi — testlar uchun). */
export function isPrimaryClass(cls: string): boolean {
  return PRIMARY_RE.test(cls) && !DANGER_RE.test(cls);
}

function isPrimary(b: HTMLButtonElement): boolean {
  if (b.disabled || b.type === 'reset') return false;
  if (b.hasAttribute('data-enter-submit')) return true;
  if (b.type === 'submit') return true;
  const cls = b.className || '';
  return typeof cls === 'string' && isPrimaryClass(cls);
}

/** Ko'rinmaydigan tugma (yopiq tab, display:none) bosilmasin. */
const visible = (el: HTMLElement) => !!(el.offsetParent || el.getClientRects().length);

function findAction(input: HTMLElement): HTMLButtonElement | null {
  let node: HTMLElement | null = input.parentElement;
  for (let i = 0; node && i < MAX_DEPTH; i++, node = node.parentElement) {
    if (node.tagName === 'FORM') return null;   // forma o'zi hal qiladi
    const marked = node.querySelector<HTMLButtonElement>('button[data-enter-submit]:not([disabled])');
    if (marked && visible(marked)) return marked;
    for (const b of Array.from(node.querySelectorAll<HTMLButtonElement>('button'))) {
      if (isPrimary(b) && visible(b)) return b;
    }
    if (node.tagName === 'MAIN' || node.tagName === 'BODY') break;
  }
  return null;
}

export function installEnterSubmit(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229) return;  // IME yozayotganda emas
    if (e.defaultPrevented) return;
    const el = e.target as HTMLElement | null;
    if (!el || el.tagName !== 'INPUT') return;
    const input = el as HTMLInputElement;
    if (!TEXT_TYPES.has(input.type) || input.disabled || input.readOnly) return;
    if (input.closest('[data-no-enter]')) return;
    if (input.closest('form')) return;          // brauzerning o'zi yuboradi
    const btn = findAction(input);
    if (!btn) return;
    e.preventDefault();
    input.blur();                               // telefonda klaviatura yopilsin
    btn.click();
  });
}
