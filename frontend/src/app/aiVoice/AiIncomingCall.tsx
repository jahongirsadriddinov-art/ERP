import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import AiSparkles from "@hugeicons/core-free-icons/AiSparklesIcon";
import Phone from "@hugeicons/core-free-icons/PhoneIcon";
import PhoneOff from "@hugeicons/core-free-icons/PhoneOff01Icon";
import BetaBadge from "./BetaBadge";
import type { AiCallState, AiVoiceController } from "./aiVoiceController";

// Kiruvchi AI qo'ng'irog'i (design §8). Jiringlash ovozi va tebranish — controller (nativeAttention).
// MUHIM: mikrofon FAQAT "Qabul qilish" bosilganda ochiladi (accept — foydalanuvchi harakati ichida, sinxron).
// Telefonda — butun ekran; kompyuterda — o'ng pastki burchakdagi karta (ishni to'smaydi).

const GRADIENT = "linear-gradient(135deg, var(--primary), var(--accent))";

export default function AiIncomingCall({ state, controller }: { state: AiCallState; controller: AiVoiceController }) {
  const { t } = useTranslation();
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { acceptRef.current?.focus({ preventScroll: true }); }, []);

  const purpose = state.purpose === "attendance" ? t("aiVoiceCall.purposeAttendance")
    : state.purpose === "reminder" ? t("aiVoiceCall.purposeReminder")
      : t("aiVoiceCall.purposeAssistant");

  return (
    <div className="fixed inset-0 sm:inset-auto sm:right-5 sm:bottom-5 z-[120] sm:w-[360px] animate-pop-in" role="alertdialog" aria-modal="false" aria-labelledby="aiv-in-title" aria-describedby="aiv-in-body" data-testid="ai-incoming-call">
      <div className="relative w-full h-full sm:h-auto overflow-hidden text-white bg-[#0A0E1C] sm:rounded-[24px] sm:shadow-2xl sm:ring-1 sm:ring-white/10 flex flex-col">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[420px] h-[420px] rounded-full opacity-30 blur-3xl" style={{ background: "radial-gradient(circle, var(--accent), transparent 65%)" }} />
        <div className="relative flex-1 flex flex-col items-center justify-center sm:justify-start px-6 pt-10 sm:pt-6 pb-6 text-center" style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top))" }}>
          <div className="relative w-28 h-28 sm:w-20 sm:h-20 flex items-center justify-center">
            <span className="absolute inset-0 rounded-full animate-ping opacity-30" style={{ background: GRADIENT }} />
            <div className="relative w-full h-full rounded-full flex items-center justify-center shadow-xl" style={{ background: GRADIENT }}>
              <MorphIcon icon={AiSparkles} className="w-11 h-11 sm:w-8 sm:h-8 text-white" />
            </div>
          </div>
          <div className="mt-5 sm:mt-4 flex items-center justify-center gap-2">
            <p id="aiv-in-title" className="text-lg sm:text-base font-semibold">{t("aiVoiceCall.contactName")}</p>
            <BetaBadge tone="dark" />
          </div>
          <p className="text-sm text-white/70 mt-1">{t("aiVoiceCall.incomingTitle")}</p>
          <p className="text-xs text-white/50 mt-1">{purpose}{state.companyName ? ` · ${state.companyName}` : ""}</p>
          <p id="aiv-in-body" className="text-[11px] text-white/40 mt-3">{t("aiVoiceCall.incomingBody")}</p>
        </div>
        <div className="relative flex items-start justify-center gap-14 sm:gap-10 px-6 pb-8 sm:pb-5" style={{ paddingBottom: "max(2rem, calc(env(safe-area-inset-bottom) + 1rem))" }}>
          <div className="flex flex-col items-center gap-2">
            <button type="button" onClick={() => controller.decline()} aria-label={t("aiVoiceCall.decline")} data-testid="ai-incoming-decline"
              className="w-16 h-16 sm:w-14 sm:h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center active:scale-95 shadow-lg shadow-red-500/30">
              <MorphIcon icon={PhoneOff} className="w-7 h-7 sm:w-6 sm:h-6" />
            </button>
            <span className="text-xs text-white/70">{t("aiVoiceCall.decline")}</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button type="button" ref={acceptRef} onClick={() => controller.accept()} aria-label={t("aiVoiceCall.accept")} data-testid="ai-incoming-accept"
              className="w-16 h-16 sm:w-14 sm:h-14 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center active:scale-95 shadow-lg shadow-green-500/30 animate-pulse">
              <MorphIcon icon={Phone} className="w-7 h-7 sm:w-6 sm:h-6" />
            </button>
            <span className="text-xs text-white/70">{t("aiVoiceCall.accept")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
