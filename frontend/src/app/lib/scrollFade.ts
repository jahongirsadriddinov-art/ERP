// Aylantiriladigan joylar chetida yumshoq so'nish (owner 2026-10-25: "kesilib qoladigan joylarda, faqat scroll
// qilganda"). Konteyner aylantirilgan bo'lsa tepasi, pastida yana kontent bo'lsa pasti so'nadi; tepada turganda
// tepada so'nish yo'q. Ichida yopishqoq (sticky) sarlavha bor konteynerlar va data-no-fade belgilanganlar tegilmaydi.

const EDGE = 4; // px — "chetga yetdi" deb hisoblash
const stickyCache = new WeakMap<Element, boolean>();

function hasSticky(el: HTMLElement): boolean {
  let v = stickyCache.get(el);
  if (v === undefined) {
    v = !!el.querySelector(".sticky, thead, [data-sticky]");
    stickyCache.set(el, v);
  }
  return v;
}

/** Bitta konteyner uchun so'nish sinflarini yangilaydi (test uchun eksport). */
export function updateFade(el: HTMLElement): void {
  if (el === document.documentElement || el === document.body) return;
  if (el.dataset.noFade !== undefined || hasSticky(el)) return;
  const max = el.scrollHeight - el.clientHeight;
  if (max <= EDGE) { el.classList.remove("sf-top", "sf-bottom"); return; }
  el.classList.toggle("sf-top", el.scrollTop > EDGE);
  el.classList.toggle("sf-bottom", el.scrollTop < max - EDGE);
}

export function installScrollEdgeFade(): void {
  if (typeof document === "undefined") return;
  let queued = new Set<HTMLElement>();
  let raf = 0;
  document.addEventListener("scroll", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    queued.add(t);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const q = queued; queued = new Set(); q.forEach(updateFade); });
  }, { capture: true, passive: true });
}
