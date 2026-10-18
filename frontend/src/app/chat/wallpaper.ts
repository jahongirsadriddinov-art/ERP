// Chat foni (owner 2026-10-19: "Telegram'dagidek tema, har xil turlari, o'zi rasm qo'yib bilsin").
// Tayyor fonlar yorug'/qorong'i rejimga mos; o'z rasmi — shu qurilmada (localStorage, ≤1600 px JPEG).
import type { CSSProperties } from "react";

export const WALLPAPERS = ["dots", "sky", "aurora", "sunset", "mint", "lavender", "night", "plain"] as const;
export type WallpaperId = typeof WALLPAPERS[number] | "custom";

const DOTS = "radial-gradient(color-mix(in srgb, var(--foreground) 8%, transparent) 1px, transparent 1.3px)";
// Telegram'dagi kabi yengil naqsh (SVG, rangsiz — ustidan gradient ko'rinadi)
const DOODLE = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" fill="none" stroke="white" stroke-opacity="0.16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M14 30l10-12 10 12M18 30v10h12V30"/><circle cx="86" cy="22" r="8"/><path d="M64 70h22l-4 14H68z"/><path d="M20 86c6-8 14-8 20 0"/>'
  + '<path d="M96 96l8-8M92 84h12v12"/><path d="M48 18h10M53 13v10"/><circle cx="104" cy="58" r="3"/><path d="M8 62l6 6 10-12"/></svg>',
)}")`;

const PRESETS: Record<Exclude<WallpaperId, "custom">, { light: CSSProperties; dark: CSSProperties }> = {
  dots: {
    light: { backgroundColor: "color-mix(in srgb, var(--muted) 75%, var(--background))", backgroundImage: DOTS, backgroundSize: "20px 20px" },
    dark: { backgroundColor: "color-mix(in srgb, var(--muted) 75%, var(--background))", backgroundImage: DOTS, backgroundSize: "20px 20px" },
  },
  sky: {
    light: { backgroundImage: `${DOODLE}, linear-gradient(160deg, #a8d8ff 0%, #c7e9ff 45%, #e6d9ff 100%)`, backgroundSize: "120px 120px, cover" },
    dark: { backgroundImage: `${DOODLE}, linear-gradient(160deg, #0d2a4a 0%, #13365c 50%, #261a4d 100%)`, backgroundSize: "120px 120px, cover" },
  },
  aurora: {
    light: { backgroundImage: `${DOODLE}, linear-gradient(135deg, #b8f0d8 0%, #a5d8ff 40%, #d6b8ff 75%, #ffc6e0 100%)`, backgroundSize: "120px 120px, cover" },
    dark: { backgroundImage: `${DOODLE}, linear-gradient(135deg, #0f3b33 0%, #123a5c 40%, #2f1f5a 75%, #4a1d3f 100%)`, backgroundSize: "120px 120px, cover" },
  },
  sunset: {
    light: { backgroundImage: `${DOODLE}, linear-gradient(160deg, #ffd6a5 0%, #ffb4a2 50%, #e5989b 100%)`, backgroundSize: "120px 120px, cover" },
    dark: { backgroundImage: `${DOODLE}, linear-gradient(160deg, #4a2a12 0%, #5a1f2a 55%, #3a1530 100%)`, backgroundSize: "120px 120px, cover" },
  },
  mint: {
    light: { backgroundImage: `${DOODLE}, linear-gradient(160deg, #d8f5e3 0%, #b9ead2 50%, #9fdcc8 100%)`, backgroundSize: "120px 120px, cover" },
    dark: { backgroundImage: `${DOODLE}, linear-gradient(160deg, #0f2e24 0%, #12392d 55%, #0c2a2a 100%)`, backgroundSize: "120px 120px, cover" },
  },
  lavender: {
    light: { backgroundImage: `${DOODLE}, linear-gradient(160deg, #e9dcff 0%, #d7c6ff 50%, #f3d1ff 100%)`, backgroundSize: "120px 120px, cover" },
    dark: { backgroundImage: `${DOODLE}, linear-gradient(160deg, #221a3d 0%, #2c1f52 55%, #3b1f4f 100%)`, backgroundSize: "120px 120px, cover" },
  },
  night: {
    light: { backgroundImage: `${DOODLE}, linear-gradient(180deg, #1f2a44 0%, #2b2350 100%)`, backgroundSize: "120px 120px, cover" },
    dark: { backgroundImage: `${DOODLE}, linear-gradient(180deg, #070b16 0%, #141030 100%)`, backgroundSize: "120px 120px, cover" },
  },
  plain: {
    light: { backgroundColor: "var(--background)" },
    dark: { backgroundColor: "var(--background)" },
  },
};

const IMG_KEY = (uid: string) => `erp_chatWallpaperImg:${uid}`;

export function loadCustomWallpaper(uid: string): string | null {
  try { return localStorage.getItem(IMG_KEY(uid)); } catch { return null; }
}

export function clearCustomWallpaper(uid: string): void {
  try { localStorage.removeItem(IMG_KEY(uid)); } catch { /* */ }
}

/** Rasmni kichraytirib (≤1600 px, JPEG) saqlaydi. Natija — data URL yoki xato (juda katta / o'qib bo'lmadi). */
export async function saveCustomWallpaper(uid: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("not_image");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("bad_image"));
      i.src = url;
    });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    let data = c.toDataURL("image/jpeg", 0.82);
    if (data.length > 2_500_000) data = c.toDataURL("image/jpeg", 0.6);
    localStorage.setItem(IMG_KEY(uid), data);
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const isDarkMode = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

/** Suhbat oynasi foni. */
export function wallpaperStyle(id: WallpaperId | undefined, customUrl: string | null, dark = isDarkMode()): CSSProperties {
  if (id === "custom" && customUrl) {
    const shade = dark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.08)";
    return { backgroundImage: `linear-gradient(${shade}, ${shade}), url("${customUrl}")`, backgroundSize: "cover", backgroundPosition: "center", backgroundColor: "var(--background)" };
  }
  const p = PRESETS[(id && id !== "custom" && id in PRESETS ? id : "dots") as Exclude<WallpaperId, "custom">];
  return dark ? p.dark : p.light;
}
