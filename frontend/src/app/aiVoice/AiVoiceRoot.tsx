import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { AppUser } from "../App";
import { subscribe } from "./bus";
import { getAiStatus, useAiStatus } from "./aiStatus";
import { useAiVoiceSession } from "./useAiVoiceSession";
import AiIncomingCall from "./AiIncomingCall";
import AiVoiceCallOverlay from "./AiVoiceCallOverlay";
import { AiChatThread } from "./chat/AiChatContact";

// AI ovozli yordamchi ildizi — App.tsx'da BIR marta montaj qilinadi (lazy). Bitta AiVoiceController:
//  - kiruvchi aiv:incoming → AiIncomingCall (WebRTC qo'ng'iroq paytida avtomatik 'busy' rad etiladi);
//  - bus.openAiVoiceCall() (AIAssistant / chatdagi AI kontakti) → chiquvchi qo'ng'iroq;
//  - qo'ng'iroq oynasi va xato bo'lsa "Yozib so'rash" — AI chat oynasi (pastdan chiquvchi panel).

export default function AiVoiceRoot({ currentUser, busy }: { currentUser: AppUser; busy: boolean }) {
  const { t, i18n } = useTranslation();
  const tRef = useRef(t); tRef.current = t;
  const langRef = useRef<"uz" | "ru">("uz");
  langRef.current = i18n.language === "ru" ? "ru" : "uz";
  const [chatOpen, setChatOpen] = useState(false);

  useAiStatus(currentUser.id);

  const { state, controller } = useAiVoiceSession({
    busy,
    deps: {
      lang: () => langRef.current,
      onNotice: (k) => toast.message(tRef.current(k === "busyWebrtc" ? "aiVoiceCall.busyWebrtc" : "aiVoiceCall.unsupported")),
      attentionText: () => ({ title: tRef.current("aiVoiceCall.incomingTitle"), body: tRef.current("aiVoiceCall.incomingBody") }),
    },
  });

  // "AI bilan gaplashish" (bus) — sinxron: AudioContext foydalanuvchi bosishi ichida ochiladi
  useEffect(() => subscribe((e) => {
    if (e.type === "chat") { setChatOpen(true); return; }
    if (e.type !== "open") return;
    const s = getAiStatus();
    if (s.loaded && !s.aiActive) { toast.message(tRef.current("aiVoiceCall.errServerDisabled")); return; }
    setChatOpen(false);
    controller.startOutgoing();
  }), [controller]);

  // Matnli chat paneli: Esc bilan yopiladi
  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setChatOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [chatOpen]);

  const st = state.status;
  const showOverlay = st !== "idle" && st !== "incoming";

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {st === "incoming" && <AiIncomingCall state={state} controller={controller} />}
      {showOverlay && (
        <AiVoiceCallOverlay
          state={state}
          controller={controller}
          onWriteInstead={() => { controller.dismiss(); setChatOpen(true); }}
        />
      )}
      {chatOpen && !showOverlay && (
        <div className="fixed inset-0 z-[105] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setChatOpen(false)}>
          <div className="w-full sm:max-w-md h-[88dvh] sm:h-[min(680px,90vh)] rounded-t-3xl sm:rounded-3xl bg-background border border-border shadow-2xl overflow-hidden flex flex-col animate-slide-up-fade" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <AiChatThread userId={currentUser.id} onBack={() => setChatOpen(false)} backAlways />
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
