import { SiteLang, langLabel } from "./index";

const LANGS: SiteLang[] = ['uz', 'uz-cyrl', 'ru'];

// Uch tugmali til tanlagich — Login, Ro'yxatdan o'tish va Profilda ishlatiladi.
export default function LanguageSwitcher({ value, onChange, size = "md" }: { value: SiteLang; onChange: (lang: SiteLang) => void; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-2.5 py-1.5 text-[11px]" : "px-3.5 py-2 text-xs";
  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-center">
      {LANGS.map(l => (
        <button key={l} type="button" onClick={() => onChange(l)}
          className={`${pad} rounded-full font-semibold liquid-transition border ${value === l
            ? "bg-primary text-white border-primary shadow-md shadow-primary/25"
            : "bg-transparent border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
          {langLabel(l)}
        </button>
      ))}
    </div>
  );
}
