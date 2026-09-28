// ─── Eski WebView/brauzerlar uchun rang mosligi ─────────────────────────────
// Tailwind v4 ranglari `oklch()` va shaffoflik uchun `color-mix()` ishlatadi — Chrome 111 dan
// eski (ko'plab Android telefonlardagi "Android System WebView") ularni bilmaydi: palitra ranglari
// umuman ko'rinmaydi, `bg-primary/10` kabi och fonlar esa TO'LIQ to'q rangda chiqadi (matn ko'rinmay
// qoladi). Bunday brauzerda barcha rang qoidalari o'qilib, oddiy rgba() bilan qayta yoziladi.

type RGBA = [number, number, number, number];
const clamp = (x: number) => Math.min(255, Math.max(0, Math.round(x)));

export function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const g = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055);
  return [clamp(g(lin[0]) * 255), clamp(g(lin[1]) * 255), clamp(g(lin[2]) * 255)];
}

export function parseColor(v: string): RGBA | null {
  v = v.trim().toLowerCase();
  if (!v) return null;
  if (v === "transparent") return [0, 0, 0, 0];
  if (v === "white") return [255, 255, 255, 1];
  if (v === "black") return [0, 0, 0, 1];
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map(c => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a];
  }
  m = v.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const L = m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    const [r, g, b] = oklchToRgb(L, parseFloat(m[3]), parseFloat(m[4]));
    const a = m[5] == null ? 1 : m[5].endsWith("%") ? parseFloat(m[5]) / 100 : parseFloat(m[5]);
    return [r, g, b, a];
  }
  return null;
}

const COLOR_PROPS = ["color", "background-color", "border-color", "border-top-color", "border-right-color", "border-bottom-color",
  "border-left-color", "outline-color", "fill", "stroke", "--tw-ring-color", "--tw-shadow-color", "caret-color", "accent-color",
  "text-decoration-color", "--tw-gradient-from", "--tw-gradient-to", "--tw-gradient-via"];

export function installLegacyColorFallback() {
  if (typeof window === "undefined" || !window.CSS?.supports) return;
  if (CSS.supports("color", "color-mix(in lab, red, red)") && CSS.supports("color", "oklch(50% 0.1 100)")) return;
  const style = document.createElement("style");
  style.id = "legacy-color-fallback";

  const resolve = (value: string, root: CSSStyleDeclaration, depth = 0): RGBA | null => {
    value = value.trim();
    const vm = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
    if (vm && depth < 6) {
      const raw = root.getPropertyValue(vm[1]);
      return raw ? resolve(raw, root, depth + 1) : vm[2] ? resolve(vm[2], root, depth + 1) : null;
    }
    return parseColor(value);
  };

  const build = () => {
    const root = getComputedStyle(document.documentElement);
    const out: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const r of Array.from(rules)) {
        if (r instanceof CSSStyleRule) {
          const alphaM = r.selectorText.match(/\\\/(\d{1,3})\b/);
          const alpha = alphaM ? Math.min(100, +alphaM[1]) / 100 : null;
          const decls: string[] = [];
          for (const prop of COLOR_PROPS) {
            const val = r.style.getPropertyValue(prop);
            if (!val || (!val.includes("var(") && !val.includes("oklch"))) continue;
            const c = resolve(val, root);
            if (!c) continue;
            const a = alpha != null ? c[3] * alpha : c[3];
            decls.push(`${prop}:rgba(${c[0]},${c[1]},${c[2]},${+a.toFixed(3)})`);
          }
          if (decls.length) out.push(`${r.selectorText}{${decls.join(";")}}`);
        } else if ((r as CSSGroupingRule).cssRules && !(r instanceof CSSSupportsRule)) {
          // @media ichidagilar (sm:, lg:, dark:) — xuddi shu shart bilan o'raladi
          const inner = (r as CSSGroupingRule).cssRules;
          if (r instanceof CSSMediaRule) { const before = out.length; walk(inner); if (out.length > before) out.push(`@media ${r.conditionText}{${out.splice(before).join("")}}`); }
          else walk(inner);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.ownerNode === style) continue;
      try { walk(sheet.cssRules); } catch { /* boshqa domen jadvali */ }
    }
    style.textContent = out.join("\n");
    if (!style.isConnected) document.head.appendChild(style);
  };

  let t: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => { if (t) clearTimeout(t); t = setTimeout(build, 60); };
  schedule();
  window.addEventListener("load", schedule);
  // Tema (rang/yorug'-qorong'i) o'zgarsa — o'zgaruvchilar yangilanadi, qayta hisoblanadi
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  // Lazy yuklangan CSS (yangi <style>/<link>)
  new MutationObserver(muts => { if (muts.some(m => Array.from(m.addedNodes).some(n => n.nodeName === "STYLE" || n.nodeName === "LINK"))) schedule(); })
    .observe(document.head, { childList: true });
}

// `dvh` birligini bilmaydigan brauzerlar uchun (Chrome < 108) — aks holda ekran balandligi
// aniqlanmaydi va ichki skroll konteynerlari umuman surilmaydi.
export function installDvhFallback() {
  if (typeof window === "undefined" || !window.CSS?.supports || CSS.supports("height", "100dvh")) return;
  const s = document.createElement("style");
  s.id = "legacy-dvh-fallback";
  s.textContent = [
    ".h-\\[100dvh\\]{height:100vh}", ".min-h-\\[100dvh\\]{min-height:100vh}",
    ".h-\\[92dvh\\]{height:92vh}", ".h-\\[94dvh\\]{height:94vh}", ".min-h-\\[60dvh\\]{min-height:60vh}",
    ".max-h-\\[min\\(20rem\\,60dvh\\)\\]{max-height:min(20rem,60vh)}",
  ].join("\n");
  document.head.appendChild(s);
}
