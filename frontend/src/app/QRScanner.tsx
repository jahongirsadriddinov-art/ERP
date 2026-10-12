import { useState, useRef, useEffect, useCallback } from "react";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import QrCode from "@hugeicons/core-free-icons/QrCodeIcon";
import Camera from "@hugeicons/core-free-icons/Camera01Icon";
import AlertCircle from "@hugeicons/core-free-icons/AlertCircleIcon";
import CheckCircle from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import { MorphIcon } from "morphicons/react";
import { API_BASE } from "./api";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { playSound } from "./sound";

interface QRScanResult {
  type: "material" | "object" | "transaction";
  data: any;
}

interface Props {
  onClose: () => void;
  onResult?: (result: QRScanResult) => void;
  onLoginQrVerified?: () => void;
  token?: string;
}

// Kamera muvaffaqiyatsizligining aniq turi — har biri boshqa sababga ega va
// boshqacha xabar/harakat talab qiladi. Avval bularning barchasi bitta
// "ruxsat bering" xabariga tushirilib yuborilar edi, garchi faqat "denied"
// uchun to'g'ri bo'lsa ham.
type CameraIssue = "denied" | "unavailable" | "busy" | "insecure" | "unknown";

export default function QRScanner({ onClose, onResult, onLoginQrVerified, token }: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectorRef = useRef<any>(null);
  const jsQRRef = useRef<any>(null);
  useEffect(() => {
    const BD = (window as any).BarcodeDetector;
    if (BD) {
      Promise.resolve(BD.getSupportedFormats?.() ?? ["qr_code"])
        .then((f: string[]) => { if (f.includes("qr_code")) detectorRef.current = new BD({ formats: ["qr_code"] }); })
        .catch(() => {});
    }
    import("jsqr").then(m => { jsQRRef.current = m.default; }).catch(() => {});
  }, []);

  const [status, setStatus] = useState<"idle" | "scanning" | "processing" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<QRScanResult | null>(null);
  const [cameraIssue, setCameraIssue] = useState<CameraIssue | null>(null);
  const [stalled, setStalled] = useState(false);

  // Laptop/planshetga "QR kod orqali kirish" — App.tsx'dagi QrLoginPanel'da
  // ko'rsatilgan "qrlogin:<sessionId>:<code>" matnini o'qiganda ishga
  // tushadi. Oddiy QR'lardan farqli o'laroq bitta skan bilan tugamaydi —
  // kod har 3 soniyada almashadi va KETMA-KET 3 tasi skanerlanishi kerak
  // (backend/src/routes/qrlogin.ts'dagi izohga qarang), shu sabab kamera
  // yopilmasdan davom etadi va pastda 3 bo'lakli progress ko'rsatiladi.
  const [loginQrMode, setLoginQrMode] = useState(false);
  const [loginScanCount, setLoginScanCount] = useState(0);
  const [loginDone, setLoginDone] = useState(false);
  // Bitta skandan keyin — "Qaysi kompyuter kirmoqchi, tasdiqlaysizmi?" oynasi
  const [loginConfirm, setLoginConfirm] = useState<{ sessionId: string; device: string } | null>(null);
  const [approving, setApproving] = useState(false);
  const lastLoginRawRef = useRef<string | null>(null);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setStalled(false);
    // MUHIM: getUserMedia'ni chaqirishdan OLDIN tekshiramiz — xavfsiz bo'lmagan
    // (HTTP, localhost emas) kontekstda navigator.mediaDevices umuman mavjud
    // bo'lmaydi, va uni chaqirish oddiy TypeError tashlaydi — bu boshqa har
    // qanday xato bilan bir xil "ruxsat bering" xabarini ko'rsatib, chalkashtirar
    // edi, holbuki bu holatda ruxsatning hech qanday aloqasi yo'q.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraIssue("insecure");
      setErrorMsg(t('qrScanner.insecureError'));
      setStatus("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraIssue(null);
        setStatus("scanning");
        scanLoop();
        // ~9s davomida hech qanday kod topilmasa — jim loop'ni to'xtatmasdan,
        // qo'shimcha maslahat matnini ko'rsatamiz (avval umuman ko'rsatilmas edi).
        stallTimerRef.current = setTimeout(() => setStalled(true), 9000);
      }
    } catch (err: any) {
      let issue: CameraIssue = "unknown";
      let msg = t('qrScanner.genericError');
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        issue = "denied"; msg = t('qrScanner.deniedError');
      } else if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
        issue = "unavailable"; msg = t('qrScanner.unavailableError');
      } else if (err?.name === "NotReadableError" || err?.name === "TrackStartError") {
        issue = "busy"; msg = t('qrScanner.busyError');
      }
      setCameraIssue(issue);
      setErrorMsg(msg);
      setStatus("error");
    }
  }, []);

  const scanLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(scanLoop);
      return;
    }
    const found = (data: string) => {
      if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
      handleQRData(data);
    };
    const next = () => { animFrameRef.current = requestAnimationFrame(scanLoop); };
    // Tezlik: (1) qurilmada o'rnatilgan QR o'quvchi (BarcodeDetector — Android Chrome/ilova) bo'lsa o'sha ishlatiladi;
    // (2) bo'lmasa kadr 640px'gacha kichraytirilib jsQR'ga beriladi (to'liq 1280x720 kadr har safar juda sekin edi).
    if (detectorRef.current) {
      detectorRef.current.detect(video)
        .then((codes: any[]) => { const v = codes?.[0]?.rawValue; if (v) found(v); else next(); })
        .catch(() => { detectorRef.current = null; next(); });
      return;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !jsQRRef.current) { next(); return; }
    const k = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * k);
    canvas.height = Math.round(video.videoHeight * k);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQRRef.current(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
    if (code && code.data) found(code.data); else next();
  }, []);

  // "qrlogin:<sessionId>:<code>" — laptop/planshet ekranida qadam-baqadam
  // (har 3s) almashib turadigan login QR'i. Kamerani TO'XTATMAYDI (keyingi
  // rotatsiyani ham o'qish kerak) va odatiy "processing/success" ekraniga
  // o'tmaydi — buning o'rniga "scanning" holatida qolib, pastda progress
  // ko'rsatadi.
  const handleLoginQR = useCallback(async (rawData: string) => {
    setLoginQrMode(true);
    // Kamera bir xil kadrni o'nlab marta (30-60fps) o'qiydi, QR esa 3
    // soniya davomida O'ZGARMAYDI — bir xil matnni serverga qayta-qayta
    // yubormaslik uchun oxirgi YUBORILGAN matn bilan solishtiramiz.
    if (rawData === lastLoginRawRef.current) {
      animFrameRef.current = requestAnimationFrame(scanLoop);
      return;
    }
    lastLoginRawRef.current = rawData;
    const [, sessionId, code] = rawData.split(':');
    if (!sessionId || !code) { animFrameRef.current = requestAnimationFrame(scanLoop); return; }
    try {
      const r = await fetch(`${API_BASE}/api/auth/qrlogin/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ sessionId, code, v: 2 }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok && d.needsConfirm) {
        stopCamera();
        playSound("success");
        setLoginConfirm({ sessionId, device: String(d.device || "") });
        return;
      }
      if (!r.ok && (r.status === 403 || r.status === 410)) {
        stopCamera();
        setErrorMsg(d.error || t('qrScanner.qrError'));
        setStatus("error");
        return;
      }
      if (r.ok && d.ok) {
        setLoginScanCount(d.scannedCount || 0);
        if (d.verified) {
          setLoginDone(true);
          stopCamera();
          onLoginQrVerified?.();
          return;
        }
      }
      // Noto'g'ri/eskirgan kod — shunchaki keyingi rotatsiyani kutamiz,
      // xato ko'rsatmaymiz (bu normal holat, foydalanuvchi xatosi emas).
    } catch { /* tarmoq xatosi — keyingi kadrda qayta urinamiz */ }
    animFrameRef.current = requestAnimationFrame(scanLoop);
  }, [token, stopCamera, onLoginQrVerified]);

  const handleQRData = useCallback(async (rawData: string) => {
    if (rawData.startsWith('qrlogin:')) {
      await handleLoginQR(rawData);
      return;
    }
    setStatus("processing");
    stopCamera();
    try {
      const response = await fetch(`${API_BASE}/api/qr/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ qrData: rawData }),
      });
      const json = await response.json();
      if (!response.ok) {
        setErrorMsg(json.error || t('qrScanner.qrError'));
        setStatus("error");
        return;
      }
      setResult(json);
      setStatus("success");
      onResult?.(json);
    } catch {
      setErrorMsg(t('qrScanner.serverError'));
      setStatus("error");
    }
  }, [token, onResult, stopCamera, handleLoginQR]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  // Ovoz: kamera qidirayotganda sokin "scanning" halqasi, natija chiqqanda
  // bir martalik "success"/"error".
  const scanSfxRef = useRef<ReturnType<typeof playSound>>(null);
  useEffect(() => {
    if (status === "scanning") {
      if (!scanSfxRef.current) scanSfxRef.current = playSound("scanning", { loop: true });
      return () => { scanSfxRef.current?.stop(); scanSfxRef.current = null; };
    }
    scanSfxRef.current?.stop();
    scanSfxRef.current = null;
    if (status === "success") playSound("success");
    else if (status === "error") playSound("error");
  }, [status]);

  const answerLogin = async (approve: boolean) => {
    if (!loginConfirm || approving) return;
    setApproving(true);
    try {
      const r = await fetch(`${API_BASE}/api/auth/qrlogin/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ sessionId: loginConfirm.sessionId, approve }),
      });
      const d = await r.json().catch(() => ({}));
      setLoginConfirm(null);
      if (!approve) { onClose(); return; }
      if (r.ok && d.verified) { setLoginDone(true); onLoginQrVerified?.(); }
      else { setErrorMsg(d.error || t('qrScanner.qrError')); setStatus("error"); }
    } catch {
      setErrorMsg(t('qrScanner.serverError')); setStatus("error");
    } finally { setApproving(false); }
  };

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setCameraIssue(null);
    startCamera();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col">
      {/* Header */}
      {/* MUHIM: bu yerda avval "safe-top" klassi ishlatilgan edi — bunday klass
          globals.css'da mavjud emas (haqiqiy nomi "pt-safe-top"), shu sabab hech
          qanday effekt bermas edi va QR-skaner ochilganda header'i telefon status
          bar (soat/signal/batareya) bilan ustma-ust tushib qolgan edi. Shuningdek
          pt-safe-top'ning o'zi ham notch'siz qurilmalarda 0px'ga tushib qoladi —
          shu sabab max() bilan minimal 0.75rem (py-3 bilan bir xil) kafolatlanadi. */}
      <div className="flex items-center justify-between px-4 flex-shrink-0"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', paddingBottom: '0.75rem' }}>
        <div className="flex items-center gap-2 text-white">
          {loginQrMode ? (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }}>
              <MorphIcon icon={QrCode} className="w-4 h-4 text-white" />
            </div>
          ) : (
            <MorphIcon icon={QrCode} className="w-5 h-5" />
          )}
          <span className="font-semibold">{loginQrMode ? t('login.qrLoginLink') : t('qrScanner.title')}</span>
        </div>
        <button onClick={() => { stopCamera(); onClose(); }}
          className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20">
          <MorphIcon icon={X} className="w-4 h-4"  />
        </button>
      </div>

      {/* Camera view */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />

        {/* Scanning overlay */}
        {status === "scanning" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-64 h-64">
              {/* Corner markers — login-QR rejimida premium (accent) rangda,
                  oddiy skanerlashdan ko'zga ko'rinib ajralib turishi uchun. */}
              <div className={`absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 rounded-tl-sm ${loginQrMode ? "border-accent" : "border-white"}`} />
              <div className={`absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 rounded-tr-sm ${loginQrMode ? "border-accent" : "border-white"}`} />
              <div className={`absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 rounded-bl-sm ${loginQrMode ? "border-accent" : "border-white"}`} />
              <div className={`absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 rounded-br-sm ${loginQrMode ? "border-accent" : "border-white"}`} />
              {/* Scanning line */}
              <motion.div
                className="absolute left-1 right-1 h-0.5 bg-primary/80"
                animate={{ top: ["10%", "90%", "10%"] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
            </div>
            <p className="absolute bottom-24 text-white/70 text-sm">
              {loginQrMode ? t('qrScanner.loginScanHint') : stalled ? t('qrScanner.stalledHint') : t('qrScanner.scanHint')}
            </p>

          </div>
        )}

        {/* Bitta skandan keyin: qaysi kompyuter kirmoqchi — "Ha, kirish" / "Yo'q" */}
        <AnimatePresence>
          {loginConfirm && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
              <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="w-full max-w-sm rounded-3xl border border-white/15 bg-card/95 p-5 text-center shadow-2xl">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg"
                  style={{ background: "linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)" }}>
                  <MorphIcon icon={QrCode} className="h-7 w-7" />
                </div>
                <p className="text-base font-bold text-foreground">{t('qrScanner.confirmTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('qrScanner.confirmDesc')}</p>
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground">💻 {loginConfirm.device || "Kompyuter"}</div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button type="button" disabled={approving} onClick={() => answerLogin(false)} className="btn btn-outline h-12 rounded-2xl">{t('qrScanner.confirmNo')}</button>
                  <button type="button" disabled={approving} onClick={() => answerLogin(true)} className="btn btn-primary h-12 rounded-2xl">{approving ? "…" : t('qrScanner.confirmYes')}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Login-QR tasdiqlandi — kompyuter/planshet endi o'zi tizimga kiradi */}
        {loginQrMode && loginDone && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="bg-card rounded-2xl p-6 w-full max-w-sm text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center mx-auto">
                <MorphIcon icon={CheckCircle} className="w-7 h-7 text-green-500" />
              </div>
              <p className="font-semibold text-foreground">{t('qrScanner.loginVerified')}</p>
              <button onClick={() => { stopCamera(); onClose(); }} className="btn btn-primary w-full">{t('qrScanner.closeBtn')}</button>
            </motion.div>
          </div>
        )}

        {/* Processing */}
        {status === "processing" && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="text-white text-center">
              <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">{t('qrScanner.checking')}</p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6">
            <div className="bg-card rounded-2xl p-6 w-full max-w-sm text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-destructive/15 flex items-center justify-center mx-auto">
                <MorphIcon icon={AlertCircle} className="w-7 h-7 text-destructive"  />
              </div>
              {cameraIssue === "denied" ? (
                <>
                  <p className="font-semibold text-foreground">{t('qrScanner.permissionTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('qrScanner.permissionDesc')}</p>
                  <MorphIcon icon={Camera} className="w-8 h-8 text-muted-foreground mx-auto"  />
                </>
              ) : cameraIssue === "unavailable" ? (
                <>
                  <p className="font-semibold text-foreground">{t('qrScanner.unavailableTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('qrScanner.unavailableDesc')}</p>
                </>
              ) : cameraIssue === "busy" ? (
                <>
                  <p className="font-semibold text-foreground">{t('qrScanner.busyTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('qrScanner.busyDesc')}</p>
                  <button onClick={reset} className="btn btn-primary w-full">{t('qrScanner.retryBtn')}</button>
                </>
              ) : cameraIssue === "insecure" ? (
                <>
                  <p className="font-semibold text-foreground">{t('qrScanner.insecureTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('qrScanner.insecureDesc')}</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-foreground">{t('qrScanner.errorTitle')}</p>
                  <p className="text-sm text-muted-foreground">{errorMsg}</p>
                  <button onClick={reset} className="btn btn-primary w-full">{t('qrScanner.retryBtn')}</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Success */}
        {status === "success" && result && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="bg-card rounded-2xl p-6 w-full max-w-sm space-y-4">
              <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center mx-auto">
                <MorphIcon icon={CheckCircle} className="w-7 h-7 text-green-500"  />
              </div>
              <p className="font-semibold text-center text-foreground">
                {result.type === "material" ? t('qrScanner.materialFound') :
                 result.type === "object" ? t('qrScanner.objectFound') : t('qrScanner.transactionFound')}
              </p>
              <div className="bg-muted rounded-xl p-4 space-y-2 text-sm">
                {result.type === "material" && (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('qrScanner.nameLabel')}</span><span className="font-medium">{result.data.name}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('qrScanner.quantityLabel')}</span><span className="font-medium">{result.data.remaining} {result.data.unit}</span></div>
                  </>
                )}
                {result.type === "object" && (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('qrScanner.nameLabel')}</span><span className="font-medium">{result.data.name}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('qrScanner.locationLabel')}</span><span className="font-medium">{result.data.location}</span></div>
                  </>
                )}
                {result.type === "transaction" && (
                  <>
                    {result.data.amount != null && <div className="flex justify-between"><span className="text-muted-foreground">{t('qrScanner.amountLabel')}</span><span className="font-medium">{Number(result.data.amount).toLocaleString('uz-UZ')} {t('common.som')}</span></div>}
                    {result.data.description && <div className="flex justify-between"><span className="text-muted-foreground">{t('qrScanner.descriptionLabel')}</span><span className="font-medium">{result.data.description}</span></div>}
                    {result.data.status && <div className="flex justify-between"><span className="text-muted-foreground">{t('qrScanner.statusLabel')}</span><span className="font-medium">{result.data.status === 'confirmed' ? t('qrScanner.statusConfirmed') : result.data.status === 'rejected' ? t('qrScanner.statusRejected') : t('qrScanner.statusPending')}</span></div>}
                    {result.data.date && <div className="flex justify-between"><span className="text-muted-foreground">{t('qrScanner.dateLabel')}</span><span className="font-medium">{result.data.date}</span></div>}
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={reset} className="btn btn-outline flex-1">{t('qrScanner.scanAgainBtn')}</button>
                <button onClick={() => { stopCamera(); onClose(); }} className="btn btn-primary flex-1">{t('qrScanner.closeBtn')}</button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
