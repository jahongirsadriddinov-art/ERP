import { useState } from "react";

// "Premium" emoji — Google Noto rangli emoji (yuqori sifatli SVG, har qurilmada bir xil ko'rinadi).
// `animated` berilsa — sichqoncha ustiga kelganda / bosilganda Telegram premium kabi jonli (animatsion
// WebP) variantga o'tadi. Animatsiya fayli faqat kerak bo'lganda yuklanadi (katta — ~100–500 KB).
// Internet yo'q bo'lsa — oddiy tizim emojisi ko'rsatiladi.
const BASE = "https://fonts.gstatic.com/s/e/notoemoji/latest";

export function PremiumEmoji({ code, char, animated, active, className = "w-7 h-7" }:
  { code: string; char: string; animated?: boolean; active?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [animFailed, setAnimFailed] = useState(false);
  if (failed) return <span className="leading-none text-[20px]" aria-hidden>{char}</span>;
  const src = animated && active && !animFailed ? `${BASE}/${code}/512.webp` : `${BASE}/${code}/emoji.svg`;
  return (
    <img src={src} alt="" aria-hidden draggable={false} loading="lazy" decoding="async"
      className={`${className} object-contain select-none pointer-events-none drop-shadow-[0_3px_6px_rgba(0,0,0,0.28)]`}
      onError={() => (src.endsWith(".webp") ? setAnimFailed(true) : setFailed(true))} />
  );
}
