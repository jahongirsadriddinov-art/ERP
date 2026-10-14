import { useTranslation } from "react-i18next";
import Telegram from "@hugeicons/core-free-icons/TelegramIcon";
import { ComingSoonCard } from "./ComingSoonCard";

// AI Telegram hisobi (Dasturchi paneli). STUB (P1): P8 telefon → kod → 2FA qadamlarini qo'shadi
// (autocomplete="one-time-code", yuborilgach tozalanadi, localStorage'ga HECH QACHON yozilmaydi).
export default function TelegramAccountPanel() {
  const { t } = useTranslation();
  return (
    <ComingSoonCard testId="ai-telegram-panel" icon={Telegram}
      title={t("aiVoice.telegram.title")} subtitle={t("aiVoice.telegram.subtitle")}
      features={[
        t("aiVoice.telegram.features.login"),
        t("aiVoice.telegram.features.health"),
      ]} />
  );
}
