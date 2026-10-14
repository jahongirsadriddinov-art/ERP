import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Socket } from "socket.io-client";
import type { AppUser } from "../App";
import { getSocket } from "../socket";
import { subscribe, decideAiIncoming, setAiCallActive } from "./bus";
import { AIV_CLIENT_EVENTS, AIV_SERVER_EVENTS, type AivDeclineReq, type AivIncoming } from "./protocol";

// AI ovozli yordamchi ildizi — App.tsx'da BIR marta montaj qilinadi (AIAssistant yonida).
// STUB (P1): ilova ichidagi audio hali yo'q (P7), shu sabab:
//  - aiv:incoming kelsa darhol rad etamiz: WebRTC qo'ng'iroqda bo'lsa 'busy', aks holda 'unsupported'
//    (server kutib qolmasdan keyingi kanalga o'tadi);
//  - "AI bilan gaplashish" tugmasi bosilsa — "tez orada" xabari.
// P7 shu faylni useAiVoiceSession + AiIncomingCall + AiVoiceCallOverlay bilan to'ldiradi.
export default function AiVoiceRoot({ currentUser, busy }: { currentUser: AppUser; busy: boolean }) {
  const { t } = useTranslation();
  const busyRef = useRef(busy); busyRef.current = busy;
  const tRef = useRef(t); tRef.current = t;

  // Header tugmasi (AIAssistant/ChatPage) → bus.openAiVoiceCall()
  useEffect(() => subscribe(e => {
    if (e.type === 'open') toast.message(tRef.current('aiVoiceCall.comingSoon'));
  }), []);

  // Socket App.tsx'da ulanadi va foydalanuvchi almashganda qayta yaratiladi — shu sabab
  // getSocket()'ni vaqti-vaqti bilan tekshirib, tinglovchini joriy socket'ga ko'chiramiz.
  useEffect(() => {
    let attached: Socket | null = null;
    const onIncoming = (d: AivIncoming) => {
      if (!d || typeof d.sessionId !== 'string' || !attached) return;
      const decision = decideAiIncoming({ busy: busyRef.current, supported: false });
      if (decision === 'ring') return; // P7: jiringlash UI
      const req: AivDeclineReq = { sessionId: d.sessionId, reason: decision };
      attached.emit(AIV_CLIENT_EVENTS.decline, req);
    };
    const sync = () => {
      const s = getSocket();
      if (s === attached) return;
      attached?.off(AIV_SERVER_EVENTS.incoming, onIncoming);
      attached = s;
      attached?.on(AIV_SERVER_EVENTS.incoming, onIncoming);
    };
    sync();
    const iv = window.setInterval(sync, 2000);
    return () => {
      window.clearInterval(iv);
      attached?.off(AIV_SERVER_EVENTS.incoming, onIncoming);
      attached = null;
    };
  }, [currentUser.id]);

  // Hech qachon "faol" holat osilib qolmasin (logout / unmount)
  useEffect(() => () => setAiCallActive(false), []);

  return null;
}
