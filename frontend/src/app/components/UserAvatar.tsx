import { useEffect, useState, type CSSProperties } from "react";

// ─── Foydalanuvchi avatari (owner 2026-10-23) ──────────────────────────────────
// Rasm bo'lsa — rasm (yuklanmasa memoji'ga qaytadi). Rasm yo'q bo'lsa — bosh harflar O'RNIGA 3D "memoji"
// bosh (Microsoft Fluent Emoji 3D, MIT — public/avatars/NOTICE.txt). Har foydalanuvchiga id bo'yicha
// BARQAROR tanlanadi (bir odam doim bir xil yuz), fonida ham barqaror yumshoq gradient doira.
// Ilovadagi barcha avatarlar shu komponent orqali: App.Avatar, chat/ChatAvatar, CallOverlay, WorkerMap.

export const MEMOJI_COUNT = 32;
// Fon tuslari — bir-biriga mos, "premium" yumshoq ranglar (hsl hue, ikkinchisi yaqin qo'shni tus)
const HUES: [number, number][] = [
  [212, 236], [252, 278], [282, 312], [330, 352], [8, 30], [32, 48],
  [150, 172], [176, 198], [196, 218], [228, 258], [94, 140], [350, 14],
];

function hash(s: string): number {
  // FNV-1a 32-bit — tez va bir tekis taqsimlangan
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Chat kalitlari ("u:<id>") va oddiy user.id bir xil yuzni bersin. */
const normSeed = (seed: string) => (seed || "?").replace(/^u:/, "");

export function memojiFor(seed: string): { src: string; h1: number; h2: number } {
  const h = hash(normSeed(seed));
  const n = (h % MEMOJI_COUNT) + 1;
  const [h1, h2] = HUES[Math.floor(h / MEMOJI_COUNT) % HUES.length];
  return { src: `/avatars/${n < 10 ? "0" : ""}${n}.webp`, h1, h2 };
}

export function initialsOf(name: string): string {
  const firsts = (name || "").split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] || "").filter(Boolean);
  return firsts.slice(0, 2).join("").toUpperCase() || "?";
}

/** Faqat memoji (fon + yuz) — HTML satr sifatida kerak bo'lgan joylar uchun (Leaflet marker). */
export function memojiHtml(seed: string, photo?: string): string {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const m = memojiFor(seed);
  if (photo) {
    return `<span class="memoji-avatar" style="--av-h1:${m.h1};--av-h2:${m.h2}"><img class="memoji-avatar__photo" src="${esc(photo)}" alt="" decoding="async" onerror="this.onerror=null;this.className='memoji-avatar__img';this.src='${m.src}'"/></span>`;
  }
  return `<span class="memoji-avatar" style="--av-h1:${m.h1};--av-h2:${m.h2}"><img class="memoji-avatar__img" src="${m.src}" alt="" decoding="async"/></span>`;
}

export function UserAvatar({ seed, name, src, size, className = "", style, testId, title }: {
  /** Barqaror kalit — odatda user.id (chatdagi "u:<id>" ham bo'ladi). */
  seed: string;
  name?: string;
  /** Profil rasmi (bo'lsa). */
  src?: string | null;
  /** px; berilmasa o'lcham className orqali (masalan "w-9 h-9"). */
  size?: number;
  className?: string;
  style?: CSSProperties;
  testId?: string;
  title?: string;
}) {
  const [photoBad, setPhotoBad] = useState(false);
  const [memojiBad, setMemojiBad] = useState(false);
  useEffect(() => { setPhotoBad(false); }, [src]);
  const box: CSSProperties = size ? { width: size, height: size, ...style } : { ...style };
  const label = name || undefined;

  if (src && !photoBad) {
    return (
      <img src={src} alt={label || ""} title={title} data-testid={testId} loading="lazy" decoding="async" draggable={false}
        className={`user-avatar rounded-full object-cover flex-shrink-0 ${className}`} style={box} onError={() => setPhotoBad(true)} />
    );
  }
  const m = memojiFor(seed);
  return (
    <span data-testid={testId} title={title} role={label ? "img" : undefined} aria-label={label}
      className={`user-avatar memoji-avatar flex-shrink-0 select-none ${className}`}
      style={{ ...box, ["--av-h1" as string]: m.h1, ["--av-h2" as string]: m.h2 } as CSSProperties}>
      {memojiBad
        ? <span className="memoji-avatar__initials" style={size ? { fontSize: Math.round(size * 0.36) } : undefined}>{initialsOf(name || "")}</span>
        : <img src={m.src} alt="" loading="lazy" decoding="async" draggable={false} className="memoji-avatar__img" onError={() => setMemojiBad(true)} />}
    </span>
  );
}

export default UserAvatar;
