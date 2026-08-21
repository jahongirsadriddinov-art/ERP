import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { haptic, isAndroid } from "./platform";

// ─── Tepadan pastga tortib yangilash (pull-to-refresh) — faqat Android APK'da ──
// MUHIM: bu komponent hech qanday yangi scroll konteyner QO'SHMAYDI — mavjud
// sahifalarning har biri o'zining overflow-y-auto konteyneriga ega (Dashboard,
// Moliya, Kuzatuv, Chat va h.k. — hammasi har xil). Shu tuzilmani BUZMASLIK
// uchun (aks holda "keraksiz joyларда scroll ko'payib ketgan" muammosi yana
// paydo bo'lardi) — bu komponent shunchaki `document` darajasida teginish
// hodisalarini tinglaydi va suzuvchi (fixed) indikatorni ko'rsatadi, hech
// narsani o'rab olmaydi. Har bir tegishdagi HAQIQIY scroll konteynerni
// (e.target'dan yuqoriga qarab birinchi haqiqatan aylanadigan ota-element)
// topib, faqat u eng tepada bo'lganda ishga tushadi.
const PULL_THRESHOLD = 70;
const MAX_PULL = 110;

function findScrollParent(el: Element | null): Element | null {
  let node = el;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const canScrollY = /(auto|scroll)/.test(style.overflowY);
    if (canScrollY && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return document.scrollingElement;
}

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const scrollEl = useRef<Element | null>(null);
  const hapticFired = useRef(false);
  const active = useRef(false);

  useEffect(() => {
    if (!isAndroid()) return; // faqat native Android APK — aniq talab

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      const target = e.target as Element;
      const parent = findScrollParent(target);
      if (!parent || parent.scrollTop > 0) { active.current = false; return; }
      scrollEl.current = parent;
      startY.current = e.touches[0].clientY;
      hapticFired.current = false;
      active.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active.current || startY.current == null) return;
      // Foydalanuvchi tortish davomida boshqa (endi tepada bo'lmagan) holatga
      // o'tsa — bekor qilamiz, oddiy scroll davom etaversin.
      if (scrollEl.current && scrollEl.current.scrollTop > 0) { active.current = false; setPull(0); return; }
      const delta = e.touches[0].clientY - (startY.current as number);
      if (delta <= 0) { setPull(0); return; }
      const damped = Math.min(MAX_PULL, delta * 0.5);
      setPull(damped);
      if (damped >= PULL_THRESHOLD && !hapticFired.current) { hapticFired.current = true; haptic(); }
    };

    const onTouchEnd = () => {
      if (!active.current) return;
      active.current = false;
      startY.current = null;
      setPull(prevPull => {
        if (prevPull >= PULL_THRESHOLD) {
          setRefreshing(true);
          setTimeout(() => window.location.reload(), 250);
          return PULL_THRESHOLD;
        }
        return 0;
      });
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing]);

  if (!isAndroid() || (pull === 0 && !refreshing)) return null;

  const progress = Math.min(1, pull / PULL_THRESHOLD);
  return (
    <div className="fixed left-0 right-0 z-[300] flex items-center justify-center pointer-events-none"
      style={{ top: "max(0.75rem, env(safe-area-inset-top))", opacity: pull > 4 || refreshing ? 1 : 0 }}>
      <div className="w-9 h-9 rounded-full surface flex items-center justify-center shadow-lg"
        style={{ transform: `rotate(${progress * 360}deg)` }}>
        <RefreshCw className={`w-4 h-4 text-primary ${refreshing ? "animate-spin" : ""}`} />
      </div>
    </div>
  );
}
