// ─── Global Skeleton Loading System ─────────────────────────────────────────
// Ataylab MUSTAQIL fayl: mavjud App.tsx/globals.css/theme.css'ga TEGINMAYDI —
// hozir boshqa Claude Code sessiyasi aynan o'sha fayllarda ishlayapti, shu
// bilan to'qnashmaslik uchun butun skeleton tizimi (komponentlar + animatsiya
// CSS'i) shu bitta faylda, o'z-o'zini yetarli qilib qurilgan. Animatsiya CSS'i
// <style> tegini birinchi Skeleton render bo'lganda document.head'ga BIR MARTA
// qo'shadi (pastda, useInjectSkeletonStyles) — hech qanday tashqi CSS fayl
// o'zgartirilishi shart emas.
//
// Mavjud dizayn tizimidan foydalanadi (theme.css'dagi CSS o'zgaruvchilari:
// --card, --muted, --border, --radius) — shuning uchun dark/light rejim va
// tanlangan rang-temaga avtomatik moslashadi, hech qanday hardcoded rang yo'q.
import { useEffect, useRef, useState } from "react";

let stylesInjected = false;
function useInjectSkeletonStyles() {
  useEffect(() => {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement("style");
    style.setAttribute("data-skeleton-system", "true");
    style.textContent = `
      @keyframes skeleton-shimmer {
        0% { background-position: -150% 0; }
        100% { background-position: 150% 0; }
      }
      .skel-shimmer {
        background-image: linear-gradient(
          100deg,
          var(--muted) 30%,
          color-mix(in srgb, var(--muted) 45%, var(--card)) 50%,
          var(--muted) 70%
        );
        background-size: 250% 100%;
        animation: skeleton-shimmer 1.7s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .skel-shimmer { animation: none; opacity: 0.7; }
      }
    `;
    document.head.appendChild(style);
  }, []);
}

// ── Asosiy bo'lak — hamma boshqa skeleton shundan yig'iladi ────────────────
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  useInjectSkeletonStyles();
  return <div aria-hidden="true" className={`skel-shimmer rounded-md ${className}`} style={style} />;
}

export function SkeletonText({ lines = 1, className = "", lastLineWidth = "60%" }: { lines?: number; className?: string; lastLineWidth?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: i === lines - 1 && lines > 1 ? lastLineWidth : "100%" }} />
      ))}
    </div>
  );
}

export function SkeletonAvatar({ size = 40, className = "" }: { size?: number; className?: string }) {
  return <Skeleton className={`rounded-full flex-shrink-0 ${className}`} style={{ width: size, height: size }} />;
}

export function SkeletonButton({ width = 96, className = "" }: { width?: number | string; className?: string }) {
  return <Skeleton className={`h-9 rounded-full flex-shrink-0 ${className}`} style={{ width }} />;
}

export function SkeletonInput({ className = "" }: { className?: string }) {
  return <Skeleton className={`h-11 rounded-2xl w-full ${className}`} />;
}

export function SkeletonIcon({ size = 20 }: { size?: number }) {
  return <Skeleton className="rounded-lg flex-shrink-0" style={{ width: size, height: size }} />;
}

// ── Card (statistika/dashboard kartalari) ───────────────────────────────────
export function SkeletonCard({ withIcon = true }: { withIcon?: boolean }) {
  return (
    <div className="surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        {withIcon && <SkeletonIcon size={28} />}
        <Skeleton className="h-2.5 w-2/5" />
      </div>
      <Skeleton className="h-6 w-3/5" />
    </div>
  );
}

export function SkeletonCardGrid({ count = 4, cols = "grid-cols-2 sm:grid-cols-4" }: { count?: number; cols?: string }) {
  return (
    <div className={`grid ${cols} gap-3`}>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────
export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 px-3 py-3 border-b border-border/50 last:border-0">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-3 flex-1" style={{ maxWidth: i === 0 ? "40%" : undefined }} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4, withHeader = true }: { rows?: number; cols?: number; withHeader?: boolean }) {
  return (
    <div className="surface overflow-hidden" aria-busy="true" aria-label="Yuklanmoqda">
      {withHeader && (
        <div className="flex items-center gap-4 px-3 py-3 border-b border-border bg-muted/40">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-2.5 flex-1" style={{ maxWidth: 90 }} />
          ))}
        </div>
      )}
      {Array.from({ length: rows }).map((_, i) => <SkeletonTableRow key={i} cols={cols} />)}
    </div>
  );
}

// ── List (foydalanuvchilar, obyektlar, xabarlar ro'yxati) ──────────────────
export function SkeletonListItem({ withAvatar = true }: { withAvatar?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      {withAvatar && <SkeletonAvatar size={40} />}
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-2.5 w-3/5" />
      </div>
    </div>
  );
}

export function SkeletonList({ items = 5, withAvatar = true }: { items?: number; withAvatar?: boolean }) {
  return (
    <div className="surface divide-y divide-border/50" aria-busy="true" aria-label="Yuklanmoqda">
      {Array.from({ length: items }).map((_, i) => <SkeletonListItem key={i} withAvatar={withAvatar} />)}
    </div>
  );
}

// ── Chat ────────────────────────────────────────────────────────────────
export function SkeletonMessage({ mine = false }: { mine?: boolean }) {
  const width = 40 + Math.round(((mine ? 7 : 3) * 37) % 45); // deterministik, tasodifiy ko'rinadigan kenglik
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} px-3`}>
      <Skeleton className={`h-9 ${mine ? "rounded-br-sm" : "rounded-bl-sm"} rounded-2xl`} style={{ width: `${width}%`, maxWidth: 260 }} />
    </div>
  );
}

export function SkeletonChat() {
  const pattern = [false, false, true, false, true, true, false];
  return (
    <div className="flex flex-col h-full">
      <div className="w-56 flex-shrink-0 border-r border-border">
        <SkeletonList items={6} />
      </div>
      <div className="flex-1 flex flex-col justify-end gap-2 p-3" aria-busy="true" aria-label="Xabarlar yuklanmoqda">
        {pattern.map((mine, i) => <SkeletonMessage key={i} mine={mine} />)}
      </div>
    </div>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────
export function SkeletonProfile() {
  return (
    <div className="max-w-lg mx-auto w-full space-y-4 p-4" aria-busy="true" aria-label="Profil yuklanmoqda">
      <Skeleton className="w-full rounded-2xl" style={{ height: 180 }} />
      <div className="surface p-5 flex flex-col items-center gap-3">
        <SkeletonAvatar size={72} />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <SkeletonList items={4} withAvatar={false} />
    </div>
  );
}

// ── Form ────────────────────────────────────────────────────────────────
export function SkeletonForm({ fields = 4, withButton = true }: { fields?: number; withButton?: boolean }) {
  return (
    <div className="space-y-3.5" aria-busy="true" aria-label="Yuklanmoqda">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-2.5 w-1/4" />
          <SkeletonInput />
        </div>
      ))}
      {withButton && <Skeleton className="h-11 w-full rounded-full mt-2" />}
    </div>
  );
}

// ── Document / fayl qatori ─────────────────────────────────────────────────
export function SkeletonDocument() {
  return (
    <div className="flex items-center gap-3 px-3 py-3 border-b border-border/50 last:border-0">
      <SkeletonIcon size={32} />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-2.5 w-1/4" />
      </div>
      <Skeleton className="h-2.5 w-12" />
      <SkeletonButton width={32} className="!h-8 !rounded-lg" />
    </div>
  );
}

// ── Notification / bildirishnoma ────────────────────────────────────────
export function SkeletonNotification() {
  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <SkeletonAvatar size={32} />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-2.5 w-4/5" />
      </div>
    </div>
  );
}

// ── Search natijalari ────────────────────────────────────────────────────
export function SkeletonSearchResults({ items = 4 }: { items?: number }) {
  return (
    <div className="space-y-1" aria-busy="true" aria-label="Qidirilmoqda">
      {Array.from({ length: items }).map((_, i) => <SkeletonListItem key={i} />)}
    </div>
  );
}

// ── Dashboard (bir necha karta + jadval) ─────────────────────────────────
export function SkeletonDashboard() {
  return (
    <div className="p-3 space-y-3" aria-busy="true" aria-label="Sahifa yuklanmoqda">
      <div className="surface px-4 py-3 flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <SkeletonButton width={110} />
      </div>
      <SkeletonCardGrid count={4} />
      <SkeletonTable rows={5} cols={4} />
    </div>
  );
}

// ── Butun sahifa (header + kontent) — dastlabki yuklanish uchun ────────────
export function SkeletonPage({ variant = "dashboard" }: { variant?: "dashboard" | "table" | "list" | "chat" | "profile" | "form" }) {
  const body = {
    dashboard: <SkeletonDashboard />,
    table: <div className="p-3"><SkeletonTable rows={7} /></div>,
    list: <div className="p-3"><SkeletonList items={7} /></div>,
    chat: <SkeletonChat />,
    profile: <SkeletonProfile />,
    form: <div className="p-4 max-w-md mx-auto"><SkeletonForm fields={5} /></div>,
  }[variant];
  return (
    <div className="flex flex-col h-full overflow-hidden page-enter">
      {body}
    </div>
  );
}

// ── Threshold hook — 200ms'dan tez tugagan loadinglar uchun skeleton
// miltillamasin (talab #27). Masalan: const showSkel = useLoadingThreshold(isLoading);
export function useLoadingThreshold(isLoading: boolean, thresholdMs = 200): boolean {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isLoading) {
      timerRef.current = setTimeout(() => setShow(true), thresholdMs);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShow(false);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isLoading, thresholdMs]);
  return show;
}
