// Ro'yxatdagi bitta suhbat qatori (Telegram uslubi): avatar, ism, oxirgi xabar, vaqt, o'qilmagan belgisi.
// Telefonda chapga surilsa (swipe) — "O'qildi / Ovozsiz / Qadash" tugmalari ochiladi; kompyuterda — o'ng tugma.
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Pin from "@hugeicons/core-free-icons/PinIcon";
import PinOff from "@hugeicons/core-free-icons/PinOffIcon";
import VolumeX from "@hugeicons/core-free-icons/VolumeOffIcon";
import Volume2 from "@hugeicons/core-free-icons/VolumeHighIcon";
import CheckCheck from "@hugeicons/core-free-icons/Tick02Icon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";

const ACTION_W = 68;

export interface ChatRowProps {
  rowKey: string;
  title: ReactNode;
  avatar: ReactNode;
  preview: ReactNode;
  time: string;
  unread: number;
  tick?: "sent" | "read" | null;
  active: boolean;
  compact: boolean;
  pinned: boolean;
  muted: boolean;
  swiped: boolean;
  onSwipe: (open: boolean) => void;
  onOpen: () => void;
  onTogglePin?: () => void;
  onToggleMute?: () => void;
  onMarkRead?: () => void;
}

export function ChatRow(p: ChatRowProps) {
  const { t } = useTranslation();
  const actions = [
    p.unread > 0 && p.onMarkRead ? { k: "read", label: t("chatUi.markRead"), icon: CheckCheck, cls: "bg-sky-500", fn: p.onMarkRead } : null,
    p.onToggleMute ? { k: "mute", label: p.muted ? t("chatUi.unmute") : t("chatUi.mute"), icon: p.muted ? Volume2 : VolumeX, cls: "bg-slate-500", fn: p.onToggleMute } : null,
    p.onTogglePin ? { k: "pin", label: p.pinned ? t("chatUi.unpin") : t("chatUi.pin"), icon: p.pinned ? PinOff : Pin, cls: "bg-emerald-600", fn: p.onTogglePin } : null,
  ].filter(Boolean) as { k: string; label: string; icon: any; cls: string; fn: () => void }[];
  const maxShift = actions.length * ACTION_W;

  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; base: number; horiz: boolean | null } | null>(null);
  const offset = drag ?? (p.swiped ? -maxShift : 0);

  const onTouchStart = (e: React.TouchEvent) => {
    if (!actions.length) return;
    const tt = e.touches[0];
    start.current = { x: tt.clientX, y: tt.clientY, base: p.swiped ? -maxShift : 0, horiz: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current; if (!s) return;
    const tt = e.touches[0];
    const dx = tt.clientX - s.x, dy = tt.clientY - s.y;
    if (s.horiz === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
    }
    if (!s.horiz) return;
    setDrag(Math.max(-maxShift - 24, Math.min(0, s.base + dx)));
  };
  const onTouchEnd = () => {
    const s = start.current; start.current = null;
    if (!s || !s.horiz || drag === null) { setDrag(null); return; }
    const open = drag < -maxShift / 2.4;
    setDrag(null);
    p.onSwipe(open);
  };

  const sz = avatarSize(p.compact);
  return (
    <div data-testid={`chat-row-${p.rowKey}`} className="relative overflow-hidden" onContextMenu={(e) => { if (!actions.length) return; e.preventDefault(); p.onSwipe(!p.swiped); }}>
      {/* Surilganda ochiladigan amallar */}
      {actions.length > 0 && (p.swiped || offset !== 0) && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: maxShift }} aria-hidden={!p.swiped}>
          {actions.map((a) => (
            <button key={a.k} type="button" tabIndex={p.swiped ? 0 : -1} data-testid={`chat-row-action-${a.k}`}
              onClick={(e) => { e.stopPropagation(); a.fn(); p.onSwipe(false); }}
              className={`${a.cls} text-white flex flex-col items-center justify-center gap-1 text-[11px] font-medium`} style={{ width: ACTION_W }}>
              <MorphIcon icon={a.icon} className="w-5 h-5" />
              <span className="leading-none truncate max-w-[60px]">{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => (p.swiped ? p.onSwipe(false) : p.onOpen())}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
        aria-current={p.active ? "true" : undefined}
        className={`relative w-full flex items-center gap-3 text-left bg-card touch-pan-y ${p.compact ? "px-3 py-1.5" : "px-3 py-2"}
          ${p.active ? "!bg-primary text-primary-foreground" : "hover:bg-muted/60 active:bg-muted"}
          ${drag === null ? "transition-transform duration-200 ease-out" : ""}`}
        style={{ transform: offset ? `translate3d(${offset}px,0,0)` : undefined }}
      >
        {p.avatar}
        {!p.active && <span aria-hidden className="absolute bottom-0 right-0 h-px bg-border/60" style={{ left: sz + 24 }} />}
        <span className={`flex-1 min-w-0 flex flex-col ${p.compact ? "gap-0" : "gap-0.5"}`}>
          <span className="flex items-center gap-1.5 min-w-0">
            <span className={`truncate min-w-0 font-semibold ${p.compact ? "text-[14px]" : "text-[15px]"}`}>{p.title}</span>
            {p.muted && <MorphIcon icon={VolumeX} aria-label={t("chatUi.mutedLabel")} className={`w-3.5 h-3.5 flex-shrink-0 ${p.active ? "opacity-80" : "text-muted-foreground"}`} />}
            <span className="ml-auto flex items-center gap-1 flex-shrink-0 pl-1">
              {p.tick && <MorphIcon icon={p.tick === "read" ? CheckCheck : Check} className={`w-4 h-4 ${p.active ? "" : "text-emerald-600 dark:text-emerald-400"}`} />}
              <span className={`text-[12px] tabular-nums ${p.active ? "opacity-80" : p.unread > 0 && !p.muted ? "text-primary font-semibold" : "text-muted-foreground"}`}>{p.time}</span>
            </span>
          </span>
          <span className="flex items-center gap-2 min-w-0">
            <span className={`truncate min-w-0 flex-1 ${p.compact ? "text-[13px]" : "text-[14px]"} ${p.active ? "opacity-85" : "text-muted-foreground"}`}>{p.preview}</span>
            {p.unread > 0 ? (
              <span data-testid="chat-unread-badge" aria-label={t("chatUi.unreadCount", { count: p.unread })}
                className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-[12px] font-semibold flex items-center justify-center leading-none flex-shrink-0
                  ${p.active ? "bg-primary-foreground text-primary" : p.muted ? "bg-muted-foreground/45 text-white" : "bg-primary text-primary-foreground"}`}>
                {p.unread > 999 ? "999+" : p.unread}
              </span>
            ) : p.pinned ? (
              <MorphIcon icon={Pin} aria-label={t("chatUi.pinnedLabel")} className={`w-4 h-4 flex-shrink-0 rotate-45 ${p.active ? "opacity-80" : "text-muted-foreground"}`} />
            ) : null}
          </span>
        </span>
      </button>
    </div>
  );
}

export const avatarSize = (compact: boolean) => (compact ? 40 : 52);
