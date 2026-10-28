import { useCallback, useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import Search from "@hugeicons/core-free-icons/Search01Icon";
import { API_BASE } from "./api";
import { SkeletonList } from "./Skeleton";

// "Ochiq muloqot" (owner 2026-10-28: "admin panelda ochiq muloqotni yoqishni qo'sh —
// firmadan, ERP dan tashqari ham hamma aytganni qilsin, lekin FAQAT tanlangan
// foydalanuvchiga"). Yoqilgan odam uchun AI mavzu chegarasidan chiqadi: istalgan
// savolga to'liq javob beradi, uzun matn/kod yozadi. Xavfsizlik qoidalari qoladi.
type Person = { id: string; name: string; phone: string; role: string; company: string; on: boolean };
type Res = { users: Person[]; enabled: Person[] };

export default function AiOpenChatPanel() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async (query: string) => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/dev/ai-open-chat?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      setData(await r.json());
    } catch { setMsg("Ro'yxatni olib bo'lmadi"); } finally { setBusy(false); }
  }, []);

  // Yozilayotganda har harfga so'rov ketmasin — 350 ms kutiladi
  useEffect(() => {
    const t = setTimeout(() => { void load(q.trim()); }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  const toggle = async (p: Person, on: boolean) => {
    setSaving(p.id); setMsg("");
    try {
      const r = await fetch(`${API_BASE}/api/dev/ai-open-chat/${p.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setMsg(j?.error || "O'zgartirib bo'lmadi"); return; }
      setMsg(on ? `✅ ${p.name} — ochiq muloqot yoqildi` : `${p.name} — o'chirildi`);
      await load(q.trim());
    } catch { setMsg("Tarmoq xatosi"); } finally { setSaving(null); }
  };

  const Row = ({ p }: { p: Person }) => (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/60 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold truncate">{p.name}</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {[p.role, p.company, p.phone].filter(Boolean).join(" · ")}
        </p>
      </div>
      <button
        onClick={() => void toggle(p, !p.on)}
        disabled={saving === p.id}
        aria-pressed={p.on}
        className={`relative w-[46px] h-[26px] rounded-full flex-shrink-0 transition-colors disabled:opacity-50 ${p.on ? "bg-emerald-500" : "bg-muted"}`}
        title={p.on ? "O'chirish" : "Yoqish"}
      >
        <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-all ${p.on ? "left-[23px]" : "left-[3px]"}`} />
      </button>
    </div>
  );

  return (
    <div className="surface rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-[13px] font-bold">Ochiq muloqot</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Yoqilgan odam bilan AI ERP va firma mavzusidan tashqari ham erkin suhbatlashadi va
          aytilgan ishni bajaradi. Boshqa xodimlarning shaxsiy ma'lumoti va ruxsatsiz amallar
          baribir taqiqlangan.
        </p>
      </div>

      {data?.enabled?.length ? (
        <div className="rounded-xl bg-emerald-500/10 px-3 py-1">
          <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 pt-2">
            Hozir yoqilgan ({data.enabled.length})
          </p>
          {data.enabled.map((p) => <Row key={p.id} p={p} />)}
        </div>
      ) : null}

      <label className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 h-10">
        <MorphIcon icon={Search} className="w-4 h-4 flex-shrink-0 opacity-60" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ism yoki telefon bo'yicha qidirish"
          className="bg-transparent outline-none text-[13px] w-full"
        />
      </label>

      {busy && !data ? <SkeletonList items={3} /> : (
        <div>
          {data?.users?.length
            ? data.users.map((p) => <Row key={p.id} p={p} />)
            : <p className="text-[12px] text-muted-foreground py-3">Hech kim topilmadi</p>}
        </div>
      )}

      {msg ? <p className="text-[12px] text-muted-foreground">{msg}</p> : null}
    </div>
  );
}
