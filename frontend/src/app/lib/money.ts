// Pul summalari (owner 2026-10-23): kiritishda va ko'rsatishda minglar NUQTA bilan ajratiladi — 1000 → "1.000",
// 1250000 → "1.250.000". Kasr qismi (faqat $/€) — VERGUL bilan: "12,5". So'mda kasr yo'q.

export type MoneyCur = "UZS" | "USD" | "EUR";

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Son → "1.250.000" (kasr bo'lsa — "12,5", 2 xonagacha). */
export function fmtNumber(n: number | null | undefined, maxFrac = 2): string {
  const v = Number(n) || 0;
  const neg = v < 0;
  const p = 10 ** maxFrac;
  const r = Math.round(Math.abs(v) * p) / p;
  const [i, f] = String(r.toFixed(maxFrac)).split(".");
  const frac = (f || "").replace(/0+$/, "");
  return (neg ? "-" : "") + group(i) + (frac ? "," + frac : "");
}

/**
 * Kiritilayotgan matnni formatlash: faqat raqamlar, minglar nuqta bilan. $/€ uchun kasr vergul bilan
 * (oxirida yozilgan "." ham kasr belgisi deb olinadi — telefon klaviaturasida vergul bo'lmasligi mumkin).
 */
export function formatMoneyInput(raw: string, cur: MoneyCur = "UZS", opts: { dotDecimal?: boolean } = {}): string {
  const s = String(raw ?? "").replace(/[\s '’]/g, "");
  if (!s) return "";
  let intPart = s, frac: string | null = null;
  const comma = s.lastIndexOf(",");
  if (comma >= 0) { intPart = s.slice(0, comma); frac = s.slice(comma + 1); }
  else if (cur !== "UZS" && opts.dotDecimal !== false) {
    // $/€: "12.5", "12.", "1250.50" (qo'yilgan/eski qiymat) — yagona nuqta va 0–2 raqam: bu kasr, minglar guruhi emas.
    // So'mda nuqta doim minglar ajratgichi.
    const m = s.match(/^([^.]*)\.(\d{0,2})$/);
    if (m) { intPart = m[1]; frac = m[2]; }
  }
  const digits = intPart.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (cur === "UZS" || frac === null) return group(digits);
  return (group(digits) || "0") + "," + frac.replace(/\D/g, "").slice(0, 2);
}

/** "1.250.000" → 1250000; "12,5" → 12.5; eski "12.5"/"150000" ham to'g'ri o'qiladi. */
export function parseMoney(s: string | number | null | undefined): number {
  if (typeof s === "number") return Number.isFinite(s) ? s : 0;
  const t = String(s ?? "").trim().replace(/[\s '’]/g, "");
  if (!t) return 0;
  const comma = t.lastIndexOf(",");
  if (comma >= 0) {
    const i = t.slice(0, comma).replace(/\D/g, "") || "0";
    const f = t.slice(comma + 1).replace(/\D/g, "");
    return Number(`${i}.${f || "0"}`) || 0;
  }
  if (/^\d+\.\d{1,2}$/.test(t)) return Number(t) || 0;
  return Number(t.replace(/\D/g, "")) || 0;
}

/** Son → kiritish maydonidagi ko'rinish (tahrirlash oynasini ochganda). */
export function amountToInput(n: number | null | undefined, cur: MoneyCur = "UZS"): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  return cur === "UZS" ? group(String(Math.round(v))) : fmtNumber(v);
}

/** Kursor o'rni: formatlashdan oldingi matnda kursorgacha nechta "ma'noli" belgi (raqam/vergul) bo'lsa — keyin ham shuncha. */
export function caretAfterFormat(raw: string, caret: number, formatted: string): number {
  const before = raw.slice(0, caret);
  let sig = (before.match(/\d/g) || []).length;
  // kasr vergul kursordan oldin bo'lsa (komponent yozilgan "." ni oldindan "," ga almashtiradi)
  if (formatted.includes(",") && before.includes(",")) sig += 1;
  // olib tashlangan bosh nollar
  const lead = (raw.match(/^[\s.]*0+(?=\d)/) || [""])[0].replace(/[^0]/g, "").length;
  sig = Math.max(0, sig - Math.min(lead, (before.match(/\d/g) || []).length));
  if (sig === 0) return 0;
  let n = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[\d,]/.test(formatted[i])) n++;
    if (n === sig) return i + 1;
  }
  return formatted.length;
}
