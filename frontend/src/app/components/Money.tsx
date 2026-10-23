import { useEffect, useState } from "react";
import { fetchLiveCurrencyRates, fmt, LIVE_EUR_RATE, LIVE_USD_RATE, type Expense } from "../App";
import { usePersistentState } from "../lib/persistentState";

// Valyuta (owner 2026-10-23): kirim/chiqim so'm, dollar yoki yevroda kiritiladi — server kurs bo'yicha so'mga o'giradi
// (hisob-kitob doim so'mda). Kartada asl valyutada ko'rinadi; "So'mda ko'rsatish" yoqilsa — hammasi so'mda.

export type Cur = "UZS" | "USD" | "EUR";
const SIGN: Record<Exclude<Cur, "UZS">, string> = { USD: "$", EUR: "€" };
const isRu = () => typeof document !== "undefined" && document.documentElement.lang.startsWith("ru");

export function fmtCur(v: number, c: Cur): string {
  if (c === "UZS") return fmt(v);
  return `${SIGN[c]}${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Karta summasi: asosiy (asl valyutada yoki so'mda) + ikkinchi qator (≈ so'm), agar valyuta boshqa bo'lsa. */
export function moneyOf(e: Pick<Expense, "amount" | "currency" | "originalAmount">, inUzs: boolean): { main: string; sub?: string } {
  const c = (e.currency || "UZS") as Cur;
  if (c === "UZS" || !e.originalAmount) return { main: fmt(e.amount) };
  return inUzs ? { main: fmt(e.amount), sub: fmtCur(e.originalAmount, c) } : { main: fmtCur(e.originalAmount, c), sub: `≈ ${fmt(e.amount)}` };
}

/** Foydalanuvchi tanlovi — barcha kartalarda bir xil (qurilmada eslab qolinadi). */
export function useShowInUzs() {
  return usePersistentState<boolean>("money.inUzs", false, (v) => typeof v === "boolean");
}

export function InUzsToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer select-none" data-testid="money-in-uzs">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-[var(--primary)]" />
      {isRu() ? "Показывать в сумах" : "So'mda ko'rsatish"}
    </label>
  );
}

/** Summa + valyuta tanlash; kiritilganda so'mdagi qiymati darhol ko'rinadi. */
export function MoneyField({ amount, currency, onAmount, onCurrency, label, autoFocus, className }: {
  amount: string; currency: Cur; onAmount: (v: string) => void; onCurrency: (c: Cur) => void; label: string; autoFocus?: boolean; className: string;
}) {
  const [, force] = useState(0);
  useEffect(() => { if (currency !== "UZS") void fetchLiveCurrencyRates().then(() => force((x) => x + 1)); }, [currency]);
  const n = Number(amount.replace(/\s/g, "").replace(",", ".")) || 0;
  const rate = currency === "USD" ? LIVE_USD_RATE : currency === "EUR" ? LIVE_EUR_RATE : 1;
  return (
    <div>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="flex gap-2 mt-1">
        <input autoFocus={autoFocus} inputMode="decimal" value={amount} placeholder="0" data-testid="money-amount"
          onChange={(e) => onAmount(e.target.value.replace(currency === "UZS" ? /[^\d\s]/g : /[^\d\s.,]/g, ""))} className={`${className} flex-1 min-w-0`} />
        <div className="flex p-1 rounded-xl bg-muted flex-shrink-0" role="radiogroup" aria-label="Valyuta">
          {(["UZS", "USD", "EUR"] as Cur[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={currency === c} data-testid={`money-cur-${c}`} onClick={() => onCurrency(c)}
              className={`h-10 min-w-[2.75rem] px-2 rounded-lg text-sm font-bold liquid-transition ${currency === c ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
              {c === "UZS" ? (isRu() ? "сум" : "so'm") : SIGN[c]}
            </button>
          ))}
        </div>
      </div>
      {currency !== "UZS" && n > 0 && (
        <p className="text-xs text-muted-foreground mt-1.5" data-testid="money-preview">
          ≈ <b className="text-foreground">{fmt(Math.round(n * rate))}</b> · {isRu() ? "курс" : "kurs"} 1 {SIGN[currency]} = {rate.toLocaleString("ru-RU")} {isRu() ? "сум" : "so'm"}
        </p>
      )}
    </div>
  );
}

export const parseAmount = (s: string) => Number(s.replace(/\s/g, "").replace(",", ".")) || 0;
