import { useId, useState, type ReactNode } from "react";
import { MorphIcon } from "morphicons/react";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import Info from "@hugeicons/core-free-icons/InformationCircleIcon";
import Alert from "@hugeicons/core-free-icons/Alert02Icon";
import Chevron from "@hugeicons/core-free-icons/ArrowDown01Icon";

// AI sozlamalari bo'limlari uchun umumiy kichik komponentlar — ilovaning dizayn tili (DataSafety/Profil):
// shisha yuza (surface), yumaloq burchaklar, ingichka chegara, telefon va kompyuterda moslashuvchan.

export function Card({ title, hint, icon, right, children, testId }: {
  title?: ReactNode; hint?: ReactNode; icon?: any; right?: ReactNode; children?: ReactNode; testId?: string;
}) {
  return (
    <section data-testid={testId} className="surface no-lift border border-border rounded-2xl overflow-hidden">
      {(title || hint) && (
        <header className="px-4 pt-4 pb-3 flex items-start gap-3">
          {icon && <div className="icon-chip w-9 h-9 rounded-xl"><MorphIcon icon={icon} className="w-[18px] h-[18px]" /></div>}
          <div className="flex-1 min-w-0">
            {title && <h3 className="text-sm font-bold leading-tight">{title}</h3>}
            {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
          </div>
          {right && <div className="flex-shrink-0">{right}</div>}
        </header>
      )}
      <div className={title || hint ? "px-4 pb-4" : "p-4"}>{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled, testId, title, icon }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; testId?: string;
  /** O'chiq bo'lsa — sababi (sichqoncha ustiga kelganda). */ title?: string; icon?: any;
}) {
  return (
    <label className={`flex items-start gap-3 py-2 ${disabled ? "opacity-60" : "cursor-pointer"}`} title={title}>
      {icon && <span className="icon-chip w-9 h-9 rounded-xl flex-shrink-0"><MorphIcon icon={icon} className="w-[18px] h-[18px]" /></span>}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} data-testid={testId} title={title}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 w-11 h-6 rounded-full flex-shrink-0 liquid-transition ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow liquid-transition ${checked ? "translate-x-5" : ""}`} />
      </button>
    </label>
  );
}

const inputCls = "h-10 w-full rounded-xl border border-border bg-card/70 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs font-semibold text-muted-foreground mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground mt-1">{hint}</span>}
    </label>
  );
}

export function NumField({ label, hint, value, onChange, min, max, step = 1, suffix, disabled, testId }: {
  label: ReactNode; hint?: ReactNode; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
  suffix?: string; disabled?: boolean; testId?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <span className="relative block">
        <input type="number" inputMode="decimal" value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step} disabled={disabled}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
          className={`${inputCls} tabular-nums ${suffix ? "pr-12" : ""}`} />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{suffix}</span>}
      </span>
    </Field>
  );
}

export function TimeField({ label, hint, value, onChange, disabled, testId, big }: {
  label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; disabled?: boolean; testId?: string; big?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="time" step={300} value={value} disabled={disabled} data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} tabular-nums ${big ? "h-14 text-2xl font-bold tracking-wide text-center" : ""}`} />
    </Field>
  );
}

export function TextField({ label, hint, value, onChange, disabled, placeholder, maxLength, testId }: {
  label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; maxLength?: number; testId?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="text" value={value} disabled={disabled} placeholder={placeholder} maxLength={maxLength} data-testid={testId}
        onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </Field>
  );
}

export function SelectField<T extends string>({ label, hint, value, options, onChange, disabled }: {
  label: ReactNode; hint?: ReactNode; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function Chip({ active, onClick, children, disabled, title, testId, tone = "primary" }: {
  active?: boolean; onClick?: () => void; children: ReactNode; disabled?: boolean; title?: string; testId?: string; tone?: "primary" | "danger";
}) {
  const on = tone === "danger" ? "bg-red-500/12 text-red-700 dark:text-red-300 border-red-500/40" : "bg-primary text-primary-foreground border-primary";
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={!!active} data-testid={testId}
      className={`h-9 min-w-[2.5rem] px-3 flex-shrink-0 whitespace-nowrap rounded-full border text-[13px] font-semibold liquid-transition disabled:opacity-50 ${active ? on : "border-border bg-card/60 text-foreground hover:border-primary/50"}`}>
      {children}
    </button>
  );
}

const TONES = {
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25",
  red: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25",
  sky: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25",
  gray: "bg-muted/50 text-muted-foreground border-border",
};
export type Tone = keyof typeof TONES;
export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

export function Notice({ tone = "info", children, testId }: { tone?: "info" | "warn" | "lock"; children: ReactNode; testId?: string }) {
  const cls = tone === "warn" ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-800 dark:text-amber-200"
    : tone === "lock" ? "border-border bg-muted/30 text-muted-foreground" : "border-sky-500/25 bg-sky-500/[0.05] text-foreground";
  const icon = tone === "warn" ? Alert : tone === "lock" ? Lock : Info;
  return (
    <div data-testid={testId} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs ${cls}`}>
      <MorphIcon icon={icon} className="w-4 h-4 flex-shrink-0 mt-px" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Skeleton({ h = "h-40" }: { h?: string }) {
  return <div className={`${h} rounded-2xl bg-muted/40 animate-pulse`} />;
}

export const fmtUsd = (micros: number) => `${(micros / 1e6).toFixed(micros >= 10_000_000 ? 0 : 2)}`;

/** Ixtiyoriy (kam ishlatiladigan) sozlamalar — bosilganda ochiladi. */
export function More({ title, hint, children, testId, defaultOpen = false }: {
  title: ReactNode; hint?: ReactNode; children: ReactNode; testId?: string; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="rounded-2xl border border-border bg-card/40" data-testid={testId}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-2xl hover:bg-muted/30 liquid-transition">
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          {hint && <span className="block text-[11px] text-muted-foreground mt-0.5">{hint}</span>}
        </span>
        <MorphIcon icon={Chevron} className={`w-4 h-4 text-muted-foreground flex-shrink-0 liquid-transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div id={id} className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}
