import { useEffect, useState } from "react";
import { Smartphone, Laptop, Download, Loader2, ShieldCheck } from "lucide-react";
import { API_BASE } from "./api";
import { openExternalUrl } from "./platform";

interface LatestRelease {
  available: boolean;
  version?: string;
  notes?: string;
  apkUrl?: string | null;
  exeUrl?: string | null;
  updatedAt?: string;
}

// GET /api/deploy/latest — hammaga ochiq (login shart emas, landing page
// mehmon uchun ham ishlaydi). CI har safar yangi versiya chiqarganda
// avtomatik yangilanadi (backend/src/routes/deploy.ts).
export function useLatestRelease(): LatestRelease | null | undefined {
  const [release, setRelease] = useState<LatestRelease | null | undefined>(undefined);
  useEffect(() => {
    fetch(`${API_BASE}/api/deploy/latest`)
      .then(r => (r.ok ? r.json() : null))
      .then(setRelease)
      .catch(() => setRelease(null));
  }, []);
  return release;
}

// Landing page (mehmonlar uchun, kattaroq) va Profil (allaqachon login
// qilganlar uchun, ixcham) ikkalasida ham ISHLATILADIGAN bitta umumiy
// komponent — versiya/havolalar ikki joyda alohida-alohida yozilib,
// keyinchalik bir-biridan chetlab ketmasin uchun.
export function AppDownloadCards({ compact, title, loadingFallback = true }: { compact?: boolean; title?: string; loadingFallback?: boolean }) {
  const release = useLatestRelease();

  if (release === undefined) {
    if (!loadingFallback) return null;
    return (
      <div className={compact ? "flex items-center justify-center py-6" : "flex items-center justify-center py-10"}>
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // Hali CI birorta ham APK/exe chiqarmagan bo'lsa — HECH NARSA (sarlavha
  // ham) ko'rsatilmaydi, bo'sh bo'lim chiqib qolmasin.
  if (!release || !release.available || (!release.apkUrl && !release.exeUrl)) return null;

  const items = [
    release.apkUrl ? { icon: Smartphone, label: "Android (APK)", hint: "Telefon/planshet uchun", url: release.apkUrl } : null,
    release.exeUrl ? { icon: Laptop, label: "Windows dasturi", hint: "Kompyuter uchun (.exe)", url: release.exeUrl } : null,
  ].filter(Boolean) as { icon: typeof Smartphone; label: string; hint: string; url: string }[];

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {title && <p className="text-sm font-semibold">{title}</p>}
      <div className={`grid ${items.length > 1 ? "sm:grid-cols-2" : ""} gap-3`}>
        {items.map(item => (
          <button key={item.label} onClick={() => openExternalUrl(item.url)}
            className={`surface rounded-2xl flex items-center gap-3 text-left hover:-translate-y-0.5 liquid-transition ${compact ? "p-3" : "p-4"}`}>
            <div className={`rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 ${compact ? "w-10 h-10" : "w-12 h-12"}`}>
              <item.icon className={compact ? "w-5 h-5" : "w-6 h-6"} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-bold ${compact ? "text-sm" : "text-base"}`}>{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.hint}</p>
            </div>
            <Download className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground px-1">
        <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" />Fayl to'g'ridan-to'g'ri bizning serverimizdan (Cloudinary orqali) keladi</span>
        {release.version && <span className="font-mono flex-shrink-0">v{release.version}</span>}
      </div>
    </div>
  );
}
