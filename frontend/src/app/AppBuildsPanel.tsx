import { useCallback, useEffect, useState } from "react";
import { MorphIcon } from "morphicons/react";
import RefreshCw from "@hugeicons/core-free-icons/Refresh01Icon";
import Upload from "@hugeicons/core-free-icons/CloudUploadIcon";
import { API_BASE } from "./api";
import { SkeletonList } from "./Skeleton";

// Ilova yangilanishini QO'LDA chiqarish (owner 2026-10-28: "har bitta push bo'lgan
// yangilanish admin panelga ko'rinadi va bittasini tanlab yuboraman").
// CI qurgan build'lar bu yerda turadi; "Chiqarish" bosilgandagina foydalanuvchilar
// ilovasida yangilanish paydo bo'ladi.
type Build = {
  id: string; version: string; notes: string;
  apkUrl: string | null; exeUrl: string | null;
  createdAt: string; publishedAt: string | null; isCurrent: boolean;
};
type Res = { current: { version: string; updatedAt: string } | null; builds: Build[] };

const when = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function AppBuildsPanel() {
  const [data, setData] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/dev/app-builds`, { cache: "no-store" });
      setData(await r.json());
    } catch { setMsg("Ro'yxatni olib bo'lmadi"); } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const publish = async (b: Build) => {
    setPublishing(b.id); setMsg("");
    try {
      const r = await fetch(`${API_BASE}/api/dev/app-builds/${b.id}/publish`, { method: "POST" });
      const j = await r.json().catch(() => null);
      setMsg(r.ok ? `✅ ${b.version} chiqarildi — ilovalar shu versiyani ko'radi`
                  : `❌ ${j?.error || "Chiqarib bo'lmadi"}`);
      if (r.ok) await load();
    } catch { setMsg("❌ Server bilan aloqa yo'q"); } finally { setPublishing(null); }
  };

  if (!data) return <SkeletonList items={3} />;

  return (
    <div className="space-y-3 max-w-3xl mx-auto w-full" data-testid="dev-app-builds">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">
          Hozir chiqarilgan: <b className="font-mono">{data.current?.version || "—"}</b>
        </p>
        <button type="button" onClick={() => void load()} disabled={busy} aria-label="Yangilash"
          className="w-9 h-9 rounded-full flex items-center justify-center bg-muted/50 hover:bg-muted text-muted-foreground disabled:opacity-50">
          <MorphIcon icon={RefreshCw} className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
      {msg && <p className="text-xs">{msg}</p>}
      <p className="text-[11px] text-muted-foreground">
        CI har push'da ilovani quradi, lekin foydalanuvchiga yubormaydi. Qaysi versiyani
        chiqarishni shu yerdan o'zingiz tanlaysiz.
      </p>

      {data.builds.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Hali build yo'q</p>
      ) : data.builds.map((b) => (
        <div key={b.id} className="surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold font-mono truncate">
              {b.version}
              {b.isCurrent && <span className="ml-2 text-[10px] font-sans font-bold text-emerald-600 dark:text-emerald-400">CHIQARILGAN</span>}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {when(b.createdAt)} · {[b.apkUrl && "APK", b.exeUrl && "EXE"].filter(Boolean).join(" + ") || "fayl yo'q"}
              {b.publishedAt ? ` · chiqarilgan ${when(b.publishedAt)}` : ""}
            </p>
            {b.notes && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{b.notes}</p>}
          </div>
          <button type="button" disabled={b.isCurrent || publishing === b.id} onClick={() => void publish(b)}
            className="flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl px-4 py-2.5 bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 liquid-transition flex-shrink-0">
            <MorphIcon icon={Upload} className={`w-4 h-4 ${publishing === b.id ? "animate-pulse" : ""}`} />
            {b.isCurrent ? "Chiqarilgan" : publishing === b.id ? "Chiqarilmoqda…" : "Chiqarish"}
          </button>
        </div>
      ))}
    </div>
  );
}
