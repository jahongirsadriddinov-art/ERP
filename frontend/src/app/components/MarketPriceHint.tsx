import { useEffect, useState } from "react";
import { API_BASE } from "../api";
import { fmtNumber } from "../lib/money";

// Narx razvedkasi ko'rsatkichi (owner 2026-10-29: "prorab qimmatga olib qo'ysa
// ogohlantirsin; qimmatligini O'zbekiston bo'yicha o'rtacha narxdan biladi").
//
// FAQAT BIRLIK NARXI bilan ishlaydi. Birliksiz narxni (masalan "sementga 2 mln
// sarfladim") bozor narxi bilan solishtirib bo'lmaydi — shuning uchun unit bo'sh
// bo'lsa hech nima ko'rsatilmaydi. Noto'g'ri ogohlantirish — ogohlantirmaslikdan yomon.
//
// Ma'lumot yetarli bo'lmasa ham jim turadi: server kamida bir nechta turli firmadan
// kuzatuv bo'lmasa xulosa bermaydi.

type Res = {
  found: boolean;
  name?: string; unit?: string;
  median?: number; low?: number; high?: number;
  points?: number; companies?: number;
  diffPct?: number; expensive?: boolean;
};

export function MarketPriceHint({ name, unit, price }: { name: string; unit: string; price: number }) {
  const [res, setRes] = useState<Res | null>(null);

  useEffect(() => {
    const n = (name || "").trim();
    const u = (unit || "").trim();
    if (n.length < 2 || !u || !(price > 0)) { setRes(null); return; }
    let alive = true;
    // Har bosilgan harfda so'rov ketmasin
    const t = setTimeout(() => {
      fetch(`${API_BASE}/api/market-price?q=${encodeURIComponent(n)}&unit=${encodeURIComponent(u)}&price=${price}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setRes(d && d.found ? d : null); })
        .catch(() => { if (alive) setRes(null); });
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [name, unit, price]);

  if (!res || typeof res.median !== "number" || typeof res.diffPct !== "number") return null;

  const pct = res.diffPct;
  const expensive = !!res.expensive;
  const cheap = pct <= -10;
  // Bozor darajasidagi narx — ortiqcha shovqin qilmaymiz
  if (!expensive && !cheap) return null;

  return (
    <p
      data-testid="market-price-hint"
      className={`text-[11px] mt-1 leading-snug ${expensive ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}
    >
      {expensive ? "⚠️ " : "✓ "}
      Bozor narxi: <b>{fmtNumber(res.median)}</b> so'm/{res.unit}
      {" — "}
      {expensive ? `siz ${pct}% qimmat olyapsiz` : `siz ${Math.abs(pct)}% arzon olyapsiz`}
      <span className="text-muted-foreground"> ({res.companies} firma)</span>
    </p>
  );
}
