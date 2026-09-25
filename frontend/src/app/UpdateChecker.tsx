import { useEffect, useState } from "react";
import Download from "@hugeicons/core-free-icons/Download04Icon";
import Sparkles from "@hugeicons/core-free-icons/SparklesIcon";
import { MorphIcon } from "morphicons/react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";
import { isNative, isAndroid, isTauri, openExternalUrl } from "./platform";

type Phase = "idle" | "downloading" | "installing" | "permission" | "error";

// Faqat o'rnatilgan ilovalarda (Windows exe / Android APK) ma'noli — veb sayt har safar
// ochilganda eng yangi kodni o'zi oladi (Vercel). Yangi versiya chiqsa ilova o'zi so'raydi
// ("Yangilashni xohlaysizmi?"), "Yangilash" bosilsa yangi o'rnatuvchini internetdan o'zi
// yuklab oladi va o'rnatishni boshlaydi:
//   - Windows (Tauri): src-tauri/src/lib.rs `download_and_install_update` — yuklab, passive
//     rejimda o'rnatadi va ilovani o'zi qayta ochadi.
//   - Android (Capacitor): AppUpdaterPlugin.java — APK'ni yuklaydi va tizim o'rnatuvchisini
//     ochadi (Android sukut ostida o'rnatishga ruxsat bermaydi — bitta "O'rnatish" bosiladi).
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export default function UpdateChecker() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<{ version: string; notes?: string; url?: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!isNative()) return;
    const check = () => {
      fetch(`${API_BASE}/api/deploy/latest`).then(r => r.ok ? r.json() : null).then(d => {
        if (!d?.available || !d.version) return;
        const url = isAndroid() ? d.apkUrl : isTauri() ? d.exeUrl : undefined;
        if (!url) return; // shu platforma uchun build yo'q (masalan iOS)
        // Aynan shu versiya o'rnatilgan bo'lsa (CI build'i) — qayta taklif qilinmaydi.
        if (d.version !== __APP_VERSION__ && compareVersions(d.version, __APP_VERSION__) >= 0) {
          setInfo(prev => (prev?.version === d.version ? prev : { version: d.version, notes: d.notes, url }));
        }
      }).catch(() => {});
    };
    check();
    // Har 30 daqiqada va ilova fondan qaytganda ham qayta tekshiriladi.
    const interval = setInterval(check, 30 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const startUpdate = async () => {
    if (!info?.url) return;
    setPhase("downloading"); setPercent(0);
    const onProgress = (p: { downloaded: number; total: number }) =>
      setPercent(p.total > 0 ? Math.min(100, Math.round((p.downloaded * 100) / p.total)) : 0);
    try {
      if (isTauri()) {
        const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
        const unlisten = await listen<{ downloaded: number; total: number }>("update-progress", e => onProgress(e.payload));
        try {
          await invoke("download_and_install_update", { url: info.url });
          setPhase("installing"); // ilova o'zi yopiladi va o'rnatuvchi ishga tushadi
        } finally { unlisten(); }
      } else if (isAndroid()) {
        const { registerPlugin } = await import("@capacitor/core");
        const AppUpdater = registerPlugin<any>("AppUpdater");
        const handle = await AppUpdater.addListener("progress", onProgress);
        try { await AppUpdater.download({ url: info.url }); } finally { handle.remove(); }
        setPhase("installing");
        await AppUpdater.install();
        setPhase("idle");
      }
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (msg.includes("PERMISSION")) setPhase("permission");
      else { console.error("[update]", e); setPhase("error"); }
    }
  };

  if (!info) return null;
  const busy = phase === "downloading" || phase === "installing";

  return (
    <AnimatePresence>
      {!dismissed ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="bg-card rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-primary/25"
              style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }}>
              <MorphIcon icon={Sparkles} className="w-7 h-7 text-white" />
            </div>
            <div className="text-center">
              <p className="font-bold text-foreground">{t('update.title')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('update.versionLabel', { version: info.version })}</p>
            </div>
            {info.notes && phase === "idle" && (
              <div className="bg-muted/50 rounded-2xl p-3.5 max-h-40 overflow-y-auto">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{t('update.whatsNew')}</p>
                <p className="text-xs text-foreground/80 whitespace-pre-line leading-relaxed">{info.notes}</p>
              </div>
            )}

            {phase === "idle" && <p className="text-sm text-center text-foreground/80">{t('update.question')}</p>}

            {busy && (
              <div className="space-y-2">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${phase === "installing" ? 100 : percent}%`, background: "linear-gradient(90deg, var(--primary), var(--accent))" }} />
                </div>
                <p className="text-xs text-center text-muted-foreground">
                  {phase === "installing" ? t('update.installing') : t('update.downloading', { percent })}
                </p>
              </div>
            )}
            {phase === "permission" && <p className="text-xs text-center text-amber-600 dark:text-amber-400 leading-relaxed">{t('update.permissionNeeded')}</p>}
            {phase === "error" && (
              <p className="text-xs text-center text-red-600 dark:text-red-400 leading-relaxed">
                {t('update.failed')}{" "}
                <button className="underline font-semibold" onClick={() => openExternalUrl(info.url!)}>{t('update.openManually')}</button>
              </p>
            )}

            {!busy && (
              <div className="flex gap-2">
                <button onClick={() => { setDismissed(true); setPhase("idle"); }}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold border border-border/60 text-muted-foreground hover:bg-muted">
                  {t('update.later')}
                </button>
                <button onClick={startUpdate}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-bold text-white shadow-lg shadow-primary/25"
                  style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }}>
                  <MorphIcon icon={Download} className="w-4 h-4" /> {phase === "idle" ? t('update.updateNow') : t('update.retry')}
                </button>
              </div>
            )}
            {phase === "idle" && isAndroid() && <p className="text-[10px] text-muted-foreground text-center leading-relaxed">{t('update.installHintAndroid')}</p>}
          </motion.div>
        </motion.div>
      ) : (
        <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
          onClick={() => setDismissed(false)}
          className="fixed bottom-20 right-4 z-[90] flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold text-white shadow-lg"
          style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }}>
          <MorphIcon icon={Sparkles} className="w-3.5 h-3.5" /> {t('update.badge')}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
