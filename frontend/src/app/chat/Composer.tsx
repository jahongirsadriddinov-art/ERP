// Xabar yozish paneli: biriktirish menyusi, avtomatik balandlik, ovozli xabar yozish, yuborish.
// Telefonda klaviatura ochilganda (visualViewport) panel klaviatura ustida qoladi.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Paperclip from "@hugeicons/core-free-icons/Attachment01Icon";
import Send from "@hugeicons/core-free-icons/SendIcon";
import Mic from "@hugeicons/core-free-icons/Mic01Icon";
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import ImageIcon from "@hugeicons/core-free-icons/Image01Icon";
import Camera from "@hugeicons/core-free-icons/Camera01Icon";
import FileText from "@hugeicons/core-free-icons/FileTextIcon";
import MapPin from "@hugeicons/core-free-icons/PinLocation01Icon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import { toast } from "sonner";

/** Ekran klaviaturasi egallagan balandlik (px). Android ilovada (adjustResize) — 0. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const on = () => {
      const v = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      setInset(v > 60 ? v : 0); // kichik farqlar (manzil satri) — e'tiborsiz
    };
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    on();
    return () => { vv.removeEventListener("resize", on); vv.removeEventListener("scroll", on); };
  }, []);
  return inset;
}

export type AttachKind = "image" | "camera" | "file" | "location";

export function Composer({ value, onChange, onSubmit, editing, banner, onAttach, onVoice, keyboardInset }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  editing: boolean;
  banner?: ReactNode;
  onAttach: (k: AttachKind) => void;
  onVoice: (blob: Blob) => void;
  keyboardInset: number;
}) {
  const { t } = useTranslation();
  const [showAttach, setShowAttach] = useState(false);
  const [rec, setRec] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Matn tozalansa (yuborilgandan keyin) — balandlik asl holiga qaytadi
  useEffect(() => { if (!value && taRef.current) taRef.current.style.height = ""; }, [value]);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);
  useEffect(() => { if (editing) taRef.current?.focus(); }, [editing]);

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        onVoice(new Blob(chunksRef.current, { type: "audio/webm" }));
        stream.getTracks().forEach((tr) => tr.stop());
      };
      mr.start();
      mediaRecRef.current = mr;
      setRec(true); setRecSec(0);
      timerRef.current = setInterval(() => setRecSec((s) => s + 1), 1000);
    } catch { toast.error(t("chat.micPermission")); }
  };
  const stopRec = () => {
    mediaRecRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRec(false);
  };
  const cancelRec = () => {
    const mr = mediaRecRef.current;
    if (mr?.state === "recording") {
      mr.ondataavailable = null;
      mr.onstop = null;
      mr.stop();
      mr.stream.getTracks().forEach((tr) => tr.stop());
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setRec(false); chunksRef.current = [];
  };

  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const has = value.trim().length > 0;
  const pick = (k: AttachKind) => { setShowAttach(false); onAttach(k); };

  return (
    <div className="flex-shrink-0 relative z-10" onClick={(e) => e.stopPropagation()}>
      {banner}
      <div className="px-2 sm:px-3 pt-2" style={{ paddingBottom: keyboardInset ? keyboardInset + 8 : "max(0.5rem, env(safe-area-inset-bottom))" }}>
        {showAttach && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowAttach(false)} />
            <div role="menu" className="absolute bottom-full mb-1 left-3 glass p-1.5 rounded-2xl border border-white/20 shadow-2xl flex flex-col gap-0.5 animate-slide-up-fade z-50 min-w-[200px]">
              <button role="menuitem" type="button" onClick={() => pick("image")} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 rounded-xl text-sm"><MorphIcon icon={ImageIcon} className="w-5 h-5 text-blue-500" />{t("chat.attachImage")}</button>
              <button role="menuitem" type="button" onClick={() => pick("camera")} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 rounded-xl text-sm"><MorphIcon icon={Camera} className="w-5 h-5 text-rose-500" />{t("chat.attachCamera")}</button>
              <button role="menuitem" type="button" onClick={() => pick("file")} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 rounded-xl text-sm"><MorphIcon icon={FileText} className="w-5 h-5 text-orange-500" />{t("chat.attachFile")}</button>
              <button role="menuitem" type="button" onClick={() => pick("location")} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 rounded-xl text-sm"><MorphIcon icon={MapPin} className="w-5 h-5 text-green-500" />{t("chat.attachLocation")}</button>
            </div>
          </>
        )}
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          <div className="flex-1 min-w-0 flex items-end rounded-[22px] bg-card border border-border/70 shadow-sm focus-within:border-primary/50 transition-colors">
            {rec ? (
              <div className="flex-1 flex items-center gap-3 px-4 h-11">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                <span className="text-sm font-mono tabular-nums text-red-500">{fmt(recSec)}</span>
                <span className="text-xs text-muted-foreground flex-1 truncate">{t("chat.recording")}</span>
                <button type="button" aria-label={t("chat.cancelRecordingAria")} onClick={cancelRec} className="w-8 h-8 -mr-2 flex items-center justify-center text-muted-foreground hover:bg-muted rounded-full"><MorphIcon icon={X} className="w-4 h-4" /></button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => setShowAttach((v) => !v)} aria-label={t("chatUi.attach")} aria-expanded={showAttach}
                  className="w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0">
                  <MorphIcon icon={Paperclip} className="w-5 h-5" />
                </button>
                <textarea ref={taRef} rows={1} data-testid="chat-input"
                  className="flex-1 min-w-0 resize-none !bg-transparent !border-0 !shadow-none !ring-0 !rounded-none focus:outline-none max-h-36 overflow-y-auto leading-snug py-[11px] pr-3 text-[16px] sm:text-sm"
                  placeholder={t("chat.inputPlaceholder")}
                  value={value}
                  enterKeyHint="send"
                  onChange={(e) => { onChange(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 144) + "px"; }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as any).isComposing) { e.preventDefault(); onSubmit(); } }}
                />
              </>
            )}
          </div>
          {rec ? (
            <button type="button" aria-label={t("chat.sendVoiceAria")} onClick={stopRec} className="w-11 h-11 flex-shrink-0 bg-red-500 text-white rounded-full flex items-center justify-center active:scale-95 transition-transform shadow-md shadow-red-500/30"><MorphIcon icon={Send} className="w-5 h-5 ml-0.5" /></button>
          ) : has ? (
            <button type="button" data-testid="chat-send" aria-label={t("chat.sendMessageAria")} onClick={onSubmit}
              className="w-11 h-11 flex-shrink-0 bg-primary text-primary-foreground rounded-full flex items-center justify-center active:scale-95 transition-transform shadow-md shadow-primary/30">
              <MorphIcon icon={editing ? Check : Send} className="w-5 h-5 ml-0.5" />
            </button>
          ) : (
            <button type="button" aria-label={t("chat.recordVoiceAria")} onClick={startRec}
              className="w-11 h-11 flex-shrink-0 bg-card border border-border/70 text-muted-foreground hover:text-primary rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform">
              <MorphIcon icon={Mic} className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
