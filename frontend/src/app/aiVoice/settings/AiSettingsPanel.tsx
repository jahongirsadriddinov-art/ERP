import { useTranslation } from "react-i18next";
import AiPhone from "@hugeicons/core-free-icons/AiPhone01Icon";
import { ComingSoonCard } from "./ComingSoonCard";

// AI ovozli yordamchi — firma sozlamalari (direktor / o'rinbosar / egasi). STUB (P1):
// P8 bo'limlarni (Umumiy, Jadval, Kanallar, Xodimlar, Rollar, Provayder, Limitlar, Audit, Test) qo'shadi.
export default function AiSettingsPanel() {
  const { t } = useTranslation();
  return (
    <ComingSoonCard testId="ai-settings-panel" icon={AiPhone}
      title={t("aiVoice.admin.title")} subtitle={t("aiVoice.admin.subtitle")}
      features={[
        t("aiVoice.admin.features.schedule"),
        t("aiVoice.admin.features.channels"),
        t("aiVoice.admin.features.employees"),
        t("aiVoice.admin.features.tools"),
      ]} />
  );
}
