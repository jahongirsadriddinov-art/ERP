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

// Yuz jinsga mos bo'lsin (owner 2026-10-23: Jahongirga ayol yuzi tushgan edi) — public/avatars/NOTICE.txt tartibida
const MALE = [1, 2, 6, 7, 8, 10, 12, 14, 15, 18, 19, 22, 24, 26, 28, 31];
const FEMALE = [3, 4, 9, 11, 13, 16, 20, 23, 25, 27, 29, 30, 32];
const MALE_IN_A = /^(hamza|murtaza|mirza|usama|isa|musa|yahya|zakariya|ota|mustafa|abdulla|ubayda|hudayfa|taha)$/i;
/** Ism-familiyadan jins: o'zbek/rus familiyasi (-ova/-eva ayol, -ov/-ev erkak), bo'lmasa ism oxiri. */
export function guessGender(name?: string): "m" | "f" | null {
  const parts = (name || "").toLowerCase().replace(/[ʻʼ'`]/g, "").split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  for (const w of parts.slice(1).concat(parts[0])) {
    if (/(ova|eva|yeva|ovna|evna|ina|aya)$/.test(w) && w.length > 4) return "f";
    if (/(ov|ev|yev|ovich|evich|in|iy|oglu|o'g'li)$/.test(w) && w.length > 3) return "m";
  }
  const first = parts[0];
  if (/(xon|gul|oy|bonu|niso|nisa|zoda)$/.test(first)) return "f";
  if (/(a|ya)$/.test(first) && !MALE_IN_A.test(first)) return "f";
  return "m";
}

export function memojiFor(seed: string, name?: string): { src: string; h1: number; h2: number } {
  const h = hash(normSeed(seed));
  const g = guessGender(name);
  const pool = g === "m" ? MALE : g === "f" ? FEMALE : null;
  const n = pool ? pool[h % pool.length] : (h % MEMOJI_COUNT) + 1;
  const [h1, h2] = HUES[Math.floor(h / MEMOJI_COUNT) % HUES.length];
  return { src: `/avatars/${n < 10 ? "0" : ""}${n}.webp`, h1, h2 };
}

export function initialsOf(name: string): string {
  const firsts = (name || "").split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] || "").filter(Boolean);
  return firsts.slice(0, 2).join("").toUpperCase() || "?";
}

/** Faqat memoji (fon + yuz) — HTML satr sifatida kerak bo'lgan joylar uchun (Leaflet marker). */
export function memojiHtml(seed: string, photo?: string, name?: string): string {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const m = memojiFor(seed, name);
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
  const m = memojiFor(seed, name);
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
