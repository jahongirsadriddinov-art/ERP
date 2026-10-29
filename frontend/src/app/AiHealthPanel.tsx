import { useCallback, useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import RefreshCw from "@hugeicons/core-free-icons/Refresh01Icon";
import { API_BASE } from "./api";

// "AI nega javob bermayapti?" — logsiz aniqlash uchun (owner 2026-10-29).
// Tekshirish tugmasi bosilganda serverda HAQIQIY savol yuboriladi: foydalanuvchi
// yozganda nima bo'lsa, xuddi o'sha yo'l. Shuning uchun o'zi yuklanmaydi.
type Provider = { name: string; env: string; keys: number; cooling: number };
type Res = {
  enabled: boolean;
  providers: Provider[];
  tgWorker: { connected: boolean; lastSeenAt: string | null; status: string | null; health: string | null };
  test: { ok: boolean; ms: number; reply?: string; error?: string };
};

const when = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function AiHealthPanel() {
  const [data, setData] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const check = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API_BASE}/api/dev/ai-health`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || "Tekshirib bo'lmadi"); return; }
      setData(j);
    } catch { setErr("Tarmoq xatosi"); } finally { setBusy(false); }
  }, []);

  useEffect(() => { /* o'zi yuklanmaydi — har tekshiruv AI'ga haqiqiy so'rov */ }, []);

  return (
    <div className="surface rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold">AI holati</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            AI javob bermasa shu yerdan sababini ko'ring: kalitlar, Telegram qo'ng'iroq xizmati va jonli sinov.
          </p>
        </div>
        <button onClick={() => void check()} disabled={busy}
          className="flex-shrink-0 h-9 px-3 rounded-xl bg-primary text-white text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-60">
          <MorphIcon icon={RefreshCw} className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Tekshirilmoqda…" : "Tekshirish"}
        </button>
      </div>

      {err ? <p className="text-[12px] text-red-600 dark:text-red-400">{err}</p> : null}

      {data && (
        <div className="space-y-3">
          <div className={`rounded-xl px-3 py-2.5 ${data.test.ok ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
            <p className={`text-[12px] font-bold ${data.test.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
              {data.test.ok ? `✅ AI javob berdi (${(data.test.ms / 1000).toFixed(1)} s)` : "❌ AI javob bermadi"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 break-words">
              {data.test.ok ? data.test.reply : data.test.error}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">API kalitlar</p>
            {data.providers.map((p) => (
              <div key={p.env} className="flex items-center justify-between py-1.5 border-b border-border/60 last:border-0">
                <span className="text-[12px] font-semibold">{p.name}</span>
                <span className={`text-[11px] ${p.keys === 0 ? "text-muted-foreground" : p.cooling >= p.keys ? "text-red-600 dark:text-red-400" : p.cooling ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {p.keys === 0 ? "sozlanmagan" : `${p.keys} ta kalit${p.cooling ? ` · ${p.cooling} tasi limitda` : ""}`}
                </span>
              </div>
            ))}
          </div>

          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Telegram qo'ng'iroq xizmati</p>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[12px] font-semibold">{data.tgWorker.connected ? "Ulangan" : "Ulanmagan"}</span>
              <span className={`text-[11px] ${data.tgWorker.connected ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {[data.tgWorker.status, data.tgWorker.health, `oxirgi: ${when(data.tgWorker.lastSeenAt)}`].filter(Boolean).join(" · ")}
              </span>
            </div>
            {data.tgWorker.health && data.tgWorker.health !== "ok" && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-lg px-2.5 py-1.5 mt-1">
                Telegram akkauntga cheklov qo'yilgan (masalan PEER_FLOOD). Akkauntni telefonda ochib,
                @SpamBot → /start → apellyatsiya yuboring. Cheklov tugamaguncha AI o'zi qo'ng'iroq qila olmaydi.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
