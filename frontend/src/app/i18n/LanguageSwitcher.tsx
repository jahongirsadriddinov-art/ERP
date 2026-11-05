import { motion } from "motion/react";
import { SiteLang, langLabel } from "./index";

const LANGS: SiteLang[] = ['uz', 'uz-cyrl', 'ru'];

// Uch tugmali til tanlagich — Login, Ro'yxatdan o'tish, Profilda va Bosh
// sahifada ishlatiladi (BITTA umumiy komponent — shu yerda yangilansa hamma
// joyda birdek o'zgaradi). 2026-11-06: premium/zamonaviy ko'rinish — segmented
// control uslubida, tanlangan til ortidan "liquid" gradient halqa springli
// animatsiya bilan suzib o'tadi (Framer Motion `layoutId`).
export default function LanguageSwitcher({ value, onChange, size = "md" }: { value: SiteLang; onChange: (lang: SiteLang) => void; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-xs";
  return (
    <div className={`inline-flex items-center gap-0.5 flex-wrap justify-center rounded-full border border-border/50 bg-white/40 dark:bg-black/25 backdrop-blur-xl shadow-inner ${size === "sm" ? "p-0.5" : "p-1"}`}>
      {LANGS.map(l => {
        const active = value === l;
        return (
          <button key={l} type="button" onClick={() => onChange(l)} aria-pressed={active}
            className={`relative ${pad} rounded-full font-semibold liquid-transition active:scale-95`}>
            {active && (
              <motion.span layoutId="lang-switch-pill" transition={{ type: "spring", stiffness: 420, damping: 32 }}
                className="absolute inset-0 rounded-full shadow-md shadow-primary/25 ring-1 ring-white/20"
                style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }} />
            )}
            <span className={`relative z-10 transition-colors duration-200 ${active ? "text-white" : "text-muted-foreground hover:text-foreground"}`}>
              {langLabel(l)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
