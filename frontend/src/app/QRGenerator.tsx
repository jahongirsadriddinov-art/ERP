import { useEffect, useRef, useState } from "react";
import { X, Download, QrCode } from "lucide-react";

interface Props {
  type: "material" | "object" | "transaction";
  id: string;
  name: string;
  onClose: () => void;
}

export default function QRGenerator({ type, id, name, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  const payload = JSON.stringify({ type, id, v: 1 });

  useEffect(() => {
    let cancelled = false;
    import("qrcode").then(QRCode => {
      if (cancelled || !canvasRef.current) return;
      QRCode.toCanvas(canvasRef.current, payload, {
        width: 280,
        margin: 2,
        color: { dark: "#1B3A6B", light: "#ffffff" },
      }, (err: Error | null | undefined) => {
        if (!err && !cancelled) setReady(true);
      });
    });
    return () => { cancelled = true; };
  }, [payload]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${type}-${id}.png`;
    a.click();
  };

  const label = type === "material" ? "Material" : type === "object" ? "Obyekt" : "Tranzaksiya";

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-xs overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm text-foreground">{label} QR kodi</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* QR */}
        <div className="flex flex-col items-center gap-4 p-6">
          <div className="relative">
            {!ready && (
              <div className="w-[280px] h-[280px] bg-muted rounded-xl flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}
            <canvas ref={canvasRef} className={`rounded-xl ${ready ? "" : "hidden"}`} />
          </div>
          <div className="text-center">
            <p className="font-semibold text-foreground text-sm truncate max-w-[240px]">{name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label} — #{id.slice(-6)}</p>
          </div>
          <button onClick={download}
            className="btn btn-primary w-full flex items-center justify-center gap-2">
            <Download className="w-4 h-4" />
            PNG yuklab olish
          </button>
        </div>
      </div>
    </div>
  );
}
