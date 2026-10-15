import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import UserIcon from "@hugeicons/core-free-icons/UserCircleIcon";
import type { RoleGroup } from "./aiAccess";

// Rolga mos qisqa izoh (owner 2026-10-15 a): har bir rol faqat O'ZI nima qila olishini o'qiydi.
// admin — firma sozlamalari (direktor/egasi yoki o'rinbosar), prefs — shaxsiy sozlamalar (hamma rol).
export default function RoleHelp({ area, group }: { area: "admin" | "prefs"; group: RoleGroup }) {
  const { t } = useTranslation();
  const g: RoleGroup = area === "admin" ? (group === "deputy" ? "deputy" : "boss") : group === "developer" ? "boss" : group;
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2.5" data-testid={`ai-role-help-${g}`}>
      <MorphIcon icon={UserIcon} className="w-4 h-4 text-primary flex-shrink-0 mt-px" />
      <p className="text-xs leading-relaxed min-w-0">
        <span className="font-bold">{t(`aiVoice.ui.roleHelp.roleName.${g}`)}: </span>
        <span className="text-muted-foreground">{t(`aiVoice.ui.roleHelp.${area}.${g}`)}</span>
      </p>
    </div>
  );
}
