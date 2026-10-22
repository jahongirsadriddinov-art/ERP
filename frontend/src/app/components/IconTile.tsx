import type { CSSProperties, ReactNode } from "react";
import { MorphIcon, type IconNode } from "morphicons/react";

// ─── Premium ikonkalar ─────────────────────────────────────────────────────────
// AppIcon — butun ilova bo'ylab bir xil o'lcham/chiziq qalinligidagi ikonka (MorphIcon ustida).
// IconTile — ikonka uchun "plitka": gradient yoki yumshoq (duotone) fon, ichki yorug'lik, nozik soya.
// Rangi `tone` orqali tanlanadi; "brand" — joriy rang mavzusining primary/accent'i (har mavzuda mos).
// Uslublar: styles/globals.css → ".icon-tile".

export type IconTone = "brand" | "blue" | "sky" | "teal" | "green" | "lime" | "amber" | "orange" | "rose" | "red" | "violet" | "slate";
export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

const ICON_PX: Record<IconSize, number> = { xs: 14, sm: 16, md: 20, lg: 22, xl: 26 };
// Plitka o'lchami: xs 24 · sm 32 · md 40 · lg 48 · xl 56 px — ichidagi ikonka mutanosib
const GLYPH_PX: Record<IconSize, number> = { xs: 13, sm: 16, md: 19, lg: 22, xl: 26 };

export function AppIcon({ icon, size = "md", className = "", strokeWidth, style }:
  { icon: IconNode; size?: IconSize | number; className?: string; strokeWidth?: number; style?: CSSProperties }) {
  const px = typeof size === "number" ? size : ICON_PX[size];
  return <MorphIcon icon={icon} className={`flex-shrink-0 ${className}`} style={{ width: px, height: px, ...style }} strokeWidth={strokeWidth ?? 1.8} />;
}

/**
 * Premium ikonka plitkasi.
 * - variant="solid": to'yingan gradient, oq ikonka (navigatsiya, asosiy kartalar)
 * - variant="soft": och rangli fon, rangli ikonka (sozlamalar qatorlari, ro'yxatlar)
 * - variant="glass": shaffof oq (rangli/qorong'i fon ustida)
 */
export function IconTile({ icon, tone = "brand", size = "md", variant = "soft", className = "", children, style, label }:
  { icon?: IconNode; tone?: IconTone; size?: IconSize; variant?: "solid" | "soft" | "glass"; className?: string; children?: ReactNode; style?: CSSProperties; label?: string }) {
  return (
    <span className={`icon-tile icon-tile--${variant} icon-tile--${size} tone-${tone} ${className}`} style={style}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {icon ? <AppIcon icon={icon} size={GLYPH_PX[size]} className="icon-tile__glyph" strokeWidth={variant === "solid" ? 2 : 1.9} /> : children}
    </span>
  );
}

export default IconTile;
