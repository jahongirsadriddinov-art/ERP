import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MorphIcon } from "morphicons/react";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Download from "@hugeicons/core-free-icons/Download04Icon";
import { saveOrShareBlob } from "./platform";

// Telegram'dagi kabi: rasm/video ilovaning O'ZIDA, to'liq ekranli oynada ochiladi
// (avval yangi tab/sahifa ochilardi — ilovalarda (APK/exe) umuman ishlamasdi).
type Media = { url: string; type: "image" | "video" };
const EVT = "erp:open-media";

export function openMediaViewer(url: string, type: "image" | "video" = "image") {
  window.dispatchEvent(new CustomEvent<Media>(EVT, { detail: { url, type } }));
}

export default function MediaViewer() {
  const [media, setMedia] = useState<Media | null>(null);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    const onOpen = (e: Event) => { setZoom(false); setMedia((e as CustomEvent<Media>).detail); };
    window.addEventListener(EVT, onOpen);
    return () => window.removeEventListener(EVT, onOpen);
  }, []);
  useEffect(() => {
    if (!media) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMedia(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [media]);

  if (!media) return null;
  const download = async () => {
    try {
      const r = await fetch(media.url);
      const blob = await r.blob();
      const name = decodeURIComponent(media.url.split("?")[0].split("/").pop() || (media.type === "video" ? "video.mp4" : "rasm.jpg"));
      await saveOrShareBlob(name, blob);
    } catch { /* tarmoq xatosi — jim */ }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/95 flex items-center justify-center" onClick={() => setMedia(null)}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="absolute right-3 flex gap-2 z-10" style={{ top: "max(0.75rem, env(safe-area-inset-top))" }} onClick={e => e.stopPropagation()}>
        <button onClick={download} aria-label="Download" className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
          <MorphIcon icon={Download} className="w-5 h-5" />
        </button>
        <button onClick={() => setMedia(null)} aria-label="Close" className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
          <MorphIcon icon={X} className="w-5 h-5" />
        </button>
      </div>
      <div className={`w-full h-full flex items-center justify-center ${zoom ? "overflow-auto" : "overflow-hidden"}`} onClick={e => e.stopPropagation()}>
        {media.type === "video" ? (
          <video src={media.url} controls autoPlay playsInline className="max-w-full max-h-full" />
        ) : (
          <img src={media.url} alt="" onClick={() => setZoom(z => !z)}
            className={zoom ? "max-w-none cursor-zoom-out" : "max-w-full max-h-full object-contain cursor-zoom-in"} />
        )}
      </div>
    </div>,
    document.body
  );
}
