import { useEffect, useRef, useState } from "react";
import ArrowLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import Phone from "@hugeicons/core-free-icons/SmartPhone01Icon";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";
import { setSiteLanguage } from "./i18n";

// WhatsApp Web uslubidagi "QR kod orqali kirish" — FAQAT laptop/planshet versiyasida (App.tsx'dagi LoginScreen).
// Telefon QR'ni BIR MARTA skanerlaydi va "Ha, kirish"ni bosadi (QRScanner.tsx). Kod har 5 soniyada almashadi —
// suratga olingan eski QR ishlamaydi (backend/src/routes/qrlogin.ts).
export default function QrLoginPanel({ onLogin, onBack }: { onLogin: (u: any, company?: any) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qrLibRef = useRef<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const finalizingRef = useRef(false);
  const scannedRef = useRef(false);
  scannedRef.current = scanned;

  const createSession = async () => {
    setScanned(false); setVerified(false); setError(""); setCode(null);
    try {
      const r = await fetch(`${API_BASE}/api/auth/qrlogin/create`, { method: "POST" });
      const d = await r.json();
      if (r.ok && d.sessionId) setSessionId(d.sessionId);
      else setError(t('login.qrCreateError'));
    } catch { setError(t('login.qrCreateError')); }
  };

  useEffect(() => {
    // QR chizuvchi kutubxona oldindan yuklanadi — birinchi kod kechikmasdan chiziladi
    import("qrcode").then(m => { qrLibRef.current = m; }).catch(() => {});
    createSession();
  }, []);

  // Holat so'rovi: skanerlanmaguncha har 1 s, telefonda tasdiqlash kutilayotganda tezroq (0.6 s)
  useEffect(() => {
    if (!sessionId || verified) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/auth/qrlogin/code/${sessionId}`);
        const d = await r.json();
        if (stop) return;
        // Sahifa ochiq turgan ekan QR "tugamaydi" — ichki sessiya muddati yetsa jimgina yangisi olinadi
        if (d.expired) { createSession(); return; }
        setScanned(!!d.scanned);
        if (d.verified) { setVerified(true); return; }
        if (d.code) setCode(d.code);
      } catch { /* tarmoq — keyingi urinishda */ }
      if (!stop) timer = setTimeout(poll, scannedRef.current ? 600 : 1000);
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [sessionId, verified]);

  // Kod o'zgarganda QR qayta chiziladi
  useEffect(() => {
    if (!code || !sessionId) return;
    const draw = (QRCode: any) => {
      const canvas = canvasRef.current;
      if (canvas) QRCode.toCanvas(canvas, `qrlogin:${sessionId}:${code}`, { width: 420, margin: 0, errorCorrectionLevel: "M", color: { dark: "#0f172a", light: "#ffffff" } }, () => {
        // Kutubxona canvas'ga o'z o'lchamini (420px) yozib qo'yadi — ramkaga sig'ishi uchun qaytaramiz (aniq chiqishi uchun 2x chiziladi)
        canvas.style.width = "210px"; canvas.style.height = "210px";
      });
    };
    if (qrLibRef.current) draw(qrLibRef.current);
    else import("qrcode").then(m => { qrLibRef.current = m; draw(m); });
  }, [code, sessionId]);

  // Tasdiqlangach — haqiqiy token olinadi va oddiy login bilan AYNAN bir xil holatga o'tiladi
  useEffect(() => {
    if (!verified || !sessionId || finalizingRef.current) return;
    finalizingRef.current = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/auth/qrlogin/finalize`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = await r.json();
        if (!r.ok) { setError(data.error || t('common.error')); setVerified(false); finalizingRef.current = false; return; }
        const u = {
          id: data.user.id || data.user._id,
          name: data.user.firstName + (data.user.lastName ? " " + data.user.lastName : ""),
          phone: data.user.phone, role: data.user.role,
          projectIds: data.user.projectIds || [], isOwner: data.user.isOwner || false,
          companyId: data.user.companyId, language: data.user.language,
        };
        localStorage.setItem("token", data.token);
        localStorage.setItem("currentUser", JSON.stringify(u));
        if (data.user.language) setSiteLanguage(data.user.language);
        onLogin(u, data.company);
      } catch {
        setError(t('common.error'));
        finalizingRef.current = false;
      }
    })();
  }, [verified, sessionId]);

  const stage = verified ? "in" : scanned ? "scanned" : "wait";
  const steps = [t('login.qrStep1'), t('login.qrStep2'), t('login.qrStep3')];
  const stepDone = (i: number) => stage === "in" || (stage === "scanned" && i < 2);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <MorphIcon icon={ArrowLeft} className="w-3.5 h-3.5" /> {t('login.back')}
      </button>
      <div className="text-center">
        <p className="text-base font-bold">{t('login.qrTitle')}</p>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{t('login.qrDesc')}</p>
      </div>

      {/* QR ramka: burchak chiziqlari + yumshoq porlash; skanerlangach QR xiralashib, ustida holat chiqadi */}
      <div className="qr-frame relative mx-auto w-[264px] h-[264px] rounded-[28px] p-4">
        <span className="qr-corner tl" /><span className="qr-corner tr" /><span className="qr-corner bl" /><span className="qr-corner br" />
        <div className="relative w-full h-full rounded-[16px] overflow-hidden bg-white p-2.5 flex items-center justify-center">
          {error ? (
            <div className="p-4 space-y-2 text-center">
              <p className="text-xs text-red-600">{error}</p>
              <button type="button" onClick={createSession} className="text-xs font-semibold text-primary underline">{t('login.qrRefresh')}</button>
            </div>
          ) : (
            <>
              <canvas ref={canvasRef} style={{ width: 210, height: 210 }} className={`block transition-[filter,opacity] duration-300 ${stage !== "wait" ? "blur-[6px] opacity-40" : ""} ${!code ? "opacity-0" : ""}`} />
              {!code && <div className="absolute inset-6 rounded-xl bg-slate-100 animate-pulse" />}
              {stage !== "wait" && (
                <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-900">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg"
                    style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }}>
                    {stage === "in"
                      ? <span className="w-6 h-6 rounded-full border-[3px] border-white/40 border-t-white animate-spin" />
                      : <MorphIcon icon={Phone} className="w-7 h-7" />}
                  </div>
                  <p className="text-sm font-bold">{stage === "in" ? t('login.qrSigningIn') : t('login.qrScanned')}</p>
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Kod yangilanish chizig'i (5 s) va holat */}
      {!error && (
        <div className="mx-auto w-[220px]">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            {stage === "wait" && code && (
              <motion.div key={code} className="h-full rounded-full" style={{ background: "linear-gradient(90deg, var(--primary), var(--accent))" }}
                initial={{ width: "100%" }} animate={{ width: "0%" }} transition={{ duration: 5, ease: "linear" }} />
            )}
          </div>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <span className={`w-1.5 h-1.5 rounded-full ${stage === "wait" ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
            {stage === "wait" ? t('login.qrWaiting') : stage === "scanned" ? t('login.qrScanned') : t('login.qrSigningIn')}
          </p>
        </div>
      )}

      <ol className="space-y-2 rounded-2xl border border-border bg-muted/30 p-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2.5 text-xs">
            <span className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold transition-colors ${stepDone(i) ? "bg-emerald-500 text-white" : "bg-primary/10 text-primary"}`}>
              {stepDone(i) ? "✓" : i + 1}
            </span>
            <span className="text-foreground/85">{s}</span>
          </li>
        ))}
      </ol>
      <p className="text-center text-[11px] text-muted-foreground">{t('login.qrHint')}</p>
    </div>
  );
}
