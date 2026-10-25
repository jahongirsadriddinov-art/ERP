// Klaviatura maydonni yopib qo'ymasin (owner 2026-10-23, iPhone / Telegram Mini App): iOS WebView'da klaviatura
// ochilganda sahifa (layout viewport) kichraymaydi — position:fixed oynalar (modal, pastki varaq) klaviatura ostida
// qoladi va fokusdagi input ko'rinmaydi. Yechim (butun ilova uchun, bir marta o'rnatiladi):
//  1) visualViewport o'lchami CSS o'zgaruvchilarga yoziladi: --vvh (ko'rinadigan balandlik), --vv-top, --kb (klaviatura);
//     klaviatura ochiq bo'lsa <html class="kb-open">. CSS (index.css) fixed oynalarni ko'rinadigan qismga sig'diradi
//     va ichini aylantiriladigan qiladi.
//  2) input/textarea/select fokus olganda — klaviatura ochilib bo'lgach (va har viewport o'zgarishida) element o'z
//     aylantiriladigan konteyneri ichida markazga suriladi (faqat ko'rinmay qolgan bo'lsa).

const FIELD = "input, textarea, select, [contenteditable='true']";
const SKIP_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file", "color", "hidden", "image"]);

export function isTypingField(el: Element | null): el is HTMLElement {
  if (!el || !(el as HTMLElement).matches?.(FIELD)) return false;
  if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) return false;
  return !(el as HTMLInputElement).readOnly && !(el as HTMLInputElement).disabled;
}

/** Element ko'rinadigan qismdan (klaviatura ustidagi) chiqib qolganmi. */
function obscured(el: HTMLElement, vv: { height: number; offsetTop: number }): boolean {
  const r = el.getBoundingClientRect();
  const top = vv.offsetTop + 8, bottom = vv.offsetTop + vv.height - 8;
  return r.bottom > bottom || r.top < top;
}

export function installKeyboardAvoid(win: Window = window): () => void {
  const doc = win.document;
  const root = doc.documentElement;
  let raf = 0;
  let timers: number[] = [];

  const vv = () => win.visualViewport || { height: win.innerHeight, offsetTop: 0, width: win.innerWidth } as VisualViewport;

  const reveal = () => {
    const el = doc.activeElement;
    if (!isTypingField(el)) return;
    const v = vv();
    if (!obscured(el, v)) return;
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch { el.scrollIntoView(); }
  };

  // Fokusdagi maydonni o'z ichiga olgan fixed oyna (modal/varaq). Sahifa konteynerida transform bo'lsa fixed element
  // o'sha konteynerga nisbatan joylashadi — shu sabab joy CSS'da emas, shu yerda o'lchab hisoblanadi.
  const overlayOf = (el: Element | null): HTMLElement | null => {
    for (let e = el?.parentElement; e && e !== doc.body; e = e.parentElement) {
      if (e.hasAttribute("data-kb-sheet")) return e;
      if (e.getAttribute("role") === "dialog" || e.classList.contains("inset-0")) {
        if (win.getComputedStyle(e).position === "fixed") return e;
      }
    }
    return null;
  };
  const unfit = (o: HTMLElement) => {
    for (const k of ["top", "bottom", "height", "--kb-max"]) o.style.removeProperty(k);
    delete o.dataset.kbFit; delete o.dataset.kbShift;
  };
  const fit = (o: HTMLElement, v: { height: number; offsetTop: number }) => {
    const applied = Number(o.dataset.kbShift || 0);
    const naturalTop = o.getBoundingClientRect().top - applied;
    const visTop = Math.max(naturalTop, v.offsetTop);
    const h = Math.max(160, Math.round(v.offsetTop + v.height - visTop));
    const shift = Math.round(visTop - naturalTop);
    o.style.setProperty("top", `${shift}px`, "important");
    o.style.setProperty("bottom", "auto", "important");
    o.style.setProperty("height", `${h}px`, "important");
    const cs = win.getComputedStyle(o);
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    o.style.setProperty("--kb-max", `${Math.max(120, h - pad - 4)}px`);
    o.dataset.kbShift = String(shift);
    o.dataset.kbFit = "1";
  };

  const update = () => {
    raf = 0;
    const v = vv();
    const kb = Math.max(0, Math.round(win.innerHeight - v.height - v.offsetTop));
    root.style.setProperty("--vvh", `${Math.round(v.height)}px`);
    root.style.setProperty("--vv-top", `${Math.round(v.offsetTop)}px`);
    root.style.setProperty("--kb", `${kb}px`);
    // kichik farqlar (manzil satri, Telegram paneli) — klaviatura emas
    const open = kb > 80;
    root.classList.toggle("kb-open", open);
    const active = isTypingField(doc.activeElement) ? overlayOf(doc.activeElement) : null;
    doc.querySelectorAll<HTMLElement>("[data-kb-fit]").forEach((o) => { if (!open || o !== active) unfit(o); });
    if (open && active) fit(active, v);
    // o'lcham o'zgargach (CSS qo'llangach) fokusdagi maydonni ko'rinadigan qilamiz
    win.requestAnimationFrame(reveal);
  };
  const schedule = () => { if (!raf) raf = win.requestAnimationFrame(update); };

  const onFocusIn = (e: FocusEvent) => {
    if (!isTypingField(e.target as Element)) return;
    timers.forEach((t) => win.clearTimeout(t));
    // klaviatura animatsiyasi ~250–400 ms; resize hodisasi kelmasa ham tekshiramiz
    timers = [80, 350, 700].map((ms) => win.setTimeout(() => { update(); reveal(); }, ms));
  };
  const onFocusOut = () => { win.setTimeout(schedule, 50); };

  const target = win.visualViewport;
  target?.addEventListener("resize", schedule);
  target?.addEventListener("scroll", schedule);
  win.addEventListener("resize", schedule);
  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("focusout", onFocusOut);
  update();
  return () => {
    target?.removeEventListener("resize", schedule);
    target?.removeEventListener("scroll", schedule);
    win.removeEventListener("resize", schedule);
    doc.removeEventListener("focusin", onFocusIn);
    doc.removeEventListener("focusout", onFocusOut);
    timers.forEach((t) => win.clearTimeout(t));
    root.classList.remove("kb-open");
    doc.querySelectorAll<HTMLElement>("[data-kb-fit]").forEach(unfit);
  };
}
