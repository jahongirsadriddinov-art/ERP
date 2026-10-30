import { useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import { API_BASE } from "./api";
import { fmtNumber } from "./lib/money";

// Bozor narxi qidiruvi (owner 2026-10-29: "hohlagan narsasini yozadi, uni global
// O'zbekiston bo'yicha qidiradi va o'rtacha narxini ko'rsatadi").
//
// Javob TAYYOR INDEKSDAN keladi — so'rov paytida hech qayerga chiqilmaydi, shuning
// uchun natija bir zumda chiqadi. Indeks firmalarning haqiqiy xaridlaridan va narx
// e'lon qiladigan ochiq Telegram kanallaridan to'ladi; kim qayerdan olgani
// ko'rinmaydi, faqat yig'ma ko'rsatkich.

const UNITS = ["", "qop", "kg", "t", "dona", "m2", "m3", "m", "l", "rulon"];

type Res = {
  found: boolean; query: string;
  name?: string; unit?: string;
  median?: number; low?: number; high?: number;
  points?: number; companies?: number; updatedAt?: string;
};

export default function MarketPricePanel({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setRes(null); return; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      fetch(`${API_BASE}/api/market-price?q=${encodeURIComponent(s)}${unit ? `&unit=${encodeURIComponent(unit)}` : ""}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setRes(d); })
        .catch(() => { if (alive) setRes(null); })
        .finally(() => { if (alive) setBusy(false); });
    }, 450);
    return () => { alive = false; clearTimeout(t); };
  }, [q, unit]);

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm max-h-[88vh] supports-[height:1dvh]:max-h-[88dvh] overflow-y-auto"
        data-testid="market-price-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
          <div>
            <h3 className="font-bold text-sm">Bozor narxi</h3>
            <p className="text-[11px] text-muted-foreground">O'zbekiston bo'yicha o'rtacha</p>
          </div>
          <button aria-label="Yopish" onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted liquid-transition">
            <MorphIcon icon={X} className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Owner 2026-10-30: "inputda yozadigan juda kichkina, o'qishga qiyin" —
              maydon ham, matn ham kattalashtirildi (telefonda 16px dan kichik matn
              iOS'da sahifani o'zi kattalashtirib yuboradi, shuning uchun ham foydali). */}
          <label className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3.5 h-14">
            <MorphIcon icon={Search} className="w-5 h-5 flex-shrink-0 opacity-60" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} data-testid="market-price-query"
              placeholder="Masalan: sement M400" className="bg-transparent outline-none text-base w-full placeholder:text-muted-foreground/70" />
          </label>

          <div className="flex gap-1.5 flex-wrap">
            {UNITS.map((u) => (
              <button key={u || "all"} type="button" onClick={() => setUnit(u)}
                className={`text-[13px] px-3 py-1.5 rounded-full border liquid-transition ${unit === u ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {u || "hammasi"}
              </button>
            ))}
          </div>

          {q.trim().length >= 2 && (
            busy && !res ? <p className="text-[12px] text-muted-foreground py-2">Qidirilmoqda…</p>
            : res?.found ? (
              <div className="rounded-xl bg-primary/5 border border-primary/15 px-3 py-3">
                <p className="text-[12px] text-muted-foreground">{res.name}</p>
                <p className="text-2xl font-bold text-primary mt-0.5">
                  {fmtNumber(res.median!)} <span className="text-sm font-semibold text-muted-foreground">so'm/{res.unit}</span>
                </p>
                <p className="text-[12px] text-muted-foreground mt-1">
                  Odatda {fmtNumber(res.low!)} – {fmtNumber(res.high!)} so'm
                </p>
                <p className="text-[11px] text-muted-foreground mt-2">
                  {res.points} ta kuzatuv · {res.companies} ta manba
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-muted/40 px-3 py-3">
                <p className="text-[12px] text-muted-foreground">
                  Bu material bo'yicha hali yetarli ma'lumot yo'q.
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Narxlar xaridlar va ochiq e'lonlardan to'planadi — ko'proq xarid kiritilgani sari aniqroq bo'ladi.
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
