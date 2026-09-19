import { useEffect, useRef, useState } from "react";
import ArrowLeft from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "./api";
import { setSiteLanguage } from "./i18n";

// WhatsApp Web uslubidagi "QR kod orqali kirish" — FAQAT laptop/planshet
// versiyasida ko'rsatiladi (App.tsx'dagi LoginScreen, isTabletOrLarger()
// bilan gated). Xavfsizlik uchun bitta statik QR EMAS — kod har 3 soniyada
// almashadi va telefon (QRScanner.tsx) KETMA-KET 3 tasini skanerlashi
// kerak (backend/src/routes/qrlogin.ts'dagi izohga qarang: bitta QR
// kadrini suratga olib keyinroq ishlatish YETARLI EMAS).
export default function QrLoginPanel({ onLogin, onBack }: { onLogin: (u: any, company?: any) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [verified, setVerified] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState("");
  const lastCodeRef = useRef<string | null>(null);

  const createSession = async () => {
    setExpired(false); setScannedCount(0); setVerified(false); setError("");
    lastCodeRef.current = null;
    try {
      const r = await fetch(`${API_BASE}/api/auth/qrlogin/create`, { method: "POST" });
      const d = await r.json();
      if (r.ok && d.sessionId) setSessionId(d.sessionId);
      else setError(t('login.qrCreateError'));
    } catch { setError(t('login.qrCreateError')); }
  };

  useEffect(() => { createSession(); }, []);

  // Har soniyada hozirgi kodni so'raymiz — o'zgargan bo'lsa QR qayta chiziladi.
  useEffect(() => {
    if (!sessionId || verified) return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/auth/qrlogin/code/${sessionId}`);
        const d = await r.json();
        if (stop) return;
        if (d.expired) { setExpired(true); return; }
        setScannedCount(d.scannedCount || 0);
        if (d.verified) { setVerified(true); return; }
        if (d.code && d.code !== lastCodeRef.current) {
          lastCodeRef.current = d.code;
          const canvas = canvasRef.current;
          if (canvas) {
            const payload = `qrlogin:${sessionId}:${d.code}`;
            import("qrcode").then(QRCode => {
              if (!stop) QRCode.toCanvas(canvas, payload, { width: 220, margin: 2, color: { dark: "#1B3A6B", light: "#ffffff" } }, () => {});
            });
          }
        }
      } catch { /* tarmoq — keyingi urinishda */ }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => { stop = true; clearInterval(id); };
  }, [sessionId, verified]);

  // Tasdiqlangach — haqiqiy tokenni olamiz va oddiy login bilan AYNAN bir
  // xil holatga o'tamiz (App.tsx'dagi onLogin callback'i).
  useEffect(() => {
    if (!verified || !sessionId || finalizing) return;
    setFinalizing(true);
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/auth/qrlogin/finalize`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = await r.json();
        if (!r.ok) { setError(data.error || t('common.error')); setVerified(false); setFinalizing(false); return; }
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
        setFinalizing(false);
      }
    })();
  }, [verified, sessionId]);

  return (
    <div className="space-y-4 text-center">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <MorphIcon icon={ArrowLeft} className="w-3.5 h-3.5" /> {t('login.back')}
      </button>
      <p className="text-sm font-semibold">{t('login.qrTitle')}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{t('login.qrDesc')}</p>

      <div className="relative w-[220px] h-[220px] mx-auto rounded-2xl overflow-hidden bg-white flex items-center justify-center">
        {expired || error ? (
          <div className="p-4 space-y-2">
            <p className="text-xs text-red-600">{error || t('login.qrExpired')}</p>
            <button type="button" onClick={createSession} className="text-xs font-semibold text-primary underline">{t('login.qrRefresh')}</button>
          </div>
        ) : verified ? (
          <div className="text-primary text-sm font-semibold p-4">{t('login.qrVerifiedWaiting')}</div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>

      {!expired && !error && !verified && (
        <div className="flex items-center justify-center gap-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-10 h-1.5 rounded-full bg-muted overflow-hidden">
              <motion.div className="h-full bg-primary" initial={{ width: "0%" }}
                animate={{ width: scannedCount > i ? "100%" : "0%" }} transition={{ duration: 0.35 }} />
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t('login.qrHint')}</p>
    </div>
  );
}
