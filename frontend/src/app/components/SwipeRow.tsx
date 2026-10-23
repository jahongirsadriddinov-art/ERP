import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MorphIcon, type IconNode } from "morphicons/react";
import Info from "@hugeicons/core-free-icons/InformationCircleIcon";
import { IconTile } from "./IconTile";

// Telefon/planshetda ro'yxat qatori (owner 2026-10-22: "Telegramdagidek o'ngdan surilganda o'zgartirish va o'chirish
// chiqsin, yoki ustiga bosganda chiqsin — ikkalasi ham"):
//  • chapga surish — qator o'ngidan amal tugmalari chiqadi (boshqa joyga tegilsa yopiladi);
//  • bosish — pastdan amallar ro'yxati (ActionSheet) ochiladi; kompyuterda ham shu (o'ng tugma ham).
// Amallar bo'lmasa — oddiy bosiladigan qator.

export interface RowAction {
  key: string;
  label: string;
  icon?: IconNode;
  tone?: "default" | "danger" | "primary";
  onClick: () => void;
  /** data-testid (ActionSheet tugmasi uchun) */
  testId?: string;
}

const REVEAL_W = 76;   // har tugma kengligi (px)

export function SwipeRow({ actions, onOpen, children, className = "", testId }: {
  actions: RowAction[]; onOpen?: () => void; children: ReactNode; className?: string; testId?: string;
}) {
  const [dx, setDx] = useState(0);
  const [sheet, setSheet] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; locked: "h" | "v" | null } | null>(null);
  const moved = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const max = actions.length * REVEAL_W;

  // Ochiq holatda boshqa joyga tegilsa — yopiladi
  useEffect(() => {
    if (dx === 0) return;
    const close = (e: Event) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setDx(0); };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("scroll", close, true); };
  }, [dx]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (!actions.length) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, base: dx, locked: null };
    moved.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    const t = e.touches[0];
    const ddx = t.clientX - s.x, ddy = t.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      s.locked = Math.abs(ddx) > Math.abs(ddy) ? "h" : "v";
    }
    if (s.locked !== "h") return;
    moved.current = true;
    setDx(Math.max(-max - 24, Math.min(0, s.base + ddx)));
  };
  const onTouchEnd = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.locked !== "h") return;
    setDx((v) => (v < -max / 2 ? -max : 0));
  };

  const click = () => {
    if (moved.current) { moved.current = false; return; }
    if (dx !== 0) { setDx(0); return; }
    if (actions.length) setSheet(true); else onOpen?.();
  };

  return (
    <div ref={rootRef} className={`relative overflow-hidden rounded-2xl ${className}`} data-testid={testId}>
      {actions.length > 0 && (
        <div className="absolute inset-y-0 right-0 flex" style={{ width: max }} aria-hidden={dx === 0}>
          {actions.map((a) => (
            <button key={a.key} type="button" tabIndex={dx === 0 ? -1 : 0}
              onClick={(e) => { e.stopPropagation(); setDx(0); a.onClick(); }}
              className={`flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold text-white ${a.tone === "danger" ? "bg-red-600" : a.tone === "primary" ? "bg-primary" : "bg-slate-600"}`}>
              {a.icon && <MorphIcon icon={a.icon} className="w-5 h-5" />}{a.label}
            </button>
          ))}
        </div>
      )}
      <div
        role="button" tabIndex={0}
        onClick={click}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); click(); } }}
        onContextMenu={(e) => { if (actions.length) { e.preventDefault(); setSheet(true); } }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
        className="relative bg-card touch-pan-y select-none"
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? "none" : "transform 220ms cubic-bezier(.2,.8,.2,1)" }}
      >
        {children}
      </div>
      {sheet && (
        <ActionSheet onClose={() => setSheet(false)} actions={[
          ...(onOpen ? [{ key: "__open", label: "", onClick: onOpen } as RowAction] : []),
          ...actions,
        ]} />
      )}
    </div>
  );
}

/** Pastdan chiqadigan amallar ro'yxati (telefon) / markazdagi kichik oyna (kompyuter). */
export function ActionSheet({ actions, onClose, title, header, testId }: { actions: RowAction[]; onClose: () => void; title?: string; header?: ReactNode; testId?: string }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div className="absolute inset-0 bg-black/45 animate-fade-in" onClick={onClose} />
      <div className="relative w-full sm:max-w-sm bg-card text-foreground rounded-t-3xl sm:rounded-3xl p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl animate-slide-up-fade">
        <div className="mx-auto mt-1 mb-2 h-1.5 w-10 rounded-full bg-muted sm:hidden" />
        {title && <p className="px-4 py-2 text-xs font-semibold text-muted-foreground">{title}</p>}
        {header}
        {/* Har bir amal — alohida tugma, rangli ikonka bilan (owner 2026-10-23: "ajralib turadigan qil") */}
        <div className="flex flex-col gap-2 px-1.5 pb-1">
          {actions.map((a) => (
            <button key={a.key} type="button" data-testid={a.testId} onClick={() => { onClose(); a.onClick(); }}
              className={`sheet-action ${a.tone === "danger" ? "sheet-action--danger" : a.tone === "primary" ? "sheet-action--primary" : ""}`}>
              <IconTile icon={a.icon || Info} size="sm" variant="soft" tone={a.tone === "danger" ? "red" : a.tone === "primary" ? "blue" : "slate"} />
              <span className="flex-1 text-left">{a.label || <OpenLabel />}</span>
            </button>
          ))}
          <button type="button" onClick={onClose} className="mt-1 h-12 rounded-2xl text-[15px] font-semibold text-muted-foreground hover:bg-muted/60" data-testid="sheet-cancel">
            <CancelLabel />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function OpenLabel() {
  // "Batafsil" — tarjimasiz komponentlar uchun; ota komponent o'z matnini yuborsa u ishlatiladi
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "uz";
  return <>{lang.startsWith("ru") ? "Подробнее" : "Batafsil"}</>;
}

function CancelLabel() {
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "uz";
  return <>{lang.startsWith("ru") ? "Отмена" : "Bekor qilish"}</>;
}
