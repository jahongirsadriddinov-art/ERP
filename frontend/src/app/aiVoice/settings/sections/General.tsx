import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import Clock from "@hugeicons/core-free-icons/Time04Icon";
import type { SectionProps } from "../sectionProps";
import { Field, SelectField, Toggle } from "../ui";

// "Til va ovoz" (Qo'shimcha sozlamalar ichida): til, ovoz, ogohlantirish matni, eski eslatma, o'rinbosar huquqi.
// AI'ni yoqish va ertalabki so'rov — asosiy ekranda. Vaqt zonasi o'zgarmaydi (Toshkent).
const VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];

export default function General({ view, draft, update }: SectionProps) {
  const { t } = useTranslation();
  const k = (s: string) => t(`aiVoice.admin.general.${s}`);
  const voices = VOICES.includes(draft.voiceName) ? VOICES : [draft.voiceName, ...VOICES];
  return (
    <div className="space-y-4" data-testid="ai-talk">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SelectField label={k("language")} value={draft.language}
          options={(["uz", "ru", "auto"] as const).map((v) => ({ value: v, label: t(`aiVoice.admin.general.languages.${v}`) }))}
          onChange={(v) => update((d) => ({ ...d, language: v }))} />
        <SelectField label={k("voice")} value={draft.voiceName} options={voices.map((v) => ({ value: v, label: v }))}
          onChange={(v) => update((d) => ({ ...d, voiceName: v }))} />
      </div>
      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5" data-testid="ai-timezone">
        <MorphIcon icon={Clock} className="w-3.5 h-3.5" />{t("aiVoice.ui.general.tz")}
      </p>
      <Field label={k("disclosure")} hint={k("disclosureHint")}>
        <textarea value={draft.disclosureText || ""} maxLength={300} rows={2}
          onChange={(e) => update((d) => ({ ...d, disclosureText: e.target.value }))}
          className="w-full rounded-xl border border-border bg-card/70 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-y" />
      </Field>
      <div className="rounded-xl border border-border bg-card/60 px-3 divide-y divide-border/60">
        <Toggle checked={draft.attendance.suppressLegacyMorningReminder} label={k("suppressLegacy")} hint={k("suppressLegacyHint")}
          onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, suppressLegacyMorningReminder: v } }))} />
        <Toggle checked={draft.attendance.orinbosarCanEditSchedule} label={k("orinbosarEdit")} hint={k("orinbosarEditHint")}
          disabled={!view.editor.canEditBossRows}
          onChange={(v) => update((d) => ({ ...d, attendance: { ...d.attendance, orinbosarCanEditSchedule: v } }))} />
      </div>
    </div>
  );
}
