import { MorphIcon } from "morphicons/react";
import Check from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Clock from "@hugeicons/core-free-icons/Time04Icon";
import { useTranslation } from "react-i18next";

// AI ovozli yordamchi sozlamalari uchun umumiy "tez orada" kartasi (P8 haqiqiy panellar bilan almashtiradi).
// Dizayn — DataSafety/Profil panellari bilan bir xil: shisha yuza, yumaloq, chegarali.
export function ComingSoonCard({ icon, title, subtitle, features, testId }: {
  icon: any; title: string; subtitle: string; features: string[]; testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <div data-testid={testId} className="surface border border-border rounded-2xl overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <div className="icon-chip w-11 h-11 rounded-xl"><MorphIcon icon={icon} className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold">{title}</p>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25">
              <MorphIcon icon={Clock} className="w-3 h-3" />
              {t("aiVoice.soonBadge")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        </div>
      </div>
      {features.length > 0 && (
        <ul className="px-4 pb-4 space-y-2">
          {features.map(f => (
            <li key={f} className="flex items-start gap-2.5 rounded-xl border border-border bg-card/60 px-3 py-2.5">
              <MorphIcon icon={Check} className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span className="text-sm min-w-0">{f}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="px-4 py-3 border-t border-border/60 bg-muted/20">
        <p className="text-[11px] text-muted-foreground">{t("aiVoice.soonNote")}</p>
      </div>
    </div>
  );
}
