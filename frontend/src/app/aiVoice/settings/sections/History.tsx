import { useTranslation } from "react-i18next";
import Archive from "@hugeicons/core-free-icons/Archive02Icon";
import { adminApi } from "../api";
import { Card, Notice } from "../ui";
import AuditLog from "./AuditLog";
import Archives from "./Archives";

// Tarix: AI amallari (audit) + suhbatlar arxivi (7 kundan keyin fayl). Faqat o'z firmasi.
// Arxivni faqat egasi/direktor ko'radi (server o'rinbosarga 403) — o'rinbosarga sababi yoziladi, so'rov yuborilmaydi.
const fetchArchives = () => adminApi.getArchives();

export default function History({ canArchives = true }: { canArchives?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <AuditLog />
      {canArchives ? <Archives fetcher={fetchArchives} urlOf={adminApi.archiveUrl} /> : (
        <Card icon={Archive} title={t("aiVoice.ui.history.archTitle")} hint={t("aiVoice.ui.history.archHint")} testId="ai-archives">
          <Notice tone="lock" testId="ai-archives-locked">{t("aiVoice.ui.history.archBossOnly")}</Notice>
        </Card>
      )}
    </div>
  );
}
