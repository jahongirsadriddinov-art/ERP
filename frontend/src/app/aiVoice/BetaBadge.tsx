import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

// "Beta" belgisi (egasi so'rovi #1) — AI tugmalari, sozlamalar, chatdagi AI kontakti va qo'ng'iroq oynasida.
// Sichqoncha ustiga kelganda, fokusda (Tab) yoki bosilganda (telefon) qisqa tushuntirish chiqadi:
// beta nima va hozirgi cheklovlar. Oyna portal orqali (overflow-hidden ota-elementlar kesmasin), ekran
// chetlariga siqiladi, Esc / tashqariga bosish bilan yopiladi.
//
// interactive=false — tugma ICHIDA ishlatish uchun (tugma ichida tugma bo'lmaydi): fokuslanmaydi, faqat
// sichqoncha bilan ko'rsatadi; tushuntirish ichki sahifadagi interaktiv belgi orqali o'qiladi.

export interface BetaBadgeProps {
  className?: string;
  /** "dark" — qorong'i fon (qo'ng'iroq oynasi) uchun. */
  tone?: "default" | "dark";
  size?: "xs" | "sm";
  interactive?: boolean;
}

const POP_W = 288;
const MARGIN = 12;

export default function BetaBadge({ className = "", tone = "default", size = "xs", interactive = true }: BetaBadgeProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const btnRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false); // bosish bilan ochilgan — sichqoncha chiqsa ham yopilmaydi
  const id = useId();

  const cancelHide = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  const show = useCallback(() => { cancelHide(); setOpen(true); }, []);
  const hideSoon = useCallback(() => {
    if (pinned.current) return;
    cancelHide();
    hideTimer.current = setTimeout(() => setOpen(false), 140);
  }, []);
  const close = useCallback(() => { cancelHide(); pinned.current = false; setOpen(false); }, []);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(POP_W, vw - MARGIN * 2);
    const left = Math.max(MARGIN, Math.min(r.left + r.width / 2 - w / 2, vw - w - MARGIN));
    const popH = popRef.current?.offsetHeight || 170;
    const below = r.bottom + 8 + popH <= vh - MARGIN || r.top < popH + 16;
    setPos(below ? { left, top: r.bottom + 8, width: w } : { left, top: Math.max(MARGIN, r.top - 8 - popH), width: w });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const onDown = (e: PointerEvent) => {
      const tgt = e.target as Node;
      if (btnRef.current?.contains(tgt) || popRef.current?.contains(tgt)) return;
      close();
    };
    const onMove = () => place();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, close, place]);

  useEffect(() => () => cancelHide(), []);

  const sz = size === "sm" ? "text-[10px] px-2 py-[3px]" : "text-[9px] px-1.5 py-[2px]";
  const look = tone === "dark"
    ? "bg-white/15 text-white ring-1 ring-white/25"
    : "text-white shadow-sm";
  const style: CSSProperties | undefined = tone === "dark" ? undefined : { background: "linear-gradient(135deg, var(--primary), var(--accent))" };
  const base = `inline-flex items-center rounded-full font-bold uppercase tracking-wider leading-none select-none flex-shrink-0 ${sz} ${look} ${className}`;

  const popover = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={popRef}
      id={id}
      role="tooltip"
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      className="fixed z-[400] rounded-2xl border border-border bg-card text-card-foreground shadow-2xl p-3.5 text-left animate-pop-in"
      style={{ ...(pos || { left: -9999, top: -9999, width: POP_W }) }}
    >
      <p className="text-[13px] font-bold flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-full px-1.5 py-[2px] text-[9px] font-bold uppercase tracking-wider text-white" style={{ background: "linear-gradient(135deg, var(--primary), var(--accent))" }}>{t("aiVoiceCall.betaLabel")}</span>
        {t("aiVoiceCall.betaTitle")}
      </p>
      <p className="text-xs text-muted-foreground mt-1.5">{t("aiVoiceCall.betaIntro")}</p>
      <ul className="mt-1.5 space-y-1 text-xs leading-snug">
        {(["betaP1", "betaP2", "betaP3"] as const).map((k) => (
          <li key={k} className="flex gap-1.5"><span aria-hidden className="text-primary mt-[1px]">•</span><span>{t(`aiVoiceCall.${k}`)}</span></li>
        ))}
      </ul>
    </div>,
    document.body,
  ) : null;

  if (!interactive) {
    return (
      <>
        <span ref={(n) => { btnRef.current = n; }} className={base} style={style} onMouseEnter={show} onMouseLeave={hideSoon} aria-hidden>
          {t("aiVoiceCall.betaLabel")}
        </span>
        {popover}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        ref={(n) => { btnRef.current = n; }}
        className={`${base} cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1`}
        style={style}
        aria-label={t("aiVoiceCall.betaAria")}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        data-testid="ai-beta-badge"
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={(e) => { if (!popRef.current?.contains(e.relatedTarget as Node)) close(); }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (open && pinned.current) close();
          else { pinned.current = true; show(); }
        }}
      >
        {t("aiVoiceCall.betaLabel")}
      </button>
      {popover}
    </>
  );
}
