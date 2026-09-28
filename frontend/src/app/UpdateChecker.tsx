import { useEffect, useRef, useState } from "react";
import Download from "@hugeicons/core-free-icons/Download04Icon";
import Sparkles from "@hugeicons/core-free-icons/SparklesIcon";
import { MorphIcon } from "morphicons/react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";
import { compareVersions } from "./lib/version";
import { isNative, isAndroid, isTauri, openExternalUrl } from "./platform";

type Phase = "downloading" | "ready" | "installing" | "permission" | "error";

// Faqat o'rnatilgan ilovalarda (Windows exe / Android APK) ma'noli — veb sayt har safar
// ochilganda eng yangi kodni o'zi oladi (Vercel). Yangi versiya chiqsa ilova o'zi so'raydi
// ("Yangilashni xohlaysizmi?"), "Yangilash" bosilsa yangi o'rnatuvchini internetdan o'zi
// yuklab oladi va o'rnatishni boshlaydi:
//   - Windows (Tauri): src-tauri/src/lib.rs `download_and_install_update` — yuklab, passive
//     rejimda o'rnatadi va ilovani o'zi qayta ochadi.
//   - Android (Capacitor): AppUpdaterPlugin.java — APK'ni yuklaydi va tizim o'rnatuvchisini
//     ochadi (Android sukut ostida o'rnatishga ruxsat bermaydi — bitta "O'rnatish" bosiladi).

export default function UpdateChecker() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<{ version: string; notes?: string; url?: string } | null>(null);
  const [phase, setPhase] = useState<Phase>("downloading");
  const [percent, setPercent] = useState(0);
  const [errMsg, setErrMsg] = useState("");
  // Oyna faqat yangilanish TAYYOR bo'lganda (yoki xato/ruxsat kerak bo'lganda) ochiladi;
  // "Keyinroq" bosilsa yopiladi, pastdagi kichik tugma orqali qayta ochiladi.
  const [open, setOpen] = useState(false);
  const startedFor = useRef<string | null>(null);

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
    const interval = setInterval(check, 30 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const onProgress = (p: { downloaded: number; total: number }) =>
    setPercent(p.total > 0 ? Math.min(100, Math.round((p.downloaded * 100) / p.total)) : 0);

  // Yangi versiya topilishi bilan — ORQA FONDA yuklab olinadi (foydalanuvchi ishlashda davom etadi)
  const download = async (url: string, attempt = 0): Promise<void> => {
    setPhase("downloading"); setPercent(0); setErrMsg("");
    try {
      if (isTauri()) {
        const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
        // Progress — ixtiyoriy: ruxsat bo'lmasa ham yuklash to'xtamasin (avval shu yerda yiqilardi)
        let unlisten: (() => void) | null = null;
        try { unlisten = await listen<{ downloaded: number; total: number }>("update-progress", e => onProgress(e.payload)); } catch { /* */ }
        try { await invoke("download_update", { url }); } finally { unlisten?.(); }
      } else if (isAndroid()) {
        const { registerPlugin } = await import("@capacitor/core");
        const AppUpdater = registerPlugin<any>("AppUpdater");
        const handle = await AppUpdater.addListener("progress", onProgress);
        try { await AppUpdater.download({ url }); } finally { handle.remove(); }
      }
      setPhase("ready");
      setOpen(true);
    } catch (e) {
      console.error("[update download]", e);
      // Reliz chiqqan paytda server ham yangilanib (qayta ishga tushib) turgan bo'ladi — oynani
      // ko'rsatmasdan avval bir necha marta jim qayta urinamiz (20s, 40s, 60s).
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 20_000 * (attempt + 1)));
        return download(url, attempt + 1);
      }
      setErrMsg(String((e as any)?.message || e || ""));
      setPhase("error");
      setOpen(true);
    }
  };

  useEffect(() => {
    if (!info?.url || startedFor.current === info.version) return;
    startedFor.current = info.version;
    download(info.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.version]);

  const install = async () => {
    setPhase("installing");
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("install_update"); // ilova o'zi yopiladi va o'rnatuvchi ishga tushadi
      } else if (isAndroid()) {
        const { registerPlugin } = await import("@capacitor/core");
        const AppUpdater = registerPlugin<any>("AppUpdater");
        await AppUpdater.install();
        setPhase("ready");
      }
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (msg.includes("PERMISSION")) setPhase("permission");
      else { console.error("[update install]", e); setErrMsg(msg); setPhase("error"); }
    }
  };

  if (!info) return null;
  const btnStyle = { background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div key="dlg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.92, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="bg-card border border-border rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center gap-3 px-5 py-4 text-white" style={btnStyle}>
              <MorphIcon icon={Sparkles} className="w-5 h-5" />
              <p className="font-bold flex-1">{phase === "error" ? t('update.failed') : phase === "downloading" ? t('update.downloadingTitle', "Yangi versiya yuklanmoqda") : t('update.readyTitle')}</p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="font-semibold text-foreground">{phase === "error" ? t('update.errorText', { version: info.version, defaultValue: `Yangi versiya (${info.version}) yuklab olinmadi.` }) : phase === "downloading" ? t('update.downloadingText', { version: info.version, defaultValue: `Yangi versiya (${info.version}) yuklanmoqda...` }) : t('update.readyText', { version: info.version })}</p>
                <p className="text-sm text-muted-foreground mt-1">{phase === "error" ? t('update.errorHint', "Internet yoki server vaqtincha javob bermadi. \"Qayta urinish\"ni bosing yoki o'rnatuvchini qo'lda yuklab oling.") : phase === "downloading" ? "" : t('update.readyQuestion')}</p>
              </div>
              {info.notes && (
                <div className="bg-muted/50 rounded-2xl p-3.5 max-h-40 overflow-y-auto">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{t('update.whatsNew')}</p>
                  <p className="text-xs text-foreground/80 whitespace-pre-line leading-relaxed">{info.notes}</p>
                </div>
              )}
              {phase === "installing" && (
                <div className="space-y-2">
                  <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full w-full animate-pulse rounded-full" style={btnStyle} /></div>
                  <p className="text-xs text-center text-muted-foreground">{t('update.installing')}</p>
                </div>
              )}
              {phase === "permission" && <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">{t('update.permissionNeeded')}</p>}
              {phase === "error" && (
                <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">
                  {t('update.failed')}{" "}
                  <button className="underline font-semibold" onClick={() => openExternalUrl(info.url!)}>{t('update.openManually')}</button>
                  {errMsg && <span className="block mt-1 text-[10px] opacity-70 break-words">{errMsg.slice(0, 160)}</span>}
                </p>
              )}
              {phase === "downloading" && (
                <div className="space-y-2">
                  <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full transition-[width] duration-300" style={{ ...btnStyle, width: `${Math.max(4, percent)}%` }} /></div>
                  <p className="text-xs text-center text-muted-foreground">{t('update.downloading', { percent })}</p>
                </div>
              )}
              {phase !== "installing" && (
                <div className="space-y-2">
                  {phase !== "downloading" && <button onClick={phase === "error" ? () => download(info.url!, 2) : install}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white shadow-lg shadow-primary/25" style={btnStyle}>
                    <MorphIcon icon={Download} className="w-4 h-4" />
                    {phase === "error" ? t('update.retry') : t('update.installRestart')}
                  </button>}
                  <button onClick={() => setOpen(false)}
                    className="w-full py-3 rounded-xl text-sm font-semibold border border-border text-muted-foreground hover:bg-muted">
                    {t('update.later')}
                  </button>
                </div>
              )}
              {phase === "ready" && isAndroid() && <p className="text-[10px] text-muted-foreground text-center leading-relaxed">{t('update.installHintAndroid')}</p>}
            </div>
          </motion.div>
        </motion.div>
      ) : (
        <UpdateBubble key="badge" phase={phase} percent={percent} label={phase === "downloading" ? t('update.downloading', { percent }) : t('update.badge')}
          onOpen={() => { if (phase !== "downloading") setOpen(true); }} btnStyle={btnStyle} />
      )}
    </AnimatePresence>
  );
}

// ─── Suzuvchi yangilanish tugmasi ───────────────────────────────────────────
// Istalgan joyga sudrab qo'yiladi (joyi eslab qolinadi). Oddiy holatda — kichik dumaloq, faqat progress
// halqasi; ustiga kelinganda / bosilganda — "Yuklab olinmoqda... N%" yozuvi bilan kengayadi.
const POS_KEY = "erp_update_bubble_pos";
function UpdateBubble({ phase, percent, label, onOpen, btnStyle }: { phase: Phase; percent: number; label: string; onOpen: () => void; btnStyle: React.CSSProperties }) {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try { const p = JSON.parse(localStorage.getItem(POS_KEY) || ""); if (typeof p.x === "number" && typeof p.y === "number") return p; } catch { /* */ }
    return { x: 0.92, y: 0.16 };
  });
  const [expanded, setExpanded] = useState(false);
  const [vw, setVw] = useState(() => window.innerWidth), [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => { const r = () => { setVw(window.innerWidth); setVh(window.innerHeight); }; window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);
  const collapseT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const R = 22; // dumaloq radiusi (px)
  const cx = Math.min(vw - R - 6, Math.max(R + 6, pos.x * vw)), cy = Math.min(vh - R - 6, Math.max(R + 6, pos.y * vh));
  const side = cx < vw / 3 ? "left" : cx > (vw * 2) / 3 ? "right" : "center";
  const tx = side === "left" ? `-${R}px` : side === "right" ? `calc(-100% + ${R}px)` : "-50%";
  const pct = phase === "downloading" ? Math.max(0, Math.min(100, percent)) : 100;
  const C = 2 * Math.PI * 17;
  const expand = (ms = 2500) => { setExpanded(true); if (collapseT.current) clearTimeout(collapseT.current); collapseT.current = setTimeout(() => setExpanded(false), ms); };
  useEffect(() => () => { if (collapseT.current) clearTimeout(collapseT.current); }, []);
  return (
    // Tashqi qatlam — joylashuv (transform shu yerda); ichki motion — faqat ko'rinish animatsiyasi
    <div role="button" tabIndex={0} aria-label={label}
      onPointerDown={e => { drag.current = { sx: e.clientX, sy: e.clientY, px: cx, py: cy, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={e => {
        const d = drag.current; if (!d) return;
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) < 6) return;
        d.moved = true; setExpanded(false);
        setPos({ x: (d.px + dx) / vw, y: (d.py + dy) / vh });
      }}
      onPointerUp={() => {
        const d = drag.current; drag.current = null;
        if (d?.moved) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* */ } return; }
        if (phase === "downloading") { if (expanded) setExpanded(false); else expand(3500); } else onOpen();
      }}
      onMouseEnter={() => { if (!drag.current) { setExpanded(true); if (collapseT.current) clearTimeout(collapseT.current); } }}
      onMouseLeave={() => { if (!drag.current) expand(600); }}
      onFocus={() => expand(4000)} onBlur={() => setExpanded(false)}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (phase !== "downloading") onOpen(); } }}
      className="fixed z-[90] touch-none select-none cursor-grab active:cursor-grabbing"
      style={{ left: cx, top: cy, transform: `translate(${tx}, -50%)` }}>
      <motion.div layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={`flex items-center text-white shadow-xl shadow-black/30 ring-1 ring-white/20 ${expanded ? "rounded-full pl-1 pr-4 gap-2" : "rounded-full"} ${side === "right" && expanded ? "flex-row-reverse pl-4 pr-1" : ""}`}
        style={btnStyle}>
        <span className="relative w-11 h-11 flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 40 40" className="absolute inset-0 w-11 h-11 -rotate-90">
            <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
            <circle cx="20" cy="20" r="17" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .4s ease" }} />
          </svg>
          {phase === "downloading"
            ? <span className="relative text-[10px] font-extrabold tabular-nums">{pct}%</span>
            : <MorphIcon icon={Sparkles} className="relative w-4 h-4" />}
        </span>
        {expanded && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs font-bold whitespace-nowrap py-2">
            {label}
          </motion.span>
        )}
      </motion.div>
    </div>
  );
}
