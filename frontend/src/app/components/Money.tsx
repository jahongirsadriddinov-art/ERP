import { useEffect, useState } from "react";
import { fetchLiveCurrencyRates, fmt, LIVE_EUR_RATE, LIVE_KAPITAL, LIVE_RATE_SOURCE, LIVE_USD_RATE, type Expense } from "../App";
import { usePersistentState } from "../lib/persistentState";
import { fmtNumber, formatMoneyInput, parseMoney } from "../lib/money";
import { MoneyInput } from "./MoneyInput";

// Valyuta (owner 2026-10-23): kirim/chiqim so'm, dollar yoki yevroda kiritiladi — server kurs bo'yicha so'mga o'giradi
// (hisob-kitob doim so'mda). Kartada asl valyutada ko'rinadi; "So'mda ko'rsatish" yoqilsa — hammasi so'mda.

export type Cur = "UZS" | "USD" | "EUR";
const SIGN: Record<Exclude<Cur, "UZS">, string> = { USD: "$", EUR: "€" };
const isRu = () => typeof document !== "undefined" && document.documentElement.lang.startsWith("ru");

export function fmtCur(v: number, c: Cur): string {
  if (c === "UZS") return fmt(v);
  return `${SIGN[c]}${fmtNumber(v)}`;
}

/** Karta summasi: asosiy (asl valyutada yoki so'mda) + ikkinchi qator (≈ so'm), agar valyuta boshqa bo'lsa. */
/** num/fmt — asosiy summa soni va formatlovchisi (CountUp animatsiyasi uchun). */
export function moneyOf(e: Pick<Expense, "amount" | "currency" | "originalAmount">, inUzs: boolean): { main: string; sub?: string; num: number; fmt: (n: number) => string } {
  const c = (e.currency || "UZS") as Cur;
  const uzs = { num: Number(e.amount) || 0, fmt };
  if (c === "UZS" || !e.originalAmount) return { main: fmt(e.amount), ...uzs };
  return inUzs ? { main: fmt(e.amount), sub: fmtCur(e.originalAmount, c), ...uzs }
    : { main: fmtCur(e.originalAmount, c), sub: `≈ ${fmt(e.amount)}`, num: e.originalAmount, fmt: (n: number) => fmtCur(n, c) };
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
/** Yorliq uchun valyuta nomi: so'm / сум / $ / €. */
const curName = (c: Cur) => (c === "UZS" ? (isRu() ? "сум" : "so'm") : SIGN[c]);

export function MoneyField({ amount, currency, onAmount, onCurrency, label, autoFocus, className, side = "sell", testId = "money-amount" }: {
  amount: string; currency: Cur; onAmount: (v: string) => void; onCurrency: (c: Cur) => void; label: string; autoFocus?: boolean; className: string; testId?: string;
  /** kirim — bank sotib olish kursi (buy), chiqim — sotish kursi (sell); server ham shunday hisoblaydi */
  side?: "buy" | "sell";
}) {
  const [, force] = useState(0);
  useEffect(() => { if (currency !== "UZS") void fetchLiveCurrencyRates().then(() => force((x) => x + 1)); }, [currency]);
  const n = parseMoney(amount);
  const kb = currency === "UZS" ? undefined : LIVE_KAPITAL?.[currency];
  const custom = LIVE_RATE_SOURCE === "company";
  const rate = currency === "UZS" ? 1 : (!custom && kb ? kb[side] : currency === "USD" ? LIVE_USD_RATE : LIVE_EUR_RATE);
  return (
    <div>
      {/* Yorliqda TANLANGAN valyuta turadi (owner 2026-10-28: "dollarda yozyapman,
          lekin so'm deb ko'rinyapti") — ilgari matnga "(so'm)" qotirib yozilgandi. */}
      <span className="text-xs font-semibold text-muted-foreground">
        {label} <span className="text-foreground">({curName(currency)})</span>
      </span>
      <div className="flex gap-2 mt-1">
        <MoneyInput autoFocus={autoFocus} value={amount} currency={currency} placeholder="0" data-testid={testId}
          onChange={onAmount} className={`${className} flex-1 min-w-0 tabular-nums`} />
        <div className="flex p-1 rounded-xl bg-muted flex-shrink-0" role="radiogroup" aria-label="Valyuta">
          {(["UZS", "USD"] as Cur[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={currency === c} data-testid={`money-cur-${c}`} onClick={() => { onCurrency(c); onAmount(formatMoneyInput(amount, c)); }}
              /* Kattaroq va aniq ajralib turadi (owner 2026-10-28: "dollar ikonasi kichkina,
                 tanlash qiyin; tugma bilinmaydi, ranglari uyushib ketgan") */
              className={`h-12 min-w-[3.5rem] px-3 rounded-lg text-base font-bold liquid-transition ${currency === c ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground"}`}>
              {c === "UZS" ? (isRu() ? "сум" : "so'm") : SIGN[c]}
            </button>
          ))}
        </div>
      </div>
      {currency !== "UZS" && n > 0 && (
        <p className="text-xs text-muted-foreground mt-1.5" data-testid="money-preview">
          ≈ <b className="text-foreground">{fmt(Math.round(n * rate))}</b> · {isRu() ? "курс" : "kurs"} 1 {SIGN[currency]} = {fmtNumber(rate)} {isRu() ? "сум" : "so'm"}{!custom && kb ? ` · Kapitalbank (${side === "buy" ? (isRu() ? "покупка" : "sotib olish") : (isRu() ? "продажа" : "sotish")})` : ""}
        </p>
      )}
    </div>
  );
}

/** Kiritilgan summa ("1.250.000", "12,5") → son. */
export const parseAmount = (s: string) => parseMoney(s);

/** Tanlangan valyutadagi summani so'mga o'giradi (server kurs qo'llamaydigan maydonlar uchun). */
export function toUzs(amount: string | number, currency: Cur, side: "buy" | "sell" = "sell"): number {
  const n = typeof amount === "number" ? amount : parseMoney(amount);
  if (!n || currency === "UZS") return Math.round(n || 0);
  const kb = LIVE_KAPITAL?.[currency];
  const rate = LIVE_RATE_SOURCE !== "company" && kb ? kb[side] : currency === "USD" ? LIVE_USD_RATE : LIVE_EUR_RATE;
  return Math.round(n * rate);
}

/** Narx kiritish + valyuta tanlash (owner 2026-10-26: "har qanday narx kiritadigan joyga valyuta tanlash").
 *  Tashqariga DOIM so'mdagi qiymat beriladi — shu sababli hech bir forma/serverni o'zgartirmasdan ishlaydi.
 *  Sarlavha (label) joyida qoladi: bu faqat maydonning o'zi. */
export function PriceField({ value, onChange, className, placeholder, side = "sell", testId, autoFocus, required, disabled, wrapClassName = "" }: {
  value: string; onChange: (uzs: string) => void; className: string; placeholder?: string;
  side?: "buy" | "sell"; testId?: string; autoFocus?: boolean; required?: boolean; disabled?: boolean;
  /** tashqi o'ramga sinf (masalan flex qatorda kenglik) */
  wrapClassName?: string;
}) {
  const [cur, setCur] = useState<Cur>("UZS");
  const [text, setText] = useState(value);
  const [, force] = useState(0);
  // So'mda kiritilayotganda tashqi qiymat bilan sinxron; valyutada — matn o'zimizda qoladi
  useEffect(() => { if (cur === "UZS") setText(value); }, [value, cur]);
  useEffect(() => { if (cur !== "UZS") void fetchLiveCurrencyRates().then(() => force((x) => x + 1)); }, [cur]);
  const put = (t: string, c: Cur) => { setText(t); onChange(c === "UZS" ? t : String(toUzs(t, c, side) || "")); };
  const n = parseMoney(text);
  const kb = cur === "UZS" ? undefined : LIVE_KAPITAL?.[cur];
  const rate = cur === "UZS" ? 1 : (LIVE_RATE_SOURCE !== "company" && kb ? kb[side] : cur === "USD" ? LIVE_USD_RATE : LIVE_EUR_RATE);
  return (
    <div className={wrapClassName}>
      <div className="flex gap-1.5">
        <MoneyInput autoFocus={autoFocus} required={required} disabled={disabled} value={text} currency={cur}
          placeholder={placeholder ?? "0"} data-testid={testId} onChange={(v) => put(v, cur)}
          className={`${className} flex-1 min-w-0 tabular-nums`} />
        <div className="flex p-0.5 rounded-lg bg-muted flex-shrink-0" role="radiogroup" aria-label="Valyuta">
          {(["UZS", "USD"] as Cur[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cur === c} disabled={disabled} data-testid={`cur-${c}`}
              onClick={() => { const t = formatMoneyInput(text, c); setCur(c); put(t, c); }}
              className={`px-3 min-w-[44px] min-h-[40px] rounded-md text-sm font-bold liquid-transition ${cur === c ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
              {c === "UZS" ? (isRu() ? "сум" : "so'm") : SIGN[c]}
            </button>
          ))}
        </div>
      </div>
      {cur !== "UZS" && n > 0 && (
        <p className="text-[11px] text-muted-foreground mt-1" data-testid="price-preview">
          ≈ <b className="text-foreground">{fmt(Math.round(n * rate))}</b> · 1 {SIGN[cur]} = {fmtNumber(rate)} {isRu() ? "сум" : "so'm"}
        </p>
      )}
    </div>
  );
}
