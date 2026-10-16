import { useEffect, useRef, useSyncExternalStore } from "react";
import { API_BASE } from "../api";
import { isAndroid } from "../platform";
import { getSocket } from "../socket";
import { AiVoiceController, type AiVoiceDeps, type AudioCtxLike, type DocLike, type SocketLike } from "./aiVoiceController";
import type { AivIncoming } from "./protocol";
import { audioSupported, createAudioContext, openMic, PcmCapture } from "./audio/pcmCapture";
import { PcmPlayer } from "./audio/pcmPlayer";
import { startIncomingAttention, startRingtone } from "./nativeAttention";
import { createTtsFallback } from "./ttsFallback";
import { aiActiveOrNull, subscribeAiStatus } from "./aiStatus";

// AI ovozli suhbat — React hook va haqiqiy (brauzer) bog'liqliklar. Holat mashinasi aiVoiceController.ts'da.

export * from "./aiVoiceController";

type ExtraDeps = Partial<AiVoiceDeps> & { attentionText?: () => { title: string; body: string } };

export function createDefaultDeps(extra: ExtraDeps = {}): AiVoiceDeps {
  const { attentionText, ...rest } = extra;
  const base: AiVoiceDeps = {
    getSocket: () => getSocket() as unknown as SocketLike | null,
    supported: audioSupported,
    // A12: Android brauzeri va WebView AEC'i Web Audio ijrosini yaxshi bekor qilmaydi — ilova ham, sayt ham
    isAndroid: () => isAndroid() || (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "")),
    createContext: () => createAudioContext() as unknown as AudioCtxLike,
    openMic: () => openMic(),
    createCapture: (ctx, stream, onFrame) => PcmCapture.create(ctx as unknown as AudioContext, stream as MediaStream, onFrame),
    createPlayer: (ctx, onState) => PcmPlayer.create(ctx as unknown as AudioContext, { onState }),
    listOutputs: async () => {
      const list = await navigator.mediaDevices.enumerateDevices();
      return list.filter((d) => d.kind === "audiooutput").map((d, i) => ({ id: d.deviceId, label: d.label || `#${i + 1}` }));
    },
    startRing: startRingtone,
    startAttention: () => startIncomingAttention(attentionText ? attentionText() : { title: "AI", body: "" }),
    fetchPending: async () => {
      try {
        const r = await fetch(`${API_BASE}/api/ai-voice/me/pending-call`, { cache: "no-store" });
        if (!r.ok) return null;
        const j = await r.json();
        return j && j.call && typeof j.call.sessionId === "string" ? (j.call as AivIncoming) : null;
      } catch { return null; }
    },
    aiActive: aiActiveOrNull,
    tts: createTtsFallback(),
    doc: typeof document !== "undefined" ? (document as unknown as DocLike) : null,
    now: () => Date.now(),
    lang: () => "uz",
    onNotice: () => {},
    canAutoAccept,
  };
  return { ...base, ...rest };
}

/**
 * "Menga qo'ng'iroq qil" dan keyin AI qo'ng'irog'ini bosishsiz ulash mumkinmi: sahifada foydalanuvchi
 * harakati bo'lgan (AudioContext autoplay siyosati) va iOS emas (u yerda ovoz faqat bosish ichida ochiladi).
 */
export function canAutoAccept(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent || "")) return false;
    const ua = (navigator as any).userActivation as { hasBeenActive?: boolean } | undefined;
    return ua ? !!ua.hasBeenActive : true;
  } catch { return false; }
}

/** React hook: bitta controller (komponent umri davomida), holatga obuna. */
export function useAiVoiceSession(opts: { busy: boolean; deps?: ExtraDeps }) {
  const ref = useRef<AiVoiceController | null>(null);
  if (!ref.current) ref.current = new AiVoiceController(createDefaultDeps(opts.deps));
  const controller = ref.current;
  useEffect(() => {
    controller.start();
    // AI holati ma'lum bo'lganda (yoki yoqilganda) — presence va kutilayotgan qo'ng'iroq darhol
    const off = subscribeAiStatus(() => controller.notifyAiStatus());
    return () => { off(); controller.dispose(); };
  }, [controller]);
  useEffect(() => { controller.setBusy(opts.busy); }, [controller, opts.busy]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return { state, controller };
}
