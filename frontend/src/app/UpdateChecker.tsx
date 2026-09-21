import { useEffect, useState } from "react";
import Download from "@hugeicons/core-free-icons/Download04Icon";
import Sparkles from "@hugeicons/core-free-icons/SparklesIcon";
import { MorphIcon } from "morphicons/react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";
import { isNative, isAndroid, isTauri, openExternalUrl } from "./platform";

// Faqat o'rnatilgan ilovalarda (Windows exe / Android APK) ma'noli — veb
// sayt har safar ochilganda avtomatik eng yangi kodni oladi (Vercel), shu
// sabab bu yerda hech narsa qilinmaydi. AppRelease (backend/src/models/
// AppRelease.ts) — dasturchi bot orqali (yoki CI) yangi versiya
// yuklaganda yangilanadigan yagona yozuv; GET /api/deploy/latest shundan
// o'qiydi.
//
// MUHIM: bu haqiqiy "o'zi yuklab, o'zi o'rnatib, qayta ochadigan" avtomatik
// yangilanish EMAS — Windows/Android ikkalasi ham operatsion tizim
// xavfsizligi tufayli veb-sahifadan sukut bo'yicha o'rnatuvchini
// so'rovsiz ishga tushirishga yo'l qo'ymaydi (bu Tauri yoki bizning
// kodimizning kamchiligi emas). "Yangilash" tugmasi eng yangi fayl
// yuklab olishni boshlaydi — undan keyin foydalanuvchi uni ochishi
// (o'rnatishi) kerak. To'liq sukut ostidagi avtomatik yangilanish uchun
// alohida ish kerak bo'ladi: Windows'da rasmiy tauri-plugin-updater
// (imzo kaliti bilan), Android'da esa maxsus o'rnatish ruxsati oqimi.
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

  useEffect(() => {
    if (!isNative()) return;
    const check = () => {
      fetch(`${API_BASE}/api/deploy/latest`).then(r => r.ok ? r.json() : null).then(d => {
        if (!d?.available || !d.version) return;
        const url = isAndroid() ? d.apkUrl : isTauri() ? d.exeUrl : undefined;
        if (!url) return; // shu platforma uchun build yo'q (masalan iOS)
        if (compareVersions(d.version, __APP_VERSION__) > 0) {
          setInfo({ version: d.version, notes: d.notes, url });
        }
      }).catch(() => {});
    };
    check();
    // XATO TUZATILDI: avval FAQAT ilova ochilgan zahoti (bir marta) tekshirilardi
    // — ilova kunlab/haftalab yopilmasdan ochiq tursa (masalan Windows'da
    // doim ishlaydigan kompyuter), yangi versiya chiqqanidan keyin ham
    // foydalanuvchi buni HECH QACHON ko'rmas edi, faqat qo'lda ilovani
    // qayta ochsa bilardi. Endi har 4 soatda ham qayta tekshiriladi.
    const interval = setInterval(check, 4 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!info) return null;

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
            {info.notes && (
              <div className="bg-muted/50 rounded-2xl p-3.5 max-h-40 overflow-y-auto">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{t('update.whatsNew')}</p>
                <p className="text-xs text-foreground/80 whitespace-pre-line leading-relaxed">{info.notes}</p>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setDismissed(true)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold border border-border/60 text-muted-foreground hover:bg-muted">
                {t('update.later')}
              </button>
              <button onClick={() => openExternalUrl(info.url!)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-bold text-white shadow-lg shadow-primary/25"
                style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }}>
                <MorphIcon icon={Download} className="w-4 h-4" /> {t('update.updateNow')}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center leading-relaxed">{t('update.installHint')}</p>
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
