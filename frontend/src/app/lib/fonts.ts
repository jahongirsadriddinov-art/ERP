// ─── Shriftlar ───────────────────────────────────────────────────────────────
// Profildan butun sayt uchun shrift tanlash (qurilmada saqlanadi) va hujjatlar (e-imzo) uchun alohida shrift.
// Hammasi kirill harflarini ham qo'llaydi (ruscha interfeys/hujjat uchun). Google Fonts faqat tanlanganda yuklanadi.

export interface FontDef { id: string; label: string; family: string; google?: string; kind: "sans" | "serif" | "round" | "mono" }

const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"';
export const FONTS: FontDef[] = [
  { id: "inter", label: "Inter", family: `Inter, "Segoe UI", Roboto, Arial, sans-serif, ${EMOJI}`, google: "Inter:wght@400;500;600;700;800", kind: "sans" },
  { id: "roboto", label: "Roboto", family: `Roboto, Arial, sans-serif, ${EMOJI}`, google: "Roboto:wght@400;500;700;900", kind: "sans" },
  { id: "montserrat", label: "Montserrat", family: `Montserrat, Arial, sans-serif, ${EMOJI}`, google: "Montserrat:wght@400;500;600;700;800", kind: "sans" },
  { id: "manrope", label: "Manrope", family: `Manrope, Arial, sans-serif, ${EMOJI}`, google: "Manrope:wght@400;500;600;700;800", kind: "sans" },
  { id: "nunito", label: "Nunito", family: `Nunito, Arial, sans-serif, ${EMOJI}`, google: "Nunito:wght@400;600;700;800", kind: "round" },
  { id: "comfortaa", label: "Comfortaa", family: `Comfortaa, Arial, sans-serif, ${EMOJI}`, google: "Comfortaa:wght@400;500;600;700", kind: "round" },
  { id: "ptsans", label: "PT Sans", family: `"PT Sans", Arial, sans-serif, ${EMOJI}`, google: "PT+Sans:wght@400;700", kind: "sans" },
  { id: "ptserif", label: "PT Serif", family: `"PT Serif", Georgia, serif, ${EMOJI}`, google: "PT+Serif:wght@400;700", kind: "serif" },
  { id: "playfair", label: "Playfair Display", family: `"Playfair Display", Georgia, serif, ${EMOJI}`, google: "Playfair+Display:wght@400;600;700;800", kind: "serif" },
  { id: "times", label: "Times New Roman", family: `"Times New Roman", Times, "PT Serif", serif, ${EMOJI}`, kind: "serif" },
  { id: "jetbrains", label: "JetBrains Mono", family: `"JetBrains Mono", Consolas, monospace, ${EMOJI}`, google: "JetBrains+Mono:wght@400;500;700", kind: "mono" },
];

export const fontById = (id?: string | null): FontDef => FONTS.find(f => f.id === id) || FONTS[0];

const loaded = new Set<string>();
/** Google Fonts stilini (bir marta) ulaydi va shriftning o'zi yuklanguncha kutadi (canvas uchun muhim). */
export async function ensureFont(id?: string | null): Promise<FontDef> {
  const f = fontById(id);
  if (typeof document === "undefined") return f;
  if (f.google && !loaded.has(f.id)) {
    loaded.add(f.id);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
    document.head.appendChild(link);
    await new Promise<void>(res => { link.onload = () => res(); link.onerror = () => res(); setTimeout(res, 4000); });
  }
  try {
    const name = f.family.split(",")[0].trim();
    await Promise.race([
      Promise.all([(document as any).fonts?.load(`400 20px ${name}`), (document as any).fonts?.load(`700 20px ${name}`)]),
      new Promise(r => setTimeout(r, 3000)),
    ]);
  } catch { /* tarmoq yo'q — zaxira shrift */ }
  return f;
}

const LS_KEY = "erp_app_font";
export const getAppFont = (): string => { try { return localStorage.getItem(LS_KEY) || "inter"; } catch { return "inter"; } };

/** Butun sayt shriftini o'rnatadi (kod/monospace bloklaridan tashqari). */
export function applyAppFont(id?: string | null) {
  if (typeof document === "undefined") return;
  const f = fontById(id ?? getAppFont());
  try { localStorage.setItem(LS_KEY, f.id); } catch { /* */ }
  let style = document.getElementById("app-font-style") as HTMLStyleElement | null;
  if (f.id === "inter") { style?.remove(); document.documentElement.removeAttribute("data-app-font"); return; }
  ensureFont(f.id);
  if (!style) { style = document.createElement("style"); style.id = "app-font-style"; document.head.appendChild(style); }
  document.documentElement.setAttribute("data-app-font", f.id);
  style.textContent = `html[data-app-font] body, html[data-app-font] body *:not(.font-mono):not(code):not(pre):not(kbd):not(samp):not([data-font-preview]) { font-family: ${f.family} !important; }`;
}
