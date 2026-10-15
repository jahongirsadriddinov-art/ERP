import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import AiSparkles from "@hugeicons/core-free-icons/AiSparklesIcon";
import Cancel from "@hugeicons/core-free-icons/Cancel01Icon";
import BetaBadge from "../BetaBadge";
import { useAiStatus } from "../aiStatus";
import { setGroupAi, useGroupAi } from "./aiGroup";

// Guruh sarlavhasidagi "AI yordamchi" tugmasi (egasi so'rovi, 2026-10-15): AI guruhda bo'lsa — rangli,
// bosilganda oyna: qanday ishlashi, maxfiylik qoidasi, qo'shish/chiqarish. AI firmada o'chiq bo'lsa — ko'rinmaydi.

const GRADIENT = { background: "linear-gradient(135deg, var(--primary), var(--accent))" } as const;

export default function AiGroupButton({ groupId, userId }: { groupId: string; userId: string }) {
  const { t } = useTranslation();
  const status = useAiStatus(userId);
  const g = useGroupAi(groupId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!status.aiActive) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const want = !g.enabled;
    const err = await setGroupAi(groupId, want);
    setBusy(false);
    if (err) {
      toast.error(t(err === "denied" ? "aiVoiceCall.groupRemoveDenied" : err === "ai_disabled" ? "aiVoiceCall.errDisabled" : "aiVoiceCall.errSend"));
      return;
    }
    toast.success(t(want ? "aiVoiceCall.groupAdded" : "aiVoiceCall.groupRemoved"));
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={g.enabled ? t("aiVoiceCall.groupOnBadge") : t("aiVoiceCall.groupBtn")}
        aria-label={t("aiVoiceCall.groupBtn")}
        aria-pressed={g.enabled}
        data-testid="ai-group-btn"
        className={`btn w-9 h-9 p-0 rounded-full relative ${g.enabled ? "text-white shadow-sm" : "btn-ghost text-primary"}`}
        style={g.enabled ? GRADIENT : undefined}
      >
        <MorphIcon icon={AiSparkles} className="w-[18px] h-[18px]" />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)}>
          <div
            role="dialog" aria-modal="true" aria-labelledby="ai-group-title" data-testid="ai-group-dialog"
            className="w-full sm:max-w-sm max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-3xl bg-card border border-border shadow-2xl animate-slide-up-fade"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-1 flex items-start gap-3">
              <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm" style={GRADIENT}>
                <MorphIcon icon={AiSparkles} className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p id="ai-group-title" className="text-base font-bold truncate">{t("aiVoiceCall.groupTitle")}</p>
                  <BetaBadge />
                </div>
                <p className={`text-xs mt-0.5 font-medium ${g.enabled ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                  {g.enabled ? t("aiVoiceCall.groupOnBadge") : t("aiVoiceCall.groupIntro")}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("aiVoiceCall.close")} className="p-2 -mr-2 -mt-1 rounded-full text-muted-foreground hover:bg-muted">
                <MorphIcon icon={Cancel} className="w-4 h-4" />
              </button>
            </div>
            <ul className="px-5 py-3 space-y-2.5 text-sm">
              {(["groupHow", "groupPerms", "groupPrivacy"] as const).map((k) => (
                <li key={k} className="flex gap-2.5 leading-snug">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={GRADIENT} />
                  <span className="text-foreground/90">{t(`aiVoiceCall.${k}`)}</span>
                </li>
              ))}
            </ul>
            <div className="px-5 pt-1">
              {g.enabled && !g.canManage ? (
                <p className="text-xs text-muted-foreground text-center py-2">{t("aiVoiceCall.groupRemoveDenied")}</p>
              ) : (
                <button
                  type="button" onClick={() => void toggle()} disabled={busy || !g.loaded} data-testid="ai-group-toggle"
                  className={`w-full h-11 rounded-2xl font-semibold text-sm disabled:opacity-50 active:scale-[0.99] liquid-transition ${g.enabled ? "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15" : "text-white shadow-sm"}`}
                  style={g.enabled ? undefined : GRADIENT}
                >
                  {g.enabled ? t("aiVoiceCall.groupRemove") : t("aiVoiceCall.groupAdd")}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
