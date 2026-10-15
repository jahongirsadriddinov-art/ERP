import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import AiSparkles from "@hugeicons/core-free-icons/AiSparklesIcon";
import PhoneOff from "@hugeicons/core-free-icons/PhoneOff01Icon";
import Mic from "@hugeicons/core-free-icons/Mic01Icon";
import MicOff from "@hugeicons/core-free-icons/MicOff01Icon";
import Keyboard from "@hugeicons/core-free-icons/KeyboardIcon";
import Phone from "@hugeicons/core-free-icons/PhoneIcon";
import Speaker from "@hugeicons/core-free-icons/VolumeHighIcon";
import HandGrab from "@hugeicons/core-free-icons/HandGrabIcon";
import BetaBadge from "./BetaBadge";
import type { AiCallError, AiCallState, AiVoiceController } from "./aiVoiceController";

// AI bilan ovozli suhbat oynasi (design §8, review A10–A12): orb (AI gapirganda to'lqin), jonli matn
// (captions — doim oxirigacha), tool natijasi, tasdiq kartasi, ovozni o'chirish, "bosib gapirish"
// (Android'da standart), ovoz chiqishi tanlovi, tugatish va xato bo'lsa — "Yozib so'rash" (matnli zaxira).
// Telefonda — butun ekran; kompyuterda — markazda karta.

const GRADIENT = "linear-gradient(135deg, var(--primary), var(--accent))";

export function endReasonKey(reason: string | null): string {
  switch (reason) {
    case "completed": return "aiVoiceCall.endCompleted";
    case "timeout": return "aiVoiceCall.endTimeout";
    case "max_duration": return "aiVoiceCall.endMaxDuration";
    case "declined": return "aiVoiceCall.endDeclined";
    case "busy": return "aiVoiceCall.endBusy";
    case "answered_elsewhere": return "aiVoiceCall.endAnsweredElsewhere";
    case "error": return "aiVoiceCall.endError";
    case "shutdown": return "aiVoiceCall.endShutdown";
    case "revoked": return "aiVoiceCall.endRevoked";
    case "off_shift": return "aiVoiceCall.endOffShift";
    case "limit": return "aiVoiceCall.endLimit";
    case "unsupported_transport": return "aiVoiceCall.endUnsupportedTransport";
    case "network": return "aiVoiceCall.endNetwork";
    default: return "aiVoiceCall.endHangup";
  }
}

export function errorKey(err: AiCallError | null, reason: string | null): string {
  if (!err) return endReasonKey(reason);
  if (err.kind === "mic") {
    switch (err.code) {
      case "permission_denied": return "aiVoiceCall.micDenied";
      case "no_device": return "aiVoiceCall.micNoDevice";
      case "device_busy": return "aiVoiceCall.micBusy";
      case "insecure": return "aiVoiceCall.micInsecure";
      default: return "aiVoiceCall.endError";
    }
  }
  if (err.kind === "unsupported") return "aiVoiceCall.unsupported";
  if (err.kind === "timeout") return "aiVoiceCall.errTimeout";
  if (err.kind === "network") return "aiVoiceCall.endNetwork";
  if (err.code === "disabled" || err.code === "denied") return "aiVoiceCall.errServerDisabled";
  return endReasonKey(reason);
}

const TOOL_KEY: Record<string, string> = {
  ok: "aiVoiceCall.toolOk", denied: "aiVoiceCall.toolDenied", not_found: "aiVoiceCall.toolNotFound",
  error: "aiVoiceCall.toolError", needs_confirmation: "aiVoiceCall.toolNeedsConfirmation",
};

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function AiVoiceCallOverlay({ state, controller, onWriteInstead }: {
  state: AiCallState;
  controller: AiVoiceController;
  onWriteInstead: () => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const capRef = useRef<HTMLDivElement>(null);
  const hangRef = useRef<HTMLButtonElement>(null);
  const st = state.status;
  const ended = st === "ended";
  const connected = st === "connected";

  useEffect(() => {
    if (!connected) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [connected]);

  // Jonli matn doim oxirigacha ko'rinsin
  useLayoutEffect(() => {
    const el = capRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.captions]);

  useEffect(() => { hangRef.current?.focus({ preventScroll: true }); }, []);

  // Bosib gapirish: Probel tugmasi (kompyuter)
  useEffect(() => {
    if (!connected || !state.ptt.mode) return;
    const isField = (e: KeyboardEvent) => /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName || "");
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !e.repeat && !isField(e)) { e.preventDefault(); controller.pttDown(); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space" && !isField(e)) { e.preventDefault(); controller.pttUp(); } };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); controller.pttUp(); };
  }, [connected, state.ptt.mode, controller]);

  const statusText = ended
    ? t(errorKey(state.error, state.endReason))
    : st === "reconnecting" ? t("aiVoiceCall.reconnecting")
      : st === "ringing" ? t("aiVoiceCall.statusRinging")
        : st === "connecting" ? t("aiVoiceCall.connecting")
          : state.aiSpeaking ? t("aiVoiceCall.speaking")
            : state.ptt.mode && !state.ptt.held ? t("aiVoiceCall.pttHold")
              : t("aiVoiceCall.listening");
  const timer = connected && state.connectedAt ? fmtDur(now - state.connectedAt) : null;
  const speaking = connected && state.aiSpeaking;
  const listening = connected && !state.aiSpeaking && !state.muted && (!state.ptt.mode || state.ptt.held);

  return (
    <div className="fixed inset-0 z-[110] flex items-stretch sm:items-center justify-center sm:p-6 bg-black/60 sm:backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="aiv-title" data-testid="ai-call-overlay">
      <div className="relative w-full h-full sm:h-[min(720px,92vh)] sm:max-w-[420px] sm:rounded-[28px] overflow-hidden flex flex-col text-white bg-[#0A0E1C] sm:shadow-2xl sm:ring-1 sm:ring-white/10">
        {/* Dekorativ porlash */}
        <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full opacity-30 blur-3xl" style={{ background: "radial-gradient(circle, var(--primary), transparent 65%)" }} />

        {/* Yuqori qism */}
        <div className="relative flex-shrink-0 px-5 pb-2 flex items-start gap-3" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p id="aiv-title" className="font-semibold text-[15px] truncate">{t("aiVoiceCall.contactName")}</p>
              <BetaBadge tone="dark" />
            </div>
            <p className="text-xs text-white/60 mt-0.5 tabular-nums" aria-live="polite" data-testid="ai-call-status">
              {timer ? `${t("aiVoiceCall.statusConnected")} · ${timer}` : !ended ? statusText : t("aiVoiceCall.ended")}
            </p>
          </div>
          {state.canSelectOutput && !ended && (
            <label className="flex items-center gap-1.5 bg-white/10 rounded-full pl-2.5 pr-1 py-1 text-[11px] max-w-[46%]">
              <MorphIcon icon={Speaker} className="w-3.5 h-3.5 flex-shrink-0 text-white/70" />
              <span className="sr-only">{t("aiVoiceCall.output")}</span>
              <select value={state.sinkId} onChange={(e) => void controller.selectOutput(e.target.value)} className="bg-transparent outline-none min-w-0 truncate text-white [&>option]:text-black">
                {state.outputs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>

        {/* Orb */}
        <div className="relative flex-shrink-0 flex flex-col items-center pt-4 pb-3">
          <div className="relative w-36 h-36 sm:w-40 sm:h-40 flex items-center justify-center">
            {speaking && <>
              <span className="absolute inset-0 rounded-full animate-ping opacity-25" style={{ background: GRADIENT }} />
              <span className="absolute -inset-3 rounded-full animate-pulse opacity-20" style={{ background: GRADIENT }} />
            </>}
            {listening && <span className="absolute -inset-2 rounded-full ring-2 ring-white/25 animate-pulse" />}
            {(st === "connecting" || st === "ringing" || st === "reconnecting") && <span className="absolute -inset-2 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />}
            <div className={`relative w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center shadow-2xl transition-transform duration-300 ${speaking ? "scale-105" : ""} ${ended ? "opacity-60 grayscale" : ""}`} style={{ background: GRADIENT }}>
              <MorphIcon icon={AiSparkles} className="w-12 h-12 text-white" />
            </div>
          </div>
          <p className={`mt-4 text-sm font-medium text-center px-6 ${ended && state.error ? "text-red-300" : "text-white/85"}`} data-testid="ai-call-status-text">{statusText}</p>
          {!ended && <p className="mt-1 text-[11px] text-white/45 text-center px-8">{t("aiVoiceCall.disclosure")}</p>}
        </div>

        {/* Jonli matn */}
        <div ref={capRef} className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-2 space-y-2" data-testid="ai-call-captions" aria-live="polite">
          {state.captions.length === 0 && connected && (
            <p className="text-center text-xs text-white/40 pt-4">{t("aiVoiceCall.captionsEmpty")}</p>
          )}
          {state.captions.map((c) => (
            <div key={c.id} className={`flex ${c.role === "user" ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap break-words ${c.role === "user" ? "rounded-br-md" : "bg-white/[0.06] rounded-bl-md ring-1 ring-white/10"} ${c.final ? "" : "opacity-75"}`} style={c.role === "user" ? { background: "rgba(255,255,255,0.12)" } : undefined}>
                {c.text}
              </p>
            </div>
          ))}
        </div>

        {/* Tool natijasi */}
        {state.tool && !ended && (
          <div className="relative flex-shrink-0 px-4 pb-2 flex justify-center">
            <span className={`text-[11px] px-3 py-1.5 rounded-full max-w-full truncate ${state.tool.status === "ok" ? "bg-green-500/20 text-green-200" : state.tool.status === "needs_confirmation" ? "bg-amber-500/20 text-amber-200" : "bg-red-500/20 text-red-200"}`}>
              {t(TOOL_KEY[state.tool.status] || "aiVoiceCall.toolError")}{state.tool.message ? ` · ${state.tool.message}` : ""}
            </span>
          </div>
        )}

        {/* Tasdiq kartasi */}
        {state.confirm && !ended && (
          <div className="relative flex-shrink-0 mx-4 mb-3 rounded-2xl bg-amber-500/15 ring-1 ring-amber-400/40 p-3.5" data-testid="ai-call-confirm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-200">{t("aiVoiceCall.confirmTitle")}</p>
            <p className="text-sm mt-1 whitespace-pre-wrap break-words">{state.confirm.summary}</p>
            <div className="flex gap-2 mt-3">
              <button type="button" disabled={state.confirmBusy} onClick={() => void controller.respondConfirm(true)} className="flex-1 h-10 rounded-xl bg-green-500 text-white text-sm font-semibold active:scale-[0.98] disabled:opacity-50">{t("aiVoiceCall.confirmYes")}</button>
              <button type="button" disabled={state.confirmBusy} onClick={() => void controller.respondConfirm(false)} className="flex-1 h-10 rounded-xl bg-white/10 text-white text-sm font-semibold active:scale-[0.98] disabled:opacity-50">{t("aiVoiceCall.confirmNo")}</button>
            </div>
          </div>
        )}

        {/* Boshqaruv */}
        <div className="relative flex-shrink-0 px-5 pt-2" style={{ paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 0.75rem))" }}>
          {ended ? (
            <div className="flex flex-col gap-2.5 max-w-xs mx-auto">
              {state.error && state.direction === "outgoing" && (
                <button type="button" onClick={() => controller.startOutgoing()} className="h-12 rounded-2xl text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98]" style={{ background: GRADIENT }}>
                  <MorphIcon icon={Phone} className="w-5 h-5" />{t("aiVoiceCall.retryCall")}
                </button>
              )}
              {state.error && (
                <button type="button" onClick={onWriteInstead} data-testid="ai-call-write" className="h-12 rounded-2xl bg-white/10 text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98]">
                  <MorphIcon icon={Keyboard} className="w-5 h-5" />{t("aiVoiceCall.writeInstead")}
                </button>
              )}
              <button type="button" ref={hangRef} onClick={() => controller.dismiss()} data-testid="ai-call-close" className="h-11 rounded-2xl text-white/70 text-sm font-medium hover:bg-white/5">{t("aiVoiceCall.close")}</button>
            </div>
          ) : (
            <>
              {connected && state.ptt.mode && (
                <button
                  type="button"
                  data-testid="ai-call-ptt"
                  aria-pressed={state.ptt.held}
                  onPointerDown={(e) => { e.preventDefault(); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* */ } controller.pttDown(); }}
                  onPointerUp={() => controller.pttUp()}
                  onPointerCancel={() => controller.pttUp()}
                  onLostPointerCapture={() => controller.pttUp()}
                  onContextMenu={(e) => e.preventDefault()}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); e.stopPropagation(); controller.pttDown(); } }}
                  onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); controller.pttUp(); } }}
                  className={`w-full max-w-xs mx-auto mb-4 h-14 rounded-2xl flex items-center justify-center gap-2 font-semibold select-none touch-none transition-all ${state.ptt.held ? "scale-[0.98] text-white shadow-lg" : "bg-white/10 text-white/90"}`}
                  style={state.ptt.held ? { background: GRADIENT } : undefined}
                >
                  <MorphIcon icon={Mic} className="w-5 h-5" />
                  {state.ptt.held ? t("aiVoiceCall.pttRelease") : t("aiVoiceCall.pttHold")}
                </button>
              )}
              <div className="flex items-end justify-center gap-5">
                <div className="flex flex-col items-center gap-1.5">
                  <button type="button" onClick={() => controller.toggleMute()} aria-pressed={state.muted} aria-label={state.muted ? t("aiVoiceCall.unmute") : t("aiVoiceCall.mute")} data-testid="ai-call-mute"
                    className={`w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-colors ${state.muted ? "bg-white text-[#0A0E1C]" : "bg-white/10 text-white"}`}>
                    <MorphIcon icon={state.muted ? MicOff : Mic} className="w-6 h-6" />
                  </button>
                  <span className="text-[10.5px] text-white/55">{state.muted ? t("aiVoiceCall.unmute") : t("aiVoiceCall.mute")}</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <button type="button" ref={hangRef} onClick={() => controller.hangup()} aria-label={t("aiVoiceCall.hangup")} data-testid="ai-call-hangup"
                    className="w-[68px] h-[68px] rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center active:scale-95 shadow-lg shadow-red-500/30">
                    <MorphIcon icon={PhoneOff} className="w-7 h-7" />
                  </button>
                  <span className="text-[10.5px] text-white/55">{t("aiVoiceCall.hangup")}</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <button type="button" disabled={!connected || state.ptt.forced} onClick={() => controller.setPttMode(!state.ptt.mode)} aria-pressed={state.ptt.mode} title={t("aiVoiceCall.pttHint")} data-testid="ai-call-ptt-toggle"
                    className={`w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-colors disabled:opacity-40 ${state.ptt.mode ? "bg-white text-[#0A0E1C]" : "bg-white/10 text-white"}`}>
                    <MorphIcon icon={HandGrab} className="w-6 h-6" />
                  </button>
                  <span className="text-[10.5px] text-white/55 max-w-[84px] text-center leading-tight">{state.ptt.mode ? t("aiVoiceCall.pttModeOn") : t("aiVoiceCall.pttModeOff")}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
