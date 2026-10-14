import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Settings from "@hugeicons/core-free-icons/Settings02Icon";
import Calendar from "@hugeicons/core-free-icons/Calendar03Icon";
import Lock from "@hugeicons/core-free-icons/LockIcon";
import type { SectionProps } from "../sectionProps";
import { Card, Field, SelectField, Toggle } from "../ui";

// Umumiy: AI'ni yoqish, til, ovoz, vaqt zonasi (faqat o'qish), ogohlantirish matni, davomat bayroqlari.
const VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];

export default function General({ view, draft, update }: SectionProps) {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.general.${s}`);
  const voices = VOICES.includes(draft.voiceName) ? VOICES : [draft.voiceName, ...VOICES];
  return (
    <div className="space-y-4">
      <Card icon={Settings} title={t("aiVoice.admin.tabs.general")}>
        <div className="rounded-xl border border-border bg-card/60 px-3 mb-3">
          <Toggle testId="ai-enabled" checked={draft.enabled} label={<span className="font-bold">{k("enabled")}</span>} hint={k("enabledHint")}
            onChange={(v) => update((d) => ({ ...d, enabled: v }))} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField label={k("language")} value={draft.language}
            options={(["uz", "ru", "auto"] as const).map((v) => ({ value: v, label: t(`aiVoice.admin.general.languages.${v}`) }))}
            onChange={(v) => update((d) => ({ ...d, language: v }))} />
          <SelectField label={k("voice")} value={draft.voiceName} options={voices.map((v) => ({ value: v, label: v }))}
            onChange={(v) => update((d) => ({ ...d, voiceName: v }))} />
          <Field label={k("timezone")} hint={k("timezoneHint")}>
            <div className="h-10 rounded-xl border border-border bg-muted/30 px-3 text-sm flex items-center gap-2 text-muted-foreground" data-testid="ai-timezone">
              <MorphIcon icon={Lock} className="w-4 h-4" /> Asia/Tashkent (UTC+5)
            </div>
          </Field>
          <Field label={k("disclosure")} hint={k("disclosureHint")}>
            <textarea value={draft.disclosureText || ""} maxLength={300} rows={2}
              onChange={(e) => update((d) => ({ ...d, disclosureText: e.target.value }))}
              className="w-full rounded-xl border border-border bg-card/70 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-y" />
          </Field>
        </div>
      </Card>
      <Card icon={Calendar} title={k("attendance")} hint={k("attendanceHint")}>
        <div className="divide-y divide-border/60">
          <Toggle checked={draft.attendance.enabled} label={k("attendance")}
            onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, enabled: v } }))} />
          <Toggle checked={draft.attendance.suppressLegacyMorningReminder} label={k("suppressLegacy")} hint={k("suppressLegacyHint")}
            onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, suppressLegacyMorningReminder: v } }))} />
          <Toggle checked={draft.attendance.orinbosarCanEditSchedule} label={k("orinbosarEdit")} hint={k("orinbosarEditHint")}
            disabled={!view.editor.canEditBossRows}
            onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, orinbosarCanEditSchedule: v } }))} />
        </div>
      </Card>
    </div>
  );
}
