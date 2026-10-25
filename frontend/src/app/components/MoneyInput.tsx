import { forwardRef, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { caretAfterFormat, formatMoneyInput, type MoneyCur } from "../lib/money";

// Barcha pul kiritish maydonlari uchun (owner 2026-10-23): yozayotganda minglar nuqta bilan — 1000 → 1.000,
// 1250000 → 1.250.000; kursor o'rni saqlanadi; nuqtani o'chirganda oldingi raqam o'chadi; qo'yish (paste) ishlaydi;
// telefonda raqamli klaviatura (inputMode numeric, $/€ uchun decimal — kasr vergul bilan).
// Qiymat — formatlangan satr; songa lib/money.parseMoney bilan o'giriladi.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type"> & {
  value?: string;
  defaultValue?: string | number;
  onChange?: (formatted: string) => void;
  currency?: MoneyCur;
};

export const MoneyInput = forwardRef<HTMLInputElement, Props>(function MoneyInput(
  { value, defaultValue, onChange, currency = "UZS", onKeyDown, ...rest }, ref,
) {
  const inner = useRef<HTMLInputElement | null>(null);
  const [own, setOwn] = useState(() => formatMoneyInput(defaultValue == null ? "" : String(defaultValue), currency));
  const controlled = value !== undefined;
  const shown = controlled ? formatMoneyInput(value, currency) : own;
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = inner.current;
    if (el && caret.current != null && document.activeElement === el) {
      try { el.setSelectionRange(caret.current, caret.current); } catch { /* */ }
    }
    caret.current = null;
  });

  return (
    <input
      {...rest}
      ref={(el) => { inner.current = el; if (typeof ref === "function") ref(el); else if (ref) ref.current = el; }}
      type="text"
      inputMode={currency === "UZS" ? "numeric" : "decimal"}
      autoComplete="off"
      value={shown}
      onKeyDown={(e) => {
        // Nuqta (ajratgich) ustidan o'chirish — undan oldingi/keyingi raqam o'chadi (aks holda "hech narsa bo'lmaydi")
        const el = e.currentTarget;
        const s = el.selectionStart ?? 0;
        if (s === el.selectionEnd) {
          if (e.key === "Backspace" && el.value[s - 1] === ".") el.setSelectionRange(s - 1, s - 1);
          else if (e.key === "Delete" && el.value[s] === ".") el.setSelectionRange(s + 1, s + 1);
        }
        onKeyDown?.(e);
      }}
      onChange={(e) => {
        const el = e.target;
        let raw = el.value;
        let pos = el.selectionStart ?? raw.length;
        const prev = shown;
        // $/€: yozilgan "." — kasr belgisi (telefon klaviaturasida vergul bo'lmasligi mumkin)
        const typedOne = raw.length === prev.length + 1;
        if (currency !== "UZS" && typedOne && raw[pos - 1] === "." && !raw.includes(",")) {
          raw = raw.slice(0, pos - 1) + "," + raw.slice(pos);
        }
        // Bir belgi yozilgan/o'chirilgan bo'lsa — nuqtalar minglar ajratgichi; ko'p belgi (qo'yish) — "12.50" kasr bo'lishi mumkin
        const next = formatMoneyInput(raw, currency, { dotDecimal: raw.length > prev.length + 1 || !prev });
        pos = caretAfterFormat(raw, pos, next);
        caret.current = pos;
        if (!controlled) setOwn(next);
        onChange?.(next);
        // qiymat o'zgarmasa (masalan harf yozildi) React qayta chizmaydi — kursorni shu yerda tiklaymiz
        if (next === prev) requestAnimationFrame(() => { try { el.setSelectionRange(pos, pos); } catch { /* */ } });
      }}
    />
  );
});
