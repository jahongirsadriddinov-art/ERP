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
//
// 2026-11-05: har bir qurilma turi (Android/Windows/macOS) ENDI MUSTAQIL
// chiqariladi (owner: "notebook ga alohida apk alohida exe alohida mac os
// ga alohida ... hammasiga alohida qil") — bittasini chiqarish boshqasiga
// tegmaydi, har biri o'z "Chiqarish" tugmasiga ega.
type Platform = "android" | "windows" | "macos";
type Build = {
  id: string; version: string; notes: string;
  apkUrl: string | null; exeUrl: string | null; dmgUrl: string | null;
  createdAt: string;
  apkPublishedAt: string | null; exePublishedAt: string | null; dmgPublishedAt: string | null;
  isCurrentAndroid: boolean; isCurrentWindows: boolean; isCurrentMacos: boolean;
};
type PlatformCurrent = { version: string; updatedAt: string } | null;
type Res = { current: { android: PlatformCurrent; windows: PlatformCurrent; macos: PlatformCurrent }; builds: Build[] };

const PLATFORMS: { key: Platform; label: string; urlKey: "apkUrl" | "exeUrl" | "dmgUrl"; publishedKey: "apkPublishedAt" | "exePublishedAt" | "dmgPublishedAt"; isCurrentKey: "isCurrentAndroid" | "isCurrentWindows" | "isCurrentMacos" }[] = [
  { key: "android", label: "Android (APK)", urlKey: "apkUrl", publishedKey: "apkPublishedAt", isCurrentKey: "isCurrentAndroid" },
  { key: "windows", label: "Windows (EXE)", urlKey: "exeUrl", publishedKey: "exePublishedAt", isCurrentKey: "isCurrentWindows" },
  { key: "macos", label: "macOS (DMG)", urlKey: "dmgUrl", publishedKey: "dmgPublishedAt", isCurrentKey: "isCurrentMacos" },
];

const when = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function AppBuildsPanel() {
  const [data, setData] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null); // `${buildId}:${platform}`
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/dev/app-builds`, { cache: "no-store" });
      setData(await r.json());
    } catch { setMsg("Ro'yxatni olib bo'lmadi"); } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const publish = async (b: Build, platform: Platform, label: string) => {
    const k = `${b.id}:${platform}`;
    setPublishing(k); setMsg("");
    try {
      const r = await fetch(`${API_BASE}/api/dev/app-builds/${b.id}/publish/${platform}`, { method: "POST" });
      const j = await r.json().catch(() => null);
      setMsg(r.ok ? `✅ ${label}: ${b.version} chiqarildi`
                  : `❌ ${label}: ${j?.error || "Chiqarib bo'lmadi"}`);
      if (r.ok) await load();
    } catch { setMsg("❌ Server bilan aloqa yo'q"); } finally { setPublishing(null); }
  };

  if (!data) return <SkeletonList items={3} />;

  return (
    <div className="space-y-3 max-w-3xl mx-auto w-full" data-testid="dev-app-builds">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm space-y-0.5">
          {PLATFORMS.map((p) => (
            <p key={p.key}>
              {p.label}: <b className="font-mono">{data.current[p.key]?.version || "—"}</b>
            </p>
          ))}
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} aria-label="Yangilash"
          className="w-9 h-9 rounded-full flex items-center justify-center bg-muted/50 hover:bg-muted text-muted-foreground disabled:opacity-50 flex-shrink-0">
          <MorphIcon icon={RefreshCw} className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
      {msg && <p className="text-xs">{msg}</p>}
      <p className="text-[11px] text-muted-foreground">
        CI har push'da ilovani quradi, lekin foydalanuvchiga yubormaydi. Har bir qurilma turini
        (Android/Windows/macOS) ALOHIDA — xohlagan paytda, bittasini chiqarib boshqasiga tegmasdan.
      </p>

      {data.builds.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Hali build yo'q</p>
      ) : data.builds.map((b) => (
        <div key={b.id} className="surface rounded-2xl p-4 flex flex-col gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold font-mono truncate">{b.version}</p>
            <p className="text-[11px] text-muted-foreground">{when(b.createdAt)}</p>
            {b.notes && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{b.notes}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => {
              const url = b[p.urlKey];
              const isCurrent = b[p.isCurrentKey];
              const publishedAt = b[p.publishedKey];
              const k = `${b.id}:${p.key}`;
              if (!url) {
                return (
                  <div key={p.key} className="text-[11px] text-muted-foreground px-3 py-2 rounded-xl bg-muted/30 flex-shrink-0">
                    {p.label}: fayl yo'q
                  </div>
                );
              }
              return (
                <button key={p.key} type="button" disabled={isCurrent || publishing === k}
                  onClick={() => void publish(b, p.key, p.label)}
                  title={publishedAt ? `oxirgi chiqarilgan: ${when(publishedAt)}` : undefined}
                  className="flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 liquid-transition flex-shrink-0">
                  <MorphIcon icon={Upload} className={`w-4 h-4 ${publishing === k ? "animate-pulse" : ""}`} />
                  {isCurrent ? `${p.label}: chiqarilgan` : publishing === k ? "Chiqarilmoqda…" : `${p.label}: Chiqarish`}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
