import { useState, useRef, useEffect, useCallback } from "react";
import { X, QrCode, Camera, AlertCircle, CheckCircle } from "lucide-react";
import { API_BASE } from "./api";
import { motion, AnimatePresence } from "motion/react";

interface QRScanResult {
  type: "material" | "object" | "transaction";
  data: any;
}

interface Props {
  onClose: () => void;
  onResult?: (result: QRScanResult) => void;
  token?: string;
}

export default function QRScanner({ onClose, onResult, token }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

  const [status, setStatus] = useState<"idle" | "scanning" | "processing" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<QRScanResult | null>(null);
  const [cameraAllowed, setCameraAllowed] = useState<boolean | null>(null);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraAllowed(true);
        setStatus("scanning");
        scanLoop();
      }
    } catch (err: any) {
      setCameraAllowed(false);
      setErrorMsg(err?.name === "NotAllowedError" ? "Kamera ruxsati berilmagan" : "Kamera ochib bo'lmadi");
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
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    import("jsqr").then(({ default: jsQR }) => {
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });
      if (code && code.data) {
        handleQRData(code.data);
      } else {
        animFrameRef.current = requestAnimationFrame(scanLoop);
      }
    });
  }, []);

  const handleQRData = useCallback(async (rawData: string) => {
    setStatus("processing");
    stopCamera();
    try {
      const response = await fetch(`${API_BASE}/qr/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ qrData: rawData }),
      });
      const json = await response.json();
      if (!response.ok) {
        setErrorMsg(json.error || "QR xatoligi");
        setStatus("error");
        return;
      }
      setResult(json);
      setStatus("success");
      onResult?.(json);
    } catch {
      setErrorMsg("Server bilan ulanishda xatolik");
      setStatus("error");
    }
  }, [token, onResult, stopCamera]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    startCamera();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 safe-top">
        <div className="flex items-center gap-2 text-white">
          <QrCode className="w-5 h-5" />
          <span className="font-semibold">QR Skan</span>
        </div>
        <button onClick={() => { stopCamera(); onClose(); }}
          className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20">
          <X className="w-4 h-4" />
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
              {/* Corner markers */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-sm" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-sm" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-sm" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-sm" />
              {/* Scanning line */}
              <motion.div
                className="absolute left-1 right-1 h-0.5 bg-primary/80"
                animate={{ top: ["10%", "90%", "10%"] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
            </div>
            <p className="absolute bottom-24 text-white/70 text-sm">QR kodni kamera oldiga tuting</p>
          </div>
        )}

        {/* Processing */}
        {status === "processing" && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="text-white text-center">
              <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">Tekshirilmoqda...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-6">
            <div className="bg-card rounded-2xl p-6 w-full max-w-sm text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-destructive/15 flex items-center justify-center mx-auto">
                <AlertCircle className="w-7 h-7 text-destructive" />
              </div>
              {cameraAllowed === false ? (
                <>
                  <p className="font-semibold text-foreground">Kamera ruxsati kerak</p>
                  <p className="text-sm text-muted-foreground">Brauzer sozlamalaridan kamera ruxsatini bering va sahifani yangilang.</p>
                  <Camera className="w-8 h-8 text-muted-foreground mx-auto" />
                </>
              ) : (
                <>
                  <p className="font-semibold text-foreground">Xatolik</p>
                  <p className="text-sm text-muted-foreground">{errorMsg}</p>
                  <button onClick={reset} className="btn btn-primary w-full">Qayta urinish</button>
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
                <CheckCircle className="w-7 h-7 text-green-500" />
              </div>
              <p className="font-semibold text-center text-foreground">
                {result.type === "material" ? "Material topildi" :
                 result.type === "object" ? "Obyekt topildi" : "Tranzaksiya topildi"}
              </p>
              <div className="bg-muted rounded-xl p-4 space-y-2 text-sm">
                {result.type === "material" && (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Nomi:</span><span className="font-medium">{result.data.name}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Miqdori:</span><span className="font-medium">{result.data.remaining} {result.data.unit}</span></div>
                  </>
                )}
                {result.type === "object" && (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Nomi:</span><span className="font-medium">{result.data.name}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Joylashuv:</span><span className="font-medium">{result.data.location}</span></div>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={reset} className="btn btn-outline flex-1">Yana skan</button>
                <button onClick={() => { stopCamera(); onClose(); }} className="btn btn-primary flex-1">Yopish</button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
