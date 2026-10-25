import { useEffect, useRef, useState } from "react";

// Raqam animatsiyasi (owner 2026-10-23): moliya summalari birinchi ko'rinishda 0 dan qiymatgacha, o'zgarganda
// eskisidan yangisiga ~600 ms ease-out bilan "sanaydi". prefers-reduced-motion — animatsiyasiz. Kenglik sakramasin:
// tabular-nums (barcha raqamlar bir xil kenglikda).

const reduced = () => {
  try { return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function useCountUp(value: number, duration = 600): number {
  const target = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState(() => (reduced() ? target : 0));
  const from = useRef(reduced() ? target : 0);
  const cur = useRef(from.current);
  useEffect(() => {
    if (reduced() || typeof requestAnimationFrame !== "function") { cur.current = target; setShown(target); return; }
    const start = cur.current;
    if (start === target) { setShown(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const v = k >= 1 ? target : start + (target - start) * easeOut(k);
      cur.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return shown;
}

export function CountUp({ value, format, className, prefix = "", testId, duration }: {
  value: number; format: (n: number) => string; className?: string; prefix?: string; testId?: string; duration?: number;
}) {
  const v = useCountUp(value, duration);
  // Oraliq qiymatlar — butun son (so'm), oxirida aniq qiymat (kasr bilan bo'lsa ham)
  const shown = v === value ? value : Math.round(v);
  return (
    <span className={`tabular-nums ${className || ""}`} data-testid={testId} data-value={value}>{prefix}{format(shown)}</span>
  );
}
