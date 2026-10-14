import { useTranslation } from "react-i18next";
import Bell from "@hugeicons/core-free-icons/Notification03Icon";
import { ComingSoonCard } from "./ComingSoonCard";

// AI ovozli yordamchi — har bir xodimning shaxsiy sozlamalari (rozilik, kanal tartibi, voz kechish). STUB (P1):
// P8 /api/ai-voice/me orqali to'ldiradi (rozilik va opt-out'ni faqat xodimning o'zi o'zgartiradi).
export default function MyAiPrefsPanel() {
  const { t } = useTranslation();
  return (
    <ComingSoonCard testId="ai-prefs-panel" icon={Bell}
      title={t("aiVoice.prefs.title")} subtitle={t("aiVoice.prefs.subtitle")}
      features={[
        t("aiVoice.prefs.features.consent"),
        t("aiVoice.prefs.features.channels"),
        t("aiVoice.prefs.features.optOut"),
      ]} />
  );
}
