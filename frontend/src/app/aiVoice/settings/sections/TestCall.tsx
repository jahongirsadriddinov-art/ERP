import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MorphIcon } from "morphicons/react";
import Send from "@hugeicons/core-free-icons/SentIcon";
import Play from "@hugeicons/core-free-icons/PlayIcon";
import type { SectionProps } from "../sectionProps";
import { adminApi, type ApiResult } from "../api";
import { Card, Chip, Notice } from "../ui";

// Sinov: bot orqali FAQAT o'ziga sinov xabari (boshqa xodimga yuborib bo'lmaydi — server ham tekshiradi) va
// tanlangan smena uchun davomat so'rovini hozir boshlash (qo'lda dedupe kaliti — takroran bosish xavfsiz).
export default function TestCall({ draft, view }: Pick<SectionProps, "draft" | "view">) {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.test.${s}`);
  const [busy, setBusy] = useState("");
  const [shiftId, setShiftId] = useState(draft.attendance.shifts[0]?.id || "");
  const errText = (r: ApiResult<unknown>) =>
    r.ok ? "" : r.status === 0 ? t("aiVoice.common.network") : t(`aiVoice.admin.test.errors.${r.error}`, t("aiVoice.common.error"));

  const send = async () => {
    setBusy("test");
    const r = await adminApi.sendTest();
    setBusy("");
    if (r.ok) toast.success(k("sent")); else toast.error(errText(r));
  };
  const run = async () => {
    setBusy("run");
    const r = await adminApi.runNow(shiftId);
    setBusy("");
    if (r.ok) toast.success(r.data.duplicate ? k("runNowDup") : k("runNowOk")); else toast.error(errText(r));
  };
  const off = !view.status.aiVoiceEnabled || !view.settings.enabled;

  return (
    <div className="space-y-4">
      {off && <Notice tone="warn">{t("aiVoice.admin.test.errors.ai_disabled")}</Notice>}
      <Card icon={Send} title={k("title")} hint={k("hint")}>
        <button type="button" onClick={send} disabled={!!busy} data-testid="ai-test-send"
          className="btn btn-primary h-11 px-4 rounded-xl text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60">
          <MorphIcon icon={Send} className="w-4 h-4" /> {busy === "test" ? "…" : k("send")}
        </button>
      </Card>
      <Card icon={Play} title={k("runNow")} hint={k("runNowHint")}>
        {draft.attendance.shifts.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {draft.attendance.shifts.map((s) => <Chip key={s.id} active={s.id === shiftId} onClick={() => setShiftId(s.id)}>{s.name || s.id}</Chip>)}
          </div>
        )}
        <button type="button" onClick={run} disabled={!!busy || !shiftId} data-testid="ai-run-now"
          className="h-11 px-4 rounded-xl border border-primary/40 text-primary text-sm font-bold hover:bg-primary/10 inline-flex items-center gap-2 disabled:opacity-60">
          <MorphIcon icon={Play} className="w-4 h-4" /> {busy === "run" ? "…" : k("runNow")}
        </button>
      </Card>
    </div>
  );
}
